/**
 * cross-check.ts — сверка реестра процедур с внешним и внутренним источником
 * (спека §4; канон п.101а: маппинг с книгами ГРБС ПО КАЖДОЙ СТРОКЕ).
 *
 * Две сверки живут здесь, и они про разное:
 *
 *  1. ВНЕШНЯЯ — книги ГРБС ↔ мониторинг. Механика связки давно готова в
 *     pipeline/monitoring-match.ts и до этой волны не вызывалась ниоткуда:
 *     расчёт был, моста до экрана не было. Здесь — переходники, которые
 *     кормят матчер живыми данными: строки книг ГРБС (ячейка AG — номер
 *     процедуры, K — план в тысячах, Y — факт в тысячах) и разобранные
 *     процедуры мониторинга (рубли). Множитель единиц один и живёт в
 *     THOUSANDS_TO_RUB — второго не заводим.
 *
 *  2. ВНУТРЕННЯЯ — лист управления ↔ переходящий реестр «25-26». Расхождения
 *     здесь не про ГРБС, а про саму книгу: одна и та же процедура записана
 *     дважды и суммы разъехались. Продукт называет расхождение и его размер
 *     и НЕ выбирает победителя: какая запись права — решение человека (§7).
 *
 * Совместная закупка отличается от дубля: ЭАС258-26 стоит на шести листах,
 * каждое управление ведёт свою долю, а в журнале записана вся закупка
 * целиком — сумма долей и целое расходятся по природе формы, и подпись
 * говорит об этом прямо, а не поднимает тревогу.
 */

import { DEPT_COLUMNS, DEPT_HEADER_ROWS } from '@aemr/shared';
import {
  THOUSANDS_TO_RUB,
  type MonitoringBookRow,
  type MonitoringMatchResult,
  type MonitoringProcedureRow,
} from '../pipeline/monitoring-match.js';
import { monitoringNumber, round3 } from './cells.js';
import type { MonitoringJournalRow } from './journal.js';
import type { MonitoringProcedure } from './procedures.js';

/** Единицы обеих сторон, подписанные в контракте ответа. */
export const CROSS_CHECK_UNITS = {
  book: 'тыс. руб.',
  monitoring: 'руб.',
  multiplier: THOUSANDS_TO_RUB,
} as const;

// ── Переходники к матчеру ────────────────────────────────────────────

/**
 * Строки книг ГРБС для матчера. Вход — значения листов КНИГ (как их отдаёт
 * снимок), ключ — короткое имя книги («УЭР», «УО»). Шапка книги ГРБС — три
 * строки, поэтому номер строки листа = индекс + DEPT_HEADER_ROWS + 1: адрес
 * должен совпадать с тем, что человек видит в таблице.
 *
 * @param rowsByBook — строки БЕЗ шапки (как отдаёт collectRowsByDept).
 */
export function bookRowsForMatch(
  rowsByBook: Readonly<Record<string, unknown[][]>>,
): MonitoringBookRow[] {
  const out: MonitoringBookRow[] = [];
  for (const [book, rows] of Object.entries(rowsByBook)) {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] ?? [];
      const ag = row[DEPT_COLUMNS.COMMENT_UER];
      if (ag === null || ag === undefined || String(ag).trim() === '') continue;
      out.push({
        rowKey: `${book}:${i + DEPT_HEADER_ROWS + 1}`,
        book,
        ag,
        planTotalThousands: monitoringNumber(row[DEPT_COLUMNS.TOTAL_PLAN]),
        factTotalThousands: monitoringNumber(row[DEPT_COLUMNS.TOTAL_FACT]),
      });
    }
  }
  return out;
}

/**
 * Процедуры мониторинга для матчера. Ячейка «код + предмет» собирается
 * обратно из разобранных полей: матчер нормализует её тем же парсером
 * @aemr/shared, что и разбор строки, поэтому второго толкования кода не
 * возникает. Строки без кода в матч не идут — их адресует сигнал
 * «код процедуры искажён», а не тихая потеря.
 */
export function procedureRowsForMatch(
  procedures: readonly MonitoringProcedure[],
  journalRows: readonly MonitoringJournalRow[] = [],
): MonitoringProcedureRow[] {
  const out: MonitoringProcedureRow[] = [];
  for (const p of procedures) {
    if (p.code === null) continue;
    out.push({
      procKey: `${p.sheet}:${p.row}`,
      sheet: p.sheet,
      nameCell: `${p.code} ${p.subject}`.trim(),
      nmckRub: p.nmck,
      winnerPriceRub: p.auctionPrice,
    });
  }
  for (const j of journalRows) {
    if (j.code === null) continue;
    out.push({
      procKey: `${j.sheet}:${j.row}`,
      sheet: j.sheet,
      nameCell: `${j.code} ${j.subject}`.trim(),
      nmckRub: j.nmck,
      winnerPriceRub: j.price,
    });
  }
  return out;
}

