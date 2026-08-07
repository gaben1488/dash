/**
 * economic.ts — экономические метрики первого эшелона (план запуска §2).
 *
 * Четыре метрики высокого приоритета, каждая считается СТРОГО из колонок,
 * которые в книгах ГРБС реально заполнены: план и факт денег по источникам
 * ФБ/КБ/МБ (H-J / V-X), плановый и фактический квартал (O / R), дата
 * заключения (Q). Ничего, чего в атоме нет (участники торгов, цены единиц,
 * даты этапов процедуры), здесь не появляется и появиться не может.
 *
 * Общие правила чисел, обязательные для всех функций файла:
 *   - процент выдаётся ТОЛЬКО вместе с числителем и знаменателем — карточка
 *     «откуда число» без них не собирается, а без карточки метрика в отчёт
 *     не идёт (план §5, пункт 31);
 *   - нулевой (и отрицательный — это дефект данных) знаменатель даёт null,
 *     а НЕ ноль: «нет плана» и «план не исполнен» — разные управленческие
 *     новости, и путать их запрещено (§3.2 пирамиды агрегации);
 *   - проценты не усредняются: доля считается из слитых числителя и
 *     знаменателя. Единственное исключение — медиана PEFA PI-1, где
 *     построчный разброс и есть предмет измерения; она названа медианой
 *     явно и рядом с агрегатом, который усреднением не получен;
 *   - масштаб процентов в этой папке — 40 = 40 % (как quarterExecution), а
 *     НЕ доля 0.4, которой оперируют производные CalcEngine.
 *
 * Периметр строк везде один — канонический standardRowFilter (строки-итоги,
 * шапки и мусор отсеиваются им, а не местной эвристикой), поэтому число
 * строк в знаменателе совпадает со счётчиками остального продукта.
 */

import {
  DEPT_COLUMNS,
  dayNumberOf,
  factCountsOn,
  isoOfDayNumber,
  toNumber,
} from '@aemr/shared';
import { CalcEngine, standardRowFilter, type RawRow } from '../pipeline/calc-engine.js';

const COL = DEPT_COLUMNS;

// ── Общие типы ───────────────────────────────────────────────────────

/** Цветовая зона интерпретации: норма / жёлтый / красный. */
export type MetricZone = 'normal' | 'yellow' | 'red';

/**
 * Отношение с провенансом: значение неотделимо от числителя, знаменателя и
 * строк, которые их сложили. Индексы строк — позиции во ВХОДНОМ массиве
 * (0-based, как contributingRows у CalcEngine), поэтому клик «покажи строки»
 * приводит ровно к тем атомам, из которых число собрано.
 */
export interface RatioValue {
  /** Значение в процентах (40 = 40 %); null — знаменателя нет. */
  pct: number | null;
  numerator: number;
  denominator: number;
  /** Строки, вошедшие в числитель. */
  numeratorRows: number[];
  /** Строки, вошедшие в знаменатель (числитель — его подмножество). */
  denominatorRows: number[];
}

/**
 * Собирает отношение по канону нулевого знаменателя. Знаменатель ≤ 0 → null:
 * ноль означал бы «доля равна нулю», а отрицательная сумма (дефект данных)
 * дала бы процент с перевёрнутым знаком — обе подписи были бы враньём.
 */
function ratio(
  numerator: number,
  denominator: number,
  numeratorRows: number[],
  denominatorRows: number[],
): RatioValue {
  return {
    pct: denominator > 0 ? (numerator / denominator) * 100 : null,
    numerator,
    denominator,
    numeratorRows,
    denominatorRows,
  };
}

/** Число листа — канон toNumber (пробелы-разряды, запятая десятичная). */
function num(v: unknown): number {
  return toNumber(v) ?? 0;
}

/**
 * Плановые деньги строки — зеркало метрики plan_total движка: K, а при нуле
 * сумма H+I+J. Тот же фолбэк, иначе строки, где оператор заполнил только
 * разбивку по бюджетам, считались бы «нулевым планом».
 */
