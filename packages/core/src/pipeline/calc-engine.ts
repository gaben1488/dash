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

import { DEPT_COLUMNS } from '@aemr/shared';

// ── Column Reference ─────────────────────────────────────────────────

const COL = DEPT_COLUMNS;

/** Safe numeric coercion (0 for non-numeric). */
function num(v: unknown): number {
  if (v == null) return 0;
  const n = parseFloat(String(v));
  return Number.isNaN(n) ? 0 : n;
}

function cellPresent(v: unknown): boolean {
  if (v == null) return false;
  const s = String(v).trim();
  return s !== '' && s !== '0';
}

// ── Types ────────────────────────────────────────────────────────────

/** A raw row from a department sheet (array of cell values). */
export type RawRow = unknown[];

/** Gate condition: determines whether a row contributes to a metric. */
export interface GateCondition {
  /** Column index in the row. */
  column: number;
  /** Comparison operator. */
  op: 'eq' | 'neq' | 'notEmpty' | 'gt' | 'gte' | 'inSet';
  /** Value to compare against (for eq/neq/gt/gte). */
  value?: string | number;
  /** Set of values (for inSet). */
  values?: Set<string>;
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
  method: (row: RawRow) => 'competitive' | 'ep' | null;
  /** Extract subordinate org name ("_org_itself" when col C is empty). */
  subordinate: (row: RawRow) => string;
  /** Extract activity type. */
  activity: (row: RawRow) => string;
}

/** Row filter: determines if a row should be processed at all. */
export type RowFilter = (row: RawRow) => boolean;

/** Accumulated result for a single metric. */
export interface AccumulatedValue {
  value: number;
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
  /** Row count processed. */
  rowCount: number;
  /** Economy conflict count: AD flag disagrees with actual economy values. */
  conflicts: number;
  /** Mathematical economy total (ungated by AD, Math.max(0, eco)), only hasFact gate. */
  economyTotalMath: number;
}

// ── Gate Evaluation ──────────────────────────────────────────────────

const PLACEHOLDERS = new Set(['х', 'x', '-', '—', '–', 'н/д', 'нет', 'не определена']);

function evaluateGate(row: RawRow, gate: GateCondition): boolean {
  const raw = row[gate.column];
  switch (gate.op) {
    case 'notEmpty': {
      const s = String(raw ?? '').trim();
      return s !== '' && !PLACEHOLDERS.has(s.toLowerCase());
    }
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
  }
}

function evaluateAllGates(row: RawRow, gates: GateCondition[]): boolean {
  return gates.every(g => evaluateGate(row, g));
}

// ── Default Dimension Extractors ─────────────────────────────────────

const COMPETITIVE_METHODS = new Set(['ЭА', 'ЭК', 'ЭЗК']);

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

function defaultMethodExtractor(row: RawRow): 'competitive' | 'ep' | null {
  const method = String(row[COL.METHOD] ?? '').trim();
  // Match СВОД/ШДЮ logic: L <> "ЕП" = competitive (includes ЭА, ЭК, ЭЗК, and any other non-ЕП)
  // Empty method = 'competitive' (СВОД FILTER: L<>"ЕП" — everything that is not ЕП is competitive, including blanks)
  if (!method) return 'competitive';
  if (method === 'ЕП') return 'ep';
  return 'competitive';
}

function defaultSubordinateExtractor(row: RawRow): string {
  const s = String(row[COL.SUBORDINATE] ?? '').trim();
  return s || '_org_itself';
}

/** Check if program name value is meaningful (not empty, not "X"/"x"/"Х"/"х" placeholder) */
function hasProgramName(val: unknown): boolean {
  const s = String(val ?? '').trim();
  if (!s) return false;
  // "X", "x", "Х" (cyrillic), "х" (cyrillic) = placeholder = no program
  if (/^[XxХх]$/u.test(s)) return false;
  return true;
}