// ── Свод исходов внешней сверки ──────────────────────────────────────

export interface MatchSummary {
  /** Строк книг ГРБС с ровно одним кодом в ячейке AG. */
  readonly bookRowsWithCode: number;
  /** Процедур мониторинга с разобранным кодом. */
  readonly proceduresWithCode: number;
  readonly matched: number;
  readonly bookOnly: number;
  readonly monitoringOnly: number;
  /** Один код в нескольких книгах — штатная форма совместной закупки. */
  readonly ambiguousAcrossBooks: number;
  /** Один код дважды в ОДНОЙ книге — аномалия заполнения. */
  readonly ambiguousSameBook: number;
  /** Ячейки AG со списком кодов: парная сверка сумм невозможна. */
  readonly listCells: number;
  /** Доля кодов мониторинга, нашедших пару, %. */
  readonly coveragePct: number | null;
  /** Из сошедшихся: суммы плана согласны / расходятся / сравнивать нечего. */
  readonly nmckAgree: number;
  readonly nmckDisagree: number;
  readonly nmckNoComparison: number;
  /** То же по факту (цена победителя ↔ Y книги). */
  readonly factAgree: number;
  readonly factDisagree: number;
  readonly factNoComparison: number;
}

/** Свод исходов сверки — счётчики к таблице классов (§4.3). */
export function summarizeMatch(
  result: MonitoringMatchResult,
  bookRowsWithCode: number,
  proceduresWithCode: number,
): MatchSummary {
  let nmckAgree = 0;
  let nmckDisagree = 0;
  let nmckNoComparison = 0;
  let factAgree = 0;
  let factDisagree = 0;
  let factNoComparison = 0;

  for (const m of result.matched) {
    if (m.nmck.agrees === null) nmckNoComparison += 1;
    else if (m.nmck.agrees) nmckAgree += 1;
    else nmckDisagree += 1;
    if (m.fact.agrees === null) factNoComparison += 1;
    else if (m.fact.agrees) factAgree += 1;
    else factDisagree += 1;
  }

  const monitoringCodes = result.matched.length + result.monitoringOnly.length
    + result.ambiguous.filter((a) => a.procedures.length > 0).length;

  return {
    bookRowsWithCode,
    proceduresWithCode,
    matched: result.matched.length,
    bookOnly: result.bookOnly.length,
    monitoringOnly: result.monitoringOnly.length,
    ambiguousAcrossBooks: result.ambiguous.filter((a) => !a.sameBook).length,
    ambiguousSameBook: result.ambiguous.filter((a) => a.sameBook).length,
    listCells: result.listCells.length,
    coveragePct: monitoringCodes === 0
      ? null
      : ((monitoringCodes - result.monitoringOnly.length) / monitoringCodes) * 100,
    nmckAgree,
    nmckDisagree,
    nmckNoComparison,
    factAgree,
    factDisagree,
    factNoComparison,
  };
}

// ── §4.4. Внутренняя сверка: лист управления ↔ «25-26» ───────────────

/** Сторона сверки: где записана процедура и с какими деньгами. */
export interface InternalSideRow {
  readonly sheet: string;
  readonly row: number;
  readonly nmckRub: number | null;
  readonly priceRub: number | null;
}

export type InternalDiffKind =
  /** Код есть по обе стороны, но суммы разъехались. */
  | 'sums-differ'
  /** Процедура есть только на листе управления. */
  | 'sheets-only'
  /** Процедура есть только в переходящем реестре. */
  | 'journal-only';

export interface InternalDiffRow {
  readonly code: string;
  readonly kind: InternalDiffKind;
  readonly sheetRows: readonly InternalSideRow[];
  readonly journalRows: readonly InternalSideRow[];
  /** Лист − журнал, руб.; null — сравнивать нечего. */
  readonly nmckDeltaRub: number | null;
  readonly priceDeltaRub: number | null;
  /** Совместная закупка: доли по управлениям против целого в журнале. */
  readonly joint: boolean;
  /** Что именно расходится, одной фразой без выбора правой стороны. */
  readonly note: string;
}

export interface InternalDiff {
  readonly codesOnSheets: number;
  readonly codesInJournal: number;
  readonly codesInBoth: number;
  readonly rows: readonly InternalDiffRow[];
  /** Сколько строк каждого класса — счётчики к шапке блока. */
  readonly counts: Record<InternalDiffKind, number>;
}

/**
 * Сверка листов управлений с переходящим реестром «25-26».
 *
 * Порог — половина копейки: книга хранит рубли с копейками, и расхождение
 * в 0,60 руб. (ЭА391-25) содержательно, а 0,001 — след округления.
 */