function planMoney(row: RawRow): number {
  const total = num(row[COL.TOTAL_PLAN]);
  return total !== 0 ? total : num(row[COL.FB_PLAN]) + num(row[COL.KB_PLAN]) + num(row[COL.MB_PLAN]);
}

/** Фактические деньги строки — зеркало fact_total движка: Y, при нуле V+W+X. */
function factMoney(row: RawRow): number {
  const total = num(row[COL.TOTAL_FACT]);
  return total !== 0 ? total : num(row[COL.FB_FACT]) + num(row[COL.KB_FACT]) + num(row[COL.MB_FACT]);
}

/**
 * Квартал из числовой ячейки (O или R): 1..4 либо null. Дробное значение —
 * дефект данных, и оно даёт null, а не округление: «1,5» невозможно отнести
 * ни к первому кварталу, ни ко второму, и честная непривязанность лучше
 * выдуманной привязки, которую потом никто не оспорит.
 */
function quarterCell(raw: unknown): 1 | 2 | 3 | 4 | null {
  const q = toNumber(raw);
  if (q === null || !Number.isInteger(q)) return null;
  return q >= 1 && q <= 4 ? (q as 1 | 2 | 3 | 4) : null;
}

/**
 * Квартал и год из даты листа. Компоненты берутся из номера суток через
 * isoOfDayNumber, а не из локальных полей Date: serial-дата приходит как
 * UTC-полночь, и getMonth() на поясе западнее Гринвича откатил бы 01.01 на
 * 31.12 предыдущего года — то есть перебросил бы закупку в другой квартал
 * и другой год ровно на границе, где считается декабрьский навес.
 */
function periodOfSheetDate(raw: unknown): { quarter: 1 | 2 | 3 | 4; year: number } | null {
  const day = dayNumberOf(raw);
  if (day === null) return null;
  const iso = isoOfDayNumber(day);
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  return { quarter: Math.ceil(month / 3) as 1 | 2 | 3 | 4, year };
}

/**
 * Период факта строки. Столбец R («Квартал (факт)») в живых книгах заполнен
 * не везде, поэтому при пустом или мусорном R квартал выводится из даты
 * заключения Q — той самой ячейки, которая уже служит гейтом факта. Это не
 * выдуманные данные, а прочтение имеющейся: но каждая такая строка считается
 * отдельно (quarterFromDate), чтобы карточка метрики честно сказала, какая
 * доля привязки держится на дате, а не на проставленном квартале.
 */
interface FactPeriod {
  quarter: 1 | 2 | 3 | 4 | null;
  year: number | null;
  quarterFromDate: boolean;
}

function factPeriodOf(row: RawRow): FactPeriod {
  const fromColumns = {
    quarter: quarterCell(row[COL.FACT_QUARTER]),
    year: (() => {
      const y = toNumber(row[COL.FACT_YEAR]);
      return y !== null && y > 0 ? Math.trunc(y) : null;
    })(),
  };
  if (fromColumns.quarter !== null && fromColumns.year !== null) {
    return { ...fromColumns, quarterFromDate: false };
  }
  const fromDate = periodOfSheetDate(row[COL.FACT_DATE]);
  return {
    quarter: fromColumns.quarter ?? fromDate?.quarter ?? null,
    year: fromColumns.year ?? fromDate?.year ?? null,
    quarterFromDate: fromColumns.quarter === null && fromDate !== null,
  };
}

/**
 * Обход строк-атомов с годовым фильтром. Политика пустого года — «lenient»,
 * как у CalcEngine по умолчанию: строка без года НЕ теряется, иначе метрика
 * молча уронила бы часть данных, которые весь остальной продукт показывает.
 */
function eachDataRow(
  rows: readonly RawRow[],
  yearOf: (row: RawRow) => number | null,
  year: number | undefined,
  visit: (row: RawRow, index: number) => void,
): void {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !standardRowFilter(row)) continue;
    if (year !== undefined) {
      const rowYear = yearOf(row);
      if (rowYear !== null && rowYear > 0 && rowYear !== year) continue;
    }
    visit(row, i);
  }
}

