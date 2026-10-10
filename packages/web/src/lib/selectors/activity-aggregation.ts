import type { BudgetPlanFactFn } from './budget-filter';
import type { PeriodResolution } from './period-resolution';

/**
 * Activity and method are independent axes. Their intersection must come from
 * the source-row CalcEngine, never from planCount guessed as competitive.
 */
export const ALL_ACTIVITY_KEYS = ['program', 'current_program', 'current_non_program'];

export type ProcurementGroup = 'competitive' | 'ep';

export interface MethodActivityValue {
  plan: number;
  fact: number;
  planSum: number;
  factSum: number;
  planFB: number; planKB: number; planMB: number;
  factFB: number; factKB: number; factMB: number;
}

interface ActivityValue {
  planCount?: number;
  factCount?: number;
  planTotal?: number;
  factTotal?: number;
  byMethod?: Partial<Record<ProcurementGroup, MethodActivityValue>>;
}

/** Empty activity selection means no activity filter. */
export function resolveActivityKeys(selectedActivities: Set<string>): string[] {
  return selectedActivities.size > 0 ? [...selectedActivities] : ALL_ACTIVITY_KEYS;
}

/**
 * Same period semantics as the shared totals selector: full quarters plus
 * precisely selected months. Quarters are NOT double counted alongside months.
 */
export function activityPeriodKeys(
  resolution: PeriodResolution,
  hasMonthData: boolean,
): string[] {
  if (!resolution.hasActiveMonths) return [resolution.periodKey];
  if (!hasMonthData) return resolution.coveredQuarters;
  return [
    ...resolution.fullQuarters,
    ...resolution.partialMonths.map(month => `m${month}`),
  ];
}

export interface SelectedActivityMethod {
  method: ProcurementGroup;
  value: MethodActivityValue;
}

/** Did selected month/quarter/year have known source rows despite missing
 * activity breakdown? If so, absent byActivity is a coverage gap, not zero. */
function hasSourceRowsForPeriod(dept: any, periodKey: string): boolean {
  const month = /^m(1[0-2]|[1-9])$/.exec(periodKey);
  const source = month
    ? dept.months?.[Number(month[1])]
    : periodKey === 'year'
      ? (dept.quarters?.year ?? dept)
      : dept.quarters?.[periodKey];
  return ['planCount', 'factCount', 'planTotal', 'factTotal']
    .some(field => typeof source?.[field] === 'number' &&
      Number.isFinite(source[field]) && source[field] !== 0);
}

/**
 * Missing byMethod in an older persisted snapshot is UNVERIFIED coverage, not
 * evidence that there are no EP procurements. Do not infer method from total.
 */
export function selectActivityMethods(depts: any[], opts: {
  actKeys: readonly string[];
  periodKeys: readonly string[];
  showKP?: boolean;
  showEP?: boolean;
}): { entries: SelectedActivityMethod[]; complete: boolean } {
  const { actKeys, periodKeys, showKP = true, showEP = true } = opts;
  const entries: SelectedActivityMethod[] = [];
  let complete = true;
  for (const d of depts) {
    const byActivity = d.byActivity ?? {};
    if (d._subFiltered && !Object.keys(byActivity).length) complete = false;
    for (const pk of periodKeys) {
      const period = byActivity[pk];
      if (!period) {
        // A populated source period with no activity partition is NOT a clean
        // zero. Empty time periods remain legitimate and keep their zero.
        if (hasSourceRowsForPeriod(d, pk)) complete = false;
        continue;
      }
      // A period can contain one perfectly valid group while entire other
      // activities disappeared. Compare coverage BEFORE applying the UI filter.
      const month = /^m(1[0-2]|[1-9])$/.exec(pk);
      const source = month ? d.months?.[Number(month[1])]
        : pk === 'year' ? (d.quarters?.year ?? d)
        : d.quarters?.[pk];
      if (typeof source?.planCount === 'number' && Number.isFinite(source.planCount)) {
        const classified = ALL_ACTIVITY_KEYS.reduce(
          (sum, key) => sum + (period[key]?.planCount ?? 0), 0);
        if (classified !== source.planCount) complete = false;
      }
      for (const ak of actKeys) {
        const activity = period[ak] as ActivityValue | undefined;
        if (!activity) continue;
        const populated = (activity.planCount ?? 0) !== 0 ||
          (activity.factCount ?? 0) !== 0 || (activity.planTotal ?? 0) !== 0 ||
          (activity.factTotal ?? 0) !== 0;
        if (!activity.byMethod) {
          if (populated) complete = false;
          continue;
        }
        if (populated && (!activity.byMethod.competitive || !activity.byMethod.ep)) complete = false;
        // The two method counts must reconcile to the activity count.
        // A truncated read with both method keys present is still incomplete.
        const methodPlan = (activity.byMethod.competitive?.plan ?? 0) +
          (activity.byMethod.ep?.plan ?? 0);
        const methodFact = (activity.byMethod.competitive?.fact ?? 0) +
          (activity.byMethod.ep?.fact ?? 0);
        if (typeof activity.planCount === 'number' && activity.planCount !== methodPlan) complete = false;
        if (typeof activity.factCount === 'number' && activity.factCount !== methodFact) complete = false;
        if (showKP && activity.byMethod.competitive) {
          entries.push({ method: 'competitive', value: activity.byMethod.competitive });
        }
        if (showEP && activity.byMethod.ep) {
          entries.push({ method: 'ep', value: activity.byMethod.ep });
        }
      }
    }
  }
  return { entries, complete };
}

