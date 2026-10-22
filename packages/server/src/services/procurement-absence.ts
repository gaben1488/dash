/**
 * One owner of procurement-absence evidence for Control, Change Story and Timeline.
 *
 * Inputs: certified Thursday proof + accepted current source observations.
 * Event delivery, content identity, physical row number and source-read time
 * are distinct concepts. A missing source/proof is UNKNOWN, never zero.
 * No new Google readers, SQLite schema, clocks or polling loops are introduced.
 */
import { DEPT_COLUMNS, DEPT_HEADER_ROWS, findDept, isoOfDayNumber, liveBaselineDay, weeklyCutoffMs, type DepartmentEntry } from '@aemr/shared';
import { diffSnapshots, type RowDiff, type ChangeEntry, type SnapshotRow } from '@aemr/core';
import { DEPARTMENT_SPREADSHEETS, config } from '../config.js';
import { productCalendarDay } from './product-calendar.js';
import { getDeptLoadMeta, getDeptSheetValues, iterateWeeklySnapshotHistory } from './snapshot.js';
import { verifiedBaselineRows } from './weekly-control-validation.js';
import { currentSheetToSnapshotRows } from './procurement-row-view.js';

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

/** Current against last certified previous-week Thursday, with per-book partiality. */
export interface CurrentComparison {
  beforeAt: string;
  afterAt: string;
  oldestCurrentAt: string;
  baselineId: string;
  unavailableBooks: Array<{ dept: string; reason: string }>;
  books: VanishedBookDto[];
  vanishedTotal: number;
  vanishedPlanSum: number;
}

/** Two adjacent certified Thursdays; no daily snapshot can substitute. */
export interface WeeklyComparison {
  beforeId: string;
  afterId: string;
  beforeAt: string;
  afterAt: string;
  books: VanishedBookDto[];
  vanishedTotal: number;
  vanishedPlanSum: number;
}


interface WeeklySnapshotRef {
  id: string;
  createdAt: string;
}

/** All selectors share the same completed Thursday boundary at 18:00 Kamchatka. */
function isControlOn(ref: WeeklySnapshotRef, day: number, now: number, utcOffsetHours: number): boolean {
  const at = Date.parse(ref.createdAt);
  return Number.isFinite(at) && at <= now &&
    productCalendarDay(new Date(at), utcOffsetHours) === day &&
    at >= weeklyCutoffMs(day, utcOffsetHours);
}

interface VerifiedControl {
  ref: WeeklySnapshotRef | null;
  rows: ReturnType<typeof verifiedBaselineRows>['rows'] | null;
  skipped: number;
  error: string | null;
}

/** Canonical sealed proof selection shared by live and historical comparisons. */
function verifiedThursday(day: number, now: number, offset: number): VerifiedControl {
  let skipped = 0;
  let error: string | null = null;
  for (const ref of iterateWeeklySnapshotHistory()) {
    if (!isControlOn(ref, day, now, offset)) continue;
    try {
      const checked = verifiedBaselineRows(ref);
      if (checked.error === null) return { ref, rows: checked.rows, skipped, error };
      error = checked.error;
    } catch {
      error = 'Чтение контрольных свидетельств завершилось отказом';
    }
    skipped++;
  }
  return { ref: null, rows: null, skipped, error };
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
    if (!isControlOn(snap, baselineDay, nowMs, utcOffsetHours)) continue;
    const at = Date.parse(snap.createdAt);
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
    if (isControlOn(candidate, beforeDay, nowMs, utcOffsetHours) &&
        (!before || ms > Date.parse(before.createdAt))) before = candidate;
    if (isControlOn(candidate, afterDay, nowMs, utcOffsetHours) &&
        (!after || ms > Date.parse(after.createdAt))) after = candidate;
  }
  return before && after ? [before, after] : null;
}


export { currentSheetToSnapshotRows } from './procurement-row-view.js';

