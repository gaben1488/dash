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
 * ЦЕНА ЗАПРОСА. Обычный GET читает принятый серверный кэш, SQLite и
 * доказанный четверговый срез. Только явное refresh=true читает Google.
 * Оба режима используют один предметный сервис evidence, а не логику маршрута.
 */
import type { FastifyInstance } from 'fastify';
import { buildComparison, buildWeeklyComparison, selectActiveSourceAbsences, type CurrentComparison, type WeeklyComparison, type OperationalAbsenceReport } from '../services/procurement-absence.js';
export {
  pickLatestControlSnapshot, pickAdjacentWeeklySnapshots, buildComparison,
  buildWeeklyComparison, selectActiveSourceAbsences, currentSheetToSnapshotRows,
} from '../services/procurement-absence.js';
export type { VanishedBookDto, OperationalAbsenceDto, OperationalAbsenceReport } from '../services/procurement-absence.js';

import {
  liveBaselineDay,
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
// Monetary read semantics use the shared journal parser, not parseFloat.
import { journalNumber as cellNumber } from '@aemr/core';
import { DEPARTMENT_SPREADSHEETS, config } from '../config.js';
import { getDeptCacheFilledAt, getDeptLoadMeta, getDeptSheetValues } from '../services/snapshot.js';
import { refreshAllSources } from '../services/source-refresh.js';
import { readSourceRowObservations } from '../services/source-row-observations.js';
import { orgLabel } from '../services/weekly-control-validation.js';
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

export interface IntegrityResponse {
  asOf: string;
  books: IntegrityBookDto[];
  /** Итоги нумерации по прочитанным книгам. */
  totals: { gapCount: number; duplicates: number; countableWithoutSeq: number; dateFormat: number };
  /** Сравнение снимков; null — сравнивать не с чем. */
  comparison: CurrentComparison | null;
  /** Two verified adjacent Thursday baselines; no read is silently substituted. */
  weeklyComparison: WeeklyComparison | null;
  /** Нет пары / не пройдена проверка полноты — отсутствие результата НЕ ноль. */
  weeklyComparisonNote: string;
  /** Почему оперативного сравнения нет — фраза для экрана. */
  comparisonNote: string;
  operational: OperationalAbsenceReport;
  /** Only present after explicit source acquisition; ordinary GET never reads Google. */
  sourceRefresh?: {
    attempted: true;
    complete: boolean;
    checkedAt: string;
    failedBooks: string[];
    error: string | null;
  };
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

/**
 * Never pass a cached state off as a successful forced source read.
 * Weekly historic evidence remains accessible; current/operational conclusions
 * are withheld until a new accepted reading. No source or SQLite writes here.
 */
export function refuseUnverifiedCurrentSource(
  response: IntegrityResponse, reason: string,
): IntegrityResponse {
  return {
    ...response,
    books: response.books.map(book => ({
      ...book, rowsAvailable: false, sequence: null, dateFormat: [],
      note: 'Текущее чтение не подтверждено: ' + reason,
    })),
    totals: { gapCount: 0, duplicates: 0, countableWithoutSeq: 0, dateFormat: 0 },
    comparison: null,
    comparisonNote: 'Принудительная перечитка не завершилась. ' + reason +
      '. По прежнему кэшу отсутствие закупок не утверждается.',
    operational: { ...response.operational, entries: [], error: reason },
    notes: [...response.notes, 'Действующие книги не приняты после попытки чтения: ' + reason],
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
    let forced: IntegrityResponse['sourceRefresh'];
    if (fresh) {
      // The same coordinator used by webhook/cron owns Google reads and its
      // durable source-revision acceptance; this route never acquires directly.
      try {
        const result = await refreshAllSources(undefined, 'request', {
          askDrive: false, svod: false, fresh: true,
        });
        const missing = Object.keys(DEPARTMENT_SPREADSHEETS).filter(
          book => !result.loaded.includes(book),
        );
        const failedBooks = [...new Set([...result.failed, ...missing])];
        forced = {
          attempted: true,
          complete: failedBooks.length === 0,
          checkedAt: new Date().toISOString(),
          failedBooks,
          error: null,
        };
      } catch {
        forced = {
          attempted: true,
          complete: false,
          checkedAt: new Date().toISOString(),
          failedBooks: Object.keys(DEPARTMENT_SPREADSHEETS),
          error: 'Не удалось завершить принудительное чтение источников',
        };
      }
    }
    const readAt = Date.now();
    const base = buildIntegrityResponse(readAt);
    // A source failure that threw before publication may leave the old cache
    // looking young; invalidate *all* current-side evidence, not old weeks.
    const response = forced?.error
      ? refuseUnverifiedCurrentSource(base, forced.error)
      : base;
    if (forced) {
      response.sourceRefresh = forced;
      if (forced.failedBooks.length > 0) {
        response.notes.push('Принудительная сверка неполна: ' +
          forced.failedBooks.join(', ') + '. Это не ноль пропавших закупок.');
      }
    }
    if (!forced?.error) {
      // Transient acquisition-attempt metadata is not stored in GET cache.
      const cacheResponse = forced ? base : response;
      cached = { at: readAt, sourceAt: getDeptCacheFilledAt(), response: cacheResponse };
    }
    return reply.send(response);
  });
}
