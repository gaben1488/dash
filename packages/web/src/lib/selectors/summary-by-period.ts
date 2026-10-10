import type { BudgetPlanFactFn } from './budget-filter';
import { ALL_ACTIVITY_KEYS, methodPlanFact, selectActivityMethods } from './activity-aggregation';

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
    const methodRestricted = showKP !== showEP;
    const selected = isActivityFiltered || methodRestricted
      ? selectActivityMethods(depts, {
          actKeys: isActivityFiltered ? actKeys : ALL_ACTIVITY_KEYS,
          periodKeys: [pk], showKP, showEP,
        })
      : null;
    const coverageComplete = selected?.complete ?? true;

    if (selected && (isActivityFiltered || selected.complete)) {
      for (const { method, value } of selected.entries) {
        const money = methodPlanFact(value, budgetPlanFact);
        if (method === 'competitive') {
          kpCount += value.plan;
          kpFactCount += value.fact;
          kpPlan += money.plan;
          kpFact += money.fact;
        } else {
          epCount += value.plan;
          epFactCount += value.fact;
          epPlan += money.plan;
          epFact += money.fact;
        }
        fbPlan += value.planFB ?? 0;
        kbPlan += value.planKB ?? 0;
        mbPlan += value.planMB ?? 0;
        fbFact += value.factFB ?? 0;
        kbFact += value.factKB ?? 0;
        mbFact += value.factMB ?? 0;
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

    // Without per-method provenance the *combined* budget breakdown
    // cannot be attributed to only EP/KP. A null is not a computed zero.
    const unknownBudget = methodRestricted && !coverageComplete;
    filteredSummary[pk] = {
      kpCount, kpFactCount, kpPlan, kpFact,
      kpPercent: kpCount > 0 ? kpFactCount / kpCount : 0,
      epCount, epFactCount, epPlan, epFact,
      epPercent: epCount > 0 ? epFactCount / epCount : 0,
      fbPlan: unknownBudget ? null : fbPlan,
      kbPlan: unknownBudget ? null : kbPlan,
      mbPlan: unknownBudget ? null : mbPlan,
      fbFact: unknownBudget ? null : fbFact,
      kbFact: unknownBudget ? null : kbFact,
      mbFact: unknownBudget ? null : mbFact,
      source: coverageComplete ? 'filtered' : 'unverified_activity_method',
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