function text(row: readonly unknown[], column: number): string {
  return String(row[column] ?? '').trim();
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

/**
 * Pure comparison: one verified Thursday proof, one accepted reading per book,
 * and an explicit observation time. No SQL, Google reads, mutable caches or
 * HTTP state. This is the oracle shared by all consumers of the report.
 */
export function compareCurrentToThursday(
  baseline: WeeklySnapshotRef,
  baselineRows: ReadonlyMap<string, readonly SnapshotRow[]>,
  liveValues: Readonly<Record<string, readonly unknown[][]>>,
  loadMeta: Readonly<Record<string, { loadedAt: string; rowCount?: number; error?: string }>>,
  now: number,
  maxAge: number,
): { comparison: CurrentComparison | null; note: string } {
  const unavailableBooks: Array<{ dept: string; reason: string }> = [];
  const books: VanishedBookDto[] = [];
  const currentReadTimes: number[] = [];
  let vanishedTotal = 0;
  let vanishedPlanSum = 0;
  const baseAt = Date.parse(baseline.createdAt);

  for (const deptId of Object.keys(DEPARTMENT_SPREADSHEETS)) {
    const dept = findDept(deptId);
    if (!dept) {
      unavailableBooks.push({ dept: deptId, reason: 'Управление отсутствует в каноническом справочнике' });
      continue;
    }
    // An alias collision must never silently choose the first cached reading.
    const sourceMatches = Object.entries(liveValues).filter(([name]) => findDept(name)?.id === dept.id);
    const metaMatches = Object.entries(loadMeta).filter(([name]) => findDept(name)?.id === dept.id);
    const previous = baselineRows.get(dept.latinId);
    const live = sourceMatches.length === 1 ? sourceMatches[0][1] : undefined;
    const meta = metaMatches.length === 1 ? metaMatches[0][1] : undefined;
    const loadedAt = Date.parse(meta?.loadedAt ?? '');
    let unavailable: string | null = null;
    if (!previous || previous.length === 0) {
      unavailable = 'В заверенном четверговом снимке нет сопоставимых закупок этой книги';
    } else if (sourceMatches.length !== 1 || metaMatches.length !== 1) {
      unavailable = 'Нет однозначного текущего чтения: отсутствует источник либо столкнулись алиасы книги';
    } else if (!live || live.length <= DEPT_HEADER_ROWS || !meta || meta.error ||
               meta.rowCount !== live.length || live.some(row => !Array.isArray(row))) {
      unavailable = 'Текущая книга не прочитана полностью или не совпадает длина подтверждённой матрицы';
    } else if (!Number.isFinite(loadedAt) || loadedAt < baseAt) {
      unavailable = 'Текущее чтение книги предшествует заверенному четвергу либо время неизвестно';
    } else if (!Number.isFinite(now) || !Number.isFinite(maxAge) || maxAge <= 0 ||
               loadedAt > now || now - loadedAt > maxAge) {
      unavailable = 'Текущее чтение устарело; запустите повторное чтение источника';
    }
    if (unavailable !== null) {
      unavailableBooks.push({ dept: dept.id, reason: unavailable });
      continue;
    }

    const current = currentSheetToSnapshotRows(live!);
    if (current.length === 0) {
      unavailableBooks.push({ dept: dept.id, reason: 'Текущее чтение не содержит ни одной закупки; массовое удаление без проверки источника не утверждаем' });
      continue;
    }
    const diff = diffSnapshots(previous, current);
    currentReadTimes.push(loadedAt);
    vanishedTotal += diff.vanished.length;
    vanishedPlanSum += diff.vanishedPlanSum;
    if (hasNotableDiff(diff)) books.push(presentDiff(dept, diff, new Date(loadedAt).toISOString()));
  }

  if (currentReadTimes.length === 0) return {
    comparison: null,
    note: 'Нет ни одной сопоставимой актуальной книги. Нельзя утверждать, что пропаж нет.',
  };

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
    note: unavailableBooks.length
      ? 'Проверка частична: ' + unavailableBooks.length + ' из ' +
        Object.keys(DEPARTMENT_SPREADSHEETS).length +
        ' книг не сопоставлены. Их неизвестное состояние не равно нулю.'
      : '',
  };
}

/** Сравнение двух снимков по книгам; null — сравнивать не с чем. */
/**
 * Одна общая истина для /api/integrity и /api/change-story.
 * База — четверг предыдущей календарной недели. После — последнее ДОСТОВЕРНОЕ чтение
 * живых ведомственных книг из общего кэша, с собственной меткой каждой книги.
 * Источники не пересобираются в SQL-снимок ради сравнения; никаких записей.
 */
