/**
 * The executable procurement metric catalog. This is the only home for
 * source columns, approval gates, formulas, dependencies, units and labels.
 *
 * @aemr/core executes these declarations. The KB and source-lineage records
 * annotate this catalog; neither the server nor the UI owns a second formula.
 * Historical metric keys remain unchanged for persisted snapshot compatibility.
 */
import { DEPT_COLUMNS } from '../column-map.js';
import { METRIC_LABELS } from '../product-dictionary.js';
const COL = DEPT_COLUMNS;
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


/** Standard gates used across metrics. */
export const GATE_HAS_FACT: GateCondition = { column: COL.FACT_DATE, op: 'notEmpty' };
/** Зеркало GATE_HAS_FACT: процедура ещё не заключена на дату среза. */
const GATE_NO_FACT: GateCondition = { column: COL.FACT_DATE, op: 'isEmpty' };
export const GATE_ECONOMY_APPROVED: GateCondition = { column: COL.FLAG, op: 'eq', value: 'да' };
const GATE_METHOD_COMPETITIVE: GateCondition = { column: COL.METHOD, op: 'methodGroup', methodGroup: 'competitive' };
const GATE_METHOD_EP: GateCondition = { column: COL.METHOD, op: 'methodGroup', methodGroup: 'ep' };


/**
 * Standard metric definitions matching СВОД ТД-ПМ columns D-U.
 * These are the base metrics — derived metrics (execution %, savings %) are computed after.
 */
