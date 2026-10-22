import { createHash } from 'node:crypto';
import { DEPARTMENT_REGISTRY, MASTER_SOURCE_PROFILE, validateMasterSourceHeader } from '@aemr/shared';
import { sheetFingerprint } from './sheet-fingerprint.js';
/**
 * book-watermark.ts — водяной знак книги и честные пропуски журнала.
 *
 * Проект «служба, а не снимок» (docs/superpowers/specs/2026-08-22-seamless-
 * service.md):
 *
 *  • §2.4 — у каждой книги в БАЗЕ хранится момент последнего успешно
 *    разобранного состояния и отпечаток содержимого. База сравнения переживает
 *    перезапуск: первое чтение после подъёма сравнивается с тем, что было до
 *    падения, а не с пустотой. Рядом лежит отметка версии файла Drive — чтобы
 *    и ворота «а файл вообще менялся» переживали рестарт.
 *
 *  • §2.2, правило полноты — если отметка времени файла говорит «книга
 *    менялась», а все содержательные свидетели молчат (отпечаток тот же),
 *    в журнал пишется запись «изменение было, содержание не установлено».
 *    Это и есть гарантия: не «мы ничего не потеряли», а «мы знаем обо всём,
 *    что потеряли».
 *
 * Отказ БД не равен пустому состоянию или успешному сохранению. Вызывающий
 * оставляет попытку незавершённой и повторяет её после устранения отказа.
 */
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

/** Ключ водяного знака листа СВОД — он не книга ГРБС, но база сравнения нужна и ему. */
export const SVOD_WATERMARK_KEY = 'лист СВОД';

export interface Watermark {
  fingerprint: string;
  parsedAt: string;
  driveVersion: string | null;
  driveModifiedTime: string | null;
}

/** Все водяные знаки из базы — для посева памяти цикла после рестарта. */
export function loadWatermarks(): Map<string, Watermark> {
  const out = new Map<string, Watermark>();
  try {
    const rows = db
      .select()
      .from(schema.bookWatermarks)
      .all();
    for (const row of rows) {
      out.set(row.book, {
        fingerprint: row.fingerprint,
        parsedAt: row.parsedAt,
        driveVersion: row.driveVersion,
        driveModifiedTime: row.driveModifiedTime,
      });
    }
  } catch (cause) {
    throw new Error("SOURCE_STATE_READ_FAILED", { cause });
  }
  return out;
}

/** Записать водяной знак после успешного разбора книги (upsert по книге). */
export function saveWatermark(
  book: string,
  fingerprint: string,
  parsedAt: string,
  drive?: { version: string | null; modifiedTime: string | null },
  accepted?: { fileId: string; values: unknown[][] },
): void {
  try {
    if (accepted && (!accepted.fileId || sheetFingerprint(accepted.values) !== fingerprint))
      throw new Error('INVALID_ACCEPTED_SOURCE');
    db.insert(schema.bookWatermarks)
      .values({
        book,
        fingerprint,
        parsedAt,
        driveVersion: drive?.version ?? null,
        driveModifiedTime: drive?.modifiedTime ?? null,
        sourceFileId: accepted?.fileId ?? null,
        readingJson: accepted ? JSON.stringify(accepted.values) : null,
      })
      .onConflictDoUpdate({
        target: schema.bookWatermarks.book,
        set: {
          fingerprint,
          parsedAt,
          driveVersion: drive?.version ?? null,
          driveModifiedTime: drive?.modifiedTime ?? null,
          sourceFileId: accepted?.fileId ?? null,
          readingJson: accepted ? JSON.stringify(accepted.values) : null,
        },
      })
      .run();
  } catch (cause) {
    throw new Error("SOURCE_STATE_PERSIST_FAILED", { cause });
  }
}

/**
 * Записать честный пропуск: изменение было, содержание не установлено.
 * Один и тот же пропуск (книга + отметка файла) не пишется дважды — повторная
 * перечитка того же немого изменения не делает пропуск вторым.
 */
export function noteHonestGap(
  book: string,
  fileModifiedTime: string | null,
  now: Date = new Date(),
): boolean {
  try {
    const inserted = db
      .insert(schema.journalGaps)
      .values({ book, fileModifiedTime, notedAt: now.toISOString() })
      .onConflictDoNothing()
      .run();
    return inserted.changes > 0;
  } catch (cause) {
    throw new Error("SOURCE_STATE_PERSIST_FAILED", { cause });
  }
}

export interface JournalGap {
  book: string;
  fileModifiedTime: string | null;
  notedAt: string;
}

