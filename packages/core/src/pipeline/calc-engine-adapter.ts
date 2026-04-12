/**
 * Adapter: CalcEngine GroupedResults → RecalculatedMetrics
 *
 * Translates the new CalcEngine output into the legacy RecalculatedMetrics
 * interface so all downstream code (dashboard.ts, reconcile.ts, orchestrator.ts)
 * works without changes.
 */

import type { GroupedResults, AccumulatedValue } from './calc-engine.js';
import type {
  RecalculatedMetrics,
  QuarterMetrics,
  ActivityBreakdown,
  ActivityMetrics,
  SubordinateMetrics,
  SubPeriodMetrics,
} from './recalculate.js';

// ── Helpers ──────────────────────────────────────────────────────────

function get(map: Map<string, AccumulatedValue> | undefined, key: string): number {
  return map?.get(key)?.value ?? 0;
}

function pct(part: number, total: number): number {
  return total > 0 ? part / total : 0;
}

// ── Method sub-object builder ─────────────────────────────────────────

function buildMethodMetrics(map: Map<string, AccumulatedValue> | undefined) {
  return {
    plan: get(map, 'plan_count'),
    fact: get(map, 'fact_count'),
    planSum: get(map, 'plan_total'),
    factSum: get(map, 'fact_total'),
    planFB: get(map, 'plan_fb'),
    planKB: get(map, 'plan_kb'),
    planMB: get(map, 'plan_mb'),
    factFB: get(map, 'fact_fb'),
    factKB: get(map, 'fact_kb'),
    factMB: get(map, 'fact_mb'),
    economyTotal: get(map, 'economy_total'),
    economyFB: get(map, 'economy_fb'),
    economyKB: get(map, 'economy_kb'),
    economyMB: get(map, 'economy_mb'),
  };
}

// ── Quarter metrics builder ──────────────────────────────────────────

function buildQuarterMetrics(
  grouped: GroupedResults,
  qKey: string,
): QuarterMetrics {
  const q = grouped.byQuarter.get(qKey);
  const comp = grouped.byQuarterMethod.get(`${qKey}.competitive`);
  const ep = grouped.byQuarterMethod.get(`${qKey}.ep`);

  return {
    planCount: get(q, 'plan_count'),
    factCount: get(q, 'fact_count'),
    planFB: get(q, 'plan_fb'),
    planKB: get(q, 'plan_kb'),
    planMB: get(q, 'plan_mb'),
    planTotal: get(q, 'plan_total'),
    factFB: get(q, 'fact_fb'),
    factKB: get(q, 'fact_kb'),
    factMB: get(q, 'fact_mb'),
    factTotal: get(q, 'fact_total'),
    economyTotal: get(q, 'economy_total'),
    economyFB: get(q, 'economy_fb'),
    economyKB: get(q, 'economy_kb'),
    economyMB: get(q, 'economy_mb'),
    executionPct: get(q, 'execution_pct'),
    execCountPct: get(q, 'exec_count_pct'),
    compExecCountPct: get(q, 'comp_exec_count_pct'),
    epExecCountPct: get(q, 'ep_exec_count_pct'),
    competitive: buildMethodMetrics(comp),
    ep: buildMethodMetrics(ep),
  };
}

// ── Activity breakdown builder ───────────────────────────────────────

const ACTIVITY_KEYS = ['program', 'current_program', 'current_non_program'] as const;

function buildActivityEntry(map: Map<string, AccumulatedValue> | undefined): ActivityMetrics {
  const pc = get(map, 'plan_count');
  const fc = get(map, 'fact_count');
  return {
    planCount: pc,
    factCount: fc,
    planTotal: get(map, 'plan_total'),
    factTotal: get(map, 'fact_total'),
    planFB: get(map, 'plan_fb'),
    planKB: get(map, 'plan_kb'),
    planMB: get(map, 'plan_mb'),
    factFB: get(map, 'fact_fb'),
    factKB: get(map, 'fact_kb'),
    factMB: get(map, 'fact_mb'),
    economyFB: get(map, 'economy_fb'),
    economyKB: get(map, 'economy_kb'),
    economyMB: get(map, 'economy_mb'),
    economyTotal: get(map, 'economy_total'),
    execCountPct: pct(fc, pc),
  };
}

