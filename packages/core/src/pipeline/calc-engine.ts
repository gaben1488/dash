/**
 * CalcEngine — Unified, extensible calculation engine for procurement metrics.
 *
 * Design principles:
 *   1. Data-driven: metrics defined as config, not hardcoded accumulation loops
 *   2. Single-pass: one iteration over rows computes all metrics
 *   3. Groupable: results sliceable by quarter/month/method/subordinate/activity
 *   4. Traceable: each accumulated value records contributing row indices
 *   5. Correct semantics: H-K = лимиты программ (NOT НМЦК), economy from Z/AA/AB gated on AD="да"
 *
 * Replaces the monolithic recalculate() function with a composable pipeline.
 */

import {
  DEPT_COLUMNS,
  subordinateKey,
  normalizeMethod,
  PROCUREMENT_METHODS,
  classifyActivity,
  factCountsOn,
  toNumber,
  type ProcurementMethodCode,
} from '@aemr/shared';

// ── Column Reference ─────────────────────────────────────────────────

const COL = DEPT_COLUMNS;

/**
 * Число листа — канон @aemr/shared (toNumber): пробелы-разряды и запятая
 * десятичная. Прежний parseFloat обрывался на пробеле («1 234,56» → 1) и
 * расходился с чтением тех же ячеек в build-report (code-review 03.08).
 */
function num(v: unknown): number {
  return toNumber(v) ?? 0;
}

function cellPresent(v: unknown): boolean {
  if (v == null) return false;
  const s = String(v).trim();
  return s !== '' && s !== '0';
}

// ── Types ────────────────────────────────────────────────────────────

/** A raw row from a department sheet (array of cell values). */
export type RawRow = unknown[];

type MethodGroup = 'competitive' | 'ep';

/** Gate condition: determines whether a row contributes to a metric. */
export interface GateCondition {
  /** Column index in the row. */
  column: number;
  /** Comparison operator. */
  op: 'eq' | 'neq' | 'notEmpty' | 'isEmpty' | 'gt' | 'gte' | 'inSet' | 'methodGroup';
  /** Value to compare against (for eq/neq/gt/gte). */
  value?: string | number;
  /** Set of values (for inSet). */
  values?: Set<string>;
  /** Method group to compare against (for methodGroup). */
  methodGroup?: MethodGroup;
}

/** Aggregation type for a metric. */
export type AggregationType = 'sum' | 'count' | 'countif';

/** Source definition: which column to read and how to aggregate. */
export interface MetricSource {
  /** Column index to read the value from. For 'count'/'countif', this is ignored. */
  column?: number;
  /** How to aggregate: sum the column, count rows, or count rows matching a condition. */
  aggregation: AggregationType;
  /** If primary column value is 0, sum these columns instead (fallback: K→H+I+J). */
  fallbackColumns?: number[];
}

/** A single metric definition in the registry. */
export interface MetricDefinition {
  /** Unique key, e.g. 'plan_count', 'economy_fb', 'fact_total'. */
  key: string;
  /** Human-readable label (Russian). */
  label: string;
  /** Unit of measurement. */
  unit: 'count' | 'currency' | 'percent';
  /** Source column and aggregation method. */
  source: MetricSource;
  /** Gate conditions — ALL must be true for the row to contribute. */
  gates: GateCondition[];
}

/** A derived metric computed from other metrics (not directly accumulated). */
export interface DerivedMetricDefinition {
  /** Unique key. */
  key: string;
  /** Human-readable label. */
  label: string;
  /** Unit. */
  unit: 'percent' | 'currency' | 'count';
  /** Formula: ratio (a/b), diff (a-b), pct (a/b as decimal), or sum of keys. */
  formula:
    | { op: 'ratio'; numerator: string; denominator: string }
    | { op: 'diff'; a: string; b: string }
    | { op: 'pct'; numerator: string; denominator: string }
    | { op: 'sum'; operands: string[] };
}

/** Dimension extractors — how to group rows. */
export interface DimensionExtractors {
  /** Extract quarter key from row (null = no quarter). */
  quarter: (row: RawRow) => string | null;
  /** Extract month from row (null = no month). */
  month: (row: RawRow) => number | null;
  /** Extract method group: 'competitive' | 'ep' | null. */
  method: (row: RawRow) => MethodGroup | null;
  /** Extract subordinate org name ("_org_itself" when col C is empty). */
  subordinate: (row: RawRow) => string;
  /** Extract activity type. */
  activity: (row: RawRow) => string;
}

/** Row filter: determines if a row should be processed at all. */
export type RowFilter = (row: RawRow) => boolean;

/**
 * Accumulated result for a single metric.
 *
 * `value === null` = «базы нет» и означает ровно это (реестр расхождений
 * 08.08, §2 «Ноль вместо „нет базы“ при нулевом знаменателе»). Лист СВОД
 * печатает в такой ячейке прочерк — `IF(D13=0;"-";E13/D13)`, — а мы печатали
 * ноль, из-за чего управление без плана получало «исполнение 0 %», штраф 45
 * баллов и грейд D за то, чего у него нет. Базовые метрики (суммы и счётчики)
 * null не бывают никогда: пустая сумма — это честный ноль. Null появляется
 * только у производных `ratio`/`pct` при нулевом знаменателе.
 */
export interface AccumulatedValue {
  value: number | null;
  /** Row indices that contributed to this value. */
  contributingRows: number[];
}