/** Свежие честные пропуски — для журнала и стражей. */
export function recentGaps(limit = 50): JournalGap[] {
  try {
    return db
      .select({
        book: schema.journalGaps.book,
        fileModifiedTime: schema.journalGaps.fileModifiedTime,
        notedAt: schema.journalGaps.notedAt,
      })
      .from(schema.journalGaps)
      .orderBy(desc(schema.journalGaps.id))
      .limit(limit)
      .all();
  } catch (cause) {
    throw new Error("SOURCE_STATE_READ_FAILED", { cause });
  }
}

/** Только для стражей: вычистить знаки и пропуски. */
export function resetWatermarks(): void {
  try {
    db.delete(schema.bookWatermarks).run();
    db.delete(schema.journalGaps).run();
  } catch (cause) {
    throw new Error("SOURCE_STATE_PERSIST_FAILED", { cause });
  }
}

/** Водяной знак одной книги — для стражей и точечных вопросов. */
export function watermarkOf(book: string): Watermark | null {
  try {
    const row = db
      .select()
      .from(schema.bookWatermarks)
      .where(eq(schema.bookWatermarks.book, book))
      .all()[0];
    if (!row) return null;
    return {
      fingerprint: row.fingerprint,
      parsedAt: row.parsedAt,
      driveVersion: row.driveVersion,
      driveModifiedTime: row.driveModifiedTime,
    };
  } catch (cause) {
    throw new Error("SOURCE_STATE_READ_FAILED", { cause });
  }
}


/** One current accepted matrix per source, used for comparison after restart. */
export function loadAcceptedReadings(): Map<string, { fileId: string; values: unknown[][] }> {
  try {
    const result = new Map<string, { fileId: string; values: unknown[][] }>();
    for (const row of db.select().from(schema.bookWatermarks).all()) {
      if (row.readingJson === null && row.sourceFileId === null) continue; // Legacy baseline is unknown.
      if (!row.readingJson || !row.sourceFileId) throw new Error('INCOMPLETE_ACCEPTED_SOURCE');
      const values = JSON.parse(row.readingJson) as unknown;
      if (!Array.isArray(values) || !values.every(Array.isArray) || sheetFingerprint(values) !== row.fingerprint)
        throw new Error('INVALID_ACCEPTED_SOURCE');
      result.set(row.book, { fileId: row.sourceFileId, values });
    }
    return result;
  } catch (cause) {
    throw new Error('SOURCE_STATE_READ_FAILED', { cause });
  }
}


/** Source revisions cannot be reused after a profile, formula, gid or permission
 * contract change merely because Google row bytes and Drive versions are equal.
 * Derive this from the single reviewed directory, not from another registry.
 */
const MASTER_SOURCE_CONTRACT_HASH = createHash('sha256').update(JSON.stringify({
  profile: MASTER_SOURCE_PROFILE,
  bindings: [...DEPARTMENT_REGISTRY].sort((a, b) => a.id.localeCompare(b.id))
    .map(({ id, source, approvedPrimaryRename }) => ({ id, source, approvedPrimaryRename: !!approvedPrimaryRename })),
})).digest('hex');

/** Receipt of accepted source state, independent of the last time it was re-read. */
export function sourceStateReceipt(bindings: Readonly<Record<string, string>>, mainFileId: string,
  current: Readonly<Record<string, { values: unknown[][] }>> = {}): string | null {
  const rows = db.select({ book: schema.bookWatermarks.book, fingerprint: schema.bookWatermarks.fingerprint,
    fileId: schema.bookWatermarks.sourceFileId, version: schema.bookWatermarks.driveVersion,
    modified: schema.bookWatermarks.driveModifiedTime }).from(schema.bookWatermarks).all();
  const byBook = new Map(rows.map(row => [row.book, row]));
  const expected: Record<string, string> = { ...bindings, [SVOD_WATERMARK_KEY]: mainFileId };
  const receipt = [];
  for (const book of Object.keys(expected).sort()) {
    const mark = byBook.get(book);
    const accepted = current[book];
    // Stored watermarks alone do not prove that a current consumer has an
    // admitted source. Keep last published evidence, but do not reuse its
    // active calculations as if all source books were loaded.
    if (!mark || mark.fileId !== expected[book] || !accepted
      || sheetFingerprint(accepted.values) !== mark.fingerprint) return null;
    if (book !== SVOD_WATERMARK_KEY) {
      try {
        validateMasterSourceHeader(accepted.values[MASTER_SOURCE_PROFILE.headerRows - 1] ?? []);
      } catch {
        return null;
      }
    }
    receipt.push(mark);
  }
  return createHash('sha256').update(JSON.stringify({
    sourceContract: MASTER_SOURCE_CONTRACT_HASH,
    acceptedWatermarks: receipt,
  })).digest('hex');
}