/** Год плана строки (столбец P) — ось годового фильтра плановых метрик. */
function planYearOf(row: RawRow): number | null {
  const y = toNumber(row[COL.PLAN_YEAR]);
  return y !== null && y > 0 ? Math.trunc(y) : null;
}

// ── Пороги интерпретации ─────────────────────────────────────────────

/**
 * Пороги декабрьского навеса (доля Q4 в годовом факте).
 * Нижняя граница нормы 25 % — не порог тревоги, а ориентир равномерности
 * (год из четырёх кварталов): доля заметно ниже неё чаще означает, что
 * квартал факта проставлен не у всех строк, а не идеальную равномерность.
 */
export const DECEMBER_OVERHANG_THRESHOLDS = {
  /** Ориентир равномерного года — четверть годового факта. */
  referenceBandMinPct: 25,
  /** Включительно: ≤ 35 % — норма. */
  normalMaxPct: 35,
  /** Включительно: ≤ 45 % — жёлтая зона; выше — красная. */
  yellowMaxPct: 45,
} as const;

/** Границы буквенных оценок PEFA PI-1 (включительно), в процентах. */
export const PLANNING_ACCURACY_GRADES = {
  A: 5,
  B: 10,
  C: 15,
} as const;

/** Пороги разрыва освоения между источниками, в процентных пунктах. */
export const SOURCE_GAP_THRESHOLDS = {
  /** Строго меньше 5 п.п. — норма. */
  normalMaxPp: 5,
  /** Включительно до 10 п.п. — жёлтая зона; выше — красная. */
  yellowMaxPp: 10,
} as const;

/** Пороги соблюдения планового квартала. */
export const QUARTER_COMPLIANCE_THRESHOLDS = {
  /** Включительно: ≥ 80 % строк в срок — норма. */
  normalMinPct: 80,
  /** Включительно: ≥ 60 % — жёлтая зона; ниже — красная. */
  yellowMinPct: 60,
  /** Средний сдвиг в целый квартал и больше — красная зона независимо от доли. */
  redMeanShiftQuarters: 1,
} as const;

/**
 * Зона декабрьского навеса. null на входе (нет годового факта) → null на
 * выходе: вердикта без знаменателя не бывает.
 */
export function classifyDecemberOverhang(pct: number | null): MetricZone | null {
  if (pct === null) return null;
  if (pct <= DECEMBER_OVERHANG_THRESHOLDS.normalMaxPct) return 'normal';
  if (pct <= DECEMBER_OVERHANG_THRESHOLDS.yellowMaxPct) return 'yellow';
  return 'red';
}

/** Буквенная оценка PEFA PI-1 по агрегатному отклонению. */
export function planningAccuracyGrade(pct: number | null): 'A' | 'B' | 'C' | 'D' | null {
  if (pct === null) return null;
  if (pct <= PLANNING_ACCURACY_GRADES.A) return 'A';
  if (pct <= PLANNING_ACCURACY_GRADES.B) return 'B';
  if (pct <= PLANNING_ACCURACY_GRADES.C) return 'C';
  return 'D';
}

/**
 * Зона точности планирования. Отображение оценок в цвет: A и B — норма
 * (методология PEFA считает такой бюджет достоверным), C — жёлтый,
 * D — красный.
 */
export function classifyPlanningAccuracy(pct: number | null): MetricZone | null {
  const grade = planningAccuracyGrade(pct);
  if (grade === null) return null;
  if (grade === 'A' || grade === 'B') return 'normal';
  return grade === 'C' ? 'yellow' : 'red';
}

/** Зона разрыва освоения между источниками (в процентных пунктах). */
export function classifySourceExecutionGap(gapPp: number | null): MetricZone | null {
  if (gapPp === null) return null;
  if (gapPp < SOURCE_GAP_THRESHOLDS.normalMaxPp) return 'normal';
  if (gapPp <= SOURCE_GAP_THRESHOLDS.yellowMaxPp) return 'yellow';
  return 'red';
}

