import type { BudgetPlanFactFn } from './budget-filter';
import { activityMethodSlice } from './activity-method';

/**
 * The selected activity and procurement method must intersect on the same
 * underlying row, period and budget. Never approximate all activity rows as
 * competitive purchases or pretend an unavailable split means zero EP.
 */
export const ALL_ACTIVITY_KEYS = ['program', 'current_program', 'current_non_program'];

export function resolveActivityKeys(selectedActivities: Set<string>): string[] {
  return selectedActivities.size > 0 ? [...selectedActivities] : ALL_ACTIVITY_KEYS;
}

export function recalcTotalsByActivity(depts: any[], opts: {
  actKeys: string[];
  periodKeys: string[];
  budgetPlanFact: BudgetPlanFactFn;
  showKP?: boolean;
  showEP?: boolean;
  selectedBudgets?: ReadonlySet<string>;
}): {
  totalPlan: number;
  totalFact: number;
  totalEconomy: number;
  totalKP: number;
  totalEP: number;
  totalPlanCount: number;
  totalFactCount: number;
  methodBreakdownAvailable: boolean;
} {
  const { actKeys, periodKeys, budgetPlanFact, showKP = true, showEP = true, selectedBudgets = new Set<string>() } = opts;
  let totalPlan = 0;
  let totalFact = 0;
  let totalEconomy = 0;
  let totalKP = 0;
  let totalEP = 0;
  let totalPlanCount = 0;
  let totalFactCount = 0;
  let methodBreakdownAvailable = true;

  for (const d of depts) {
    for (const period of periodKeys) {
      const byActivity = d.byActivity?.[period];
      if (!byActivity) {
        if (d._subFiltered && d._activityBreakdownAvailable === false) {
          methodBreakdownAvailable = false;
        }
        continue;
      }
      for (const activity of actKeys) {
        const a = byActivity[activity];
        if (!a) continue;
        const selected = activityMethodSlice(a, showKP, showEP, budgetPlanFact, selectedBudgets);
        if (!selected.exact) {
          methodBreakdownAvailable = false;
          continue;
        }
        totalPlan += selected.planTotal;
        totalFact += selected.factTotal;
        totalEconomy += selected.economyTotal;
        totalKP += selected.kpCount;
        totalEP += selected.epCount;
        totalPlanCount += selected.planCount;
        totalFactCount += selected.factCount;
      }
    }
  }

  return {
    totalPlan, totalFact, totalEconomy, totalKP, totalEP, totalPlanCount, totalFactCount,
    methodBreakdownAvailable,
  };
}
