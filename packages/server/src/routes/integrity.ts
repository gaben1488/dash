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
import {
  liveBaselineDay,
  isoOfDayNumber,
  DEPT_COLUMNS,
  DEPT_HEADER_ROWS,
  checkSequenceIntegrity,
  detectDateShownAsNumber,
  findDept,
  isMetaRow,
  isReadableDeptRow,
  type DateFormatFinding,
  type DepartmentEntry,
  type SequenceReport,
  type SequenceRow,
} from '@aemr/shared';
import {
  diffSnapshots,
  // Тот же дом разбора «значение ячейки → число либо честный null», что и у
  // /api/anomalies: копия правила разъехалась бы с ним на первом живом
  // формате (страж — shared/canon-homes.test.ts).
  journalNumber as cellNumber,
  type RowDiff,
  type SnapshotRow,
  type ChangeEntry,
} from '@aemr/core';
import { DEPARTMENT_SPREADSHEETS, config } from '../config.js';
import { productCalendarDay } from '../services/product-calendar.js';
import { isDataRow } from '../services/rows-dto.js';
import { getDeptCacheFilledAt, getDeptLoadMeta, getDeptSheetValues, iterateWeeklySnapshotHistory } from '../services/snapshot.js';
import { refreshAllSources } from '../services/source-refresh.js';
import { readSourceRowObservations } from '../services/source-row-observations.js';
import { orgLabel, verifiedBaselineRows } from '../services/weekly-control-validation.js';
export { atomsToSnapshotRows, indexHistoricalDepartments, interpretWeeklySnapshotJson, verifiedBaselineRows } from '../services/weekly-control-validation.js';

/** Номер строки книги = индекс в массиве листа + 1 (кэш несёт шапку). */
const SHEET_ROW_FROM_INDEX = 1;

/** Сколько строк со сбитым видом даты показывать поимённо. */
const SHOWN_DATE_ROWS = 20;

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

