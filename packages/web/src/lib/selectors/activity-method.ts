/**
 * Exact procurement method intersection for a selected activity and period.
 *
 * Before the 2026-10 control rework, the activity summary contained only
 * planCount/factCount. Assigning it all to competitive and setting EP=0 is
 * factually wrong; counts and money must be sourced from the same selected
 * method(s). Unknown/older snapshots are explicitly marked not comparable.
 */
import type { BudgetPlanFactFn } from './budget-filter';

export interface MethodActivitySlice {
  exact: boolean;
  kpCount: number;
  epCount: number;
  kpFactCount: number;
  epFactCount: number;
  kpPlan: number;
  epPlan: number;
  kpFact: number;
  epFact: number;
  planCount: number;
  factCount: number;
  planTotal: number;
  factTotal: number;
  planFB: number;
  planKB: number;
  planMB: number;
  factFB: number;
  factKB: number;
  factMB: number;
}

const EMPTY: MethodActivitySlice = {
  exact: false, kpCount: 0, epCount: 0, kpFactCount: 0, epFactCount: 0,
  kpPlan: 0, epPlan: 0, kpFact: 0, epFact: 0,
  planCount: 0, factCount: 0, planTotal: 0, factTotal: 0,
  planFB: 0, planKB: 0, planMB: 0, factFB: 0, factKB: 0, factMB: 0,
};

type Method = {
  plan?: number; fact?: number; planSum?: number; factSum?: number;
  planFB?: number; planKB?: number; planMB?: number;
  factFB?: number; factKB?: number; factMB?: number;
};
type ActivityLike = {
  planCount?: number; factCount?: number;
  planTotal?: number; factTotal?: number;
  byMethod?: { competitive?: Method; ep?: Method };
};

/** No amount or method count is attributed to an unobserved split. */
export function activityMethodSlice(
  entry: ActivityLike | null | undefined,
  showKP: boolean,
  showEP: boolean,
  budgetPlanFact: BudgetPlanFactFn,
): MethodActivitySlice {
  if (!entry) return { ...EMPTY, exact: true }; // No applicable rows in this slice
  const byMethod = entry.byMethod;
  if (!byMethod?.competitive || !byMethod.ep) {
    return { ...EMPTY }; // Historical snapshot without the required intersection
  }
  const kp = byMethod.competitive;
  const ep = byMethod.ep;
  const kMoney = showKP ? budgetPlanFact({ ...kp, planTotal: kp.planSum, factTotal: kp.factSum }) : { plan: 0, fact: 0 };
  const eMoney = showEP ? budgetPlanFact({ ...ep, planTotal: ep.planSum, factTotal: ep.factSum }) : { plan: 0, fact: 0 };
  const f = (key: keyof Method) => (showKP ? kp[key] ?? 0 : 0) + (showEP ? ep[key] ?? 0 : 0);
  return {
    exact: true,
    kpCount: showKP ? kp.plan ?? 0 : 0,
    epCount: showEP ? ep.plan ?? 0 : 0,
    kpFactCount: showKP ? kp.fact ?? 0 : 0,
    epFactCount: showEP ? ep.fact ?? 0 : 0,
    kpPlan: kMoney.plan,
    epPlan: eMoney.plan,
    kpFact: kMoney.fact,
    epFact: eMoney.fact,
    planCount: (showKP ? kp.plan ?? 0 : 0) + (showEP ? ep.plan ?? 0 : 0),
    factCount: (showKP ? kp.fact ?? 0 : 0) + (showEP ? ep.fact ?? 0 : 0),
    planTotal: kMoney.plan + eMoney.plan,
    factTotal: kMoney.fact + eMoney.fact,
    planFB: f('planFB'),
    planKB: f('planKB'),
    planMB: f('planMB'),
    factFB: f('factFB'),
    factKB: f('factKB'),
    factMB: f('factMB'),
  };
}

/** Sum a selected set of subordinate activity entries without importing
 * department-wide aggregates. Missing legacy sub-slices stay unavailable. */
export function sumSubordinateActivityEntries(entries: readonly ActivityLike[]): ActivityLike {
  const fields = [
    'planCount', 'factCount', 'planTotal', 'factTotal',
    'planFB', 'planKB', 'planMB', 'factFB', 'factKB', 'factMB',
    'economyFB', 'economyKB', 'economyMB', 'economyTotal',
  ] as const;
  const methodFields = [
    'plan', 'fact', 'planSum', 'factSum', 'planFB', 'planKB', 'planMB',
    'factFB', 'factKB', 'factMB', 'economyTotal', 'economyFB', 'economyKB', 'economyMB',
  ] as const;
  const total: Record<string, any> = { byMethod: { competitive: {}, ep: {} } };
  for (const field of fields) total[field] = 0;
  for (const method of ['competitive', 'ep'] as const) {
    for (const field of methodFields) total.byMethod[method][field] = 0;
  }
  for (const entry of entries) {
    for (const field of fields) total[field] += (entry as Record<string, number | undefined>)[field] ?? 0;
    for (const method of ['competitive', 'ep'] as const) {
      const stats = entry.byMethod?.[method];
      for (const field of methodFields) total.byMethod[method][field] += stats?.[field] ?? 0;
    }
  }
  total.execCountPct = total.planCount > 0 ? total.factCount / total.planCount : null;
  return total;
}