/** Grouped results: metric values sliced by dimensions. */
export interface GroupedResults {
  /** Overall (ungrouped) results. */
  total: Map<string, AccumulatedValue>;
  /** By quarter (q1, q2, q3, q4, plus '_orphan' for rows with fact but no planQ). */
  byQuarter: Map<string, Map<string, AccumulatedValue>>;
  /** By month (1-12). */
  byMonth: Map<number, Map<string, AccumulatedValue>>;
  /**
   * Год-квалифицированные кварталы: `${год}.q1..q4` + `${год}._orphan`;
   * строки без валидного года плана — под `_noyear.*` (Фаза 2 оси времени).
   * Существующие q1..q4 НЕ заменяет — добавлена рядом для мультигода.
   */
  byYearQuarter: Map<string, Map<string, AccumulatedValue>>;
  /** Год-квалифицированные месяцы: `${год}.m1..m12`, `_noyear.m*` (Фаза 2). */
  byYearMonth: Map<string, Map<string, AccumulatedValue>>;
  /** By method (competitive, ep). */
  byMethod: Map<string, Map<string, AccumulatedValue>>;
  /** By quarter × method (e.g., q1.competitive). */
  byQuarterMethod: Map<string, Map<string, AccumulatedValue>>;
  /** By subordinate organization. */
  bySubordinate: Map<string, Map<string, AccumulatedValue>>;
  /** By subordinate × quarter (e.g., "МКУ ЦЭР.q1"). */
  bySubordinateQuarter: Map<string, Map<string, AccumulatedValue>>;
  /** By subordinate × month (e.g., "МКУ ЦЭР.m3"). */
  bySubordinateMonth: Map<string, Map<string, AccumulatedValue>>;
  /** By subordinate × method (e.g., "МКУ ЦЭР.competitive"). */
  bySubordinateMethod: Map<string, Map<string, AccumulatedValue>>;
  /** By activity type. */
  byActivity: Map<string, Map<string, AccumulatedValue>>;
  /** By quarter × activity (e.g., q1.program, year.program). */
  byQuarterActivity: Map<string, Map<string, AccumulatedValue>>;
  /** By subordinate × activity (e.g., "МКУ ЦЭР.program"). */
  bySubordinateActivity: Map<string, Map<string, AccumulatedValue>>;
  /** By activity × method (e.g., "program.competitive"). */
  byActivityMethod: Map<string, Map<string, AccumulatedValue>>;
  /** By month × method (e.g., "m3.competitive"). Already in byQuarterMethod (key "m3.competitive"). */
  // NOTE: byMonthMethod is stored IN byQuarterMethod (keys "m{N}.{method}") — adapter already reads it
  /** By month × activity (e.g., "m3.program"). */
  byMonthActivity: Map<string, Map<string, AccumulatedValue>>;
  /**
   * ЧЕСТНАЯ КОРЗИНА ГОДА: строки, не попавшие в годовой срез только потому,
   * что плановый год (P) пуст, — при `emptyYearPolicy: 'bucket'`.
   *
   * Лист адресует ячейку парой O×P, и строке без года лечь на нём некуда:
   * официальные формулы её не видят. Раньше её не видели молча — она либо
   * проходила в срез ЛЮБОГО года («нестрогий гейт», из-за чего лимит
   * управления расходился с листом: УЭР 13 921 против 13 331,23, пять строк
   * на 589,93 тыс. руб.), либо отбрасывалась без следа при strict. Теперь она
   * считается тем же набором метрик, но отдельно: годовые числа читаются без
   * неё, а продукт может показать строку «без года плана: N позиций на X тыс.
   * руб.» (реестр расхождений 08.08 §2 и правило владельца от 08.08 —
   * копировать правило листа можно, копировать его немоту нельзя).
   *
   * Пуста при `lenient`/`strict` и когда годового фильтра нет вовсе.
   */
  noYear: Map<string, AccumulatedValue>;
  /**
   * Качество данных, а не разрез: индексы строк с НЕПУСТЫМ нераспознанным
   * способом (столбец L — не ЭА/ЕП/ЭК/ЭЗК). В счёте такие строки идут к
   * конкурентным, как у листа (`classifyMethodGroup` тотальна); счётчик
   * существует, чтобы загрязнение столбца было видно как проблема данных, а
   * не искажало доли (реестр 08.08 §2).
   */
  unknownMethodRows: number[];
  /** Row count processed. */
  rowCount: number;
  /** Economy conflict count: AD flag disagrees with actual economy values. */
  conflicts: number;
  /** Mathematical economy total (ungated by AD, Math.max(0, eco)), only hasFact gate. */
  economyTotalMath: number;
  /**
   * Rows with DATA that failed the row-classification filter (e.g.
   * standardRowFilter score < 3). Does NOT include: rows skipped by the year
   * filter (intentional scoping), and — с 20.08.2026 — полностью пустые строки
   * листа-простыни (вопрос владельца: УАГЗО «925 из 994 не попали в расчёт» —
   * 925 были пустотой хвоста диапазона, а сигнал читался как поломка). (B-8)
   */
  droppedRows: number;
  /** Полностью пустые слоты/строки — не носители данных, отсевом не считаются. */
  emptyRows: number;
  /** Адреса первых отвергнутых строк С ДАННЫМИ (номер строки листа, 1-based). */
  droppedRowNumbers: number[];
}

// ── Gate Evaluation ──────────────────────────────────────────────────

function evaluateGate(row: RawRow, gate: GateCondition, asOfDay?: number): boolean {
  const raw = row[gate.column];
  switch (gate.op) {
    // 'notEmpty' используется только для GATE_HAS_FACT (COL.FACT_DATE) — канон
    // factCountsOn() из @aemr/shared: есть дата факта И она не позже среза
    // (asOfDay не задан — весь факт, как было до среза-канона).
    case 'notEmpty':
      return factCountsOn(raw, asOfDay);
    // Зеркало notEmpty: процедура ещё НЕ заключена на дату среза. Именно
    // отрицание factCountsOn, а не «пустая ячейка»: заглушки Х/X и дата
    // позже среза — тоже «не заключено», и остаток обязан их считать.
    case 'isEmpty':
      return !factCountsOn(raw, asOfDay);
    case 'eq':
      return String(raw ?? '').trim().toLowerCase() === String(gate.value).toLowerCase();
    case 'neq':
      return String(raw ?? '').trim().toLowerCase() !== String(gate.value).toLowerCase();
    case 'gt':
      return num(raw) > (gate.value as number);
    case 'gte':
      return num(raw) >= (gate.value as number);
    case 'inSet':
      return gate.values?.has(String(raw ?? '').trim()) ?? false;
    case 'methodGroup':
      return classifyMethodGroup(raw) === gate.methodGroup;
  }
}

function evaluateAllGates(row: RawRow, gates: GateCondition[], asOfDay?: number): boolean {
  return gates.every(g => evaluateGate(row, g, asOfDay));
}

// ── Default Dimension Extractors ─────────────────────────────────────

/**
 * Канон группировки способа: разбиение ТОТАЛЬНО — не ЕП значит конкурентная.
 * Экспортирован как единственная дверь: выгрузки и UI не изобретают свой ЕП.
 *
 * ПОЧЕМУ ТОТАЛЬНО (реестр расхождений 08.08, §2 «Неизвестный непустой способ
 * не попадает ни в КП, ни в ЕП»). Лист СВОД определяет конкурентные
 * отрицанием `L<>"ЕП"`: у него нет третьей группы, и сумма частей равна
 * плану по построению. Прежняя версия возвращала null на непустом
 * нераспознанном коде, и строка выпадала из обеих групп: КП + ЕП < План, а
 * доля ЕП росла от одного лишь загрязнения столбца L — то есть дефект данных
 * подменялся ложным управленческим выводом. Загрязнение теперь видно там,
 * где ему место: отдельным счётчиком качества данных
 * (`GroupedResults.unknownMethodRows`), а не искажением долей.
 *
 * Зеркало того же правила для единой сетки — `unified-svod.ts` methodOf().
 */
export function classifyMethodGroup(raw: unknown): MethodGroup {
  const canonical: ProcurementMethodCode | undefined = normalizeMethod(raw);
  return canonical === 'ЕП' ? 'ep' : 'competitive';
}

/**
 * Непустая ячейка способа, которую словарь не опознал ни как один из четырёх
 * кодов (ЭА/ЕП/ЭК/ЭЗК). Это дефект ДАННЫХ, а не третья группа способов:
 * в счёте строка идёт к конкурентным (как у листа), а здесь только считается.
 * Единственная дверь для «мусор в L» — сверка (`recon-classify`) и движок
 * читают этот предикат, а не сравнивают классификатор с null.
 */
export function isUnknownMethod(raw: unknown): boolean {
  if (String(raw ?? '').trim() === '') return false;
  return normalizeMethod(raw) === undefined;
}

function defaultQuarterExtractor(row: RawRow): string | null {
  const q = num(row[COL.PLAN_QUARTER]);
  if (q >= 1 && q <= 4) return `q${q}`;
  return null;
}

function defaultMonthExtractor(row: RawRow): number | null {
  const dateStr = String(row[COL.PLAN_DATE] ?? '').trim();
  if (!dateStr) return null;
  // DD.MM.YYYY or DD/MM/YYYY
  const dotMatch = dateStr.match(/\d{1,2}[./](\d{1,2})[./]\d{2,4}/);
  if (dotMatch) {
    const m = parseInt(dotMatch[1], 10);
    return m >= 1 && m <= 12 ? m : null;
  }
  // ISO: YYYY-MM-DD
  const isoMatch = dateStr.match(/\d{4}-(\d{2})-\d{2}/);
  if (isoMatch) {
    const m = parseInt(isoMatch[1], 10);
    return m >= 1 && m <= 12 ? m : null;
  }
  // Excel serial date
  const n = parseFloat(dateStr);
  if (!isNaN(n) && n > 40000 && n < 60000) {
    const date = new Date((n - 25569) * 86400000);
    const m = date.getMonth() + 1;
    return m >= 1 && m <= 12 ? m : null;
  }
  return null;
}