export const STANDARD_METRICS: MetricDefinition[] = [
  // D: Plan count — count all rows (no extra gate)
  { key: 'plan_count', label: METRIC_LABELS['plan_count'], unit: 'count', source: { aggregation: 'count' }, gates: [] },
  // E: Fact count — count rows with fact date
  { key: 'fact_count', label: METRIC_LABELS['fact_count'], unit: 'count', source: { aggregation: 'count' }, gates: [GATE_HAS_FACT] },

  // Method-specific counts
  { key: 'competitive_count', label: METRIC_LABELS['competitive_count'], unit: 'count', source: { aggregation: 'count' }, gates: [GATE_METHOD_COMPETITIVE] },
  { key: 'ep_count', label: METRIC_LABELS['ep_count'], unit: 'count', source: { aggregation: 'count' }, gates: [GATE_METHOD_EP] },

  // H-K: Plan sums (лимиты программ) — K with fallback to H+I+J
  { key: 'plan_fb', label: METRIC_LABELS['plan_fb'], unit: 'currency', source: { column: COL.FB_PLAN, aggregation: 'sum' }, gates: [] },
  { key: 'plan_kb', label: METRIC_LABELS['plan_kb'], unit: 'currency', source: { column: COL.KB_PLAN, aggregation: 'sum' }, gates: [] },
  { key: 'plan_mb', label: METRIC_LABELS['plan_mb'], unit: 'currency', source: { column: COL.MB_PLAN, aggregation: 'sum' }, gates: [] },
  { key: 'plan_total', label: METRIC_LABELS['plan_total'], unit: 'currency', source: { column: COL.TOTAL_PLAN, aggregation: 'sum', fallbackColumns: [COL.FB_PLAN, COL.KB_PLAN, COL.MB_PLAN] }, gates: [] },

  // Остаток: плановые деньги ЕЩЁ НЕ заключённых процедур. Прямой запрос
  // ГРБС-специалиста (27.07): «сколько в плановых деньгах по оставшимся
  // процедурам с разбивкой по бюджетам». Считается по ПЛАНОВЫМ столбцам с
  // обратным гейтом факта — это не «план минус факт»: факт есть цена
  // контракта, она ниже плана, и разность дала бы экономию, а не остаток.
  { key: 'pending_count', label: METRIC_LABELS['pending_count'], unit: 'count', source: { aggregation: 'count' }, gates: [GATE_NO_FACT] },
  { key: 'pending_fb', label: METRIC_LABELS['pending_fb'], unit: 'currency', source: { column: COL.FB_PLAN, aggregation: 'sum' }, gates: [GATE_NO_FACT] },
  { key: 'pending_kb', label: METRIC_LABELS['pending_kb'], unit: 'currency', source: { column: COL.KB_PLAN, aggregation: 'sum' }, gates: [GATE_NO_FACT] },
  { key: 'pending_mb', label: METRIC_LABELS['pending_mb'], unit: 'currency', source: { column: COL.MB_PLAN, aggregation: 'sum' }, gates: [GATE_NO_FACT] },
  { key: 'pending_total', label: METRIC_LABELS['pending_total'], unit: 'currency', source: { column: COL.TOTAL_PLAN, aggregation: 'sum', fallbackColumns: [COL.FB_PLAN, COL.KB_PLAN, COL.MB_PLAN] }, gates: [GATE_NO_FACT] },

  // L-O: Fact sums (цены контрактов) — gated on fact date, Y with fallback to V+W+X
  { key: 'fact_fb', label: METRIC_LABELS['fact_fb'], unit: 'currency', source: { column: COL.FB_FACT, aggregation: 'sum' }, gates: [GATE_HAS_FACT] },
  { key: 'fact_kb', label: METRIC_LABELS['fact_kb'], unit: 'currency', source: { column: COL.KB_FACT, aggregation: 'sum' }, gates: [GATE_HAS_FACT] },
  { key: 'fact_mb', label: METRIC_LABELS['fact_mb'], unit: 'currency', source: { column: COL.MB_FACT, aggregation: 'sum' }, gates: [GATE_HAS_FACT] },
  { key: 'fact_total', label: METRIC_LABELS['fact_total'], unit: 'currency', source: { column: COL.TOTAL_FACT, aggregation: 'sum', fallbackColumns: [COL.FB_FACT, COL.KB_FACT, COL.MB_FACT] }, gates: [GATE_HAS_FACT] },

  // R-U листа СВОД (источник — Z/AA/AB книг ГРБС) под гейтом AD="да" + дата факта.
  // Имя с прилагательным «утверждённая» обязательно: вторая экономия района —
  // «НМЦК минус цена аукциона» книги мониторинга, в рублях, — считается иначе,
  // отбирается иначе и живёт в другой книге (см. economy_total ниже).
  { key: 'economy_fb', label: METRIC_LABELS['economy_fb'], unit: 'currency', source: { column: COL.ECONOMY_FB, aggregation: 'sum' }, gates: [GATE_HAS_FACT, GATE_ECONOMY_APPROVED] },
  { key: 'economy_kb', label: METRIC_LABELS['economy_kb'], unit: 'currency', source: { column: COL.ECONOMY_KB, aggregation: 'sum' }, gates: [GATE_HAS_FACT, GATE_ECONOMY_APPROVED] },
  { key: 'economy_mb', label: METRIC_LABELS['economy_mb'], unit: 'currency', source: { column: COL.ECONOMY_MB, aggregation: 'sum' }, gates: [GATE_HAS_FACT, GATE_ECONOMY_APPROVED] },

  // Compound-gate counts for G-column СВОД: comp_fact_count = КП with fact, ep_fact_count = ЕП with fact
  { key: 'comp_fact_count', label: METRIC_LABELS['comp_fact_count'], unit: 'count', source: { aggregation: 'count' }, gates: [GATE_HAS_FACT, GATE_METHOD_COMPETITIVE] },
  { key: 'ep_fact_count', label: METRIC_LABELS['ep_fact_count'], unit: 'count', source: { aggregation: 'count' }, gates: [GATE_HAS_FACT, GATE_METHOD_EP] },

  // Method-specific plan totals
  { key: 'comp_plan_total', label: METRIC_LABELS['comp_plan_total'], unit: 'currency', source: { column: COL.TOTAL_PLAN, aggregation: 'sum', fallbackColumns: [COL.FB_PLAN, COL.KB_PLAN, COL.MB_PLAN] }, gates: [GATE_METHOD_COMPETITIVE] },
  { key: 'ep_plan_total', label: METRIC_LABELS['ep_plan_total'], unit: 'currency', source: { column: COL.TOTAL_PLAN, aggregation: 'sum', fallbackColumns: [COL.FB_PLAN, COL.KB_PLAN, COL.MB_PLAN] }, gates: [GATE_METHOD_EP] },
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
  { key: 'deviation', label: METRIC_LABELS['deviation'], unit: 'count', formula: { op: 'diff', a: 'fact_count', b: 'plan_count' } },
  // Q листа СВОД: fact_total / plan_total. ОДНА колонка листа — два ключа
  // продукта (execution_pct и savings_pct ниже). Дубль наследственный: оба
  // ключа записаны в персистентных снимках, поэтому не сливаются, но обе
  // карточки БЗ обязаны называть друг друга и колонку Q.
  { key: 'execution_pct', label: METRIC_LABELS['execution_pct'], unit: 'percent', formula: { op: 'pct', numerator: 'fact_total', denominator: 'plan_total' } },
  // P листа СВОД: `=O43-K43` — факт минус план, недоосвоение < 0. Тот же знак,
  // что и у счётного deviation выше.
  { key: 'amount_deviation', label: METRIC_LABELS['amount_deviation'], unit: 'currency', formula: { op: 'diff', a: 'fact_total', b: 'plan_total' } },
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
  { key: 'savings_pct', label: METRIC_LABELS['savings_pct'], unit: 'percent', formula: { op: 'pct', numerator: 'fact_total', denominator: 'plan_total' } },
  // U: Economy total = economy_fb + economy_kb + economy_mb.
  // «Утверждённая» в имени — не украшение: в районе живут ДВЕ экономии.
  // Эта — утверждённая финансовым органом (флаг AD книг ГРБС), в ТЫСЯЧАХ рублей,
  // колонки R–U листа СВОД. Вторая — экономия торгов «НМЦК минус цена аукциона»
  // в РУБЛЯХ из книги «Ежедневный мониторинг» (та самая, что стоит в записке
  // руководителю: 293 аукциона, 57 743 709,89 руб.). Числа разные, единицы
  // разные — одним словом называться не должны.
  { key: 'economy_total', label: METRIC_LABELS['economy_total'], unit: 'currency', formula: { op: 'sum', operands: ['economy_fb', 'economy_kb', 'economy_mb'] } },
  // Total procedures and EP share
  { key: 'total_procedures', label: METRIC_LABELS['total_procedures'], unit: 'count', formula: { op: 'sum', operands: ['competitive_count', 'ep_count'] } },
  { key: 'ep_share_pct', label: METRIC_LABELS['ep_share_pct'], unit: 'percent', formula: { op: 'pct', numerator: 'ep_count', denominator: 'total_procedures' } },

  // Execution % by count: fact_count / plan_count (all methods)
  { key: 'exec_count_pct', label: METRIC_LABELS['exec_count_pct'], unit: 'percent', formula: { op: 'pct', numerator: 'fact_count', denominator: 'plan_count' } },
  // G-column СВОД: comp_fact_count / competitive_count — ГЛАВНЫЙ ПОКАЗАТЕЛЬ РУКОВОДСТВА
  { key: 'comp_exec_count_pct', label: METRIC_LABELS['comp_exec_count_pct'], unit: 'percent', formula: { op: 'pct', numerator: 'comp_fact_count', denominator: 'competitive_count' } },
  // EP execution by count
  { key: 'ep_exec_count_pct', label: METRIC_LABELS['ep_exec_count_pct'], unit: 'percent', formula: { op: 'pct', numerator: 'ep_fact_count', denominator: 'ep_count' } },
];


