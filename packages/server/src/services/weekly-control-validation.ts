/** Неизменённая проверка сохранённых недельных доказательств; без чтения live-кэша. */
import { eq, inArray } from 'drizzle-orm';
import { buildCellDict, DEPT_HEADER_ROWS, findDept, toGrbsId, GRBS_ID_TO_DEPARTMENT_ID } from '@aemr/shared';
import { MONITORING_DATA_SHEETS, type SnapshotRow } from '@aemr/core';
import { db, schema } from '../db/index.js';
import { DEPARTMENT_SPREADSHEETS } from '../config.js';
import { isDataRow } from './rows-dto.js';
import { orgLabel } from './procurement-row-view.js';
export { orgLabel } from './procurement-row-view.js';

export interface WeeklySnapshotRef {
  id: string;
  createdAt: string;
}

interface AtomRow {
  snapshotId: string | null;
  departmentId: string;
  rowIndex: number;
  cellsJson: string;
  subject: string | null;
  planAmount: number | null;
  factAmount: number | null;
}

/** Строки-атомы снимка, разложенные по управлению, в форме входа сравнения. */
export function atomsToSnapshotRows(atoms: readonly AtomRow[]): Map<string, SnapshotRow[]> {
  const byDept = new Map<string, SnapshotRow[]>();
  for (const atom of atoms) {
    let cells: Record<string, unknown>;
    try {
      cells = JSON.parse(atom.cellsJson) as Record<string, unknown>;
    } catch {
      // Повреждённый JSON строки учитывается отдельной проверкой целостности
      // контрольного среза; функция конвертации не утверждает полноту.
      continue;
    }
    // Один и тот же предикат для исторических атомов и текущего листа:
    // иначе строки шапки/разделов могут выглядеть «исчезнувшими закупками».
    if (!isDataRow({
      id: cells.A ?? '', subject: cells.G ?? '',
      method: String(cells.L ?? ''), planSum: atom.planAmount ?? 0,
    })) continue;
    const bucket = byDept.get(atom.departmentId) ?? [];
    bucket.push({
      rowSeq: String(cells.A ?? '').trim(),
      sheetRow: atom.rowIndex,
      subject: String(cells.G ?? atom.subject ?? '').trim(),
      subordinate: orgLabel(cells.C),
      ...(atom.planAmount === null ? {} : { planSum: atom.planAmount }),
      ...(atom.factAmount === null ? {} : { factSum: atom.factAmount }),
      method: String(cells.L ?? '').trim(),
    });
    byDept.set(atom.departmentId, bucket);
  }
  return byDept;
}

function readAtoms(snapshotIds: readonly string[]): AtomRow[] {
  if (snapshotIds.length === 0) return [];
  return db.select({
    snapshotId: schema.procurementRows.snapshotId,
    departmentId: schema.procurementRows.departmentId,
    rowIndex: schema.procurementRows.rowIndex,
    cellsJson: schema.procurementRows.cellsJson,
    subject: schema.procurementRows.subject,
    planAmount: schema.procurementRows.planAmount,
    factAmount: schema.procurementRows.factAmount,
  })
    .from(schema.procurementRows)
    .where(inArray(schema.procurementRows.snapshotId, [...snapshotIds]))
    .all();
}


interface SealedControlData {
  rowsByDept?: Record<string, unknown[][]>;
  weeklyTableContext?: {
    contract?: string;
    sealedAt?: string;
    masters?: Record<string, { formulasRead?: boolean }>;
    monitoring?: { sheets?: Record<string, unknown[][]> };
  };
}

/**
 * Историческое написание книги → постоянная ось управления. Источник алиасов
 * уже существует в @aemr/shared; никаких новых имён или ID в таблицах.
 */
function historicalDepartmentId(name: string): string | null {
  const direct = findDept(name);
  if (direct) return direct.latinId;
  const alias = toGrbsId(name);
  return alias ? findDept(GRBS_ID_TO_DEPARTMENT_ID[alias])?.latinId ?? null : null;
}

/** Не объединять две разные исторические записи, даже если обе ведут к одному ID. */
export function indexHistoricalDepartments<T>(
  sources: Record<string, T> | undefined,
): Map<string, T> | null {
  if (!sources || typeof sources !== 'object' || Array.isArray(sources)) return null;
  const result = new Map<string, T>();
  for (const [name, value] of Object.entries(sources)) {
    const id = historicalDepartmentId(name);
    if (!id || result.has(id)) return null;
    result.set(id, value);
  }
  return result;
}

/** Синтаксический сбой JSON, устаревшая схема и отсутствие данных — разные состояния. */
export function interpretWeeklySnapshotJson(raw: string | null | undefined):
  { source: SealedControlData | null; error: string | null } {
  if (!raw) return { source: null, error: 'В историческом снимке отсутствует сохранённый JSON; повреждение не доказано' };
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return { source: null, error: 'Сохранённый JSON контрольного снимка не разбирается (нарушен формат данных)' };
  }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    return { source: null, error: 'Исторический формат снимка не поддерживается; исходные данные не изменены' };
  }
  const source = decoded as SealedControlData;
  if (!source.weeklyTableContext) {
    return { source: null, error: 'В снимке этого поколения не сохранён полный недельный контекст; другие исторические данные доступны' };
  }
  const version = source.weeklyTableContext.contract;
  if (version && version !== 'dash-weekly-table-context-v1') {
    return { source: null, error: 'Версия недельного контекста пока не поддерживается: ' + String(version) };
  }
  return { source, error: null };
}

