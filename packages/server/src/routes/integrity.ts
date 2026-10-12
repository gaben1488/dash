/**
 * /api/integrity — целостность книг: нумерация, вид ячеек дат, пропавшие строки.
 *
 * ЗАЧЕМ. Инвентаризация сигналов 20.08.2026 (§4 «Сироты») нашла три модуля,
 * которые считаются правильно и не выводятся никуда: целостность нумерации
 * (shared/sequence-integrity.ts), сбитый вид ячейки даты
 * (shared/cell-format-integrity.ts) и сравнение снимков на пропажу строк
 * (core/analytics/vanished-rows.ts). Все три отвечают на вопросы, которые
 * больше не задаёт никто:
 *
 *   · «на какую строку сослаться» — у шести книг из восьми номер есть меньше
 *     чем у сотни строк, и адреса в переписке просто нет;
 *   · «куда делась закупка» — журнал книги удаление строки не записывает
 *     (канон п.105), и единственные следы пропажи — пропуск в нумерации и
 *     разница двух снимков;
 *   · «почему в графе срока стоит число» — значение верное, а человек видит
 *     внутренний код вместо даты.
 *
 * ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ. Четвёртый модуль-сирота, `shared/mirror-integrity.ts`
 * (битые зеркала IMPORTRANGE), сюда сознательно не подключён: листы учреждений
 * — зеркала, ими не пользуются, и их расхождения ничего не говорят о качестве
 * работы (решение владельца 19.08). Он остаётся справочным.
 *
 * ГРАНИЦА ЧЕСТНОСТИ У ВИДА ЯЧЕЙКИ. Проверка формата спрашивает, что ПОКАЗАНО в
 * ячейке, а книги читаются в необработанном виде (UNFORMATTED_VALUE): дата с
 * правильным форматом и дата с числовым форматом приходят одинаковым числом,
 * различить их нечем. Поэтому здесь ловится только та половина беды, которая
 * видна честно: код даты, лежащий в ячейке ТЕКСТОМ. Он хуже числового формата
 * — такую ячейку не понимают ни сортировка, ни формулы кварталa. Про вторую
 * половину ответ говорит словами, а не молчит.
 *
 * ЦЕНА ЗАПРОСА. Ни одного обращения к Google: нумерация и вид ячеек считаются
 * по уже прочитанному кэшу книг и строкам-атомам последнего завершённого
 * недельного контрольного среза в местной базе. Различаем момент контроля
 * и моменты чтения каждой книги; пробелы источников называем явно (п.58).
 */
import type { FastifyInstance } from 'fastify';
import { eq, inArray } from 'drizzle-orm';
import {
  DAYS_PER_WEEK,
  buildCellDict,
  DEPT_COLUMNS,
  DEPT_HEADER_ROWS,
  checkSequenceIntegrity,
  detectDateShownAsNumber,
  findDept,
  toGrbsId,
  GRBS_ID_TO_DEPARTMENT_ID,
  isMetaRow,
  isReadableDeptRow,
  subordinateKey,
  ORG_ITSELF_SENTINEL,
  type DateFormatFinding,
  type DepartmentEntry,
  type SequenceReport,
  type SequenceRow,
} from '@aemr/shared';
import {
  diffSnapshots,
  MONITORING_DATA_SHEETS,
  // Тот же дом разбора «значение ячейки → число либо честный null», что и у
  // /api/anomalies: копия правила разъехалась бы с ним на первом живом
  // формате (страж — shared/canon-homes.test.ts).
  journalNumber as cellNumber,
  type RowDiff,
  type SnapshotRow,
} from '@aemr/core';
import { db, schema } from '../db/index.js';
import { DEPARTMENT_SPREADSHEETS, config } from '../config.js';
import { productCalendarDay } from '../services/product-calendar.js';
import { isDataRow } from '../services/rows-dto.js';
import { getDeptCacheFilledAt, getDeptLoadMeta, getDeptSheetValues, getWeeklySnapshotHistory } from '../services/snapshot.js';
import { refreshAllSources } from '../services/source-refresh.js';

/** Номер строки книги = индекс в массиве листа + 1 (кэш несёт шапку). */
const SHEET_ROW_FROM_INDEX = 1;

/** Сколько строк со сбитым видом даты показывать поимённо. */
const SHOWN_DATE_ROWS = 20;

/** До года подтверждённых недельных срезов без чтения тяжёлых JSON-блобов. */
const WEEKLY_LOOKBACK = 52;