/**
 * Зона соблюдения планового квартала. Средний сдвиг в целый квартал и
 * больше делает зону красной при любой доле «в срок»: план, который в
 * среднем исполняется кварталом позже, существует на бумаге, даже если
 * формально «в срок» отчиталось большинство строк.
 */
export function classifyQuarterCompliance(
  pct: number | null,
  meanShiftQuarters: number | null,
): MetricZone | null {
  if (pct === null) return null;
  if (
    meanShiftQuarters !== null &&
    meanShiftQuarters >= QUARTER_COMPLIANCE_THRESHOLDS.redMeanShiftQuarters
  ) {
    return 'red';
  }
  if (pct >= QUARTER_COMPLIANCE_THRESHOLDS.normalMinPct) return 'normal';
  if (pct >= QUARTER_COMPLIANCE_THRESHOLDS.yellowMinPct) return 'yellow';
  return 'red';
}

// ── 1. Индекс декабрьского навеса ────────────────────────────────────

export interface DecemberOverhangOptions {
  /**
   * Год ФАКТА (столбец S, при пустом — год из даты заключения Q). Именно
   * факта, а не плана: метрика измеряет, как деньги легли внутри года их
   * освоения. Строка с неопределимым годом проходит (канон lenient).
   */
  year?: number;
  /** Номер суток среза: факт позже среза не засчитывается (канон factCountsOn). */
  asOfDay?: number;
}

export interface DecemberOverhangResult {
  /** Доля денег Q4 в годовом факте. */
  money: RatioValue;
  /** Доля строк Q4 в числе заключённых за год. */
  count: RatioValue;
  /** Зона по деньгам (деньги — то, из-за чего метрика существует). */
  zone: MetricZone | null;
  /**
   * Факт, который не удалось привязать к кварталу (пусты и R, и разбор Q).
   * Входит в знаменатель — это реальные деньги года — и потому занижает
   * индекс: заметная доля здесь означает не «навеса нет», а «привязка не
   * работает».
   */
  unattributed: { count: number; amount: number; rows: number[] };
  /** Сколько строк получили квартал факта из даты Q, а не из столбца R. */
  quarterFromDateCount: number;
}

/**
 * Индекс декабрьского навеса — доля годового факта, пришедшаяся на четвёртый
 * квартал, по деньгам и по количеству процедур.
 *
 * ЧЬЁ РЕШЕНИЕ. Начальника управления и главы района: если больше трети денег
 * уходит в последний квартал, торги идут в спешке под угрозой возврата
 * средств, и решение — переносить размещение на первое полугодие, а не
 * догонять план в декабре. Сравнение ГРБС между собой показывает, у кого
 * навес системный, а у кого разовый.
 *
 * ФОРМУЛА. Σ(факт, квартал факта = 4) / Σ(факт за год) × 100 — отдельно по
 * деньгам и по числу строк с фактом.
 *
 * ПРОВЕНАНС. Деньги — Y (при нуле V+W+X) под гейтом даты заключения Q
 * (factCountsOn: заглушки Х/X/- фактом не считаются, дата позже среза тоже).
 * Квартал факта — R, при пустом или мусорном R выводится из даты Q, и такие
 * строки считаны в quarterFromDateCount. Год — S, при пустом из даты Q.
 * Периметр строк — standardRowFilter. Каждое число сопровождают индексы
 * строк входного массива.
 *
 * ПОРОГ. ≤ 35 % — норма, 35–45 % — жёлтая зона, свыше 45 % — красная.
 * Ориентир равномерного года — 25 % (четверть); доля заметно ниже него
 * обычно означает пробелы в привязке, а не образцовую равномерность.
 *
 * ИСТОЧНИК. Liebman J., Mahoney N. «Do Expiring Budgets Lead to Wasteful
 * Year-End Spending? Evidence from Federal Procurement», American Economic
 * Review, 2017 — https://www.aeaweb.org/articles?id=10.1257/aer.20131296
 */