function defaultMethodExtractor(row: RawRow): MethodGroup {
  // Канонизируем сырое значение через METHOD_ALIAS_MAP в dictionaries.
  // Это снимает drift: 'ЭА (МЭП)', 'Ед. поставщик', 'ЭЕП', lowercase 'еп' и т.д.
  // сводятся к одному из {ЭА, ЕП, ЭК, ЭЗК} (или undefined для пустых/мусора).
  //
  // Семантика исторически унаследована из СВОД/ШДЮ: пустое поле или любой
  // не-ЕП код = competitive. Это инвариант, не меняем — только нормализуем вход.
  return classifyMethodGroup(row[COL.METHOD]);
}

function defaultSubordinateExtractor(row: RawRow): string {
  // Канон столбца C → сентинел «само управление» или имя подведа (@aemr/shared/org-itself).
  return subordinateKey(row[COL.SUBORDINATE]);
}

/**
 * Разрез по виду деятельности — канон classifyActivity (@aemr/shared,
 * та же логика, что у срезов matchesActivityScope). Нераспознанный вид
 * (F пуст/мусор) — группа 'unknown', а НЕ молчаливое зачисление в
 * 'program', как делала прежняя локальная копия (Д16): фиксированная
 * тройка разрезов такие строки честно не показывает.
 */
function defaultActivityExtractor(row: RawRow): string {
  return classifyActivity(row[COL.TYPE], row[COL.PROGRAM_NAME]) ?? 'unknown';
}

export const DEFAULT_EXTRACTORS: DimensionExtractors = {
  quarter: defaultQuarterExtractor,
  month: defaultMonthExtractor,
  method: defaultMethodExtractor,
  subordinate: defaultSubordinateExtractor,
  activity: defaultActivityExtractor,
};

// ── Standard Metric Registry ─────────────────────────────────────────

/** Standard gates used across metrics. */
const GATE_HAS_FACT: GateCondition = { column: COL.FACT_DATE, op: 'notEmpty' };
/** Зеркало GATE_HAS_FACT: процедура ещё не заключена на дату среза. */
const GATE_NO_FACT: GateCondition = { column: COL.FACT_DATE, op: 'isEmpty' };
const GATE_ECONOMY_APPROVED: GateCondition = { column: COL.FLAG, op: 'eq', value: 'да' };
const GATE_METHOD_COMPETITIVE: GateCondition = { column: COL.METHOD, op: 'methodGroup', methodGroup: 'competitive' };
const GATE_METHOD_EP: GateCondition = { column: COL.METHOD, op: 'methodGroup', methodGroup: 'ep' };

/**
 * Утверждённая экономия строки: Z+AA+AB под теми же гейтами, что и метрики
 * economy_* (AD='да' + дата факта). Единственный источник построчной экономии
 * для потребителей вне CalcEngine (комплаенс, антидемпинг, отчёты).
 * Сырую сумму Z+AA+AB показывать/проверять нельзя — она порождает ложные вердикты.
 *
 * ЗНАК НЕ ОБРЕЗАЕТСЯ (реестр расхождений 08.08, §2 «Обрезка отрицательной
 * экономии по строке»). Прежний `Math.max(0, …)` не делали ни метрики
 * economy_*, ни лист СВОД, и он ломал сразу два обещания продукта: клик по
 * плитке экономии раскрывал строки, сумма которых не сходилась с самой
 * плиткой, а перерасход над лимитом (замер: −150,00327 тыс. руб. по МБ)
 * превращался в ноль и порождал ложный антикоррупционный флаг. Отрицательная
 * экономия — реальное явление (цена контракта выше лимита), и прятать её
 * значит скрывать ровно то, ради чего продукт и строится.
 */
export function approvedEconomy(row: RawRow, asOfDay?: number): number {
  if (!evaluateGate(row, GATE_HAS_FACT, asOfDay) || !evaluateGate(row, GATE_ECONOMY_APPROVED)) return 0;
  return num(row[COL.ECONOMY_FB]) + num(row[COL.ECONOMY_KB]) + num(row[COL.ECONOMY_MB]);
}

/**
 * Standard metric definitions matching СВОД ТД-ПМ columns D-U.
 * These are the base metrics — derived metrics (execution %, savings %) are computed after.
 */
