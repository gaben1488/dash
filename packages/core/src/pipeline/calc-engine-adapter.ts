/**
 * Adapter: CalcEngine GroupedResults → RecalculatedMetrics
 *
 * Translates the new CalcEngine output into the legacy RecalculatedMetrics
 * interface so all downstream code (dashboard.ts, reconcile.ts, orchestrator.ts)
 * works without changes.
 */

import { combineMetricSlices, noYearRemainderOf, type GroupedResults, type AccumulatedValue } from './calc-engine.js';
import type {
  RecalculatedMetrics,
  QuarterMetrics,
  ActivityBreakdown,
  ActivityMetrics,
  SubordinateMetrics,
  SubPeriodMetrics,
} from './recalculate.js';

// ── Helpers ──────────────────────────────────────────────────────────

/** Аддитивное чтение (суммы и счётчики): пустая сумма — честный ноль. */
function get(map: Map<string, AccumulatedValue> | undefined, key: string): number {
  return map?.get(key)?.value ?? 0;
}

/** An already-executed derived metric: a missing denominator stays null. */
function derived(map: Map<string, AccumulatedValue> | undefined, key: string): number | null {
  return map?.get(key)?.value ?? null;
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
    // Ratios are executed in the canonical catalog; null stays null.
    executionPct: derived(q, 'execution_pct'),
    execCountPct: derived(q, 'exec_count_pct'),
    compExecCountPct: derived(comp, 'comp_exec_count_pct'),
    epExecCountPct: derived(ep, 'ep_exec_count_pct'),
    competitive: buildMethodMetrics(comp),
    ep: buildMethodMetrics(ep),
  };
}

function buildActivityEntry(
  map: Map<string, AccumulatedValue> | undefined,
  competitive: Map<string, AccumulatedValue> | undefined,
  ep: Map<string, AccumulatedValue> | undefined,
): ActivityMetrics {
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
    execCountPct: derived(map, 'exec_count_pct'),
    byMethod: { competitive: buildMethodMetrics(competitive), ep: buildMethodMetrics(ep) },
  };
}

function buildActivityBreakdown(
  grouped: GroupedResults,
  prefix: string,
  byActivity: Map<string, Map<string, AccumulatedValue>> = grouped.byQuarterActivity,
  byActivityMethod: Map<string, Map<string, AccumulatedValue>> = grouped.byPeriodActivityMethod,
): ActivityBreakdown {
  function forActivity(activity: string): ActivityMetrics {
    const key = `${prefix}.${activity}`;
    return buildActivityEntry(byActivity.get(key),
      byActivityMethod.get(`${key}.competitive`),
      byActivityMethod.get(`${key}.ep`));
  }
  return {
    program: forActivity('program'),
    current_program: forActivity('current_program'),
    current_non_program: forActivity('current_non_program'),
  };
}

// ── Main adapter function ────────────────────────────────────────────

/**
 * Convert CalcEngine GroupedResults to RecalculatedMetrics (backward-compatible).
 *
 * ОДНО ОПРЕДЕЛЕНИЕ ГОДА (реестр расхождений 08.08 §2, волна 0 п.2).
 * Год листа — сумма периодных строк (`D13=SUM(D7:D12)`), поэтому ВСЁ годовое
 * здесь считается суммой четырёх плановых кварталов: счётчики, деньги,
 * экономия и доли способов. Негруппированный `grouped.total` («все строки,
 * прошедшие фильтр») для года не годится — он тянет строки без квартала: на
 * 26.06 это давало 475 конкурентных вместо 396 при 430 бесквартальных
 * строках, то есть завышенный знаменатель исполнения.
 *
 * Раньше разные ярусы одного и того же блока считали год по-разному:
 * счётчики — суммой кварталов, деньги и экономия — из `total`, а факт ещё и
 * прибавлял корзину `_orphan`, план которой в год не входил (числитель шире
 * знаменателя). Отсюда и брался разный год у Пульта и Отчёта на одних
 * данных.
 *
 * Ни одна строка при этом не теряется молча: `orphanFact` (факт без
 * планового квартала, замер 07.08 — одна строка УДТХ на 67 666,68 тыс. руб.)
 * и `noYearRows` (нет планового года) отдаются наружу отдельными полями —
 * это строки остатка, а не отброшенные данные. Чинится проставлением O и P
 * у источника, а не выравниванием формул.
 */