export function decemberOverhang(
  rows: readonly RawRow[],
  opts: DecemberOverhangOptions = {},
): DecemberOverhangResult {
  let q4Money = 0;
  let yearMoney = 0;
  let q4Count = 0;
  let yearCount = 0;
  const q4Rows: number[] = [];
  const factRows: number[] = [];
  const unattributedRows: number[] = [];
  let unattributedAmount = 0;
  let quarterFromDateCount = 0;

  // Год строки для фильтра — тот же, по которому метрика атрибуцирует факт.
  const yearOf = (row: RawRow): number | null => factPeriodOf(row).year;

  eachDataRow(rows, yearOf, opts.year, (row, index) => {
    if (!factCountsOn(row[COL.FACT_DATE], opts.asOfDay)) return;

    const money = factMoney(row);
    yearMoney += money;
    yearCount += 1;
    factRows.push(index);

    const period = factPeriodOf(row);
    if (period.quarterFromDate) quarterFromDateCount += 1;

    if (period.quarter === null) {
      unattributedRows.push(index);
      unattributedAmount += money;
      return;
    }
    if (period.quarter === 4) {
      q4Money += money;
      q4Count += 1;
      q4Rows.push(index);
    }
  });

  const money = ratio(q4Money, yearMoney, q4Rows, factRows);
  return {
    money,
    count: ratio(q4Count, yearCount, q4Rows, factRows),
    zone: classifyDecemberOverhang(money.pct),
    unattributed: {
      count: unattributedRows.length,
      amount: unattributedAmount,
      rows: unattributedRows,
    },
    quarterFromDateCount,
  };
}

// ── 2. Точность планирования (PEFA PI-1) ─────────────────────────────

export interface PlanningAccuracyOptions {
  /** Год ПЛАНА (столбец P); пустой год проходит (канон lenient). */
  year?: number;
  /** Номер суток среза (канон factCountsOn). */
  asOfDay?: number;
  /**
   * Включать ли в периметр строки без факта, считая их факт нулём.
   * По умолчанию false — середина года: незаключённая процедура ещё не
   * «недоосвоение», и её нулевой факт дал бы отклонение 100 % на пустом
   * месте. true — годовой разрез PEFA, где отсутствие факта к концу года и
   * есть неисполнение бюджета.
   */
  includePending?: boolean;
}

export interface PlanningAccuracyResult {
  /** Агрегат: |Σфакт − Σплан| / Σплан × 100. */
  aggregate: RatioValue;
  /**
   * Тот же агрегат со знаком: отрицательный — потрачено меньше плана
   * (недоосвоение или экономия), положительный — превышение.
   */
  signedPct: number | null;
  /** Сумма факта и сумма плана периметра — знаменатель раскрыт по частям. */
  factTotal: number;
  planTotal: number;
  /** Медиана построчного |факт−план|/план × 100; null — нет строк с планом > 0. */
  medianPct: number | null;
  /** Сколько строк вошло в медиану. */
  medianRowCount: number;
  /** Строки периметра с планом ≤ 0: в медиану не вошли — делить не на что. */
  zeroPlanRows: number[];
  /** Строки без факта: при includePending = false в периметр не вошли. */
  pendingRows: number[];
  /** Буквенная оценка PEFA PI-1 по агрегату. */
  grade: 'A' | 'B' | 'C' | 'D' | null;
  zone: MetricZone | null;
}