/** Budget filters use planTotal/factTotal, while MethodMetrics calls them
 * planSum/factSum. Preserve both amount dimensions without changing units. */
export function methodPlanFact(
  value: MethodActivityValue,
  budgetPlanFact: BudgetPlanFactFn,
): { plan: number; fact: number } {
  return budgetPlanFact({ ...value, planTotal: value.planSum, factTotal: value.factSum });
}

export function recalcTotalsByActivity(depts: any[], opts: {
  actKeys: string[];
  periodKeys: string[];
  budgetPlanFact: BudgetPlanFactFn;
  showKP?: boolean;
  showEP?: boolean;
}): {
  totalPlan: number; totalFact: number;
  totalKP: number; totalEP: number;
  planCount: number; factCount: number;
  complete: boolean;
} {
  const selected = selectActivityMethods(depts, opts);
  let totalPlan = 0, totalFact = 0, totalKP = 0, totalEP = 0;
  let planCount = 0, factCount = 0;
  for (const { method, value } of selected.entries) {
    const money = methodPlanFact(value, opts.budgetPlanFact);
    totalPlan += money.plan;
    totalFact += money.fact;
    planCount += value.plan;
    factCount += value.fact;
    if (method === 'competitive') totalKP += value.plan;
    else totalEP += value.plan;
  }

  // Legacy snapshots may contain correct activity-level money but no
  // activity×method provenance. Preserve their *known total* when neither
  // method is filtered out; never invent the missing KP/EP distribution.
  // Existing independent whole-versus-parts checks must remain meaningful.
  if ((opts.showKP ?? true) && (opts.showEP ?? true)) {
    for (const d of depts) {
      for (const pk of opts.periodKeys) {
        const period = d.byActivity?.[pk];
        if (!period) continue;
        for (const ak of opts.actKeys) {
          const activity = period[ak];
          if (!activity || activity.byMethod) continue;
          const money = opts.budgetPlanFact(activity);
          totalPlan += money.plan;
          totalFact += money.fact;
          planCount += activity.planCount ?? 0;
          factCount += activity.factCount ?? 0;
        }
      }
    }
  }
  return { totalPlan, totalFact, totalKP, totalEP, planCount, factCount, complete: selected.complete };
}

/** Exact roll-up of selected subordinates; never copy full-department data. */
export function mergeSubordinateActivityPeriods(subordinates: any[]): Record<string, any> {
  if (!subordinates.length || subordinates.some(s => !s.activityByPeriod)) return {};
  const periods = new Set<string>();
  for (const s of subordinates) for (const p of Object.keys(s.activityByPeriod)) periods.add(p);
  const activities = ALL_ACTIVITY_KEYS;
  const amountFields = ['plan', 'fact', 'planSum', 'factSum',
    'planFB', 'planKB', 'planMB', 'factFB', 'factKB', 'factMB',
    'economyTotal', 'economyFB', 'economyKB', 'economyMB'];
  const primaryFields = ['planCount', 'factCount', 'planTotal', 'factTotal',
    'planFB', 'planKB', 'planMB', 'factFB', 'factKB', 'factMB',
    'economyTotal', 'economyFB', 'economyKB', 'economyMB'];
  const out: Record<string, any> = {};
  for (const p of periods) {
    const target: Record<string, any> = {};
    for (const activity of activities) {
      const contributors = subordinates.map(s => s.activityByPeriod[p]?.[activity]).filter(Boolean);
      const aggregated: Record<string, any> = {};
      for (const field of primaryFields) {
        aggregated[field] = contributors.reduce((sum, a) => sum + (a[field] ?? 0), 0);
      }
      aggregated.execCountPct = aggregated.planCount > 0
        ? aggregated.factCount / aggregated.planCount : null;
      // If a contributing subordinate lacks method provenance, the merged
      // group is unverified, not zero EP/KP. The caller preserves known
      // combined money but refuses to invent the split.
      const methodComplete = contributors.every(a => Boolean(a.byMethod?.competitive && a.byMethod?.ep));
      if (methodComplete) aggregated.byMethod = {};
      for (const method of ['competitive', 'ep'] as const) {
        const metric: Record<string, number> = {};
        for (const field of amountFields) {
          metric[field] = contributors.reduce((sum, a) => sum + (a.byMethod?.[method]?.[field] ?? 0), 0);
        }
        if (methodComplete) aggregated.byMethod[method] = metric;
      }
      target[activity] = aggregated;
    }
    out[p] = target;
  }
  return out;
}