export const STANDARD_METRICS: MetricDefinition[] = [
  // D: Plan count — count all rows (no extra gate)
  { key: 'plan_count', label: 'План (кол-во)', unit: 'count', source: { aggregation: 'count' }, gates: [] },
  // E: Fact count — count rows with fact date
  { key: 'fact_count', label: 'Факт (кол-во)', unit: 'count', source: { aggregation: 'count' }, gates: [GATE_HAS_FACT] },

  // Method-specific counts
  { key: 'competitive_count', label: 'КП (кол-во)', unit: 'count', source: { aggregation: 'count' }, gates: [GATE_METHOD_COMPETITIVE] },
  { key: 'ep_count', label: 'ЕП (кол-во)', unit: 'count', source: { aggregation: 'count' }, gates: [GATE_METHOD_EP] },

  // H-K: Plan sums (лимиты программ) — K with fallback to H+I+J
  { key: 'plan_fb', label: 'Лимит ФБ', unit: 'currency', source: { column: COL.FB_PLAN, aggregation: 'sum' }, gates: [] },
  { key: 'plan_kb', label: 'Лимит КБ', unit: 'currency', source: { column: COL.KB_PLAN, aggregation: 'sum' }, gates: [] },
  { key: 'plan_mb', label: 'Лимит МБ', unit: 'currency', source: { column: COL.MB_PLAN, aggregation: 'sum' }, gates: [] },
  { key: 'plan_total', label: 'Лимит ИТОГО', unit: 'currency', source: { column: COL.TOTAL_PLAN, aggregation: 'sum', fallbackColumns: [COL.FB_PLAN, COL.KB_PLAN, COL.MB_PLAN] }, gates: [] },

  // Остаток: плановые деньги ЕЩЁ НЕ заключённых процедур. Прямой запрос
  // ГРБС-специалиста (27.07): «сколько в плановых деньгах по оставшимся
  // процедурам с разбивкой по бюджетам». Считается по ПЛАНОВЫМ столбцам с
  // обратным гейтом факта — это не «план минус факт»: факт есть цена
  // контракта, она ниже плана, и разность дала бы экономию, а не остаток.
  { key: 'pending_count', label: 'Осталось заключить (кол-во)', unit: 'count', source: { aggregation: 'count' }, gates: [GATE_NO_FACT] },
  { key: 'pending_fb', label: 'Остаток ФБ', unit: 'currency', source: { column: COL.FB_PLAN, aggregation: 'sum' }, gates: [GATE_NO_FACT] },
  { key: 'pending_kb', label: 'Остаток КБ', unit: 'currency', source: { column: COL.KB_PLAN, aggregation: 'sum' }, gates: [GATE_NO_FACT] },
  { key: 'pending_mb', label: 'Остаток МБ', unit: 'currency', source: { column: COL.MB_PLAN, aggregation: 'sum' }, gates: [GATE_NO_FACT] },
  { key: 'pending_total', label: 'Остаток ИТОГО', unit: 'currency', source: { column: COL.TOTAL_PLAN, aggregation: 'sum', fallbackColumns: [COL.FB_PLAN, COL.KB_PLAN, COL.MB_PLAN] }, gates: [GATE_NO_FACT] },

  // L-O: Fact sums (цены контрактов) — gated on fact date, Y with fallback to V+W+X
  { key: 'fact_fb', label: 'Факт ФБ', unit: 'currency', source: { column: COL.FB_FACT, aggregation: 'sum' }, gates: [GATE_HAS_FACT] },
  { key: 'fact_kb', label: 'Факт КБ', unit: 'currency', source: { column: COL.KB_FACT, aggregation: 'sum' }, gates: [GATE_HAS_FACT] },
  { key: 'fact_mb', label: 'Факт МБ', unit: 'currency', source: { column: COL.MB_FACT, aggregation: 'sum' }, gates: [GATE_HAS_FACT] },
  { key: 'fact_total', label: 'Факт ИТОГО', unit: 'currency', source: { column: COL.TOTAL_FACT, aggregation: 'sum', fallbackColumns: [COL.FB_FACT, COL.KB_FACT, COL.MB_FACT] }, gates: [GATE_HAS_FACT] },

  // R-U листа СВОД (источник — Z/AA/AB книг ГРБС) под гейтом AD="да" + дата факта.
  // Имя с прилагательным «утверждённая» обязательно: вторая экономия района —
  // «НМЦК минус цена аукциона» книги мониторинга, в рублях, — считается иначе,
  // отбирается иначе и живёт в другой книге (см. economy_total ниже).
  { key: 'economy_fb', label: 'Утверждённая экономия ФБ', unit: 'currency', source: { column: COL.ECONOMY_FB, aggregation: 'sum' }, gates: [GATE_HAS_FACT, GATE_ECONOMY_APPROVED] },
  { key: 'economy_kb', label: 'Утверждённая экономия КБ', unit: 'currency', source: { column: COL.ECONOMY_KB, aggregation: 'sum' }, gates: [GATE_HAS_FACT, GATE_ECONOMY_APPROVED] },
  { key: 'economy_mb', label: 'Утверждённая экономия МБ', unit: 'currency', source: { column: COL.ECONOMY_MB, aggregation: 'sum' }, gates: [GATE_HAS_FACT, GATE_ECONOMY_APPROVED] },

  // Compound-gate counts for G-column СВОД: comp_fact_count = КП with fact, ep_fact_count = ЕП with fact
  { key: 'comp_fact_count', label: 'Факт КП (кол-во)', unit: 'count', source: { aggregation: 'count' }, gates: [GATE_HAS_FACT, GATE_METHOD_COMPETITIVE] },
  { key: 'ep_fact_count', label: 'Факт ЕП (кол-во)', unit: 'count', source: { aggregation: 'count' }, gates: [GATE_HAS_FACT, GATE_METHOD_EP] },

  // Method-specific plan totals
  { key: 'comp_plan_total', label: 'Лимит КП ИТОГО', unit: 'currency', source: { column: COL.TOTAL_PLAN, aggregation: 'sum', fallbackColumns: [COL.FB_PLAN, COL.KB_PLAN, COL.MB_PLAN] }, gates: [GATE_METHOD_COMPETITIVE] },
  { key: 'ep_plan_total', label: 'Лимит ЕП ИТОГО', unit: 'currency', source: { column: COL.TOTAL_PLAN, aggregation: 'sum', fallbackColumns: [COL.FB_PLAN, COL.KB_PLAN, COL.MB_PLAN] }, gates: [GATE_METHOD_EP] },
];

/** Derived metrics computed from accumulated values. */
export const STANDARD_DERIVED: DerivedMetricDefinition[] = [
  // F листа СВОД: `=E43-D43` — ФАКТ минус ПЛАН (дамп 18.08.2026: F14 = −49 при
  // плане 333 и факте 284). Недобор отрицателен.
  //
  // До 18.08.2026 здесь стояло `plan_count − fact_count`, и внутри продукта жили
  // ДВЕ противоположные конвенции под одним словом «Отклонение»: соседний
  // amount_deviation (P = O−K), orchestrator (`fact − plan`), unified-svod и
  // вкладка «Свод» считали по-листовому, а этот ключ — против. Карта метрик
  // назвала это расхождением №1; конвенция сведена к листовой.
  //
  // Ключ метрики НЕ меняется — он записан в персистентных снимках. Меняется
  // только знак и подпись; словесная формулировка еженедельного отчёта
  // («Отклонение от плана 2 квартала – 19 процедур», положительный недобор)
  // живёт отдельной величиной в docx-сборщике и от этого ключа не зависит.
  { key: 'deviation', label: 'Отклонение, единиц', unit: 'count', formula: { op: 'diff', a: 'fact_count', b: 'plan_count' } },
  // Q листа СВОД: fact_total / plan_total. ОДНА колонка листа — два ключа
  // продукта (execution_pct и savings_pct ниже). Дубль наследственный: оба
  // ключа записаны в персистентных снимках, поэтому не сливаются, но обе
  // карточки БЗ обязаны называть друг друга и колонку Q.
  { key: 'execution_pct', label: 'Исполнение (сумма), %', unit: 'percent', formula: { op: 'pct', numerator: 'fact_total', denominator: 'plan_total' } },
  // P листа СВОД: `=O43-K43` — факт минус план, недоосвоение < 0. Тот же знак,
  // что и у счётного deviation выше.
  { key: 'amount_deviation', label: 'Отклонение, тыс. руб.', unit: 'currency', formula: { op: 'diff', a: 'fact_total', b: 'plan_total' } },
  // Та же дробь колонки Q, что и у execution_pct выше, — но под ИМЕНЕМ ЛИСТА.
  // Оба ключа записаны в сохранённых снимках и переименованию не подлежат;
  // разница между ними чисто именная, и обе карточки БЗ это говорят прямо.
  // Экономией это не является: утверждённая финорганом экономия — economy_total
  // (Z+AA+AB книг ГРБС под гейтом AD='да'), разница лимит−факт —
  // amount_deviation. Прежний комментарий описывал здесь формулу
  // (plan−fact)/plan, которой в коде нет (реестр багов 09.07.2026, п.5
  // «savings_pct = копия execution_pct»: мислейбл снят переименованием
  // 18.08.2026, ложное описание осталось).
  // Имя листа СВОД после переименования владельцем 18.08.2026 (было «Потрачено, %»).
  { key: 'savings_pct', label: 'Законтрактовано, %', unit: 'percent', formula: { op: 'pct', numerator: 'fact_total', denominator: 'plan_total' } },
  // U: Economy total = economy_fb + economy_kb + economy_mb.
  // «Утверждённая» в имени — не украшение: в районе живут ДВЕ экономии.
  // Эта — утверждённая финансовым органом (флаг AD книг ГРБС), в ТЫСЯЧАХ рублей,
  // колонки R–U листа СВОД. Вторая — экономия торгов «НМЦК минус цена аукциона»
  // в РУБЛЯХ из книги «Ежедневный мониторинг» (та самая, что стоит в записке
  // руководителю: 293 аукциона, 57 743 709,89 руб.). Числа разные, единицы
  // разные — одним словом называться не должны.
  { key: 'economy_total', label: 'Утверждённая экономия, ИТОГО', unit: 'currency', formula: { op: 'sum', operands: ['economy_fb', 'economy_kb', 'economy_mb'] } },
  // Total procedures and EP share
  { key: 'total_procedures', label: 'Всего процедур', unit: 'count', formula: { op: 'sum', operands: ['competitive_count', 'ep_count'] } },
  { key: 'ep_share_pct', label: 'Доля ЕП %', unit: 'percent', formula: { op: 'pct', numerator: 'ep_count', denominator: 'total_procedures' } },

  // Execution % by count: fact_count / plan_count (all methods)
  { key: 'exec_count_pct', label: '% исполнения (кол-во)', unit: 'percent', formula: { op: 'pct', numerator: 'fact_count', denominator: 'plan_count' } },
  // G-column СВОД: comp_fact_count / competitive_count — ГЛАВНЫЙ ПОКАЗАТЕЛЬ РУКОВОДСТВА
  { key: 'comp_exec_count_pct', label: '% исполнения КП (кол-во)', unit: 'percent', formula: { op: 'pct', numerator: 'comp_fact_count', denominator: 'competitive_count' } },
  // EP execution by count
  { key: 'ep_exec_count_pct', label: '% исполнения ЕП (кол-во)', unit: 'percent', formula: { op: 'pct', numerator: 'ep_fact_count', denominator: 'ep_count' } },
];