/** Медиана: при чётной длине — среднее двух срединных. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Точность планирования — насколько плановые суммы предсказали фактические.
 *
 * ЧЬЁ РЕШЕНИЕ. Начальника финансового управления и ГРБС при формировании
 * плана на следующий год: агрегат отвечает, можно ли верить плану как
 * бюджетному обязательству, медиана — насколько велик разброс по отдельным
 * строкам. Агрегат в норме при большой медиане означает, что ошибки строк
 * гасят друг друга: сумма сходится случайно, а каждая отдельная закупка
 * спланирована плохо, и укрупнять лимиты по такому плану нельзя.
 *
 * ФОРМУЛА. Агрегат = |Σфакт − Σплан| / Σплан × 100; строки = медиана
 * |факт − план| / план × 100 по строкам с планом > 0.
 *
 * ПРОВЕНАНС. План — K (при нуле H+I+J), факт — Y (при нуле V+W+X), гейт
 * факта — дата заключения Q через factCountsOn. По умолчанию в периметр
 * входят только заключённые строки (см. includePending); исключённые
 * перечислены в pendingRows, строки с нулевым планом — в zeroPlanRows.
 *
 * ПОРОГ. Отклонение агрегата ≤ 5 % — оценка A, ≤ 10 % — B, ≤ 15 % — C,
 * свыше — D. В цвете: A и B — норма, C — жёлтая зона, D — красная.
 *
 * ИСТОЧНИК. PEFA, показатель PI-1 «Aggregate expenditure outturn» —
 * https://www.pefa.org/node/4762
 */
export function planningAccuracy(
  rows: readonly RawRow[],
  opts: PlanningAccuracyOptions = {},
): PlanningAccuracyResult {
  let planTotal = 0;
  let factTotal = 0;
  const perimeterRows: number[] = [];
  const zeroPlanRows: number[] = [];
  const pendingRows: number[] = [];
  const rowDeviations: number[] = [];

  eachDataRow(rows, planYearOf, opts.year, (row, index) => {
    const hasFact = factCountsOn(row[COL.FACT_DATE], opts.asOfDay);
    if (!hasFact) {
      pendingRows.push(index);
      if (!opts.includePending) return;
    }

    const plan = planMoney(row);
    const fact = hasFact ? factMoney(row) : 0;
    planTotal += plan;
    factTotal += fact;
    perimeterRows.push(index);

    if (plan > 0) {
      rowDeviations.push((Math.abs(fact - plan) / plan) * 100);
    } else {
      zeroPlanRows.push(index);
    }
  });

  // Числитель агрегата — модуль разности сумм: PI-1 измеряет величину
  // промаха, а не его направление; направление отдельно в signedPct.
  const aggregate = ratio(Math.abs(factTotal - planTotal), planTotal, perimeterRows, perimeterRows);
  return {
    aggregate,
    signedPct: planTotal > 0 ? ((factTotal - planTotal) / planTotal) * 100 : null,
    factTotal,
    planTotal,
    medianPct: median(rowDeviations),
    medianRowCount: rowDeviations.length,
    zeroPlanRows,
    pendingRows,
    grade: planningAccuracyGrade(aggregate.pct),
    zone: classifyPlanningAccuracy(aggregate.pct),
  };
}

// ── 3. Разрыв освоения по источникам ─────────────────────────────────

/** Код источника финансирования в подписи листа. */
export type BudgetSource = 'ФБ' | 'КБ' | 'МБ';

export interface SourceExecutionGapOptions {
  /** Год ПЛАНА (столбец P) — передаётся в CalcEngine как targetYear. */
  year?: number;
  /** Номер суток среза (канон factCountsOn). */
  asOfDay?: number;
}

export interface SourceExecutionGapResult {
  /** Освоение по каждому источнику: факт / план × 100. */
  bySource: Record<BudgetSource, RatioValue>;
  /** Максимальная попарная разница в процентных пунктах; null — сравнивать нечего. */
  gapPp: number | null;
  /** Пара источников, давшая максимум, — адрес проблемы, а не просто число. */
  widestPair: [BudgetSource, BudgetSource] | null;
  zone: MetricZone | null;
  /** Источники, у которых плана нет: в сравнении не участвуют. */
  sourcesWithoutPlan: BudgetSource[];
}

/** Stateless-движок: compute() не хранит состояние между вызовами. */
const ENGINE = new CalcEngine();