// ────────────────────────────────────────────────────────────
// Формы ответа
// ────────────────────────────────────────────────────────────

/** Одна ячейка, где срок показан кодом, а не датой. */
export interface DateFormatRowDto {
  sheetRow: number;
  rowSeq: string;
  subject: string;
  subordinate: string;
  /** Графа: «N» — плановая дата, «Q» — дата заключения. */
  column: 'N' | 'Q';
  columnLabel: string;
  shown: string;
  meansDate: string;
  mechanism: string;
  action: string;
}

/** Нумерация и вид ячеек одной книги. */
export interface IntegrityBookDto {
  /** Кириллический канон-идентификатор книги — ось изоляции п.127. */
  dept: string;
  deptName: string;
  sheet: string;
  /** false — строки книги не прочитаны: это не «нарушений нет». */
  rowsAvailable: boolean;
  /** null — читать было нечего. */
  sequence: SequenceReport | null;
  dateFormat: DateFormatRowDto[];
  /** Человеческое пояснение строки книги. */
  note: string;
}

/** Пропажи и переезды строк одной книги между двумя снимками. */
export interface VanishedBookDto {
  dept: string;
  deptName: string;
  vanished: Array<{
    rowSeq: string;
    wasAtSheetRow: number;
    subject: string;
    subordinate: string;
    planSum: number | null;
    factSum: number | null;
  }>;
  moved: Array<{ rowSeq: string; fromSheetRow: number; toSheetRow: number; subject: string }>;
  appeared: number;
  vanishedPlanSum: number;
  vanishedFactSum: number;
  unkeyed: { before: number; after: number };
  note: string;
  /** Возможная смена № п/п, требующая подтверждения; не автоматическая идентичность. */
  /** Время последнего достоверного чтения данной ведомственной книги. */
  currentAt: string;
  identityCandidates: Array<{
    beforeRowSeq: string; afterRowSeq: string;
    beforeSheetRow: number; afterSheetRow: number;
    subject: string; subordinate: string; planSum: number;
    evidence: 'subject+subordinate+plan+method'; status: 'needs-review';
  }>;
  /** Ключи с дублями не сравнивались: first-wins скрывал неопределённость. */
  ambiguousKeys: { before: string[]; after: string[] };
  /** № остался, но изменились предмет или учреждение — это ещё не доказанная подмена. */
  contextChanged: Array<{
    rowSeq: string; beforeSheetRow: number; afterSheetRow: number;
    beforeSubject: string; afterSubject: string;
    beforeSubordinate: string; afterSubordinate: string;
    status: 'needs-review';
  }>;
}

export interface IntegrityResponse {
  asOf: string;
  books: IntegrityBookDto[];
  /** Итоги нумерации по прочитанным книгам. */
  totals: { gapCount: number; duplicates: number; countableWithoutSeq: number; dateFormat: number };
  /** Сравнение снимков; null — сравнивать не с чем. */
  comparison: {
    /** Последний подтверждённый недельный контроль, не просто суточный снимок. */
    beforeAt: string;
    /** Самое позднее успешное чтение среди сопоставленных текущих книг. */
    afterAt: string;
    /** Самое раннее чтение среди сопоставленных книг: стороны не атомарны. */
    oldestCurrentAt: string;
    baselineId: string;
    /** Книги вне сравнения — отсутствие источника не равно нулю пропаж. */
    unavailableBooks: Array<{ dept: string; reason: string }>;
    books: VanishedBookDto[];
    vanishedTotal: number;
    vanishedPlanSum: number;
  } | null;
  /** Почему сравнения нет — фраза для экрана, а не пустое место. */
  comparisonNote: string;
  notes: string[];
}

// ────────────────────────────────────────────────────────────
// Нумерация и вид ячеек
// ────────────────────────────────────────────────────────────

function text(row: unknown[], col: number): string {
  return String(row[col] ?? '').trim();
}

/** Число из ячейки листа; null — «числа нет», а не ноль. */
function money(row: unknown[], col: number): number | null {
  return cellNumber(row[col]);
}

function orgLabel(raw: unknown): string {
  const key = subordinateKey(raw);
  return key === ORG_ITSELF_SENTINEL ? 'Аппарат управления' : key;
}

const DATE_COLUMN_LABEL: Record<'N' | 'Q', string> = {
  N: 'плановая дата',
  Q: 'дата заключения контракта',
};