/** O(1) lookup; the source definitions are never copied or modified. */
export const EXECUTABLE_METRICS: ReadonlyMap<string, MetricDefinition | DerivedMetricDefinition> =
  new Map([...STANDARD_METRICS, ...STANDARD_DERIVED].map(def => [def.key, def]));
export const BASE_METRIC_KEYS: ReadonlySet<string> = new Set(STANDARD_METRICS.map(def => def.key));

/** Dependencies come from the executable registry, including intermediate totals. */
export function metricDependencies(d: DerivedMetricDefinition): string[] {
  const f = d.formula;
  switch (f.op) {
    case 'ratio': case 'pct': return [f.numerator, f.denominator];
    case 'diff': return [f.a, f.b];
    case 'sum': return f.operands;
  }
}



/** Technical formula rendered from the same executable definition as the value.
 *  Literary explanations stay in METRIC_KB, but executable mathematics cannot
 *  drift when the source column, gate or dependency changes. */
function a1Column(index: number): string {
  let n = index + 1, text = '';
  while (n > 0) {
    n--; text = String.fromCharCode(65 + n % 26) + text;
    n = Math.floor(n / 26);
  }
  return text;
}

function gateExpression(gate: GateCondition): string {
  const col = a1Column(gate.column);
  switch (gate.op) {
    case 'notEmpty': return col + ' дата факта подтверждена к моменту среза';
    case 'isEmpty': return col + ' не подтверждена к моменту среза';
    case 'eq': return col + ' = ' + String(gate.value);
    case 'neq': return col + ' ≠ ' + String(gate.value);
    case 'gt': return col + ' > ' + String(gate.value);
    case 'gte': return col + ' ≥ ' + String(gate.value);
    case 'inSet': return col + ' ∈ {' + [...(gate.values ?? [])].join(', ') + '}';
    case 'methodGroup': return col + ' ∈ ' + String(gate.methodGroup);
  }
}

export function executableFormula(key: string): string | null {
  const definition = EXECUTABLE_METRICS.get(key);
  if (!definition) return null;
  if ('formula' in definition) {
    const expression = definition.formula;
    switch (expression.op) {
      case 'diff': return expression.a + ' − ' + expression.b;
      case 'sum': return expression.operands.join(' + ');
      case 'ratio': case 'pct':
        return expression.numerator + ' / ' + expression.denominator + ' (нет базы → null; результат — доля 0..1)';
    }
  }
  const source = definition.source;
  const column = source.column === undefined ? '' : a1Column(source.column);
  const aggregation = source.aggregation === 'sum'
    ? 'SUM(' + column + (source.fallbackColumns?.length
      ? '; при нуле ' + source.fallbackColumns.map(a1Column).join('+') : '') + ')'
    : 'COUNT(строк)';
  return aggregation + (definition.gates.length
    ? ' WHERE ' + definition.gates.map(gateExpression).join(' AND ') : '');
}