export function internalDiff(
  procedures: readonly MonitoringProcedure[],
  journalRows: readonly MonitoringJournalRow[],
): InternalDiff {
  const sheets = new Map<string, MonitoringProcedure[]>();
  for (const p of procedures) {
    if (p.code === null) continue;
    const bucket = sheets.get(p.code);
    if (bucket === undefined) sheets.set(p.code, [p]);
    else bucket.push(p);
  }
  const journal = new Map<string, MonitoringJournalRow[]>();
  for (const j of journalRows) {
    if (j.code === null) continue;
    const bucket = journal.get(j.code);
    if (bucket === undefined) journal.set(j.code, [j]);
    else bucket.push(j);
  }

  const rows: InternalDiffRow[] = [];
  const counts: Record<InternalDiffKind, number> = {
    'sums-differ': 0, 'sheets-only': 0, 'journal-only': 0,
  };
  let codesInBoth = 0;

  const sumOf = (values: ReadonlyArray<number | null>): number | null => {
    const present = values.filter((v): v is number => v !== null);
    return present.length === 0 ? null : round3(present.reduce((a, b) => a + b, 0));
  };

  for (const [code, sheetRows] of sheets) {
    const journalBucket = journal.get(code);
    const sheetSide: InternalSideRow[] = sheetRows.map((p) => ({
      sheet: p.sheet, row: p.row, nmckRub: p.nmck, priceRub: p.auctionPrice,
    }));

    if (journalBucket === undefined) {
      counts['sheets-only'] += 1;
      rows.push({
        code,
        kind: 'sheets-only',
        sheetRows: sheetSide,
        journalRows: [],
        nmckDeltaRub: null,
        priceDeltaRub: null,
        joint: sheetRows.every((p) => p.joint),
        note: 'Процедура ведётся на листе управления, в переходящем реестре её нет.',
      });
      continue;
    }

    codesInBoth += 1;
    const journalSide: InternalSideRow[] = journalBucket.map((j) => ({
      sheet: j.sheet, row: j.row, nmckRub: j.nmck, priceRub: j.price,
    }));
    const sheetNmck = sumOf(sheetSide.map((r) => r.nmckRub));
    const journalNmck = sumOf(journalSide.map((r) => r.nmckRub));
    const sheetPrice = sumOf(sheetSide.map((r) => r.priceRub));
    const journalPrice = sumOf(journalSide.map((r) => r.priceRub));
    const nmckDeltaRub = sheetNmck === null || journalNmck === null
      ? null
      : round3(sheetNmck - journalNmck);
    const priceDeltaRub = sheetPrice === null || journalPrice === null
      ? null
      : round3(sheetPrice - journalPrice);

    const nmckDiffers = nmckDeltaRub !== null && Math.abs(nmckDeltaRub) >= 0.005;
    const priceDiffers = priceDeltaRub !== null && Math.abs(priceDeltaRub) >= 0.005;
    if (!nmckDiffers && !priceDiffers) continue;

    const joint = sheetRows.every((p) => p.joint) && sheetRows.length > 1;
    const what = nmckDiffers && priceDiffers
      ? 'начальная цена и цена аукциона'
      : nmckDiffers ? 'начальная цена' : 'цена аукциона';
    counts['sums-differ'] += 1;
    rows.push({
      code,
      kind: 'sums-differ',
      sheetRows: sheetSide,
      journalRows: journalSide,
      nmckDeltaRub,
      priceDeltaRub,
      joint,
      note: joint
        ? `Совместная закупка: на листах управлений записаны доли (${sheetRows.length} строк), в переходящем реестре — вся закупка целиком, поэтому ${what} расходится по природе формы.`
        : `Расходится ${what}: лист управления и переходящий реестр держат разные числа. Какая запись верна — решение человека.`,
    });
  }

  for (const [code, journalBucket] of journal) {
    if (sheets.has(code)) continue;
    counts['journal-only'] += 1;
    rows.push({
      code,
      kind: 'journal-only',
      sheetRows: [],
      journalRows: journalBucket.map((j) => ({
        sheet: j.sheet, row: j.row, nmckRub: j.nmck, priceRub: j.price,
      })),
      nmckDeltaRub: null,
      priceDeltaRub: null,
      joint: false,
      note: 'Процедура ведётся в переходящем реестре, на лист управления ещё не перенесена.',
    });
  }

  rows.sort((a, b) => {
    const order: Record<InternalDiffKind, number> = { 'sums-differ': 0, 'sheets-only': 1, 'journal-only': 2 };
    return order[a.kind] - order[b.kind] || a.code.localeCompare(b.code, 'ru');
  });

  return {
    codesOnSheets: sheets.size,
    codesInJournal: journal.size,
    codesInBoth,
    rows,
    counts,
  };
}