/**
 * Разрыв освоения по источникам — расхождение процентов исполнения между
 * федеральными, краевыми и муниципальными деньгами.
 *
 * ЧЬЁ РЕШЕНИЕ. Начальника финансового управления: федеральные и краевые
 * субсидии возвращаются в вышестоящий бюджет, если не освоены в срок, а
 * местные деньги переходят мягче. Отставание ФБ или КБ от МБ на десяток
 * пунктов — прямой риск возврата и повод перебросить силы закупочной службы
 * на процедуры за счёт целевых средств.
 *
 * ФОРМУЛА. Для каждого источника execution_pct = Σфакт / Σплан × 100;
 * метрика = максимальная попарная разница этих процентов в п.п. Разности
 * считаются из готовых процентов ИСТОЧНИКОВ (это разные знаменатели, их не
 * складывают), а сами проценты — только из слитых числителя и знаменателя.
 *
 * ПРОВЕНАНС. Считает канонический CalcEngine теми же метриками, что и весь
 * продукт: plan_fb/kb/mb — колонки H/I/J без гейта, fact_fb/kb/mb — V/W/X
 * под гейтом даты заключения Q. Своего чтения колонок здесь нет. Источник
 * без плана (знаменатель 0) получает pct = null и в сравнении не участвует;
 * если сравнивать оказалось нечего, gapPp тоже null.
 *
 * ПОРОГ. Меньше 5 п.п. — норма, 5–10 п.п. — жёлтая зона, свыше 10 п.п. —
 * красная (риск возврата целевых средств).
 *
 * ИСТОЧНИК. Santos et al., Journal of Common Market Studies, 2025 —
 * https://onlinelibrary.wiley.com/doi/10.1111/jcms.13640
 */
export function sourceExecutionGap(
  rows: readonly RawRow[],
  opts: SourceExecutionGapOptions = {},
): SourceExecutionGapResult {
  // Каст readonly → mutable: compute() входной массив не меняет, а копия
  // (`[...rows]`) стоила бы лишнего прохода по нескольким тысячам строк на
  // каждый вызов метрики.
  const grouped = ENGINE.compute(rows as RawRow[], standardRowFilter, 0, opts.year, {
    asOfDay: opts.asOfDay,
  });

  const of = (planKey: string, factKey: string): RatioValue => {
    const plan = grouped.total.get(planKey);
    const fact = grouped.total.get(factKey);
    return ratio(
      fact?.value ?? 0,
      plan?.value ?? 0,
      [...(fact?.contributingRows ?? [])],
      [...(plan?.contributingRows ?? [])],
    );
  };

  const bySource: Record<BudgetSource, RatioValue> = {
    'ФБ': of('plan_fb', 'fact_fb'),
    'КБ': of('plan_kb', 'fact_kb'),
    'МБ': of('plan_mb', 'fact_mb'),
  };

  const codes: BudgetSource[] = ['ФБ', 'КБ', 'МБ'];
  const comparable = codes.filter((c) => bySource[c].pct !== null);
  const sourcesWithoutPlan = codes.filter((c) => bySource[c].pct === null);

  let gapPp: number | null = null;
  let widestPair: [BudgetSource, BudgetSource] | null = null;
  for (let i = 0; i < comparable.length; i++) {
    for (let j = i + 1; j < comparable.length; j++) {
      const diff = Math.abs(bySource[comparable[i]].pct! - bySource[comparable[j]].pct!);
      if (gapPp === null || diff > gapPp) {
        gapPp = diff;
        widestPair = [comparable[i], comparable[j]];
      }
    }
  }

  return {
    bySource,
    gapPp,
    widestPair,
    zone: classifySourceExecutionGap(gapPp),
    sourcesWithoutPlan,
  };
}

// ── 4. Соблюдение планового квартала ─────────────────────────────────

export interface QuarterComplianceOptions {
  /** Год ПЛАНА (столбец P); пустой год проходит (канон lenient). */
  year?: number;
  /** Номер суток среза (канон factCountsOn). */
  asOfDay?: number;
}

