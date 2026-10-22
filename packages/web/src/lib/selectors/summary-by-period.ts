import { completeSum, observedNumber } from '@aemr/shared';
import type { BudgetPlanFactFn } from './budget-filter';
import { ALL_ACTIVITY_KEYS, selectActivityMethods } from './activity-aggregation';

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
  const periodKeys = ['q1', 'q2', 'q3', 'q4', 'year'] as const;
  const moneyKeys = ['fbPlan', 'kbPlan', 'mbPlan', 'fbFact', 'kbFact', 'mbFact'] as const;

  for (const pk of periodKeys) {
    const methodRestricted = showKP !== showEP;
    const selected = isActivityFiltered || methodRestricted || depts.some(d => d._subFiltered)
      ? selectActivityMethods(depts, {
          actKeys: isActivityFiltered ? actKeys : ALL_ACTIVITY_KEYS,
          periodKeys: [pk], showKP, showEP,
        })
      : null;
    const kp = selected ? selected.entries.filter(e => e.method === 'competitive') : [];
    const ep = selected ? selected.entries.filter(e => e.method === 'ep') : [];
    const budgetFor = (entry: (typeof kp)[number]) => budgetPlanFact({
      ...entry.value, planTotal: entry.value.planSum, factTotal: entry.value.factSum,
    });
    const kpBudget = kp.map(budgetFor);
    const epBudget = ep.map(budgetFor);
    const verified = (!selected || selected.complete) &&
      [...kpBudget, ...epBudget].every(projected => projected.complete);
    // Under a proven complete activity/method projection, no entries of a
    // selected group can legitimately mean zero. Under an unproven projection
    // it is NOT proof of zero; no percentage or money may be published.
    const sumSelected = (values: Array<number | null | undefined>): number | null =>
      verified ? (values.length === 0 ? 0 : completeSum(values)) : null;
    const sumDepts = (key: string): number | null =>
      completeSum(depts.map(d => observedNumber(d.quarters?.[pk]?.[key])));

    const totals = selected
      ? {
          kpCount: sumSelected(kp.map(e => e.value.plan)),
          kpFactCount: sumSelected(kp.map(e => e.value.fact)),
          kpPlan: sumSelected(kpBudget.map(e => e.complete ? e.plan : null)),
          kpFact: sumSelected(kpBudget.map(e => e.complete ? e.fact : null)),
          epCount: sumSelected(ep.map(e => e.value.plan)),
          epFactCount: sumSelected(ep.map(e => e.value.fact)),
          epPlan: sumSelected(epBudget.map(e => e.complete ? e.plan : null)),
          epFact: sumSelected(epBudget.map(e => e.complete ? e.fact : null)),
          ...Object.fromEntries(moneyKeys.map(key => [
            key,
            sumSelected(selected.entries.map(e => observedNumber(e.value[key]))),
          ])),
        }
      : {
          kpCount: sumDepts('kpCount'),
          kpFactCount: sumDepts('kpFactCount'),
          kpPlan: sumDepts('kpPlanTotal'),
          kpFact: sumDepts('kpFactTotal'),
          epCount: sumDepts('epCount'),
          epFactCount: sumDepts('epFactCount'),
          epPlan: sumDepts('epPlanTotal'),
          epFact: sumDepts('epFactTotal'),
          ...Object.fromEntries(moneyKeys.map(key => [key, sumDepts(key)])),
        };

    const kpCount = showKP ? totals.kpCount : 0;
    const kpFactCount = showKP ? totals.kpFactCount : 0;
    const kpPlan = showKP ? totals.kpPlan : 0;
    const kpFact = showKP ? totals.kpFact : 0;
    const epCount = showEP ? totals.epCount : 0;
    const epFactCount = showEP ? totals.epFactCount : 0;
    const epPlan = showEP ? totals.epPlan : 0;
    const epFact = showEP ? totals.epFact : 0;

    // A filtered-out method is a known excluded zero; missing included
    // source fields and partial cross-index reads remain null, without
    // inheriting annual or all-method values.
    filteredSummary[pk] = {
      kpCount, kpFactCount, kpPlan, kpFact,
      kpPercent: kpCount != null && kpFactCount != null && kpCount > 0
        ? kpFactCount / kpCount : null,
      epCount, epFactCount, epPlan, epFact,
      epPercent: epCount != null && epFactCount != null && epCount > 0
        ? epFactCount / epCount : null,
      ...Object.fromEntries(moneyKeys.map(key => [key, totals[key]])),
      source: verified ? 'filtered' : 'unverified_activity_method',
      completeness: verified ? 'complete' : 'incomplete',
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
