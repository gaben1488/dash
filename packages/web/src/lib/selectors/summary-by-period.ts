import type { BudgetPlanFactFn } from './budget-filter';
import { activityMethodSlice } from './activity-method';

/**
 * Пересчёт summaryByPeriod (сводка q1..q4/year: КП/ЕП счётчики, план/факт,
 * per-budget тоталы) по отфильтрованным департаментам — и бюджет-обнуление.
 *
 * Извлечено move-only из useFilteredData.ts §11 (:641–718) и §11a (:720–732),
 * разрез E11-1.
 */
export function recalcSummaryByPeriod(depts: any[], opts: {
  isActivityFiltered: boolean;
  actKeys: string[];
  budgetPlanFact: BudgetPlanFactFn;
  /** Способ (КП/ЕП): пустой selectedMethods = показывать оба */
  showKP: boolean;
  showEP: boolean;
}): Record<string, any> {
  const { isActivityFiltered, actKeys, budgetPlanFact, showKP, showEP } = opts;
  const filteredSummary: Record<string, any> = {};
  const periodKeys = ['q1', 'q2', 'q3', 'q4', 'year'];
  for (const pk of periodKeys) {
    let kpCount = 0, kpFactCount = 0, kpPlan = 0, kpFact = 0;
    let epCount = 0, epFactCount = 0, epPlan = 0, epFact = 0;
    let fbPlan = 0, kbPlan = 0, mbPlan = 0, fbFact = 0, kbFact = 0, mbFact = 0;

    let missingActivitySplit = false;
    if (isActivityFiltered) {
      for (const d of depts) {
        const ba = d.byActivity?.[pk];
        if (!ba) {
          if (d._subFiltered && d._activityBreakdownAvailable === false) missingActivitySplit = true;
          continue;
        }
        for (const ak of actKeys) {
          const a = ba[ak];
          if (!a) continue;
          const part = activityMethodSlice(a, showKP, showEP, budgetPlanFact);
          if (!part.exact) {
            missingActivitySplit = true;
            continue;
          }
          kpCount += part.kpCount;
          kpFactCount += part.kpFactCount;
          kpPlan += part.kpPlan;
          kpFact += part.kpFact;
          epCount += part.epCount;
          epFactCount += part.epFactCount;
          epPlan += part.epPlan;
          epFact += part.epFact;
          fbPlan += part.planFB; kbPlan += part.planKB; mbPlan += part.planMB;
          fbFact += part.factFB; kbFact += part.factKB; mbFact += part.factMB;
        }
      }
    } else {
      for (const d of depts) {
        const q = d.quarters?.[pk];
        if (!q) continue;
        kpCount += q.kpCount ?? 0;
        kpFactCount += q.kpFactCount ?? 0;
        kpPlan += q.kpPlanTotal ?? 0;
        kpFact += q.kpFactTotal ?? 0;
        epCount += q.epCount ?? 0;
        epFactCount += q.epFactCount ?? 0;
        epPlan += q.epPlanTotal ?? 0;
        epFact += q.epFactTotal ?? 0;
        fbPlan += q.planFB ?? 0;
        kbPlan += q.planKB ?? 0;
        mbPlan += q.planMB ?? 0;
        fbFact += q.factFB ?? 0;
        kbFact += q.factKB ?? 0;
        mbFact += q.factMB ?? 0;
      }
    }

    // Apply procurement filter: zero out excluded type (multi-select)
    if (!showKP) {
      kpCount = 0; kpFactCount = 0; kpPlan = 0; kpFact = 0;
    }
    if (!showEP) {
      epCount = 0; epFactCount = 0; epPlan = 0; epFact = 0;
    }

    filteredSummary[pk] = {
      // A legacy snapshot without activity × method evidence is not a
      // zero-competitive/zero-EP period. Expose unavailable, not false zero.
      kpCount: missingActivitySplit ? null : kpCount,
      kpFactCount: missingActivitySplit ? null : kpFactCount,
      kpPlan: missingActivitySplit ? null : kpPlan,
      kpFact: missingActivitySplit ? null : kpFact,
      kpPercent: missingActivitySplit ? null : kpCount > 0 ? kpFactCount / kpCount : null,
      epCount: missingActivitySplit ? null : epCount,
      epFactCount: missingActivitySplit ? null : epFactCount,
      epPlan: missingActivitySplit ? null : epPlan,
      epFact: missingActivitySplit ? null : epFact,
      epPercent: missingActivitySplit ? null : epCount > 0 ? epFactCount / epCount : null,
      fbPlan: missingActivitySplit ? null : fbPlan,
      kbPlan: missingActivitySplit ? null : kbPlan,
      mbPlan: missingActivitySplit ? null : mbPlan,
      fbFact: missingActivitySplit ? null : fbFact,
      kbFact: missingActivitySplit ? null : kbFact,
      mbFact: missingActivitySplit ? null : mbFact,
      source: missingActivitySplit ? 'not_comparable' : 'filtered',
    };
  }
  return filteredSummary;
}

/**
 * §11a: обнуление невыбранных бюджетов в summaryByPeriod. Пустой Set = вход
 * возвращается как есть. Возвращает новый объект (оригинал не мутируется;
 * до разреза мутировался свежепостроенный filteredSummary — наблюдаемое
 * поведение не изменилось, т.к. при активном бюджет-фильтре пересчёт
 * summaryByPeriod выполняется всегда).
 */
export function applyBudgetZeroing(
  summaryByPeriod: Record<string, any>,
  selectedBudgets: Set<string>,
): Record<string, any> {
  if (selectedBudgets.size === 0) return summaryByPeriod;
  const showFB = selectedBudgets.has('fb');
  const showKB = selectedBudgets.has('kb');
  const showMB = selectedBudgets.has('mb');
  const out: Record<string, any> = {};
  for (const pk of Object.keys(summaryByPeriod)) {
    const s = summaryByPeriod[pk];
    if (!s) { out[pk] = s; continue; }
    const next = { ...s };
    if (!showFB) { next.fbPlan = 0; next.fbFact = 0; }
    if (!showKB) { next.kbPlan = 0; next.kbFact = 0; }
    if (!showMB) { next.mbPlan = 0; next.mbFact = 0; }
    out[pk] = next;
  }
  return out;
}