export interface QuarterComplianceResult {
  /** Доля строк с фактом, заключённых не позже планового квартала. */
  onTime: RatioValue;
  /** Средний сдвиг в кварталах (факт − план); null — периметр пуст. */
  meanShiftQuarters: number | null;
  zone: MetricZone | null;
  /** Строки с фактом, где квартал плана или факта определить не удалось. */
  unattributedRows: number[];
  /** Сколько строк получили квартал факта из даты Q, а не из столбца R. */
  quarterFromDateCount: number;
  /** Сколько строк сравнивалось в предположении «год факта = год плана». */
  assumedSameYearCount: number;
}

/**
 * Соблюдение планового квартала — доля закупок, заключённых не позже того
 * квартала, на который они были запланированы, и средний сдвиг.
 *
 * ЧЬЁ РЕШЕНИЕ. Начальника управления: доля ниже двух третей и средний сдвиг
 * около квартала означают, что план размещения — формальность, и планировать
 * по нему годовой график поставок нельзя. Разрез по подведам показывает, чей
 * график двигает весь ГРБС.
 *
 * ФОРМУЛА. Доля = число строк с фактом, где квартал факта ≤ квартала плана,
 * делённое на число строк с фактом и определимыми кварталами, × 100.
 * Средний сдвиг = среднее (квартал факта − квартал плана) по тем же строкам.
 * Среднее берётся от РАЗНОСТЕЙ КВАРТАЛОВ, а не от процентов — усреднять
 * проценты запрещено, а кварталы аддитивны.
 *
 * ПРОВЕНАНС. План-квартал — O, факт-квартал — R (при пустом выводится из
 * даты Q, счётчик quarterFromDateCount). Переход через год учитывается:
 * сдвиг = (год факта − год плана) × 4 + разность кварталов, иначе план
 * четвёртого квартала, исполненный в январе следующего года, выглядел бы
 * опережением на три квартала. Если год факта не проставлен и не выводится,
 * сравнение идёт в предположении одного года, и такие строки посчитаны в
 * assumedSameYearCount. Строки с фактом, но без определимых кварталов, в
 * знаменатель не входят и перечислены в unattributedRows.
 *
 * ПОРОГ. ≥ 80 % — норма, 60–80 % — жёлтая зона, ниже 60 % — красная.
 * Средний сдвиг в целый квартал и больше делает зону красной при любой доле.
 *
 * ИСТОЧНИК. MAPS (Methodology for Assessing Procurement Systems),
 * индикатор 4 — https://www.mapsinitiative.org/en/methodology.html
 */
export function quarterCompliance(
  rows: readonly RawRow[],
  opts: QuarterComplianceOptions = {},
): QuarterComplianceResult {
  const onTimeRows: number[] = [];
  const comparableRows: number[] = [];
  const unattributedRows: number[] = [];
  let shiftSum = 0;
  let quarterFromDateCount = 0;
  let assumedSameYearCount = 0;

  eachDataRow(rows, planYearOf, opts.year, (row, index) => {
    if (!factCountsOn(row[COL.FACT_DATE], opts.asOfDay)) return;

    const planQ = quarterCell(row[COL.PLAN_QUARTER]);
    const fact = factPeriodOf(row);
    if (fact.quarterFromDate) quarterFromDateCount += 1;

    if (planQ === null || fact.quarter === null) {
      unattributedRows.push(index);
      return;
    }

    const planY = planYearOf(row);
    const sameYearAssumed = planY === null || fact.year === null;
    if (sameYearAssumed) assumedSameYearCount += 1;
    const yearShift = sameYearAssumed ? 0 : (fact.year! - planY!) * 4;
    const shift = yearShift + (fact.quarter - planQ);

    comparableRows.push(index);
    shiftSum += shift;
    if (shift <= 0) onTimeRows.push(index);
  });

  const onTime = ratio(onTimeRows.length, comparableRows.length, onTimeRows, comparableRows);
  const meanShiftQuarters = comparableRows.length > 0 ? shiftSum / comparableRows.length : null;
  return {
    onTime,
    meanShiftQuarters,
    zone: classifyQuarterCompliance(onTime.pct, meanShiftQuarters),
    unattributedRows,
    quarterFromDateCount,
    assumedSameYearCount,
  };
}