/** No inferred deletion; only read-only absence of a previously observed number. */
export interface OperationalAbsenceDto {
  dept: string;
  rowSeq: string;
  wasAtSheetRow: number | null;
  subject: string;
  observedAt: string;
}
export interface OperationalAbsenceReport {
  since: string;
  entries: OperationalAbsenceDto[];
  unavailableBooks: Array<{ dept: string; reason: string }>;
  error: string | null;
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
  /** Две законченные соседние контрольные недели: независимая страховка live/webhook. */
  weeklyComparison: {
    beforeId: string;
    afterId: string;
    beforeAt: string;
    afterAt: string;
    books: VanishedBookDto[];
    vanishedTotal: number;
    vanishedPlanSum: number;
  } | null;
  /** Нет пары / не пройдена проверка полноты — отсутствие результата НЕ ноль. */
  weeklyComparisonNote: string;
  /** Почему оперативного сравнения нет — фраза для экрана. */
  comparisonNote: string;
  operational: OperationalAbsenceReport;
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

interface WeeklySnapshotRef {
  id: string;
  createdAt: string;
}

/**
 * LIVE-база — завершённый четверговый срез предыдущей календарной недели.
 * Новый четверговый выпуск становится базой только в следующий понедельник.
 * Пропуск нужной недели не заменяется старым или суточным снимком.
 */
export function pickLatestControlSnapshot(
  sealed: readonly WeeklySnapshotRef[],
  nowMs: number,
  utcOffsetHours: number,
): WeeklySnapshotRef | null {
  let latest: WeeklySnapshotRef | null = null;
  let latestAt = -Infinity;
  const baselineDay = liveBaselineDay(new Date(nowMs), utcOffsetHours);
  for (const snap of sealed) {
    const at = Date.parse(snap.createdAt);
    if (!Number.isFinite(at) || at > nowMs) continue;
    if (productCalendarDay(new Date(at), utcOffsetHours) !== baselineDay) continue;
    if (at > latestAt) {
      latest = snap;
      latestAt = at;
    }
  }
  return latest;
}

/**
 * Недельная страховка: только ДВА СМЕЖНЫХ завершённых четверга Камчатки.
 * Последний неполный четверг не становится эталоном до следующего понедельника.
 * Чтения между четвергами и более старые недели пару не подменяют.
 * Проходим только метаданные; дорогая проверка атомов выполняется после отбора.
 */
export function pickAdjacentWeeklySnapshots(
  snapshots: Iterable<WeeklySnapshotRef>,
  nowMs: number,
  utcOffsetHours: number,
): [WeeklySnapshotRef, WeeklySnapshotRef] | null {
  const afterDay = liveBaselineDay(new Date(nowMs), utcOffsetHours);
  const beforeDay = afterDay - 7;
  let before: WeeklySnapshotRef | null = null;
  let after: WeeklySnapshotRef | null = null;
  for (const candidate of snapshots) {
    const ms = Date.parse(candidate.createdAt);
    if (!Number.isFinite(ms) || ms > nowMs) continue;
    const day = productCalendarDay(new Date(ms), utcOffsetHours);
    if (day === beforeDay && (!before || ms > Date.parse(before.createdAt))) before = candidate;
    if (day === afterDay && (!after || ms > Date.parse(after.createdAt))) after = candidate;
  }
  return before && after ? [before, after] : null;
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

/** Один набор проверяемых признаков для оперативного и исторического диффа. */
function hasNotableDiff(diff: RowDiff): boolean {
  return diff.vanished.length > 0 || diff.moved.length > 0 ||
    diff.unkeyed.before > 0 || diff.unkeyed.after > 0 ||
    (diff.identityCandidates?.length ?? 0) > 0 ||
    (diff.contextChanged?.length ?? 0) > 0 ||
    (diff.ambiguousKeys?.before.length ?? 0) > 0 ||
    (diff.ambiguousKeys?.after.length ?? 0) > 0;
}

function presentDiff(dept: DepartmentEntry, diff: RowDiff, currentAt: string): VanishedBookDto {
  return {
    dept: dept.id,
    deptName: dept.fullName,
    currentAt,
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
    identityCandidates: diff.identityCandidates ?? [],
    contextChanged: diff.contextChanged ?? [],
    ambiguousKeys: diff.ambiguousKeys ?? { before: [], after: [] },
    note: diff.note,
  };
}

/** Сравнение двух снимков по книгам; null — сравнивать не с чем. */
/**
 * Одна общая истина для /api/integrity и /api/change-story.
 * База — четверг предыдущей календарной недели. После — последнее ДОСТОВЕРНОЕ чтение
 * живых ведомственных книг из общего кэша, с собственной меткой каждой книги.
 * Источники не пересобираются в SQL-снимок ради сравнения; никаких записей.
 */
export function buildComparison(now: number = Date.now()): { comparison: IntegrityResponse['comparison']; note: string } {
  let baseline: WeeklySnapshotRef | null = null;
  let verified: ReturnType<typeof verifiedBaselineRows> | null = null;
  let skippedControls = 0;
  let lastError: string | null = null;
  for (const candidate of iterateWeeklySnapshotHistory()) {
    if (!pickLatestControlSnapshot([candidate], now, config.weeklySnapshot.utcOffsetHours)) continue;
    const checked = verifiedBaselineRows(candidate);
    if (checked.error !== null) { skippedControls++; lastError = checked.error; continue; }
    baseline = candidate;
    verified = checked;
    break;
  }
  if (!baseline || !verified) return {
    comparison: null,
    note: lastError
      ? 'Недельный контроль не пригоден для достоверной сверки: ' + lastError +
        '. Ни одна доступная контрольная попытка не подтверждена; отсутствие сравнения не доказывает отсутствие пропаж.'
      : 'Нет подтверждённого среза четверга предыдущей календарной недели. Сравнивать текущее состояние с другой неделей или суточным чтением вместо него нельзя.',
  };
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
    if (!hasNotableDiff(diff)) continue;
    books.push(presentDiff(dept, diff, new Date(loadedAt).toISOString()));
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

/**
 * Сравнение ЗАПЕЧАТАННЫХ соседних недель — независимый контроль потерь между
 * вебхуками и перезапусками. Только локальная SQLite; не трогает Sheets,
 * не создаёт новую историю и не приравнивает отсутствие № к доказанному удалению.
 */
export function buildWeeklyComparison(now: number = Date.now()): {
  weeklyComparison: IntegrityResponse['weeklyComparison'];
  note: string;
} {
  const offset = config.weeklySnapshot.utcOffsetHours;
  const endDay = liveBaselineDay(new Date(now), offset);
  const beginDay = endDay - 7;
  const pair = pickAdjacentWeeklySnapshots(iterateWeeklySnapshotHistory(), now, offset);
  const window = isoOfDayNumber(beginDay) + ' → ' + isoOfDayNumber(endDay);
  if (!pair) return {
    weeklyComparison: null,
    note: 'Нет пары соседних завершённых четверговых срезов (' + window +
      '). Более старую неделю и произвольный суточный снимок не подставляем.',
  };

  let before: ReturnType<typeof verifiedBaselineRows>;
  let after: ReturnType<typeof verifiedBaselineRows>;
  try {
    // Оперативная проверка только что удостоверила after: читаем её первой,
    // используя существующий verifiedCache; затем проверяем предыдущий четверг.
    after = verifiedBaselineRows(pair[1]);
    before = verifiedBaselineRows(pair[0]);
  } catch {
    return {
      weeklyComparison: null,
      note: 'Недельная пара ' + window +
        ' не проверена: чтение локальных контрольных доказательств завершилось отказом. Это не ноль пропавших закупок.',
    };
  }
  if (before.error !== null || after.error !== null) return {
    weeklyComparison: null,
    note: 'Недельная пара ' + window + ' не прошла проверку полноты: ' +
      [before.error, after.error].filter(Boolean).join('; ') +
      '. Отсутствие подтверждённых пропаж не утверждается.',
  };

  const books: VanishedBookDto[] = [];
  let vanishedTotal = 0;
  let vanishedPlanSum = 0;
  for (const deptId of Object.keys(DEPARTMENT_SPREADSHEETS)) {
    const dept = findDept(deptId);
    const previous = dept ? before.rows.get(dept.latinId) : undefined;
    const next = dept ? after.rows.get(dept.latinId) : undefined;
    if (!dept || !previous || !next) return {
      weeklyComparison: null,
      note: 'Недельная пара ' + window + ' не содержит сопоставимых строк книги ' +
        deptId + '. Считать пропажи нулевыми нельзя.',
    };
    const diff = diffSnapshots(previous, next);
    vanishedTotal += diff.vanished.length;
    vanishedPlanSum += diff.vanishedPlanSum;
    if (hasNotableDiff(diff)) books.push(presentDiff(dept, diff, pair[1].createdAt));
  }
  return {
    weeklyComparison: {
      beforeId: pair[0].id,
      afterId: pair[1].id,
      beforeAt: pair[0].createdAt,
      afterAt: pair[1].createdAt,
      books: books.sort((a, b) => b.vanishedPlanSum - a.vanishedPlanSum),
      vanishedTotal,
      vanishedPlanSum: Math.round(vanishedPlanSum * 100) / 100,
    },
    note: '',
  };
}

/**
 * Accepted SQLite observations only. Never invent a weekly pair or interpret
 * the absence of a number as proof that a procurement has been deleted.
 * An unread, stale or earlier-than-event book stays UNKNOWN, not zero.
 */
export function selectActiveSourceAbsences(
  observations: readonly Pick<ChangeEntry,
    'book' | 'kind' | 'rowSeq' | 'sheetRow' | 'subject' | 'observedAt'>[],
  sheetValues: Readonly<Record<string, unknown[][]>>,
  loadMeta: Readonly<Record<string, { loadedAt: string; rowCount?: number; error?: string }>>,
  now: number,
  maxAgeMs: number,
): Pick<OperationalAbsenceReport, 'entries' | 'unavailableBooks'> {
  const candidates = new Map<string, typeof observations[number][]>();
  const unavailable = new Map<string, string>();
  for (const event of observations) {
    if (event.kind !== 'row-vanished' || !event.rowSeq?.trim()) continue;
    const dept = findDept(event.book)?.id;
    if (!dept) {
      unavailable.set(event.book, 'Нельзя подтвердить принадлежность наблюдения книге');
      continue;
    }
    const entries = candidates.get(dept) ?? [];
    entries.push(event);
    candidates.set(dept, entries);
  }

  const active = new Map<string, OperationalAbsenceDto>();
  for (const [dept, events] of candidates) {
    const current = Object.entries(sheetValues).find(([name]) => findDept(name)?.id === dept)?.[1];
    const meta = Object.entries(loadMeta).find(([name]) => findDept(name)?.id === dept)?.[1];
    const readAt = Date.parse(meta?.loadedAt ?? '');
    const eventTimes = events.map(event => Date.parse(event.observedAt ?? ''));
    let reason: string | null = null;
    if (!current || current.length <= DEPT_HEADER_ROWS || !meta || meta.error ||
        meta.rowCount !== current.length) {
      reason = 'Нет подтверждённого полного чтения книги';
    } else if (!Number.isFinite(readAt) || readAt > now || now - readAt > maxAgeMs) {
      reason = 'Текущее чтение книги устарело';
    } else if (eventTimes.some(at => !Number.isFinite(at) || at > now || at > readAt)) {
      reason = 'Момент наблюдения новее подтверждённого чтения или неизвестен';
    }
    if (reason) {
      unavailable.set(dept, reason);
      continue;
    }

    // A complete raw matrix, including unfinished data positions. A literal
    // 12/1 cannot be replaced with 12/01 or coerced to a numeric identifier.
    const present = new Set(current!.slice(DEPT_HEADER_ROWS)
      .filter((row): row is unknown[] => Array.isArray(row))
      .map(row => text(row, DEPT_COLUMNS.ID)).filter(Boolean));
    for (const event of events) {
      const rowSeq = event.rowSeq!.trim();
      if (present.has(rowSeq)) continue; // Number returned: no active absence.
      const key = JSON.stringify([dept, rowSeq]);
      const previous = active.get(key);
      if (previous && previous.observedAt >= event.observedAt!) continue;
      active.set(key, {
        dept, rowSeq, wasAtSheetRow: event.sheetRow,
        subject: event.subject ?? '', observedAt: event.observedAt!,
      });
    }
  }

  return {
    entries: [...active.values()].sort((a, b) =>
      b.observedAt.localeCompare(a.observedAt) ||
      a.dept.localeCompare(b.dept) || a.rowSeq.localeCompare(b.rowSeq)),
    unavailableBooks: [...unavailable].sort(([a], [b]) => a.localeCompare(b))
      .map(([dept, reason]) => ({ dept, reason })),
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
  const { weeklyComparison, note: weeklyComparisonNote } = buildWeeklyComparison(now);
  const baselineMs = comparison ? Date.parse(comparison.beforeAt) : NaN;
  const sinceMs = Number.isFinite(baselineMs) ? baselineMs : now - 14 * 86_400_000;
  let operational: OperationalAbsenceReport = {
    since: new Date(sinceMs).toISOString(), entries: [], unavailableBooks: [], error: null,
  };
  try {
    operational = {
      ...operational,
      ...selectActiveSourceAbsences(
        readSourceRowObservations(sinceMs), sheetValues, getDeptLoadMeta(), now,
        Math.max(config.cache.sourceFreshnessSeconds * 1000, 3_600_000),
      ),
    };
  } catch {
    operational.error = 'Не удалось прочитать сохранённые оперативные наблюдения';
  }

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
    weeklyComparison,
    weeklyComparisonNote,
    operational,
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
        liveBaselineDay(new Date(cached.at), config.weeklySnapshot.utcOffsetHours) ===
          liveBaselineDay(new Date(now), config.weeklySnapshot.utcOffsetHours) &&
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
