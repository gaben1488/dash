/**
 * Durable, bounded evidence from Google Sheets integrity checks.
 *
 * One SQLite row per (book, check kind). Formula attempt + last successful verdict
 * are one atomic payload: a parser/network failure must not turn yesterday's
 * verdict into today's clean bill of health. Store diagnostics, never entire grids.
 */
import { eq } from 'drizzle-orm';
import { DEPARTMENT_SPREADSHEETS } from '../config.js';
import { db, schema } from '../db/index.js';
import { METADATA_CANON } from './metadata-canon.js';
import type { BookFormulaVerdict } from './formula-sink.js';
import type { FormulaDeliveryNote } from './source-refresh.js';
import type { BookWatchResult } from './metadata-watch.js';

type Kind = 'formulas' | 'metadata';
interface FormulaAudit { delivery: FormulaDeliveryNote; verdict: BookFormulaVerdict | null }
export interface MetadataAudit { attempt: BookWatchResult; lastConfirmed: BookWatchResult | null }

const FORMULA_VERSION = 'formula-integrity/1';
const METADATA_VERSION = `metadata-watch/2:${METADATA_CANON.syncedAt}`;
const warnings = new Set<string>();

function version(kind: Kind): string {
  return kind === 'formulas' ? FORMULA_VERSION : METADATA_VERSION;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function validAt(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
function validDelivery(value: unknown, book: string): value is FormulaDeliveryNote {
  return isObject(value)
    && value.book === book && validAt(value.at)
    && Number.isSafeInteger(value.cells) && (value.cells as number) >= 0
    && typeof value.handled === 'boolean' && value.persisted === true
    && (value.formulasRead === undefined || typeof value.formulasRead === 'boolean')
    && (value.failedBecause === undefined || typeof value.failedBecause === 'string');
}
function validVerdict(value: unknown, book: string): value is BookFormulaVerdict {
  return isObject(value)
    && value.book === book && validAt(value.at)
    && Number.isSafeInteger(value.rowsJudged) && (value.rowsJudged as number) >= 0
    && Array.isArray(value.defects)
    && value.defects.every((defect: unknown) => isObject(defect)
      && defect.book === book
      && typeof defect.kind === 'string' && typeof defect.column === 'string'
      && typeof defect.row === 'number' && typeof defect.cell === 'string'
      && typeof defect.rowSeq === 'string'
      && typeof defect.actual === 'string' && typeof defect.etalon === 'string'
      && (defect.etalonRow === null || typeof defect.etalonRow === 'number'));
}
function validMetadata(value: unknown, book: string): value is BookWatchResult {
  return isObject(value)
    && value.book === book && validAt(value.at)
    && typeof value.read === 'boolean' && value.persisted === true
    && (value.skippedBecause === undefined || typeof value.skippedBecause === 'string')
    && Array.isArray(value.remarks)
    && value.remarks.every((r: unknown) => isObject(r) && r.book === book
      && typeof r.kind === 'string' && typeof r.text === 'string'
      && typeof r.expected === 'string' && typeof r.actual === 'string');
}

/** Validation is done on read, not merely on write: DB might predate this code. */
function load<T>(kind: Kind, guard: (data: unknown, book: string) => data is T): T[] {
  // A read failure must not take the entire dashboard down. It must also not
  // create a false 'healthy' state from an empty array.
  let observations: (typeof schema.sourceIntegrityState.$inferSelect)[];
  try {
    observations = db.select().from(schema.sourceIntegrityState)
      .where(eq(schema.sourceIntegrityState.kind, kind)).all();
  } catch {
    // No database paths or SQL internals in the API response.
    warnings.add(`${kind}: SQLite недоступна — результаты контроля не восстановлены`);
    return [];
  }
  const result: T[] = [];
  for (const row of observations) {
    const sourceId = DEPARTMENT_SPREADSHEETS[row.book];
    if (!sourceId || sourceId !== row.sourceId || row.checkerVersion !== version(kind)) {
      warnings.add(`${kind}/${row.book}: прежний источник или версия контроля — требуется новая проверка`);
      continue;
    }
    try {
      const value: unknown = JSON.parse(row.stateJson);
      if (!guard(value, row.book)) throw new Error('неверная структура');
      result.push(value);
    } catch {
      warnings.add(`${kind}/${row.book}: запись повреждена — результат не подтверждён`);
    }
  }
  return result;
}

function save(kind: Kind, book: string, at: string, state: unknown): void {
  const sourceId = DEPARTMENT_SPREADSHEETS[book];
  if (!sourceId || !validAt(at)) throw new Error(`Неизвестная книга или время проверки: ${book}`);
  const row = {
    id: `${kind}:${book}`,
    kind,
    book,
    sourceId,
    checkerVersion: version(kind),
    observedAt: at,
    stateJson: JSON.stringify(state),
  };
  db.insert(schema.sourceIntegrityState).values(row)
    .onConflictDoUpdate({
      target: schema.sourceIntegrityState.id,
      set: {
        sourceId: row.sourceId,
        checkerVersion: row.checkerVersion,
        observedAt: row.observedAt,
        stateJson: row.stateJson,
      },
    }).run();
  warnings.delete(`${kind}/${book}: запись повреждена — результат не подтверждён`);
  warnings.delete(`${kind}/${book}: прежний источник или версия контроля — требуется новая проверка`);
}

export function loadFormulaAudits(): FormulaAudit[] {
  return load<FormulaAudit>('formulas', (value, book): value is FormulaAudit => {
    if (!isObject(value) || !validDelivery(value.delivery, book)) return false;
    if (value.verdict !== null && !validVerdict(value.verdict, book)) return false;
    return !value.delivery.handled || value.verdict === null
      || value.delivery.at === value.verdict.at;
  }).sort((a, b) => a.delivery.book.localeCompare(b.delivery.book, 'ru'));
}

/**
 * A successful check replaces the verdict; an unsuccessful check updates only
 * the attempt and keeps the older verdict with its original timestamp.
 * This write is one SQLite upsert, with no inconsistent two-table midpoint.
 */
export function saveFormulaAudit(delivery: FormulaDeliveryNote, newVerdict: BookFormulaVerdict | null): void {
  if (newVerdict && (newVerdict.book !== delivery.book || newVerdict.at !== delivery.at || !delivery.handled)) {
    throw new Error('Вердикт формул не соответствует попытке чтения');
  }
  const previous = newVerdict ? null
    : loadFormulaAudits().find((entry) => entry.delivery.book === delivery.book)?.verdict ?? null;
  save('formulas', delivery.book, delivery.at, {
    delivery: { ...delivery, persisted: true },
    verdict: newVerdict ?? previous,
  } satisfies FormulaAudit);
}

export function loadMetadataAudits(): MetadataAudit[] {
  return load<MetadataAudit>('metadata', (value, book): value is MetadataAudit => {
    if (!isObject(value) || !validMetadata(value.attempt, book)) return false;
    if (value.lastConfirmed === null) return true;
    return validMetadata(value.lastConfirmed, book)
      && value.lastConfirmed.read
      && Date.parse(value.lastConfirmed.at) <= Date.parse(value.attempt.at);
  }).sort((a, b) => a.attempt.book.localeCompare(b.attempt.book, 'ru'));
}

/** The most recent attempt can be a failure; consumers must inspect `read`. */
export function loadMetadataResults(): BookWatchResult[] {
  return loadMetadataAudits().map((entry) => entry.attempt);
}

export function saveMetadataResult(result: BookWatchResult): void {
  const previous = result.read ? null
    : loadMetadataAudits().find((entry) => entry.attempt.book === result.book)?.lastConfirmed ?? null;
  const attempt = { ...result, persisted: true };
  save('metadata', result.book, result.at, {
    attempt,
    lastConfirmed: result.read ? attempt : previous,
  } satisfies MetadataAudit);
}

/** Storage/contract warnings are explicit; invalid records never become '0 defects'. */
export function sourceIntegrityStorageWarnings(): string[] {
  return [...warnings].sort();
}
