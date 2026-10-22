import { completeSum, observedNumber } from '@aemr/shared';
import type { PeriodResolution } from './period-resolution';
import { aggregateNodeTotals } from './totals-aggregation';

/**
 * Ось бюджета (ФБ/КБ/МБ): выбор плана/факта из per-budget полей агрегата
 * и пересчёт тоталов при активном бюджет-фильтре.
 *
 * Извлечено move-only из useFilteredData.ts §9a (:464–478) и §9c (:517–541),
 * разрез E11-1. budgetPlanFact — «выживший» по спеке
 * filter-system-target-2026-07-16 §3.4.
 */
export interface PlanFact { plan: number; fact: number; complete: boolean }
export type BudgetPlanFactFn = (q: any) => PlanFact;

/**
 * §9a: строит функцию выбора plan/fact из квартального/месячного агрегата
 * с учётом бюджет-фильтра. Пустой Set (фильтра нет) = сырые planTotal/factTotal.
 */
export function makeBudgetPlanFact(selectedBudgets: Set<string>): BudgetPlanFactFn {
  const isBudgetFiltered = selectedBudgets.size > 0;
  const budgetShowFB = !isBudgetFiltered || selectedBudgets.has('fb');
  const budgetShowKB = !isBudgetFiltered || selectedBudgets.has('kb');
  const budgetShowMB = !isBudgetFiltered || selectedBudgets.has('mb');

  /** Numbers remain a legacy projection; complete controls whether the
   * figure is publishable. Do not confuse a missing selected budget with 0. */
  return (q: any): PlanFact => {
    const planValues = isBudgetFiltered
      ? [
          ...(budgetShowFB ? [q?.planFB] : []),
          ...(budgetShowKB ? [q?.planKB] : []),
          ...(budgetShowMB ? [q?.planMB] : []),
        ]
      : [q?.planTotal];
    const factValues = isBudgetFiltered
      ? [
          ...(budgetShowFB ? [q?.factFB] : []),
          ...(budgetShowKB ? [q?.factKB] : []),
          ...(budgetShowMB ? [q?.factMB] : []),
        ]
      : [q?.factTotal];
    const observedPlan = completeSum(planValues.map(observedNumber));
    const observedFact = completeSum(factValues.map(observedNumber));
    return {
      plan: observedPlan ?? 0,
      fact: observedFact ?? 0,
      complete: observedPlan !== null && observedFact !== null,
    };
  };
}

/**
 * §9c: пересчёт totalPlan/totalFact при бюджет-фильтре БЕЗ фильтра деятельности.
 * Ветви: подвед-оверрайд (_subFiltered — через общее периодное ядро, баг #4) /
 * month-level / quarter-level (покрытые кварталы либо periodKey).
 */
export function recalcTotalsByBudget(depts: any[], opts: {
  budgetPlanFact: BudgetPlanFactFn;
  useMonthLevel: boolean;
  activeMonths: Set<number>;
  hasActiveMonths: boolean;
  coveredQuarters: string[];
  periodKey: string;
  /** Полная резолюция периода — подвед-ветвь считается общим ядром (баг #4). */
  resolution: PeriodResolution;
  hasMonthData: boolean;
}): { totalPlan: number; totalFact: number; complete: boolean } {
  const { budgetPlanFact, useMonthLevel, activeMonths, hasActiveMonths, coveredQuarters, periodKey, resolution, hasMonthData } = opts;
  let totalPlan = 0;
  let totalFact = 0;
  let complete = depts.length > 0;
  for (const d of depts) {
    if (d._subFiltered) {
      // Баг #4 реестра охоты 08.08: раньше здесь суммировались ВСЕ 4 квартала
      // оверрайднутого узла независимо от выбранного периода — бюджет-итог при
      // фильтре по подведам показывал год под заголовком квартала/месяца.
      // Теперь узел идёт через то же ядро, что итоги (aggregateNodeTotals),
      // а бюджет выбирается из его периодной разбивки.
      const n = aggregateNodeTotals(d, resolution, { showKP: true, showEP: true, activeMonths, hasMonthData });
      const projected = budgetPlanFact({ ...n.budget, planTotal: n.planTotal, factTotal: n.factTotal });
      if (!projected.complete || (!n.periodApplied && periodKey !== 'year')) complete = false;
      totalPlan += projected.plan; totalFact += projected.fact;
    } else if (useMonthLevel) {
      for (const monthNum of activeMonths) {
        const projected = budgetPlanFact(d.months?.[monthNum]);
        if (!projected.complete) complete = false;
        totalPlan += projected.plan; totalFact += projected.fact;
      }
    } else {
      const aggregateQuarters = hasActiveMonths && coveredQuarters.length > 0
        ? coveredQuarters : [periodKey];
      for (const qKey of aggregateQuarters) {
        const projected = budgetPlanFact(d.quarters?.[qKey] ?? (qKey === 'year' ? d : undefined));
        if (!projected.complete) complete = false;
        totalPlan += projected.plan; totalFact += projected.fact;
      }
    }
  }
  return { totalPlan, totalFact, complete };
}