// ── CalcEngine ───────────────────────────────────────────────────────

export class CalcEngine {
  private metrics: MetricDefinition[];
  private derived: DerivedMetricDefinition[];
  private extractors: DimensionExtractors;

  constructor(
    metrics: MetricDefinition[] = STANDARD_METRICS,
    derived: DerivedMetricDefinition[] = STANDARD_DERIVED,
    extractors: DimensionExtractors = DEFAULT_EXTRACTORS,
  ) {
    this.metrics = metrics;
    this.derived = derived;
    this.extractors = extractors;
  }

  /**
   * Single-pass computation over all rows.
   * Returns grouped results with traceability.
   */
  compute(
    rows: RawRow[],
    filter: RowFilter,
    startRow: number = 0,
    targetYear?: number,
    opts?: {
      /**
       * Строгий год-срез: строка входит ТОЛЬКО при явном P === targetYear.
       * По умолчанию (false) пустой год ПРОХОДИТ — канон дашборда (строки без
       * года не теряются из базового вида). strict нужен СВЕРКЕ: официал
       * года нельзя сравнивать с расчётом из строк-без-года (981 псевдо-high
       * за 2025 на живых данных, задача #5 от 16.07).
       */
      strictYear?: boolean;
      /**
       * Номер суток среза (dayNumberOf). Задан — факт засчитывается только
       * если дата заключения не позже среза: отчёт «на четверг» перестаёт
       * мутировать от пятничных строк. Не задан — весь факт как есть
       * (Пульт, Реестр и прочие «живые» виды).
       *
       * undefined разрешён явно: вызывающие метрики прокидывают свой
       * необязательный срез напрямую, и «поля нет» здесь значит ровно то же,
       * что «срез не задан».
       */
      asOfDay?: number | undefined;
      /**
       * Мультигодовой скоуп (Фаза 2): строка проходит, если её год плана
       * входит в список (пустой год — по emptyYearPolicy). Задан вместе с
       * targetYear — years побеждает. Пустой массив = фильтра нет.
       */
      years?: number[];
      /**
       * Политика строки без года плана (P пуст) при годовом фильтре.
       *
       * ДЕФОЛТ — 'bucket' (реестр расхождений 08.08 §2, волна 0 п.1). Лист
       * адресует строку парой «квартал × год»: строке без года на нём лечь
       * некуда, и в официальные числа она не входит. Прежний дефолт 'lenient'
       * пускал её в срез ЛЮБОГО года — это и был корень расхождения лимита у
       * каждого управления (УЭР 13 921 против 13 331,23 на листе). 'bucket'
       * берёт правило листа, но не берёт его немоту: строка не исчезает, а
       * попадает в `GroupedResults.noYear` — адресуемый остаток отдельной
       * строкой.
       *
       * 'strict' — то же отсечение, но БЕЗ корзины (эквивалент strictYear);
       * оставлено сверке, которой нужен ровно периметр листа.
       * 'lenient' — легаси: строка без года проходит в любой год. Пригодно
       * только там, где годового вопроса не задают.
       *
       * В картах byYearQuarter/byYearMonth пустой год ВСЕГДА под `_noyear`.
       */
      emptyYearPolicy?: 'lenient' | 'strict' | 'bucket';
    },
  ): GroupedResults {
    const result: GroupedResults = {
      total: new Map(),
      byQuarter: new Map(),
      byMonth: new Map(),
      byYearQuarter: new Map(),
      byYearMonth: new Map(),
      byMethod: new Map(),
      byQuarterMethod: new Map(),
      bySubordinate: new Map(),
      bySubordinateQuarter: new Map(),
      bySubordinateMonth: new Map(),
      bySubordinateMethod: new Map(),
      byActivity: new Map(),
      byQuarterActivity: new Map(),
      bySubordinateActivity: new Map(),
      byActivityMethod: new Map(),
      byMonthActivity: new Map(),
      noYear: new Map(),
      unknownMethodRows: [],
      rowCount: 0,
      conflicts: 0,
      economyTotalMath: 0,
      droppedRows: 0,
      emptyRows: 0,
      droppedRowNumbers: [],
    };

    // Initialize total accumulators
    for (const m of this.metrics) {
      result.total.set(m.key, { value: 0, contributingRows: [] });
    }

    for (let i = startRow; i < rows.length; i++) {
      const row = rows[i];
      // Пустой слот и строка без единого значения — не «отвергнутые данные»,
      // а простыня листа (диапазон дочитан до последней заполненной ячейки
      // где-то в далёкой колонке). Вопрос владельца 20.08: «925 из 994» УАГЗО.
      if (!row || row.every((c) => c === null || c === undefined || String(c).trim() === '')) {
        result.emptyRows++;
        continue;
      }
      if (!filter(row)) {
        result.droppedRows++;
        // Адрес строки листа (1-based): rows приходит с листа целиком.
        if (result.droppedRowNumbers.length < 12) result.droppedRowNumbers.push(i + 1);
        continue;
      }

      // Year filter: мультигодовой скоуп years[] побеждает targetYear;
      // policy обобщает strictYear (обратная совместимость сохранена).
      const rowYear = num(row[COL.PLAN_YEAR]);
      const yearPolicy = opts?.emptyYearPolicy ?? (opts?.strictYear ? 'strict' : 'bucket');
      const multiYear = opts?.years && opts.years.length > 0;
      if (multiYear || targetYear) {
        if (rowYear > 0) {
          // Год есть и он чужой — строка просто из другого среза, к корзине
          // «без года» отношения не имеет.
          const inScope = multiYear ? opts!.years!.includes(rowYear) : rowYear === targetYear;
          if (!inScope) continue;
        } else if (yearPolicy === 'strict') {
          continue;
        } else if (yearPolicy === 'bucket') {
          // Строгий год + адресуемый остаток: в срез не пускаем (лист её тоже
          // не видит), но считаем отдельной корзиной, чтобы потеря была
          // названа, а не молчалива.
          for (const m of this.metrics) {
            if (!evaluateAllGates(row, m.gates, opts?.asOfDay)) continue;
            this.accumulate(result.noYear, m.key, this.extractValue(row, m.source), i);
          }
          continue;
        }
        // 'lenient' — легаси-поведение: строка без года проходит в срез
        // ЛЮБОГО года. Оставлено только для явного вызова.
      }
      // Ключ года для год-квалифицированных карт: пустой год — честная
      // корзина _noyear (адресуемый остаток, не потеря).
      const yearBucket = rowYear > 0 ? String(rowYear) : '_noyear';

      result.rowCount++;

      // Extract dimensions
      const quarter = this.extractors.quarter(row);
      const month = this.extractors.month(row);
      const method = this.extractors.method(row);
      const subordinate = this.extractors.subordinate(row);
      const activity = this.extractors.activity(row);
      // Качество данных: способ непустой, но словарю неизвестен. В счёте
      // строка идёт к конкурентным (правило листа), здесь только помечается.
      if (isUnknownMethod(row[COL.METHOD])) result.unknownMethodRows.push(i);
      // Гейт со срезом — тот же, что у метрик: без asOfDay архивный срез
    // рапортовал конфликты по строкам, заключённым ПОСЛЕ даты снимка.
    const hasFact = evaluateGate(row, GATE_HAS_FACT, opts?.asOfDay);

      // Accumulate each metric
      for (const m of this.metrics) {
        if (!evaluateAllGates(row, m.gates, opts?.asOfDay)) continue;

        const val = this.extractValue(row, m.source);

        // Total
        this.accumulate(result.total, m.key, val, i);

        // By quarter (or _orphan for rows with fact but no quarter)
        if (quarter) {
          this.accumulateInGroup(result.byQuarter, quarter, m.key, val, i);

          // By quarter × method
          if (method) {
            const qmKey = `${quarter}.${method}`;
            this.accumulateInGroup(result.byQuarterMethod, qmKey, m.key, val, i);
          }

          // By quarter × activity
          const qaKey = `${quarter}.${activity}`;
          this.accumulateInGroup(result.byQuarterActivity, qaKey, m.key, val, i);
        } else if (hasFact) {
          // Orphan: has fact but no plan quarter → tracked separately for year total derivation
          this.accumulateInGroup(result.byQuarter, '_orphan', m.key, val, i);
        }

        // Год-квалифицированные карты (Фаза 2): те же ключи кварталов и
        // месяцев, но с префиксом года строки — фундамент мультигода.
        if (quarter) {
          this.accumulateInGroup(result.byYearQuarter, `${yearBucket}.${quarter}`, m.key, val, i);
        } else if (hasFact) {
          this.accumulateInGroup(result.byYearQuarter, `${yearBucket}._orphan`, m.key, val, i);
        }

        // By year × activity (always accumulate for year-level activity breakdown)
        this.accumulateInGroup(result.byQuarterActivity, `year.${activity}`, m.key, val, i);

        // By month
        if (month) {
          this.accumulateInMonthGroup(result.byMonth, month, m.key, val, i);
          this.accumulateInGroup(result.byYearMonth, `${yearBucket}.m${month}`, m.key, val, i);
          // By month × method (adapter reads as `m${month}.competitive` etc.)
          if (method) {
            this.accumulateInGroup(result.byQuarterMethod, `m${month}.${method}`, m.key, val, i);
          }
          // By month × activity
          this.accumulateInGroup(result.byMonthActivity, `m${month}.${activity}`, m.key, val, i);
        }

        // By method
        if (method) {
          this.accumulateInGroup(result.byMethod, method, m.key, val, i);
        }

        // By subordinate (+ cross-dimensional: sub×quarter, sub×month, sub×method)
        // subordinate is always non-null: "_org_itself" for org's own rows, name for subordinates
        this.accumulateInGroup(result.bySubordinate, subordinate, m.key, val, i);
        if (quarter) {
          this.accumulateInGroup(result.bySubordinateQuarter, `${subordinate}.${quarter}`, m.key, val, i);
        }
        if (month) {
          this.accumulateInGroup(result.bySubordinateMonth, `${subordinate}.m${month}`, m.key, val, i);
        }
        if (method) {
          this.accumulateInGroup(result.bySubordinateMethod, `${subordinate}.${method}`, m.key, val, i);
        }

        // By activity
        this.accumulateInGroup(result.byActivity, activity, m.key, val, i);

        // By subordinate × activity
        this.accumulateInGroup(result.bySubordinateActivity, `${subordinate}.${activity}`, m.key, val, i);

        // By activity × method
        if (method) {
          this.accumulateInGroup(result.byActivityMethod, `${activity}.${method}`, m.key, val, i);
        }
      }

      // ── Post-metric special accumulations ────────────────────────
      if (hasFact) {
        const ecoFB = num(row[COL.ECONOMY_FB]);
        const ecoKB = num(row[COL.ECONOMY_KB]);
        const ecoMB = num(row[COL.ECONOMY_MB]);
        const ecoTotal = ecoFB + ecoKB + ecoMB;
        const adFlag = String(row[COL.FLAG] ?? '').trim().toLowerCase();
        // Канон флага — ровно тот, что у гейта метрик (GATE_ECONOMY_APPROVED,
        // eq 'да'). Раньше детектор дополнительно принимал 'yes': такая строка
        // не попадала ни в экономию (гейт её не пускал), ни в конфликты
        // (детектор считал её утверждённой) — деньги исчезали молча.
        const isApproved = adFlag === 'да';

        // economyTotalMath: экономия без гейта AD, СО ЗНАКОМ. Обрезка
        // Math.max(0, …) снята вместе с обрезкой в approvedEconomy (реестр
        // 08.08 §2): «математическая» экономия существует ради сверки с
        // AD-гейтом, и если одна из двух величин прячет перерасход, а вторая
        // нет, сверка сравнивает разные вопросы.
        result.economyTotalMath += ecoTotal;

        // Conflict: flag says "да" but no economy, or has economy but no flag
        if ((isApproved && ecoTotal === 0) || (!isApproved && ecoTotal > 0)) {
          result.conflicts++;
        }
      }
    }

    // Compute derived metrics for all groups
    this.computeDerived(result.total);
    if (result.noYear.size > 0) this.computeDerived(result.noYear);
    for (const group of result.byQuarter.values()) this.computeDerived(group);
    for (const group of result.byMonth.values()) this.computeDerived(group);
    for (const group of result.byYearQuarter.values()) this.computeDerived(group);
    for (const group of result.byYearMonth.values()) this.computeDerived(group);
    for (const group of result.byMethod.values()) this.computeDerived(group);
    for (const group of result.byQuarterMethod.values()) this.computeDerived(group);
    for (const group of result.bySubordinate.values()) this.computeDerived(group);
    for (const group of result.bySubordinateQuarter.values()) this.computeDerived(group);
    for (const group of result.bySubordinateMonth.values()) this.computeDerived(group);
    for (const group of result.bySubordinateMethod.values()) this.computeDerived(group);
    for (const group of result.byActivity.values()) this.computeDerived(group);
    for (const group of result.byQuarterActivity.values()) this.computeDerived(group);
    for (const group of result.bySubordinateActivity.values()) this.computeDerived(group);
    for (const group of result.byActivityMethod.values()) this.computeDerived(group);
    for (const group of result.byMonthActivity.values()) this.computeDerived(group);

    return result;
  }