export function adaptToRecalcMetrics(
  grouped: GroupedResults,
  department: string,
): RecalculatedMetrics {
  const q1 = buildQuarterMetrics(grouped, 'q1');
  const q2 = buildQuarterMetrics(grouped, 'q2');
  const q3 = buildQuarterMetrics(grouped, 'q3');
  const q4 = buildQuarterMetrics(grouped, 'q4');
  // Year is the same aggregation of four planned quarterly cohorts used by
  // published metrics and every other CalcEngine consumer. No second ratio.
  const annual = combineMetricSlices(['q1', 'q2', 'q3', 'q4'].map(q => ({
    values: grouped.byQuarter.get(q) ?? new Map<string, AccumulatedValue>(),
  })));
  const yearPlanCount = get(annual, 'plan_count');
  const yearPlanFB = get(annual, 'plan_fb');
  const yearPlanKB = get(annual, 'plan_kb');
  const yearPlanMB = get(annual, 'plan_mb');
  const yearPlanTotal = get(annual, 'plan_total');
  const yearFactCount = get(annual, 'fact_count');
  const yearFactFB = get(annual, 'fact_fb');
  const yearFactKB = get(annual, 'fact_kb');
  const yearFactMB = get(annual, 'fact_mb');
  const yearFactTotal = get(annual, 'fact_total');
  const yearEconomyTotal = get(annual, 'economy_total');
  const yearEconomyFB = get(annual, 'economy_fb');
  const yearEconomyKB = get(annual, 'economy_kb');
  const yearEconomyMB = get(annual, 'economy_mb');
  const yearCompPlan = get(annual, 'competitive_count');
  const yearEpPlan = get(annual, 'ep_count');

  // Orphan fact is separately exposed, never silently merged into year.
  const orphan = grouped.byQuarter.get('_orphan');

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
      executionPct: derived(mMap, 'execution_pct'),
      execCountPct: derived(mMap, 'exec_count_pct'),
      compExecCountPct: derived(mComp, 'comp_exec_count_pct'),
      epExecCountPct: derived(mEp, 'ep_exec_count_pct'),
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
    ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => {
      const key = `m${i + 1}`;
      return [key, buildActivityBreakdown(grouped, key, grouped.byMonthActivity)];
    })),
  };

  // bySubordinate: extract from grouped.bySubordinate + cross-dimensional maps
  const emptySubPeriod = (): SubPeriodMetrics => ({
    planCount: 0, factCount: 0, planTotal: 0, factTotal: 0,
    planFB: 0, planKB: 0, planMB: 0,
    factFB: 0, factKB: 0, factMB: 0,
    economyTotal: 0, economyFB: 0, economyKB: 0, economyMB: 0,
    executionPct: null, execCountPct: null,
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
      executionPct: derived(m, 'execution_pct'),
      execCountPct: derived(m, 'exec_count_pct'),
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
      executionPct: derived(subMap, 'execution_pct'),
      execCountPct: derived(subMap, 'exec_count_pct'),
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
      activityByPeriod: Object.fromEntries(
        ['q1', 'q2', 'q3', 'q4', 'year',
          ...Array.from({ length: 12 }, (_, i) => `m${i + 1}`)].map(period => [
          period,
          buildActivityBreakdown(grouped, `${name}.${period}`,
            grouped.bySubordinatePeriodActivity, grouped.bySubordinatePeriodActivityMethod),
        ]),
      ),
    });
  }
  bySubordinate.sort((a, b) => b.planTotal - a.planTotal);

  return {
    department,
    // Годовые счётчики способов — сумма кварталов, а не негруппированный
    // итог: иначе в «год» падали бы строки без планового квартала.
    totalCompetitive: yearCompPlan,
    totalEP: yearEpPlan,
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
      executionPct: derived(annual, 'execution_pct'),
      execCountPct: derived(annual, 'exec_count_pct'),
      compExecCountPct: derived(annual, 'comp_exec_count_pct'),
      epExecCountPct: derived(annual, 'ep_exec_count_pct'),
    },
    orphanFact: {
      factCount: get(orphan, 'fact_count'),
      factFB: get(orphan, 'fact_fb'),
      factKB: get(orphan, 'fact_kb'),
      factMB: get(orphan, 'fact_mb'),
      factTotal: get(orphan, 'fact_total'),
      economyTotal: get(orphan, 'economy_total'),
      economyFB: get(orphan, 'economy_fb'),
      economyKB: get(orphan, 'economy_kb'),
      economyMB: get(orphan, 'economy_mb'),
    },
    noYearRows: noYearRemainderOf(grouped),
    // Доля ЕП — от годовых (квартальных) счётчиков обоих способов; знаменателя
    // нет (процедур нет вовсе) → null, а не «0 % ЕП».
    epSharePct: derived(annual, 'ep_share_pct'),
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
    executionPct: null, execCountPct: null, compExecCountPct: null, epExecCountPct: null,
    competitive: { plan: 0, fact: 0, planSum: 0, factSum: 0, planFB: 0, planKB: 0, planMB: 0, factFB: 0, factKB: 0, factMB: 0, economyTotal: 0, economyFB: 0, economyKB: 0, economyMB: 0 },
    ep: { plan: 0, fact: 0, planSum: 0, factSum: 0, planFB: 0, planKB: 0, planMB: 0, factFB: 0, factKB: 0, factMB: 0, economyTotal: 0, economyFB: 0, economyKB: 0, economyMB: 0 },
  };
}
