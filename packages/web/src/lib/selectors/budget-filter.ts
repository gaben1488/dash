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
export interface PlanFact { plan: number; fact: number }
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

  /** Sum plan/fact from quarter's per-budget fields, respecting budget filter */
  return (q: any): PlanFact => {
    if (!q || !isBudgetFiltered) return { plan: q?.planTotal ?? 0, fact: q?.factTotal ?? 0 };
    let plan = 0, fact = 0;
    if (budgetShowFB) { plan += q.planFB ?? 0; fact += q.factFB ?? 0; }
    if (budgetShowKB) { plan += q.planKB ?? 0; fact += q.factKB ?? 0; }
    if (budgetShowMB) { plan += q.planMB ?? 0; fact += q.factMB ?? 0; }
    return { plan, fact };
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
}): { totalPlan: number; totalFact: number } {
  const { budgetPlanFact, useMonthLevel, activeMonths, hasActiveMonths, coveredQuarters, periodKey, resolution, hasMonthData } = opts;
  let totalPlan = 0;
  let totalFact = 0;
  for (const d of depts) {
    if (d._subFiltered) {
      // Баг #4 реестра охоты 08.08: раньше здесь суммировались ВСЕ 4 квартала
      // оверрайднутого узла независимо от выбранного периода — бюджет-итог при
      // фильтре по подведам показывал год под заголовком квартала/месяца.
      // Теперь узел идёт через то же ядро, что итоги (aggregateNodeTotals),
      // а бюджет выбирается из его периодной разбивки.
      const n = aggregateNodeTotals(d, resolution, { showKP: true, showEP: true, activeMonths, hasMonthData });
      const { plan, fact } = budgetPlanFact({ ...n.budget, planTotal: n.planTotal, factTotal: n.factTotal });
      totalPlan += plan; totalFact += fact;
    } else if (useMonthLevel) {
      for (const monthNum of activeMonths) {
        const { plan, fact } = budgetPlanFact(d.months?.[monthNum]);
        totalPlan += plan; totalFact += fact;
      }
    } else {
      const aggregateQuarters = hasActiveMonths && coveredQuarters.length > 0
        ? coveredQuarters : [periodKey];
      for (const qKey of aggregateQuarters) {
        const { plan, fact } = budgetPlanFact(d.quarters?.[qKey]);
        totalPlan += plan; totalFact += fact;
      }
    }
  }
  return { totalPlan, totalFact };
}