function defaultActivityExtractor(row: RawRow): string {
  const typeText = String(row[COL.TYPE] ?? '').trim().toLowerCase();

  // F column (TYPE) is the primary classifier
  if (typeText.includes('программное мероприятие')) return 'program';

  // F = "Текущая деятельность": sub-classify by presence of program name in D
  // — реальный текст названия ПМ → ТД в рамках программного мероприятия
  // — "X"/"x"/"Х"/"х" или пусто → ТД вне рамок программного мероприятия
  if (typeText.includes('текущая')) {
    return hasProgramName(row[COL.PROGRAM_NAME]) ? 'current_program' : 'current_non_program';
  }

  // Fallback: if PROGRAM_NAME column has real text, treat as program activity
  if (hasProgramName(row[COL.PROGRAM_NAME])) return 'program';
  return 'program';
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
const GATE_ECONOMY_APPROVED: GateCondition = { column: COL.FLAG, op: 'eq', value: 'да' };
const GATE_METHOD_COMPETITIVE: GateCondition = { column: COL.METHOD, op: 'inSet', values: COMPETITIVE_METHODS };
const GATE_METHOD_EP: GateCondition = { column: COL.METHOD, op: 'eq', value: 'ЕП' };

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

  // L-O: Fact sums (цены контрактов) — gated on fact date, Y with fallback to V+W+X
  { key: 'fact_fb', label: 'Факт ФБ', unit: 'currency', source: { column: COL.FB_FACT, aggregation: 'sum' }, gates: [GATE_HAS_FACT] },
  { key: 'fact_kb', label: 'Факт КБ', unit: 'currency', source: { column: COL.KB_FACT, aggregation: 'sum' }, gates: [GATE_HAS_FACT] },
  { key: 'fact_mb', label: 'Факт МБ', unit: 'currency', source: { column: COL.MB_FACT, aggregation: 'sum' }, gates: [GATE_HAS_FACT] },
  { key: 'fact_total', label: 'Факт ИТОГО', unit: 'currency', source: { column: COL.TOTAL_FACT, aggregation: 'sum', fallbackColumns: [COL.FB_FACT, COL.KB_FACT, COL.MB_FACT] }, gates: [GATE_HAS_FACT] },

  // R-U: Economy (from dept Z/AA/AB) — gated on AD="да" AND fact date
  { key: 'economy_fb', label: 'Экономия ФБ', unit: 'currency', source: { column: COL.ECONOMY_FB, aggregation: 'sum' }, gates: [GATE_HAS_FACT, GATE_ECONOMY_APPROVED] },
  { key: 'economy_kb', label: 'Экономия КБ', unit: 'currency', source: { column: COL.ECONOMY_KB, aggregation: 'sum' }, gates: [GATE_HAS_FACT, GATE_ECONOMY_APPROVED] },
  { key: 'economy_mb', label: 'Экономия МБ', unit: 'currency', source: { column: COL.ECONOMY_MB, aggregation: 'sum' }, gates: [GATE_HAS_FACT, GATE_ECONOMY_APPROVED] },

  // Compound-gate counts for G-column СВОД: comp_fact_count = КП with fact, ep_fact_count = ЕП with fact
  { key: 'comp_fact_count', label: 'Факт КП (кол-во)', unit: 'count', source: { aggregation: 'count' }, gates: [GATE_HAS_FACT, GATE_METHOD_COMPETITIVE] },
  { key: 'ep_fact_count', label: 'Факт ЕП (кол-во)', unit: 'count', source: { aggregation: 'count' }, gates: [GATE_HAS_FACT, GATE_METHOD_EP] },

  // Method-specific plan totals
  { key: 'comp_plan_total', label: 'Лимит КП ИТОГО', unit: 'currency', source: { column: COL.TOTAL_PLAN, aggregation: 'sum', fallbackColumns: [COL.FB_PLAN, COL.KB_PLAN, COL.MB_PLAN] }, gates: [GATE_METHOD_COMPETITIVE] },
  { key: 'ep_plan_total', label: 'Лимит ЕП ИТОГО', unit: 'currency', source: { column: COL.TOTAL_PLAN, aggregation: 'sum', fallbackColumns: [COL.FB_PLAN, COL.KB_PLAN, COL.MB_PLAN] }, gates: [GATE_METHOD_EP] },
];