function buildActivityBreakdown(
  grouped: GroupedResults,
  prefix: string,
): ActivityBreakdown {
  return {
    program: buildActivityEntry(grouped.byQuarterActivity.get(`${prefix}.program`)),
    current_program: buildActivityEntry(grouped.byQuarterActivity.get(`${prefix}.current_program`)),
    current_non_program: buildActivityEntry(grouped.byQuarterActivity.get(`${prefix}.current_non_program`)),
  };
}

// ── Main adapter function ────────────────────────────────────────────

/**
 * Convert CalcEngine GroupedResults to RecalculatedMetrics (backward-compatible).
 *
 * Year totals derivation:
 *   - Plan values: sum of q1-q4 plan values (only rows with planQ contribute to year plan)
 *   - Fact values: sum of q1-q4 fact values + '_orphan' group (rows with fact but no planQ)
 *   - Economy: sum of q1-q4 economy + orphan economy (economy goes to year regardless)
 */
export function adaptToRecalcMetrics(
  grouped: GroupedResults,
  department: string,
): RecalculatedMetrics {
  const q1 = buildQuarterMetrics(grouped, 'q1');
  const q2 = buildQuarterMetrics(grouped, 'q2');
  const q3 = buildQuarterMetrics(grouped, 'q3');
  const q4 = buildQuarterMetrics(grouped, 'q4');
  const quarters = [q1, q2, q3, q4];

  // Orphan facts: rows with fact but no plan quarter
  const orphan = grouped.byQuarter.get('_orphan');

  // Year plan = sum of quarters (only rows with planQ contribute)
  const yearPlanCount = quarters.reduce((s, q) => s + q.planCount, 0);
  const yearPlanFB = quarters.reduce((s, q) => s + q.planFB, 0);
  const yearPlanKB = quarters.reduce((s, q) => s + q.planKB, 0);
  const yearPlanMB = quarters.reduce((s, q) => s + q.planMB, 0);
  const yearPlanTotal = quarters.reduce((s, q) => s + q.planTotal, 0);

  // Year fact = sum of quarters + orphan facts
  const yearFactCount = quarters.reduce((s, q) => s + q.factCount, 0) + get(orphan, 'fact_count');
  const yearFactFB = quarters.reduce((s, q) => s + q.factFB, 0) + get(orphan, 'fact_fb');
  const yearFactKB = quarters.reduce((s, q) => s + q.factKB, 0) + get(orphan, 'fact_kb');
  const yearFactMB = quarters.reduce((s, q) => s + q.factMB, 0) + get(orphan, 'fact_mb');
  const yearFactTotal = quarters.reduce((s, q) => s + q.factTotal, 0) + get(orphan, 'fact_total');

  // Year economy = from total (economy goes to year regardless of quarter)
  const yearEconomyTotal = get(grouped.total, 'economy_total');
  const yearEconomyFB = get(grouped.total, 'economy_fb');
  const yearEconomyKB = get(grouped.total, 'economy_kb');
  const yearEconomyMB = get(grouped.total, 'economy_mb');

  // Monthly metrics
  const months: Record<number, QuarterMetrics> = {};
  for (let mi = 1; mi <= 12; mi++) {
    const mMap = grouped.byMonth.get(mi);
    if (!mMap) {
      months[mi] = emptyQuarterMetrics();
      continue;
    }
    const mComp = grouped.byQuarterMethod.get(`m${mi}.competitive`);
    const mEp = grouped.byQuarterMethod.get(`m${mi}.ep`);
    months[mi] = {
      planCount: get(mMap, 'plan_count'),
      factCount: get(mMap, 'fact_count'),
      planFB: get(mMap, 'plan_fb'),
      planKB: get(mMap, 'plan_kb'),
      planMB: get(mMap, 'plan_mb'),
      planTotal: get(mMap, 'plan_total'),
      factFB: get(mMap, 'fact_fb'),
      factKB: get(mMap, 'fact_kb'),
      factMB: get(mMap, 'fact_mb'),
      factTotal: get(mMap, 'fact_total'),
      economyTotal: get(mMap, 'economy_total'),
      economyFB: get(mMap, 'economy_fb'),
      economyKB: get(mMap, 'economy_kb'),
      economyMB: get(mMap, 'economy_mb'),
      executionPct: get(mMap, 'execution_pct'),
      execCountPct: get(mMap, 'exec_count_pct'),
      compExecCountPct: get(mMap, 'comp_exec_count_pct'),
      epExecCountPct: get(mMap, 'ep_exec_count_pct'),
      competitive: buildMethodMetrics(mComp),
      ep: buildMethodMetrics(mEp),
    };
  }

  // byActivity: per-quarter and year
  const byActivity: Record<string, ActivityBreakdown> = {
    q1: buildActivityBreakdown(grouped, 'q1'),
    q2: buildActivityBreakdown(grouped, 'q2'),
    q3: buildActivityBreakdown(grouped, 'q3'),
    q4: buildActivityBreakdown(grouped, 'q4'),
    year: buildActivityBreakdown(grouped, 'year'),
  };

  // bySubordinate: extract from grouped.bySubordinate + cross-dimensional maps
  const emptySubPeriod = (): SubPeriodMetrics => ({
    planCount: 0, factCount: 0, planTotal: 0, factTotal: 0,
    planFB: 0, planKB: 0, planMB: 0,
    factFB: 0, factKB: 0, factMB: 0,
    economyTotal: 0, economyFB: 0, economyKB: 0, economyMB: 0,
    executionPct: 0, execCountPct: 0,
  });
  const buildSubPeriod = (m: Map<string, AccumulatedValue> | undefined): SubPeriodMetrics => {
    if (!m) return emptySubPeriod();
    const pt = get(m, 'plan_total');
    const ft = get(m, 'fact_total');
    const pc = get(m, 'plan_count');
    const fc = get(m, 'fact_count');
    return {
      planCount: pc,
      factCount: fc,
      planTotal: pt,
      factTotal: ft,
      planFB: get(m, 'plan_fb'),
      planKB: get(m, 'plan_kb'),
      planMB: get(m, 'plan_mb'),
      factFB: get(m, 'fact_fb'),
      factKB: get(m, 'fact_kb'),
      factMB: get(m, 'fact_mb'),
      economyTotal: get(m, 'economy_total'),
      economyFB: get(m, 'economy_fb'),
      economyKB: get(m, 'economy_kb'),
      economyMB: get(m, 'economy_mb'),
      executionPct: pct(ft, pt),
      execCountPct: pct(fc, pc),
    };
  };

  const bySubordinate: SubordinateMetrics[] = [];
  for (const [name, subMap] of grouped.bySubordinate) {
    const subPlan = get(subMap, 'plan_total');
    const subFact = get(subMap, 'fact_total');

    // Per-quarter breakdown
    const quarters: Record<string, SubPeriodMetrics> = {};
    for (const qk of ['q1', 'q2', 'q3', 'q4']) {
      quarters[qk] = buildSubPeriod(grouped.bySubordinateQuarter.get(`${name}.${qk}`));
    }

    // Per-month breakdown
    const months: Record<number, SubPeriodMetrics> = {};
    for (let mi = 1; mi <= 12; mi++) {
      const mMap = grouped.bySubordinateMonth.get(`${name}.m${mi}`);
      if (mMap) months[mi] = buildSubPeriod(mMap);
    }

    // By method
    const byMethod = {
      competitive: buildSubPeriod(grouped.bySubordinateMethod.get(`${name}.competitive`)),
      ep: buildSubPeriod(grouped.bySubordinateMethod.get(`${name}.ep`)),
    };

    const subPlanCount = get(subMap, 'plan_count');
    const subFactCount = get(subMap, 'fact_count');
    // By activity for this subordinate
    const bySubActivity = {
      program: buildSubPeriod(grouped.bySubordinateActivity.get(`${name}.program`)),
      current_program: buildSubPeriod(grouped.bySubordinateActivity.get(`${name}.current_program`)),
      current_non_program: buildSubPeriod(grouped.bySubordinateActivity.get(`${name}.current_non_program`)),
    };

    bySubordinate.push({
      name,
      rowCount: subPlanCount,
      planTotal: subPlan,
      factTotal: subFact,
      planFB: get(subMap, 'plan_fb'),
      planKB: get(subMap, 'plan_kb'),
      planMB: get(subMap, 'plan_mb'),
      factFB: get(subMap, 'fact_fb'),
      factKB: get(subMap, 'fact_kb'),
      factMB: get(subMap, 'fact_mb'),
      executionPct: pct(subFact, subPlan),
      execCountPct: pct(subFactCount, subPlanCount),
      competitiveCount: get(subMap, 'competitive_count'),
      epCount: get(subMap, 'ep_count'),
      economyTotal: get(subMap, 'economy_total'),
      economyFB: get(subMap, 'economy_fb'),
      economyKB: get(subMap, 'economy_kb'),
      economyMB: get(subMap, 'economy_mb'),
      quarters,
      months,
      byMethod,
      byActivity: bySubActivity,
    });
  }
  bySubordinate.sort((a, b) => b.planTotal - a.planTotal);

  return {
    department,
    totalCompetitive: get(grouped.total, 'competitive_count'),
    totalEP: get(grouped.total, 'ep_count'),
    quarters: { q1, q2, q3, q4 },
    months,
    year: {
      planCount: yearPlanCount,
      factCount: yearFactCount,
      planFB: yearPlanFB,
      planKB: yearPlanKB,
      planMB: yearPlanMB,
      planTotal: yearPlanTotal,
      factFB: yearFactFB,
      factKB: yearFactKB,
      factMB: yearFactMB,
      factTotal: yearFactTotal,
      economyTotal: yearEconomyTotal,
      economyFB: yearEconomyFB,
      economyKB: yearEconomyKB,
      economyMB: yearEconomyMB,
      executionPct: pct(yearFactTotal, yearPlanTotal),
      execCountPct: pct(yearFactCount, yearPlanCount),
      compExecCountPct: get(grouped.total, 'comp_exec_count_pct'),
      epExecCountPct: get(grouped.total, 'ep_exec_count_pct'),
    },
    epSharePct: get(grouped.total, 'ep_share_pct'),
    dataRowCount: grouped.rowCount,
    byActivity,
    bySubordinate,
    conflicts: grouped.conflicts,
    economyTotalMath: grouped.economyTotalMath,
  };
}

// ── Helper: empty quarter metrics ────────────────────────────────────

function emptyQuarterMetrics(): QuarterMetrics {
  return {
    planCount: 0, factCount: 0,
    planFB: 0, planKB: 0, planMB: 0, planTotal: 0,
    factFB: 0, factKB: 0, factMB: 0, factTotal: 0,
    economyTotal: 0, economyFB: 0, economyKB: 0, economyMB: 0,
    executionPct: 0, execCountPct: 0, compExecCountPct: 0, epExecCountPct: 0,
    competitive: { plan: 0, fact: 0, planSum: 0, factSum: 0, planFB: 0, planKB: 0, planMB: 0, factFB: 0, factKB: 0, factMB: 0, economyTotal: 0, economyFB: 0, economyKB: 0, economyMB: 0 },
    ep: { plan: 0, fact: 0, planSum: 0, factSum: 0, planFB: 0, planKB: 0, planMB: 0, factFB: 0, factKB: 0, factMB: 0, economyTotal: 0, economyFB: 0, economyKB: 0, economyMB: 0 },
  };
}