  // ── Private helpers ──────────────────────────────────────────────

  /** Extract numeric value from a row for a metric source, with fallback logic. */
  private extractValue(row: RawRow, source: MetricSource): number {
    if (source.aggregation === 'count') return 1;
    const primary = num(row[source.column!]);
    if (primary !== 0 || !source.fallbackColumns) return primary;
    return source.fallbackColumns.reduce((s, c) => s + num(row[c]), 0);
  }

  private accumulate(map: Map<string, AccumulatedValue>, key: string, val: number, rowIdx: number): void {
    let acc = map.get(key);
    if (!acc) {
      acc = { value: 0, contributingRows: [] };
      map.set(key, acc);
    }
    // Базовый аккумулятор всегда числовой (создаётся нулём); `?? 0` здесь —
    // не подстановка «нет базы», а сужение типа, общего с производными.
    acc.value = (acc.value ?? 0) + val;
    acc.contributingRows.push(rowIdx);
  }

  private accumulateInGroup(
    groups: Map<string, Map<string, AccumulatedValue>>,
    groupKey: string,
    metricKey: string,
    val: number,
    rowIdx: number,
  ): void {
    let group = groups.get(groupKey);
    if (!group) {
      group = new Map();
      groups.set(groupKey, group);
    }
    this.accumulate(group, metricKey, val, rowIdx);
  }

