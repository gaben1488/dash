/**
 * The single published read-model projection for procurement metrics.
 *
 * Input is the already evaluated CalcEngine result, never raw Sheets values.
 * The public names stay stable for old snapshots/REPORT_MAP; their meaning,
 * formula, units and row gates come exclusively from the executable catalog.
 *
 * This replaces manual metric arithmetic in orchestrator (including its
 * separate district/monthly aggregation). Ratios are recalculated from bases
 * by combineMetricSlices; no averaging or summing percentages is permitted.
 */
import { EXECUTABLE_METRICS, BASE_METRIC_KEYS, resolvePublishedMetricKey,
  type NormalizedMetric, type UnitType, type PeriodScope } from '@aemr/shared';
import { combineMetricSlices, type GroupedResults, type AccumulatedValue } from '../pipeline/calc-engine.js';

type Slice = ReadonlyMap<string, AccumulatedValue>;
type Period = 'q1' | 'q2' | 'q3' | 'q4' | 'year' | `m${number}`;
type Method = 'competitive' | 'ep';
type Published = Map<string, NormalizedMetric>;

export interface DepartmentCalculation {
  departmentId: string;
  grouped: GroupedResults;
  /** Offset in a concatenation of unmodified source rows; keeps row ids disjoint. */
  rowOffset: number;
}
const QUARTERS = ['q1', 'q2', 'q3', 'q4'] as const;
const METHODS = [
  ['kp', 'competitive'],
  ['ep', 'ep'],
] as const;

const ALL_FIELDS = [
  'plan_count', 'fact_count', 'plan_total', 'fact_total',
  'fb_plan', 'kb_plan', 'mb_plan', 'fb_fact', 'kb_fact', 'mb_fact',
  'economy_total', 'economy_fb', 'economy_kb', 'economy_mb',
  'execution_pct', 'exec_count_pct', 'comp_exec_count_pct', 'ep_exec_count_pct',
] as const;
const METHOD_FIELDS = [
  'count', 'fact', 'percent', 'total_plan', 'total_fact',
  'fb_plan', 'kb_plan', 'mb_plan', 'fb_fact', 'kb_fact', 'mb_fact',
  'deviation', 'amount_dev', 'savings_pct',
  'economy_fb', 'economy_kb', 'economy_mb', 'economy_total',
] as const;
const MONTH_METHOD_FIELDS = ['count', 'fact', 'total_plan', 'total_fact'] as const;
const SUMMARY_FIELDS = [
  'count', 'fact_count', 'deviation', 'percent', 'total_plan', 'total_fact',
  'fb_plan', 'kb_plan', 'mb_plan', 'fb_fact', 'kb_fact', 'mb_fact',
  'amount_dev', 'savings_pct', 'economy_fb', 'economy_kb', 'economy_mb', 'economy_total',
] as const;
const SUMMARY_MONTH_FIELDS = ['count', 'fact_count', 'total_plan', 'total_fact'] as const;

const LEGACY_UNIT: Readonly<Record<'count' | 'currency' | 'percent', UnitType>> =
  { count: 'count', currency: 'rubles', percent: 'percent' };

/**
 * Version-safe layout of an old NormalizedMetric. The catalog, never a
 * hand-maintained list of 'rub' vs 'count', chooses the unit.
 */
function put(
  target: Published, key: string, group: Slice,
  source: string, readAt: string,
): void {
  const publicAddress = resolvePublishedMetricKey(key);
  if (!publicAddress) throw new Error(`UNREGISTERED_PUBLISHED_METRIC:${key}`);
  const definition = EXECUTABLE_METRICS.get(publicAddress.definitionKey);
  if (!definition) throw new Error(`MISSING_EXECUTABLE_METRIC:${key}`);
  const accumulated = group.get(publicAddress.definitionKey);
  // An empty eligible period has a known zero base but an unknown ratio.
  const value = accumulated?.value ?? (BASE_METRIC_KEYS.has(publicAddress.definitionKey) ? 0 : null);
  if (value === null) return;
  if (!Number.isFinite(value)) throw new Error(`NONFINITE_PUBLISHED_METRIC:${key}`);
  const period = publicAddress.period;
  const periodScope: PeriodScope = period === 'q1' || period === 'q2'
    || period === 'q3' || period === 'q4' ? period : 'annual';
  const unit = LEGACY_UNIT[definition.unit];
  target.set(key, {
    metricKey: key, value, numericValue: value,
    displayValue: definition.unit === 'percent' ? `${(value * 100).toFixed(1)}%`
      : definition.unit === 'currency' ? value.toLocaleString('ru-RU') + ' ₽'
      : String(Math.round(value)),
    origin: 'calculated', period: periodScope,
    unit, sourceSheet: source, sourceCell: '', formula: null,
    confidence: 1, readAt, warnings: [],
  });
}

