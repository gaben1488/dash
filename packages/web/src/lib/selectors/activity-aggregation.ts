import type { BudgetPlanFactFn } from './budget-filter';

/**
 * Ось вида деятельности: пересчёт тоталов по byActivity-разбиению.
 *
 * Извлечено move-only из useFilteredData.ts §9b (:480–515), разрез E11-1.
 * Ограничение как было: byActivity не делит КП/ЕП, поэтому totalKP —
 * аппроксимация из planCount, totalEP обнуляется.
 */
export const ALL_ACTIVITY_KEYS = ['program', 'current_program', 'current_non_program'];

/** Пустой выбор = все виды деятельности (фильтра нет). */
export function resolveActivityKeys(selectedActivities: Set<string>): string[] {
  return selectedActivities.size > 0 ? [...selectedActivities] : ALL_ACTIVITY_KEYS;
}

/**
 * §9b: тоталы из byActivity по активным периодам и выбранным видам деятельности,
 * с учётом бюджет-фильтра (budgetPlanFact).
 */
export function recalcTotalsByActivity(depts: any[], opts: {
  actKeys: string[];
  /** Активные ключи периодов: coveredQuarters либо [periodKey] (см. activePeriodKeys) */
  periodKeys: string[];
  budgetPlanFact: BudgetPlanFactFn;
}): { totalPlan: number; totalFact: number; totalKP: number; totalEP: number } {
  const { actKeys, periodKeys, budgetPlanFact } = opts;
  let totalPlan = 0;
  let totalFact = 0;
  let totalKP = 0;

  for (const d of depts) {
    const ba = d.byActivity ?? {};
    for (const pk of periodKeys) {
      const qActivity = ba[pk];
      if (!qActivity) continue;

      for (const ak of actKeys) {
        const a = qActivity[ak];
        if (!a) continue;
        // Apply budget filter when active; ActivityMetrics has planFB/factFB fields
        const { plan, fact } = budgetPlanFact(a);
        totalPlan += plan;
        totalFact += fact;
        totalKP += a.planCount ?? 0; // approximate — byActivity doesn't split KP/EP
      }
    }
  }

  return { totalPlan, totalFact, totalKP, totalEP: 0 };
}