/** Derived metrics computed from accumulated values. */
export const STANDARD_DERIVED: DerivedMetricDefinition[] = [
  // F: Deviation = plan_count - fact_count
  { key: 'deviation', label: 'Отклонение', unit: 'count', formula: { op: 'diff', a: 'plan_count', b: 'fact_count' } },
  // G: Execution % = fact_total / plan_total (decimal: 0.316 = 31.6%)
  { key: 'execution_pct', label: '% исполнения', unit: 'percent', formula: { op: 'pct', numerator: 'fact_total', denominator: 'plan_total' } },
  // P: Amount deviation = plan_total - fact_total
  { key: 'amount_deviation', label: 'Отклонение сумм', unit: 'currency', formula: { op: 'diff', a: 'plan_total', b: 'fact_total' } },
  // Q: Savings % = (plan_total - fact_total) / plan_total (decimal)
  { key: 'savings_pct', label: '% экономии', unit: 'percent', formula: { op: 'pct', numerator: 'amount_deviation', denominator: 'plan_total' } },
  // U: Economy total = economy_fb + economy_kb + economy_mb
  { key: 'economy_total', label: 'Экономия ИТОГО', unit: 'currency', formula: { op: 'sum', operands: ['economy_fb', 'economy_kb', 'economy_mb'] } },
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
  ): GroupedResults {
    const result: GroupedResults = {
      total: new Map(),
      byQuarter: new Map(),
      byMonth: new Map(),
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
      rowCount: 0,
      conflicts: 0,
      economyTotalMath: 0,
    };

    // Initialize total accumulators
    for (const m of this.metrics) {
      result.total.set(m.key, { value: 0, contributingRows: [] });
    }

    for (let i = startRow; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      if (!filter(row)) continue;

      // Year filter
      if (targetYear) {
        const rowYear = num(row[COL.PLAN_YEAR]);
        if (rowYear > 0 && rowYear !== targetYear) continue;
      }

      result.rowCount++;

      // Extract dimensions
      const quarter = this.extractors.quarter(row);
      const month = this.extractors.month(row);
      const method = this.extractors.method(row);
      const subordinate = this.extractors.subordinate(row);
      const activity = this.extractors.activity(row);
      const hasFact = evaluateGate(row, GATE_HAS_FACT);

      // Accumulate each metric
      for (const m of this.metrics) {
        if (!evaluateAllGates(row, m.gates)) continue;

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

        // By year × activity (always accumulate for year-level activity breakdown)
        this.accumulateInGroup(result.byQuarterActivity, `year.${activity}`, m.key, val, i);

        // By month
        if (month) {
          this.accumulateInMonthGroup(result.byMonth, month, m.key, val, i);
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
        const isApproved = adFlag === 'да' || adFlag === 'yes';

        // economyTotalMath: ungated economy with Math.max(0, ...)
        result.economyTotalMath += Math.max(0, ecoTotal);

        // Conflict: flag says "да" but no economy, or has economy but no flag
        if ((isApproved && ecoTotal === 0) || (!isApproved && ecoTotal > 0)) {
          result.conflicts++;
        }
      }
    }

    // Compute derived metrics for all groups
    this.computeDerived(result.total);
    for (const group of result.byQuarter.values()) this.computeDerived(group);
    for (const group of result.byMonth.values()) this.computeDerived(group);
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
    acc.value += val;
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
      const val = this.evaluateDerived(d, metrics);
      metrics.set(d.key, { value: val, contributingRows: [] });
    }
  }

  private evaluateDerived(d: DerivedMetricDefinition, metrics: Map<string, AccumulatedValue>): number {
    const get = (key: string) => metrics.get(key)?.value ?? 0;

    switch (d.formula.op) {
      case 'ratio': {
        const denom = get(d.formula.denominator);
        return denom !== 0 ? get(d.formula.numerator) / denom : 0;
      }
      case 'diff':
        return get(d.formula.a) - get(d.formula.b);
      case 'pct': {
        const denom = get(d.formula.denominator);
        // Returns decimal: 0.316 = 31.6% (matching recalculate.ts convention)
        return denom !== 0 ? get(d.formula.numerator) / denom : 0;
      }
      case 'sum':
        return d.formula.operands.reduce((acc, key) => acc + get(key), 0);
    }
  }
}