function read(group: Slice, key: string): number {
  return group.get(key)?.value ?? 0;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function byPeriod(grouped: GroupedResults, period: Period, method?: Method): Slice {
  if (period.startsWith('m')) {
    const month = Number(period.slice(1));
    return method ? grouped.byQuarterMethod.get(`${period}.${method}`) ?? new Map()
      : grouped.byMonth.get(month) ?? new Map();
  }
  if (period === 'year') {
    const parts = QUARTERS.map(q => ({
      values: (method ? grouped.byQuarterMethod.get(`${q}.${method}`) : grouped.byQuarter.get(q)) ?? new Map(),
    }));
    return combineMetricSlices(parts);
  }
  return method ? grouped.byQuarterMethod.get(`${period}.${method}`) ?? new Map()
    : grouped.byQuarter.get(period) ?? new Map();
}

/** This is an adapter from executable grouped values to historical wire names. */
export function projectDepartmentMetrics(
  target: Published, calculation: DepartmentCalculation, readAt: string,
): void {
  const { departmentId: dept, grouped } = calculation;
  const root = `grbs.${dept}`;

  for (const period of [...QUARTERS, 'year'] as const) {
    const all = byPeriod(grouped, period);
    for (const field of ALL_FIELDS) put(target, `${root}.${period}.${field}`, all, dept, readAt);
    for (const [label, method] of METHODS) {
      const sliced = byPeriod(grouped, period, method);
      for (const field of METHOD_FIELDS) put(target, `${root}.${label}.${period}.${field}`, sliced, dept, readAt);
    }
  }

  // Historical extra annual indicators. The count/percent below come from
  // the same year-sliced bases; no alternate 'fact date = today' semantics.
  const annual = byPeriod(grouped, 'year');
  for (const key of ['competitive_count', 'ep_count', 'ep_share_pct'] as const)
    put(target, `${root}.year.${key}`, annual, dept, readAt);

  // Domain diagnostics are not financial source metrics. Retain legacy keys
  // but do not pretend they come from the standard executable catalog.
  function putDiagnostic(key: string, value: number, unit: UnitType): void {
    target.set(key, {
      metricKey: key, value, numericValue: value,
      displayValue: unit === 'percent' ? `${(value * 100).toFixed(1)}%`
        : unit === 'rubles' ? value.toLocaleString('ru-RU') + ' ₽'
        : String(Math.round(value)),
      origin: 'calculated', period: 'annual',
      unit, sourceSheet: dept, sourceCell: '',
      formula: null, confidence: 1, readAt, warnings: [],
    });
  }
  putDiagnostic(`${root}.year.data_row_count`, grouped.rowCount, 'count');
  putDiagnostic(`${root}.economy.math`, grouped.economyTotalMath, 'rubles');
  putDiagnostic(`${root}.economy.conflicts`, grouped.conflicts, 'count');

  const epYear = byPeriod(grouped, 'year', 'ep');
  const kpYear = byPeriod(grouped, 'year', 'competitive');
  putDiagnostic(`${root}.ep.total`, read(epYear, 'plan_count'), 'count');
  const epMoneyShare = ratio(read(epYear, 'fact_total'),
    read(epYear, 'fact_total') + read(kpYear, 'fact_total'));
  if (epMoneyShare !== null) putDiagnostic(`${root}.ep.percent`, epMoneyShare, 'percent');

  for (const [label, method] of METHODS) {
    const annualMethod = byPeriod(grouped, 'year', method);
    putDiagnostic(`${root}.economy.${label}`, read(annualMethod, 'economy_total'), 'rubles');
    for (const [suffix, definition] of [
      ['fb', 'economy_fb'], ['kb', 'economy_kb'], ['mb', 'economy_mb'],
    ] as const) putDiagnostic(`${root}.economy.${label}.${suffix}`, read(annualMethod, definition), 'rubles');
  }

  // In the legacy contract, months are absent when no position has a plan
  // or fact in that month. An empty acquired quarter, by contrast, is zero.
  for (let m = 1; m <= 12; m++) {
    const period = `m${m}` as Period;
    const all = byPeriod(grouped, period);
    if (read(all, 'plan_count') === 0 && read(all, 'fact_count') === 0) continue;
    for (const field of ALL_FIELDS) put(target, `${root}.${period}.${field}`, all, dept, readAt);
    for (const [label, method] of METHODS) {
      const sliced = byPeriod(grouped, period, method);
      for (const field of MONTH_METHOD_FIELDS) put(target, `${root}.${label}.${period}.${field}`, sliced, dept, readAt);
    }
  }
}

/**
 * One reduction over already computed department slices — no independent
 * district formula. Percentages are evaluated from the merged base values.
 */
export function projectDistrictMetrics(
  target: Published, departments: readonly DepartmentCalculation[], readAt: string,
): void {
  if (departments.length === 0) return; // no acquired book is not an observed zero
  function district(period: Period, method: Method): Slice {
    return combineMetricSlices(departments.map(item => ({
      values: byPeriod(item.grouped, period, method),
      rowOffset: item.rowOffset,
    })));
  }
  for (const period of [...QUARTERS, 'year'] as const) {
    for (const [label, method] of METHODS) {
      const values = district(period, method);
      const prefix = label === 'kp' ? 'competitive' : 'sole';
      for (const field of SUMMARY_FIELDS) put(target, `${prefix}.${period}.${field}`, values, 'summary', readAt);
    }
  }
  for (let m = 1; m <= 12; m++) {
    const period = `m${m}` as Period;
    const kp = district(period, 'competitive');
    const ep = district(period, 'ep');
    if (read(kp, 'plan_count') + read(kp, 'fact_count') + read(kp, 'plan_total') + read(kp, 'fact_total')
      + read(ep, 'plan_count') + read(ep, 'fact_count') + read(ep, 'plan_total') + read(ep, 'fact_total') === 0) continue;
    for (const field of SUMMARY_MONTH_FIELDS) {
      put(target, `competitive.${period}.${field}`, kp, 'summary', readAt);
      put(target, `sole.${period}.${field}`, ep, 'summary', readAt);
    }
  }
}