  private accumulateInMonthGroup(
    groups: Map<number, Map<string, AccumulatedValue>>,
    month: number,
    metricKey: string,
    val: number,
    rowIdx: number,
  ): void {
    let group = groups.get(month);
    if (!group) {
      group = new Map();
      groups.set(month, group);
    }
    this.accumulate(group, metricKey, val, rowIdx);
  }

  private computeDerived(metrics: Map<string, AccumulatedValue>): void {
    for (const d of this.derived) {
      const val = evaluateDerivedFormula(d, (key) => metrics.get(key)?.value ?? 0);
      metrics.set(d.key, { value: val, contributingRows: [] });
    }
  }
}

/**
 * Вычисление производной метрики по базовым аккумуляторам. Общий дом для
 * compute() и sliceResults(): проценты и доли ВСЕГДА пересчитываются из
 * (слитых) числителя/знаменателя, никогда не агрегируются сами (§3.2
 * пирамиды агрегации).
 */
function evaluateDerivedFormula(
  d: DerivedMetricDefinition,
  get: (key: string) => number,
): number | null {
  switch (d.formula.op) {
    case 'ratio': {
      const denom = get(d.formula.denominator);
      // Нулевой знаменатель = базы нет. Это НЕ ноль: прежний 0 неотличим от
      // «база есть, числитель пуст», и на этом различии держится вся разница
      // между «плана нет» и «план есть, факта нет» (реестр 08.08 §2).
      return denom !== 0 ? get(d.formula.numerator) / denom : null;
    }
    case 'diff':
      return get(d.formula.a) - get(d.formula.b);
    case 'pct': {
      const denom = get(d.formula.denominator);
      // Returns decimal: 0.316 = 31.6% (matching recalculate.ts convention)
      return denom !== 0 ? get(d.formula.numerator) / denom : null;
    }
    case 'sum':
      return d.formula.operands.reduce((acc, key) => acc + get(key), 0);
  }
}

/** Ключи производных метрик канона: при слиянии срезов их суммировать нельзя. */
const STANDARD_DERIVED_KEYS = new Set(STANDARD_DERIVED.map((d) => d.key));

// ── Factory: Standard row filter with classification scoring ─────────

const SKIP_PREFIXES = ['итого', 'всего', 'справочно'];
// Canonical method codes from shared/dictionaries (single source of truth).
// PROCUREMENT_METHODS = ['ЭА', 'ЕП', 'ЭК', 'ЭЗК'] as const.
const ALL_METHODS = new Set<string>(PROCUREMENT_METHODS);

/**
 * Row classification heuristic matching recalculate.ts classifyRow().
 *
 * Points:
 *   +3  known procurement method in column L (ЭА/ЕП/ЭК/ЭЗК)
 *   +2  known activity type in column F
 *   +2  plan amounts > 0.009
 *   +1  plan date present (N)
 *   +1  has ID (A) or subject (G)
 *
 * Threshold: score >= 3 qualifies as a data row.
 */
export function standardRowFilter(row: RawRow): boolean {
  // Must have ID or subject
  if (!cellPresent(row[COL.ID]) && !cellPresent(row[COL.SUBJECT])) return false;
  // Skip summary rows
  const subject = String(row[COL.SUBJECT] ?? '').trim().toLowerCase();
  if (SKIP_PREFIXES.some(p => subject.startsWith(p))) return false;

  // Classification scoring
  const method = normalizeMethod(row[COL.METHOD]);
  const hasMethod = method ? ALL_METHODS.has(method) : false;

  const typeText = String(row[COL.TYPE] ?? '').trim().toLowerCase();
  const hasType = typeText === 'текущая деятельность' || typeText === 'программное мероприятие';

  const planMoney = num(row[COL.FB_PLAN]) + num(row[COL.KB_PLAN]) + num(row[COL.MB_PLAN]);

  const hasDate = cellPresent(row[COL.PLAN_DATE]);
  const hasIdOrSubject = cellPresent(row[COL.ID]) || cellPresent(row[COL.SUBJECT]);

  const score =
    (hasMethod ? 3 : 0) +
    (hasType ? 2 : 0) +
    (planMoney > 0.009 ? 2 : 0) +
    (hasDate ? 1 : 0) +
    (hasIdOrSubject ? 1 : 0);

  return score >= 3;
}

// ── Utility: extract value from grouped results ──────────────────────

/** Адресуемый остаток «без года плана» — то, что показывается строкой. */
export interface NoYearRemainder {
  /** Счётных строк без планового года в периметре. */
  count: number;
  /** Их плановые деньги (ИТОГО с фолбэком ФБ+КБ+МБ), тыс. руб. */
  planTotal: number;
  planFB: number;
  planKB: number;
  planMB: number;
  /** Индексы строк — чтобы остаток можно было раскрыть до первички. */
  rows: number[];
}

/**
 * Корзина «без года плана» из результатов движка. `null` — корзина пуста
 * (или политика была не 'bucket'): пустую строку остатка рисовать не за что.
 */
export function noYearRemainderOf(results: GroupedResults): NoYearRemainder | null {
  const count = results.noYear.get('plan_count')?.value ?? 0;
  if (count === 0) return null;
  const v = (key: string): number => results.noYear.get(key)?.value ?? 0;
  return {
    count,
    planTotal: v('plan_total'),
    planFB: v('plan_fb'),
    planKB: v('plan_kb'),
    planMB: v('plan_mb'),
    rows: [...(results.noYear.get('plan_count')?.contributingRows ?? [])],
  };
}

/**
 * Аддитивное чтение метрики: суммы и счётчики. Отсутствующая группа и пустой
 * аккумулятор дают 0 — для слагаемого это верно.
 *
 * Для производных долей (`*_pct`, `ratio`) звать НЕЛЬЗЯ: у них 0 и «нет базы»
 * — разные ответы, и `?? 0` вернул бы обратно ровно тот ноль, ради снятия
 * которого правило и менялось. Их дверь — `getRatio()`.
 */
export function getValue(results: GroupedResults, metricKey: string, group?: string): number {
  return groupOf(results, group)?.get(metricKey)?.value ?? 0;
}

/**
 * Чтение производной доли: `null` = знаменателя не было (лист печатает в
 * такой ячейке прочерк). Отличается от `getValue` именно тем, что не
 * подменяет «нет базы» нулём (реестр расхождений 08.08 §2).
 *
 * Вызовов пока нет — и это НЕ мёртвый код (сверка зоны В 20.08.2026):
 * контракт getValue выше прямо запрещает читать `*_pct`/`ratio` через себя
 * и адресует сюда. Убрать функцию — значит оставить контракту дверь,
 * которой нет, и первый же читатель долей снова возьмёт `?? 0` с тем самым
 * враньём нуля, ради снятия которого правило заводилось.
 */
export function getRatio(results: GroupedResults, metricKey: string, group?: string): number | null {
  return groupOf(results, group)?.get(metricKey)?.value ?? null;
}

function groupOf(
  results: GroupedResults,
  group?: string,
): Map<string, AccumulatedValue> | undefined {
  if (!group) return results.total;
  return results.byQuarter.get(group)
    ?? results.byMethod.get(group)
    ?? results.byQuarterMethod.get(group)
    ?? results.byQuarterActivity.get(group);
}