export function buildComparison(now: number = Date.now()): { comparison: CurrentComparison | null; note: string } {
  const selected = verifiedThursday(liveBaselineDay(new Date(now), config.weeklySnapshot.utcOffsetHours),
    now, config.weeklySnapshot.utcOffsetHours);
  const baseline = selected.ref;
  if (!baseline || !selected.rows) return {
    comparison: null,
    note: selected.error
      ? 'Недельный контроль не пригоден: ' + selected.error +
        '. Отсутствие доказательства не подтверждает отсутствие пропаж.'
      : 'Нет заверенного четверга предыдущей календарной недели. Срез другой недели не подставляем.',
  };
  const baselineNote = selected.skipped
    ? 'Пропущено неполных попыток того же четверга: ' + selected.skipped +
      '. Использован последний подтверждённый контроль.'
    : '';
  const compared = compareCurrentToThursday(
    baseline, selected.rows, getDeptSheetValues(), getDeptLoadMeta(), now,
    Math.max(config.cache.sourceFreshnessSeconds * 1000, 3_600_000),
  );
  return {
    comparison: compared.comparison,
    note: [baselineNote, compared.note].filter(Boolean).join(' '),
  };
}

/**
 * Сравнение ЗАПЕЧАТАННЫХ соседних недель — независимый контроль потерь между
 * вебхуками и перезапусками. Только локальная SQLite; не трогает Sheets,
 * не создаёт новую историю и не приравнивает отсутствие № к доказанному удалению.
 */
export function buildWeeklyComparison(now: number = Date.now()): {
  weeklyComparison: WeeklyComparison | null;
  note: string;
} {
  const offset = config.weeklySnapshot.utcOffsetHours;
  const endDay = liveBaselineDay(new Date(now), offset);
  const beginDay = endDay - 7;
  const window = isoOfDayNumber(beginDay) + ' → ' + isoOfDayNumber(endDay);
  const after = verifiedThursday(endDay, now, offset);
  const before = verifiedThursday(beginDay, now, offset);
  if (!before.ref || !before.rows || !after.ref || !after.rows) return {
    weeklyComparison: null,
    note: 'Нет полностью заверенной пары смежных четвергов (' + window + '). ' +
      [before.error, after.error].filter(Boolean).join('; ') +
      ' Не подменяем контроль старой или суточной записью.',
  };
  const books: VanishedBookDto[] = [];
  let vanishedTotal = 0;
  let vanishedPlanSum = 0;
  for (const deptId of Object.keys(DEPARTMENT_SPREADSHEETS)) {
    const dept = findDept(deptId);
    const previous = dept ? before.rows!.get(dept.latinId) : undefined;
    const next = dept ? after.rows!.get(dept.latinId) : undefined;
    if (!dept || !previous || !next) return {
      weeklyComparison: null,
      note: 'Недельная пара ' + window + ' не содержит сопоставимых строк книги ' +
        deptId + '. Считать пропажи нулевыми нельзя.',
    };
    const diff = diffSnapshots(previous, next);
    vanishedTotal += diff.vanished.length;
    vanishedPlanSum += diff.vanishedPlanSum;
    if (hasNotableDiff(diff)) books.push(presentDiff(dept, diff, after.ref.createdAt));
  }
  return {
    weeklyComparison: {
      beforeId: before.ref.id,
      afterId: after.ref.id,
      beforeAt: before.ref.createdAt,
      afterAt: after.ref.createdAt,
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
    // The source cache can contain aliases; first-match would silently pick
    // one revision and claim an absence from the wrong book.
    const sourceMatches = Object.entries(sheetValues)
      .filter(([name]) => findDept(name)?.id === dept);
    const metaMatches = Object.entries(loadMeta)
      .filter(([name]) => findDept(name)?.id === dept);
    const current = sourceMatches.length === 1 ? sourceMatches[0][1] : undefined;
    const meta = metaMatches.length === 1 ? metaMatches[0][1] : undefined;
    const readAt = Date.parse(meta?.loadedAt ?? '');
    const eventTimes = events.map(event => Date.parse(event.observedAt ?? ''));
    let reason: string | null = null;
    if (sourceMatches.length !== 1 || metaMatches.length !== 1) {
      reason = 'Нет однозначного чтения книги: совпало несколько алиасов либо источник отсутствует';
    } else if (!current || current.length <= DEPT_HEADER_ROWS ||
        current.some(row => !Array.isArray(row)) || !meta || meta.error ||
        !Number.isInteger(meta.rowCount) || meta.rowCount !== current.length) {
      reason = 'Нет подтверждённой полной матрицы книги';
    } else if (!Number.isFinite(now) || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0 ||
        !Number.isFinite(readAt) || readAt > now || now - readAt > maxAgeMs) {
      reason = 'Текущее чтение книги устарело или время не подтверждено';
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