// ── Factory: Standard row filter with classification scoring ─────────

const SKIP_PREFIXES = ['итого', 'всего', 'справочно'];
const ALL_METHODS = new Set(['ЭА', 'ЕП', 'ЭК', 'ЭЗК']);

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
  const method = String(row[COL.METHOD] ?? '').trim();
  const hasMethod = ALL_METHODS.has(method);

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

export function getValue(results: GroupedResults, metricKey: string, group?: string): number {
  if (!group) return results.total.get(metricKey)?.value ?? 0;
  const g = results.byQuarter.get(group)
    ?? results.byMethod.get(group)
    ?? results.byQuarterMethod.get(group)
    ?? results.byQuarterActivity.get(group);
  return g?.get(metricKey)?.value ?? 0;
}

// ── sliceResults: universal filter aggregation ───────────────────────

export interface SliceFilter {
  /** Quarter keys to include, e.g. ['q1', 'q3']. */
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
  const hasQ = filter.quarters && filter.quarters.length > 0;
  const hasM = filter.months && filter.months.length > 0;
  const hasMeth = filter.methods && filter.methods.length > 0;
  const hasSub = filter.subordinates && filter.subordinates.length > 0;
  const hasAct = filter.activities && filter.activities.length > 0;

  // No filter → total
  if (!hasQ && !hasM && !hasMeth && !hasSub && !hasAct) {
    return grouped.total;
  }

  const result = new Map<string, AccumulatedValue>();

  function merge(source: Map<string, AccumulatedValue> | undefined): void {
    if (!source) return;
    for (const [key, acc] of source) {
      const existing = result.get(key);
      if (existing) {
        existing.value += acc.value;
        existing.contributingRows.push(...acc.contributingRows);
      } else {
        result.set(key, { value: acc.value, contributingRows: [...acc.contributingRows] });
      }
    }
  }

  // Cross-dimension: quarter × method
  if (hasQ && hasMeth) {
    for (const q of filter.quarters!) {
      for (const m of filter.methods!) {
        merge(grouped.byQuarterMethod.get(`${q}.${m}`));
      }
    }
    return result;
  }

  // Cross-dimension: quarter × activity
  if (hasQ && hasAct) {
    for (const q of filter.quarters!) {
      for (const a of filter.activities!) {
        merge(grouped.byQuarterActivity.get(`${q}.${a}`));
      }
    }
    return result;
  }

  // Single dimension filters
  if (hasQ) {
    for (const q of filter.quarters!) merge(grouped.byQuarter.get(q));
    return result;
  }
  if (hasM) {
    for (const m of filter.months!) merge(grouped.byMonth.get(m));
    return result;
  }
  if (hasMeth) {
    for (const m of filter.methods!) merge(grouped.byMethod.get(m));
    return result;
  }
  if (hasSub) {
    for (const s of filter.subordinates!) merge(grouped.bySubordinate.get(s));
    return result;
  }
  if (hasAct) {
    for (const a of filter.activities!) merge(grouped.byActivity.get(a));
    return result;
  }

  return grouped.total;
}