// ── sliceResults: universal filter aggregation ───────────────────────

export interface SliceFilter {
  /**
   * Quarter keys to include, e.g. ['q1', 'q3']. Служебная корзина
   * '_orphan' (факт без план-квартала) — легальный ключ: явное
   * ['q1','q2','q3','q4','_orphan'] эквивалентно total по счётчикам
   * (инвариант Фазы 0; сигнал factQuarterMissing помечает такие строки).
   */
  quarters?: string[];
  /** Month numbers to include, e.g. [1, 2, 3]. */
  months?: number[];
  /** Method groups to include, e.g. ['competitive']. */
  methods?: string[];
  /** Subordinate names to include. */
  subordinates?: string[];
  /** Activity types to include, e.g. ['program']. */
  activities?: string[];
}

/**
 * Aggregate metrics from grouped results according to an arbitrary filter combination.
 * compute() runs ONCE for all rows; sliceResults() sums selected group slices.
 *
 * For single-dimension filtering, sums the selected groups.
 * For cross-dimension filtering (e.g. q1 AND competitive), uses composite keys
 * from byQuarterMethod or byQuarterActivity maps.
 */
export function sliceResults(
  grouped: GroupedResults,
  filter: SliceFilter,
): Map<string, AccumulatedValue> {
  const hasQ = !!(filter.quarters && filter.quarters.length > 0);
  const hasM = !!(filter.months && filter.months.length > 0);
  const hasMeth = !!(filter.methods && filter.methods.length > 0);
  const hasSub = !!(filter.subordinates && filter.subordinates.length > 0);
  const hasAct = !!(filter.activities && filter.activities.length > 0);

  // No filter → total
  if (!hasQ && !hasM && !hasMeth && !hasSub && !hasAct) {
    return grouped.total;
  }

  // Харденинг Фазы 0: сочетание осей, для которого нет карты пересечения,
  // — честная ошибка, а НЕ молчаливый сброс «лишних» фильтров (раньше
  // {quarters, subordinates} тихо возвращал весь квартал по всем подведам).
  const SUPPORTED: ReadonlySet<string> = new Set([
    'quarters', 'months', 'methods', 'subordinates', 'activities',
    'quarters+methods', 'quarters+activities',
  ]);
  const dims = [
    hasQ && 'quarters', hasMeth && 'methods', hasAct && 'activities',
    hasM && 'months', hasSub && 'subordinates',
  ].filter((d): d is string => Boolean(d));
  const combo = dims.join('+');
  if (!SUPPORTED.has(combo)) {
    throw new Error(
      `sliceResults: неподдерживаемое сочетание осей (${combo}) — карты пересечения нет. ` +
      'Поддержано: одна ось, quarters+methods, quarters+activities.',
    );
  }

  const result = new Map<string, AccumulatedValue>();

  // Производные (проценты/доли/разности) при слиянии НЕ суммируются —
  // пересчитываются ниже из слитых базовых аккумуляторов (§3.2 пирамиды:
  // сложение процентов — запрещённая операция).
  function merge(source: Map<string, AccumulatedValue> | undefined): void {
    if (!source) return;
    for (const [key, acc] of source) {
      if (STANDARD_DERIVED_KEYS.has(key)) continue;
      const existing = result.get(key);
      if (existing) {
        // Слагаемые здесь только базовые (производные отфильтрованы выше и
        // пересчитываются заново) — `?? 0` сужает общий тип, а не прячет null.
        existing.value = (existing.value ?? 0) + (acc.value ?? 0);
        existing.contributingRows.push(...acc.contributingRows);
      } else {
        result.set(key, { value: acc.value, contributingRows: [...acc.contributingRows] });
      }
    }
  }

  if (hasQ && hasMeth) {
    // Cross-dimension: quarter × method
    for (const q of filter.quarters!) {
      for (const m of filter.methods!) {
        merge(grouped.byQuarterMethod.get(`${q}.${m}`));
      }
    }
  } else if (hasQ && hasAct) {
    // Cross-dimension: quarter × activity
    for (const q of filter.quarters!) {
      for (const a of filter.activities!) {
        merge(grouped.byQuarterActivity.get(`${q}.${a}`));
      }
    }
  } else if (hasQ) {
    for (const q of filter.quarters!) merge(grouped.byQuarter.get(q));
  } else if (hasM) {
    for (const m of filter.months!) merge(grouped.byMonth.get(m));
  } else if (hasMeth) {
    for (const m of filter.methods!) merge(grouped.byMethod.get(m));
  } else if (hasSub) {
    for (const s of filter.subordinates!) merge(grouped.bySubordinate.get(s));
  } else if (hasAct) {
    for (const a of filter.activities!) merge(grouped.byActivity.get(a));
  }

  // Производные — заново по слитым базам (единый вычислитель с compute()).
  for (const d of STANDARD_DERIVED) {
    const val = evaluateDerivedFormula(d, (key) => result.get(key)?.value ?? 0);
    result.set(d.key, { value: val, contributingRows: [] });
  }

  return result;
}

/**
 * Срез по дизъюнктным ключам периода (Фаза 2 оси времени): единственный
 * потребитель `resolveTimeSelection(...).keys` из @aemr/shared.
 *
 * Свёртка ключей:
 *  - month  → byYearMonth `${год}.m${месяц}`;
 *  - quarter → byYearQuarter `${год}.q${квартал}`;
 *  - year   → Σ четырёх кварталов года (канон печатного года, правила
 *    счёта §2) + `${год}._orphan` ТОЛЬКО при opts.includeOrphan (Пульт
 *    «всё, что реально произошло»; факт без квартала помечен сигналом
 *    factQuarterMissing).
 *
 * Дизъюнктность ключей гарантирует резолвер — здесь без двойного счёта по
 * построению. Производные пересчитываются из слитых базовых аккумуляторов.
 */
export function slicePeriods(
  grouped: GroupedResults,
  keys: readonly import('@aemr/shared').PeriodKey[],
  opts?: { includeOrphan?: boolean },
): Map<string, AccumulatedValue> {
  const result = new Map<string, AccumulatedValue>();

  function merge(source: Map<string, AccumulatedValue> | undefined): void {
    if (!source) return;
    for (const [key, acc] of source) {
      if (STANDARD_DERIVED_KEYS.has(key)) continue;
      const existing = result.get(key);
      if (existing) {
        // Слагаемые здесь только базовые (производные отфильтрованы выше и
        // пересчитываются заново) — `?? 0` сужает общий тип, а не прячет null.
        existing.value = (existing.value ?? 0) + (acc.value ?? 0);
        existing.contributingRows.push(...acc.contributingRows);
      } else {
        result.set(key, { value: acc.value, contributingRows: [...acc.contributingRows] });
      }
    }
  }

  for (const k of keys) {
    if (k.kind === 'month') {
      merge(grouped.byYearMonth.get(`${k.year}.m${k.month}`));
    } else if (k.kind === 'quarter') {
      merge(grouped.byYearQuarter.get(`${k.year}.q${k.quarter}`));
    } else {
      for (const q of [1, 2, 3, 4]) {
        merge(grouped.byYearQuarter.get(`${k.year}.q${q}`));
      }
      if (opts?.includeOrphan) {
        merge(grouped.byYearQuarter.get(`${k.year}._orphan`));
      }
    }
  }

  for (const d of STANDARD_DERIVED) {
    const val = evaluateDerivedFormula(d, (key) => result.get(key)?.value ?? 0);
    result.set(d.key, { value: val, contributingRows: [] });
  }

  return result;
}
