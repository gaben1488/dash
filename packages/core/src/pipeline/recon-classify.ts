/**
 * Классификаторы первопричин расхождений сверки (блок 1 плана к запуску,
 * шаги 4–5). Контракт типов — @aemr/shared/recon-root-cause.
 *
 * Классификатор получает строки-атомы книги ГРБС и меру расхождения, а
 * возвращает первопричину с адресами строк-виновниц и их вкладом. Правило:
 * причина без адресов не предъявима, поэтому классификатор, не нашедший
 * строк, возвращает null — остаток честно достанется классу 'unknown'.
 */

import {
  DEPT_COLUMNS,
  DEPT_HEADER_ROWS,
  toNumber,
  type ReconRootCause,
  type ReconRootCauseRow,
} from '@aemr/shared';
import { standardRowFilter, type RawRow } from './calc-engine.js';

const COL = DEPT_COLUMNS;

/** Мера, в которой считается расхождение: деньги или количество процедур. */
export type ReconMeasure = 'planMoney' | 'planCount' | 'factMoney' | 'factCount';

/**
 * Буква колонки листа по индексу (0 → A, 25 → Z, 26 → AA). Книги ГРБС
 * доходят до AH, поэтому одной буквы, в отличие от листа СВОД, мало.
 */
export function columnLetter(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** Номер строки листа для атома по его индексу (шапка + 1, как видит человек). */
export function sheetRowOf(rowIndex: number): number {
  return rowIndex + DEPT_HEADER_ROWS + 1;
}

const cellNum = (v: unknown): number => toNumber(v) ?? 0;

/** Плановая сумма строки: ИТОГО либо тройка бюджетов (канон build-report). */
function rowPlanTotal(row: RawRow): number {
  return (
    cellNum(row[COL.TOTAL_PLAN]) ||
    cellNum(row[COL.FB_PLAN]) + cellNum(row[COL.KB_PLAN]) + cellNum(row[COL.MB_PLAN])
  );
}

/** Фактическая сумма строки: ИТОГО либо тройка бюджетов. */
function rowFactTotal(row: RawRow): number {
  return (
    cellNum(row[COL.TOTAL_FACT]) ||
    cellNum(row[COL.FB_FACT]) + cellNum(row[COL.KB_FACT]) + cellNum(row[COL.MB_FACT])
  );
}

/** Дата факта заполнена (не пусто и не заглушка «Х»/«-»). */
function hasFactDate(row: RawRow): boolean {
  const s = String(row[COL.FACT_DATE] ?? '').trim().toLowerCase();
  return s !== '' && s !== 'х' && s !== 'x' && s !== '-';
}

/** Год плана пуст или заглушка — строка «без подтверждённого финансирования». */
function planYearEmpty(row: RawRow): boolean {
  const s = String(row[COL.PLAN_YEAR] ?? '').trim().toLowerCase();
  return s === '' || s === 'х' || s === 'x' || s === '-';
}

/** Плановый квартал валиден (1..4). */
function planQuarterValid(row: RawRow): boolean {
  const q = Number(String(row[COL.PLAN_QUARTER] ?? '').trim().replace(',', '.'));
  return q >= 1 && q <= 4;
}

/** Вклад строки в меру расхождения: сколько именно она добавляет расчёту. */
function contributionOf(row: RawRow, measure: ReconMeasure): number {
  switch (measure) {
    case 'planMoney':
      return rowPlanTotal(row);
    case 'factMoney':
      return rowFactTotal(row);
    case 'planCount':
      return 1;
    case 'factCount':
      return hasFactDate(row) ? 1 : 0;
  }
}

/** Колонка-адрес для меры: куда смотреть человеку в книге. */
function cellColumnFor(measure: ReconMeasure): number {
  return measure === 'factMoney' || measure === 'factCount' ? COL.TOTAL_FACT : COL.TOTAL_PLAN;
}

function toCauseRow(sheet: string, rowIndex: number, measure: ReconMeasure, delta: number): ReconRootCauseRow {
  return {
    sheet,
    row: sheetRowOf(rowIndex),
    cell: `${columnLetter(cellColumnFor(measure))}${sheetRowOf(rowIndex)}`,
    delta,
  };
}

/** Строки-виновницы дороже — выше: внимание читателя ведут деньги. */
function sortRows(rows: ReconRootCauseRow[]): ReconRootCauseRow[] {
  return rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

function money(n: number): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

export interface ClassifyInput {
  /** Строки-атомы книги ГРБС (без шапки, как в snapshot.rowsByDept). */
  rows: RawRow[];
  /** Имя листа книги — первая часть пути до виновницы. */
  sheet: string;
  /** Мера расхождения. */
  measure: ReconMeasure;
  /**
   * Отчётный год. Строки других лет к расхождению отношения не имеют.
   * Не задан — год не проверяется (сверка «за всё время»).
   */
  year?: number;
  /** Номер суток среза: для класса afterSlice. */
  asOfDay?: number;
}

/**
 * Класс `unfunded` — строки без года плана (P пуст).
 *
 * Формулы листа СВОД считают год строго и таких строк не видят; наш расчёт
 * до консолидации 07.08 их учитывал. Ровно их сумма и была расхождением
 * лимита. Классификатор находит их адреса, чтобы исполнитель проставил
 * сроки, а не искал вручную по книге на три тысячи строк.
 */
export function classifyUnfunded(input: ClassifyInput): ReconRootCause | null {
  const rows: ReconRootCauseRow[] = [];
  input.rows.forEach((row, i) => {
    if (!standardRowFilter(row)) return;
    if (!planYearEmpty(row)) return;
    if (rowPlanTotal(row) <= 0) return;
    const delta = contributionOf(row, input.measure);
    if (delta === 0) return;
    rows.push(toCauseRow(input.sheet, i, input.measure, delta));
  });
  if (rows.length === 0) return null;
  const total = rows.reduce((s, r) => s + r.delta, 0);
  return {
    class: 'unfunded',
    rows: sortRows(rows),
    explanation:
      `Строк без года плана: ${rows.length}, их вклад ${money(total)}. ` +
      'Формулы листа СВОД считают год строго и эти строки не видят, поэтому официальное число меньше расчётного.',
  };
}

/**
 * Класс `factQuarterMissing` — факт есть, планового квартала (O) нет.
 *
 * Печатный год считается строго по плановым кварталам, поэтому такая
 * строка выпадает из годовой свёртки отчёта, оставаясь в «живом» итоге.
 * Замер 07.08: одна строка УДТХ на 67 666,68 тыс. давала всё расхождение
 * годовых чисел района.
 */
export function classifyFactQuarterMissing(input: ClassifyInput): ReconRootCause | null {
  const rows: ReconRootCauseRow[] = [];
  input.rows.forEach((row, i) => {
    if (!standardRowFilter(row)) return;
    if (!hasFactDate(row)) return;
    if (planQuarterValid(row)) return;
    if (input.year !== undefined) {
      const y = cellNum(row[COL.PLAN_YEAR]);
      if (y > 0 && y !== input.year) return;
    }
    const delta = contributionOf(row, input.measure);
    if (delta === 0) return;
    rows.push(toCauseRow(input.sheet, i, input.measure, delta));
  });
  if (rows.length === 0) return null;
  const total = rows.reduce((s, r) => s + r.delta, 0);
  return {
    class: 'factQuarterMissing',
    rows: sortRows(rows),
    explanation:
      `Строк с фактом без планового квартала: ${rows.length}, их вклад ${money(total)}. ` +
      'Годовой итог отчёта складывается из четырёх плановых кварталов, поэтому такие строки в него не входят.',
  };
}

/**
 * Класс `afterSlice` — заключено ПОСЛЕ даты среза.
 *
 * Лист СВОД дату факта ни с чем не сравнивает и всегда считает «на сейчас»,
 * а отчёт режет факт по четвергу снимка. Это не дефект данных: причина
 * несёт рекомендацию «действий не требуется», но расхождение объясняет.
 */
export function classifyAfterSlice(input: ClassifyInput): ReconRootCause | null {
  if (input.asOfDay === undefined) return null;
  if (input.measure === 'planMoney' || input.measure === 'planCount') return null;
  const rows: ReconRootCauseRow[] = [];
  input.rows.forEach((row, i) => {
    if (!standardRowFilter(row)) return;
    if (!hasFactDate(row)) return;
    const factDay = dayNumberOfCell(row[COL.FACT_DATE]);
    if (factDay === null || factDay <= input.asOfDay!) return;
    const delta = contributionOf(row, input.measure);
    if (delta === 0) return;
    rows.push(toCauseRow(input.sheet, i, input.measure, delta));
  });
  if (rows.length === 0) return null;
  const total = rows.reduce((s, r) => s + r.delta, 0);
  return {
    class: 'afterSlice',
    rows: sortRows(rows),
    // Знак: эти строки есть у листа и нет у отчёта, поэтому расчёт МЕНЬШЕ
    // официала — вклад отрицательный относительно «расчёт − официал».
    explanation:
      `Заключено после даты среза: ${rows.length} строк на ${money(total)}. ` +
      'Лист СВОД всегда считает на текущий момент, отчёт — на дату среза; в отчётные числа эти строки войдут следующей неделей.',
  };
}

/** Дата ячейки в номер суток — локальная копия канона parse-sheet-date. */
function dayNumberOfCell(v: unknown): number | null {
  const s = String(v ?? '').trim();
  if (s === '') return null;
  const m = s.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/);
  if (m) {
    const d = Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    return Math.floor(d / 86_400_000);
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Math.floor(d / 86_400_000);
  }
  const serial = Number(s);
  // Google Sheets serial: 1899-12-30 = 0.
  if (Number.isFinite(serial) && serial > 20_000 && serial < 80_000) {
    return Math.floor(serial - 25_569);
  }
  return null;
}