/**
 * Строки книги в форме входа проверки нумерации.
 *
 * «Счётная» — ровно то же определение, что у остального продукта: есть способ
 * закупки и плановые деньги. Иначе разметочные и пустые строки попали бы в
 * знаменатель охвата и занизили бы его на ровном месте.
 */
export function buildSequenceRows(values: readonly unknown[][]): SequenceRow[] {
  const out: SequenceRow[] = [];
  values.forEach((raw, idx) => {
    if (!Array.isArray(raw)) return;
    if (idx < DEPT_HEADER_ROWS) return;
    if (!isReadableDeptRow(raw)) return;
    const name = text(raw, DEPT_COLUMNS.SUBORDINATE) || text(raw, DEPT_COLUMNS.PROGRAM_NAME);
    if (isMetaRow(name)) return;
    const planSum = money(raw, DEPT_COLUMNS.TOTAL_PLAN);
    out.push({
      sheetRow: idx + SHEET_ROW_FROM_INDEX,
      rowSeq: text(raw, DEPT_COLUMNS.ID),
      countable: text(raw, DEPT_COLUMNS.METHOD) !== '' && planSum !== null && planSum > 0,
      subject: text(raw, DEPT_COLUMNS.SUBJECT),
      planSum,
    });
  });
  return out;
}

/**
 * Ячейки дат, где вместо срока лежит его внутренний код ТЕКСТОМ.
 *
 * Гейт `typeof === 'string'` — не придирка, а граница честности: число в этой
 * же графе может быть нормальной датой с правильным форматом, и объявить его
 * дефектом значило бы обвинить всю книгу разом (см. шапку модуля).
 */
export function buildDateFormatFindings(values: readonly unknown[][]): DateFormatRowDto[] {
  const out: DateFormatRowDto[] = [];
  values.forEach((raw, idx) => {
    if (!Array.isArray(raw)) return;
    if (idx < DEPT_HEADER_ROWS) return;
    if (!isReadableDeptRow(raw)) return;
    const sheetRow = idx + SHEET_ROW_FROM_INDEX;
    const columns: Array<{ letter: 'N' | 'Q'; index: number }> = [
      { letter: 'N', index: DEPT_COLUMNS.PLAN_DATE },
      { letter: 'Q', index: DEPT_COLUMNS.FACT_DATE },
    ];
    for (const { letter, index } of columns) {
      const cell = raw[index];
      if (typeof cell !== 'string') continue;
      const found: DateFormatFinding | null = detectDateShownAsNumber(cell, letter, sheetRow);
      if (!found) continue;
      out.push({
        sheetRow,
        rowSeq: text(raw, DEPT_COLUMNS.ID),
        subject: text(raw, DEPT_COLUMNS.SUBJECT),
        subordinate: orgLabel(raw[DEPT_COLUMNS.SUBORDINATE]),
        column: letter,
        columnLabel: DATE_COLUMN_LABEL[letter],
        shown: found.shown,
        meansDate: found.meansDate,
        mechanism: found.mechanism,
        action: found.action,
      });
    }
  });
  return out.slice(0, SHOWN_DATE_ROWS);
}

// ────────────────────────────────────────────────────────────
// Пропавшие номера: последнее чтение книг относительно недельной контрольной точки
// ────────────────────────────────────────────────────────────

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

interface WeeklySnapshotRef {
  id: string;
  createdAt: string;
}

/**
 * Контрольная точка: самый новый ЗАВЕРШЁННЫЙ четверговый снимок, не позже
 * настоящего момента. Его реестр даёт только sealed weeklyTableContext.
 * Даже при пропущенной неделе берётся последний доступный контроль — текущие
 * данные сравниваются с ним, а не с предыдущим четвергом или суточным срезом.
 */
export function pickLatestControlSnapshot(
  sealed: readonly WeeklySnapshotRef[],
  nowMs: number,
  utcOffsetHours: number,
): WeeklySnapshotRef | null {
  let latest: WeeklySnapshotRef | null = null;
  let latestAt = -Infinity;
  for (const snap of sealed) {
    const at = Date.parse(snap.createdAt);
    if (!Number.isFinite(at) || at > nowMs) continue;
    if (productCalendarDay(new Date(at), utcOffsetHours) % DAYS_PER_WEEK !== 0) continue;
    if (at > latestAt) {
      latest = snap;
      latestAt = at;
    }
  }
  return latest;
}