/**
 * Строки-атомы — только индексированный вариант данных snapshot.rowsByDept.
 * Проверяем ВСЮ популяцию контрольного среза до диффа: иначе один потерянный
 * атом выдаст ложную «новую закупку»/ложную тишину. Неполный weekly context
 * с маркером в JSON не является подтверждённой контрольной точкой.
 */
function validateBaselineRows(baseline: WeeklySnapshotRef):
  { rows: Map<string, SnapshotRow[]>; error: string | null } {
  const stored = db.select({ data: schema.snapshots.data })
    .from(schema.snapshots).where(eq(schema.snapshots.id, baseline.id)).get();
  const parsed = interpretWeeklySnapshotJson(stored?.data);
  if (!parsed.source) return { rows: new Map(), error: parsed.error };
  const source = parsed.source;

  const names = Object.keys(DEPARTMENT_SPREADSHEETS).sort();
  const expectedIds = names.map((name) => historicalDepartmentId(name));
  const context = source.weeklyTableContext;
  const masters = indexHistoricalDepartments(context?.masters);
  const monitoring = context?.monitoring?.sheets;
  const raw = indexHistoricalDepartments(source.rowsByDept);
  const matches = (actual: readonly string[], expected: readonly string[]) =>
    actual.length === expected.length && actual.every((name, i) => name === expected[i]);
  const fullSet = (entries: Map<string, unknown> | null): boolean =>
    entries !== null && entries.size === names.length &&
    expectedIds.every((id) => id !== null && entries.has(id));
  if (context?.contract !== 'dash-weekly-table-context-v1' ||
      !context.sealedAt || !Number.isFinite(Date.parse(context.sealedAt)) ||
      !fullSet(masters) || !fullSet(raw) || !monitoring ||
      !matches(Object.keys(monitoring).sort(), [...MONITORING_DATA_SHEETS].sort()) ||
      expectedIds.some((id) => !id || masters?.get(id)?.formulasRead !== true ||
        !Array.isArray(raw?.get(id)))) {
    return { rows: new Map(), error: 'Недельный контроль неполон или неоднозначно сопоставляет исторические названия книг; данные не изменены' };
  }

  const atoms = readAtoms([baseline.id]);
  const normalizedAtoms: AtomRow[] = [];
  const perDept = new Map<string, Map<number, AtomRow>>();
  for (const atom of atoms) {
    const id = historicalDepartmentId(atom.departmentId);
    if (!id) return { rows: new Map(), error: 'Неизвестная историческая книга строки-атома: ' + atom.departmentId };
    const normalized = { ...atom, departmentId: id };
    normalizedAtoms.push(normalized);
    const book = perDept.get(id) ?? new Map<number, AtomRow>();
    if (book.has(atom.rowIndex)) {
      return { rows: new Map(), error: 'Повтор строки-атома в контрольном снимке: ' + id };
    }
    book.set(atom.rowIndex, normalized);
    perDept.set(id, book);
  }
  for (const name of names) {
    const deptId = historicalDepartmentId(name);
    const rows = raw!.get(deptId ?? '');
    const actual = deptId ? perDept.get(deptId) : undefined;
    if (!deptId || !rows) {
      return { rows: new Map(), error: 'Неизвестная ведомственная книга контрольного снимка: ' + name };
    }
    let expectedCount = 0;
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (!Array.isArray(row) || row.every((cell) => String(cell ?? '').trim() === '')) continue;
      expectedCount++;
      const atom = actual?.get(i + DEPT_HEADER_ROWS + 1);
      if (!atom || atom.cellsJson !== JSON.stringify(buildCellDict(row))) {
        return { rows: new Map(), error: 'Строки контрольного снимка не совпадают с сохранёнными атомами книги ' + name };
      }
    }
    if (actual?.size !== expectedCount) {
      return { rows: new Map(), error: 'Количество строк-атомов не совпадает с недельным контрольным снимком книги ' + name };
    }
  }
  return { rows: atomsToSnapshotRows(normalizedAtoms), error: null };
}

/**
 * Live→Thursday and Thursday→Thursday share the same two certified controls.
 * Keep only these two immutable, verified projections. An external SQLite
 * write changes data_version; a write on this connection changes total_changes.
 * Never cache failed proof and never use cache while inside a transaction.
 */
const MAX_VERIFIED_CONTROLS = 2;
const verifiedControls = new Map<string, { version: string; rows: Map<string, SnapshotRow[]> }>();

function databaseVersion(): string {
  return JSON.stringify(db.$client.prepare(`
    SELECT data_version, schema_version, total_changes() AS changes
    FROM pragma_data_version(), pragma_schema_version()
  `).get());
}

export function verifiedBaselineRows(baseline: WeeklySnapshotRef):
  { rows: Map<string, SnapshotRow[]>; error: string | null } {
  if (db.$client.inTransaction) return validateBaselineRows(baseline);
  const version = databaseVersion();
  const cached = verifiedControls.get(baseline.id);
  if (cached && cached.version === version) {
    verifiedControls.delete(baseline.id);
    verifiedControls.set(baseline.id, cached);
    return { rows: structuredClone(cached.rows), error: null };
  }
  verifiedControls.delete(baseline.id);
  const checked = validateBaselineRows(baseline);
  if (checked.error !== null || databaseVersion() !== version) return checked;

  verifiedControls.set(baseline.id, { version, rows: structuredClone(checked.rows) });
  if (verifiedControls.size > MAX_VERIFIED_CONTROLS) {
    const oldest = verifiedControls.keys().next().value;
    if (oldest !== undefined) verifiedControls.delete(oldest);
  }
  return checked;
}