/** Текущее ЧТЕНИЕ книги: ровно та же геометрия строк, что у SQL-атомов. */
export function currentSheetToSnapshotRows(values: readonly unknown[][]): SnapshotRow[] {
  const result: SnapshotRow[] = [];
  values.forEach((raw, index) => {
    if (index < DEPT_HEADER_ROWS || !Array.isArray(raw)) return;
    const rowSeq = text(raw, DEPT_COLUMNS.ID);
    const subject = text(raw, DEPT_COLUMNS.SUBJECT);
    // Канон фильтра — тот же isDataRow, что и в SQL-атомах /api/rows.
    const method = text(raw, DEPT_COLUMNS.METHOD);
    const planSum = money(raw, DEPT_COLUMNS.TOTAL_PLAN);
    if (!isDataRow({ id: rowSeq, subject, planSum: planSum ?? 0, method })) return;
    const factSum = money(raw, DEPT_COLUMNS.TOTAL_FACT);
    result.push({
      rowSeq,
      sheetRow: index + 1,
      subject,
      subordinate: orgLabel(raw[DEPT_COLUMNS.SUBORDINATE]),
      ...(planSum === null ? {} : { planSum }),
      ...(factSum === null ? {} : { factSum }),
      method,
    });
  });
  return result;
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
export function verifiedBaselineRows(baseline: WeeklySnapshotRef):
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

// ────────────────────────────────────────────────────────────
// Сборка ответа
// ────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000;
let cached: { at: number; sourceAt: number; response: IntegrityResponse } | null = null;

export function resetIntegrityCache(): void {
  cached = null;
}

function unreadNote(dept: DepartmentEntry): string {
  return (
    `${dept.id}: строки книги не прочитаны. Нумерацию и вид ячеек проверять не по чему — ` +
    'это отсутствие ответа источника, а не порядок в книге. Действие: обновить данные и ' +
    'открыть раздел снова.'
  );
}

/** Сравнение двух снимков по книгам; null — сравнивать не с чем. */
/**
 * Одна общая истина для /api/integrity и /api/change-story.
 * База — последний контрольный четверг. После — последнее ДОСТОВЕРНОЕ чтение
 * живых ведомственных книг из общего кэша, с собственной меткой каждой книги.
 * Источники не пересобираются в SQL-снимок ради сравнения; никаких записей.
 */
export function buildComparison(now: number = Date.now()): { comparison: IntegrityResponse['comparison']; note: string } {
  const sealed = getWeeklySnapshotHistory(WEEKLY_LOOKBACK);
  let candidates = sealed;
  let baseline = pickLatestControlSnapshot(candidates, now, config.weeklySnapshot.utcOffsetHours);
  if (!baseline) {
    return {
      comparison: null,
      note: 'Нет последнего подтверждённого недельного контрольного среза. Сравнивать текущее состояние с суточными чтениями вместо него нельзя.',
    };
  }

  let verified = verifiedBaselineRows(baseline);
  let skippedControls = 0;
  let lastError = verified.error;
  // SQL-маркер контекста ещё не доказывает завершённость. Каждая попытка
  // проходит ту же строгую проверку; неполные данные не становятся базой.
  while (verified.error !== null) {
    skippedControls++;
    lastError = verified.error;
    const rejectedId = baseline.id;
    candidates = candidates.filter((candidate) => candidate.id !== rejectedId);
    baseline = pickLatestControlSnapshot(candidates, now, config.weeklySnapshot.utcOffsetHours);
    if (!baseline) return {
      comparison: null,
      note: 'Недельный контроль не пригоден для достоверной сверки: ' +
        lastError + '. Ни одна доступная контрольная попытка не подтверждена; отсутствие сравнения не доказывает отсутствие пропаж.',
    };
    verified = verifiedBaselineRows(baseline);
  }
  const baselineNote = skippedControls > 0
    ? 'Пропущено неполных или несовместимых контрольных попыток: ' + skippedControls +
      '. Использован последний полностью проверенный недельный срез.'
    : '';
  const baselineRows = verified.rows;
  const liveValues = getDeptSheetValues();
  const loadMeta = getDeptLoadMeta();
  const unavailableBooks: Array<{ dept: string; reason: string }> = [];
  const books: VanishedBookDto[] = [];
  const currentReadTimes: number[] = [];
  let vanishedTotal = 0;
  let vanishedPlanSum = 0;
  const baseAt = Date.parse(baseline.createdAt);
  // По умолчанию источники обновляются чаще. Час допускает длительный
  // пропуск фонового цикла, но не выдаёт вчерашний кэш за «сейчас».
  const maxAge = Math.max(config.cache.sourceFreshnessSeconds * 1000, 3_600_000);

  for (const deptId of Object.keys(DEPARTMENT_SPREADSHEETS)) {
    const dept = findDept(deptId);
    if (!dept) {
      unavailableBooks.push({ dept: deptId, reason: 'Управление отсутствует в каноническом справочнике' });
      continue;
    }
    const live = Object.entries(liveValues).find(([name]) => findDept(name)?.id === dept.id)?.[1];
    const meta = Object.entries(loadMeta).find(([name]) => findDept(name)?.id === dept.id)?.[1];
    const previous = [...baselineRows].find(([name]) => findDept(name)?.id === dept.id)?.[1];
    const loadedAt = meta ? Date.parse(meta.loadedAt) : NaN;
    let unavailable: string | null = null;
    if (!previous || previous.length === 0) {
      unavailable = 'В контрольном снимке нет пригодных строк этой книги';
    } else if (!live || live.length <= DEPT_HEADER_ROWS || !meta || meta.error) {
      unavailable = 'Действующая книга не прочитана полностью';
    } else if (!Number.isFinite(loadedAt) || loadedAt < baseAt) {
      unavailable = 'Последнее чтение книги сделано до контрольного снимка';
    } else if (loadedAt > now || now - loadedAt > maxAge) {
      unavailable = 'Чтение устарело — нужно перечитать действующую книгу';
    }
    if (unavailable !== null) {
      unavailableBooks.push({ dept: dept.id, reason: unavailable });
      continue;
    }

    const current = currentSheetToSnapshotRows(live!);
    if (current.length === 0) {
      unavailableBooks.push({ dept: dept.id, reason: 'Текущая книга не содержит пригодных строк; массовую пропажу не утверждаем без проверки источника' });
      continue;
    }
    const diff: RowDiff = diffSnapshots(previous!, current);
    currentReadTimes.push(loadedAt);
    vanishedTotal += diff.vanished.length;
    vanishedPlanSum += diff.vanishedPlanSum;
    const identityCandidates = diff.identityCandidates ?? [];
    const contextChanged = diff.contextChanged ?? [];
    const ambiguousKeys = diff.ambiguousKeys ?? { before: [], after: [] };
    if (diff.vanished.length === 0 && diff.moved.length === 0 &&
        diff.unkeyed.before === 0 && diff.unkeyed.after === 0 &&
        identityCandidates.length === 0 && contextChanged.length === 0 &&
        ambiguousKeys.before.length === 0 && ambiguousKeys.after.length === 0) continue;
    books.push({
      dept: dept.id,
      deptName: dept.fullName,
      currentAt: new Date(loadedAt).toISOString(),
      vanished: diff.vanished.map((v) => ({
        rowSeq: v.rowSeq,
        wasAtSheetRow: v.wasAtSheetRow,
        subject: v.subject ?? '',
        subordinate: v.subordinate ?? '',
        planSum: v.planSum ?? null,
        factSum: v.factSum ?? null,
      })),
      moved: diff.moved.map((v) => ({
        rowSeq: v.rowSeq,
        fromSheetRow: v.fromSheetRow,
        toSheetRow: v.toSheetRow,
        subject: v.subject ?? '',
      })),
      appeared: diff.appeared.length,
      vanishedPlanSum: diff.vanishedPlanSum,
      vanishedFactSum: diff.vanishedFactSum,
      unkeyed: diff.unkeyed,
      identityCandidates,
      contextChanged,
      ambiguousKeys,
      note: diff.note,
    });
  }

  if (currentReadTimes.length === 0) {
    return {
      comparison: null,
      note: 'Контрольный недельный снимок есть, но нет ни одной сопоставимой свежей действующей книги. Перечитайте источники; отсутствие результата не означает отсутствие пропаж.',
    };
  }

  const partialNote = unavailableBooks.length
    ? 'Сравнение частичное: ' + unavailableBooks.length +
      ' из ' + Object.keys(DEPARTMENT_SPREADSHEETS).length +
      ' книг не удалось достоверно сверить. Не считать их пропажи нулём.'
    : '';
  const note = [baselineNote, partialNote].filter(Boolean).join(' ');

  return {
    comparison: {
      baselineId: baseline.id,
      beforeAt: baseline.createdAt,
      oldestCurrentAt: new Date(Math.min(...currentReadTimes)).toISOString(),
      afterAt: new Date(Math.max(...currentReadTimes)).toISOString(),
      unavailableBooks,
      books: books.sort((a, b) => b.vanishedPlanSum - a.vanishedPlanSum),
      vanishedTotal,
      vanishedPlanSum: Math.round(vanishedPlanSum * 100) / 100,
    },
    note,
  };
}

export function buildIntegrityResponse(now: number = Date.now()): IntegrityResponse {
  const sheetValues = getDeptSheetValues();
  const books: IntegrityBookDto[] = [];
  const totals = { gapCount: 0, duplicates: 0, countableWithoutSeq: 0, dateFormat: 0 };
  const silent: string[] = [];

  for (const deptId of Object.keys(DEPARTMENT_SPREADSHEETS)) {
    const dept = findDept(deptId);
    if (!dept) continue;
    const values = Object.entries(sheetValues)
      .find(([name]) => findDept(name)?.id === dept.id)?.[1];
    if (!values || values.length <= DEPT_HEADER_ROWS) {
      silent.push(dept.id);
      books.push({
        dept: dept.id,
        deptName: dept.fullName,
        sheet: dept.sheetName,
        rowsAvailable: false,
        sequence: null,
        dateFormat: [],
        note: unreadNote(dept),
      });
      continue;
    }
    const sequence = checkSequenceIntegrity(buildSequenceRows(values));
    const dateFormat = buildDateFormatFindings(values);
    totals.gapCount += sequence.gapCount;
    totals.duplicates += sequence.duplicates.length;
    totals.countableWithoutSeq += sequence.countableWithoutSeq;
    totals.dateFormat += dateFormat.length;
    books.push({
      dept: dept.id,
      deptName: dept.fullName,
      sheet: dept.sheetName,
      rowsAvailable: true,
      sequence,
      dateFormat,
      note: sequence.note,
    });
  }

  const { comparison, note: comparisonNote } = buildComparison(now);

  const notes: string[] = [
    'Пропуск номера не доказывает удаления строки: он бывает от перенумерации и других изменений. ' +
    'Сравнение с контрольным срезом показывает отсутствие прежнего номера, а не причину.',
    'Вид ячейки проверяется только там, где код даты лежит ТЕКСТОМ: книги читаются в ' +
    'необработанном виде, и дату с правильным форматом от даты с числовым отличить нечем. ' +
    'Пустой список здесь означает «текстовых кодов не найдено», а не «формат везде верен».',
  ];
  if (silent.length > 0) {
    notes.push(
      `Строки не прочитаны: ${silent.join(', ')}. По этим книгам нумерацию и вид ячеек ` +
      'проверять не по чему — это не «порядок в них есть».',
    );
  }

  return {
    asOf: new Date(now).toISOString(),
    // Сперва книги, где нумерация болит сильнее: разбор идёт от худшего.
    books: books.sort((a, b) =>
      (b.sequence?.gapCount ?? -1) - (a.sequence?.gapCount ?? -1)),
    totals,
    comparison,
    comparisonNote,
    notes,
  };
}

export async function integrityRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/integrity — нумерация, вид ячеек дат и пропавшие строки.
   *
   * 200 при любом состоянии источников: раздел существует затем, чтобы назвать
   * книгу, по которой ответа нет, — отказ роута спрятал бы именно это.
   */
  app.get('/api/integrity', async (request, reply) => {
    const fresh = (request.query as { refresh?: string } | undefined)?.refresh === 'true';
    const now = Date.now();
    if (!fresh && cached && now - cached.at < CACHE_TTL_MS &&
        cached.sourceAt === getDeptCacheFilledAt()) {
      return reply.send(cached.response);
    }
    if (fresh) {
      // Ручная кнопка действительно перечитывает 8 источников, без проверки
      // ревизии Drive. Это read-only Google Sheets, без записи в книги.
      // Даже если чтение частично упало, buildComparison выдаёт честные gaps.
      await refreshAllSources(undefined, 'request', { askDrive: false, svod: false, fresh: true });
    }
    const readAt = Date.now();
    const response = buildIntegrityResponse(readAt);
    cached = { at: readAt, sourceAt: getDeptCacheFilledAt(), response };
    return reply.send(response);
  });
}
