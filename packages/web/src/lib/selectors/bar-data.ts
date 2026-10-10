import type { BudgetPlanFactFn } from './budget-filter';
import type { PeriodResolution } from './period-resolution';
import { aggregateNodeTotals } from './totals-aggregation';
import { activityMethodSlice } from './activity-method';

/**
 * Данные бар-чарта исполнения per-департамент (план/факт/%, КП/ЕП, счётное
 * исполнение) с учётом всех активных осей — и оверрайды для департамент-карточек.
 *
 * Извлечено move-only из useFilteredData.ts §10 (:543–639) и §12 (:829–841),
 * разрез E11-1.
 */
export function buildBarData(depts: any[], opts: {
  budgetPlanFact: BudgetPlanFactFn;
  isBudgetFiltered: boolean;
  isActivityFiltered: boolean;
  actKeys: string[];
  useMonthLevel: boolean;
  activeMonths: Set<number>;
  hasActiveMonths: boolean;
  coveredQuarters: string[];
  periodKey: string;
  showKP: boolean;
  showEP: boolean;
  /** Полная резолюция периода — подвед-ветвь считается общим ядром (баг #4). */
  resolution: PeriodResolution;
  hasMonthData: boolean;
}): any[] {
  const {
    budgetPlanFact, isBudgetFiltered, isActivityFiltered, actKeys,
    useMonthLevel, activeMonths, hasActiveMonths, coveredQuarters, periodKey,
    showKP, showEP, resolution, hasMonthData,
  } = opts;

  return depts.map((d: any) => {
    // `pct` — доля исполнения либо `null`, когда базы нет. Ноль здесь означал
    // бы «исполнено 0 %» там, где плана не было вовсе: сосед `execCountPct`
    // это различие держал с самого начала, денежный процент — нет
    // (реестр расхождений §2 «Ноль вместо „нет базы“»).
    let pct: number | null, plan = 0, fact = 0, kp = 0, ep = 0;
    let execCountPct: number | null;
    let activityBreakdownAvailable = true;

    if (isActivityFiltered) {
      // Use exact activity × method × period × budget intersection. This
      // branch also works for selected subordinates: their byActivity is
      // replaced by the selected subordinate slices before arriving here.
      const periodKeys = useMonthLevel && hasActiveMonths
        ? [...resolution.fullQuarters, ...resolution.partialMonths.map(m => `m${m}`)]
        : hasActiveMonths && coveredQuarters.length > 0 ? coveredQuarters : [periodKey];
      let countPlan = 0, countFact = 0;
      for (const pk of periodKeys) {
        const ba = d.byActivity?.[pk];
        if (!ba) {
          if (d._subFiltered && d._activityBreakdownAvailable === false) activityBreakdownAvailable = false;
          continue;
        }
        for (const ak of actKeys) {
          const a = ba[ak];
          if (!a) continue;
          const slice = activityMethodSlice(a, showKP, showEP, budgetPlanFact);
          if (!slice.exact) {
            activityBreakdownAvailable = false;
            continue;
          }
          plan += slice.planTotal;
          fact += slice.factTotal;
          kp += slice.kpCount;
          ep += slice.epCount;
          countPlan += slice.planCount;
          countFact += slice.factCount;
        }
      }
      pct = activityBreakdownAvailable && plan > 0 ? +((fact / plan) * 100).toFixed(1) : null;
      execCountPct = activityBreakdownAvailable && countPlan > 0
        ? +((countFact / countPlan) * 100).toFixed(1) : null;
    } else if (d._subFiltered) {
      // The original subordinate-only path keeps its exact quarter/month
      // aggregation through aggregateNodeTotals.
      const n = aggregateNodeTotals(d, resolution, { showKP: true, showEP: true, activeMonths, hasMonthData });
      kp = n.kp;
      ep = n.ep;
      const bf = budgetPlanFact({ ...n.budget, planTotal: n.planTotal, factTotal: n.factTotal });
      plan = bf.plan; fact = bf.fact;
      pct = plan > 0 ? +((fact / plan) * 100).toFixed(1) : (d.executionPercent ?? null);
      execCountPct = n.planCount > 0 ? +((n.factCount / n.planCount) * 100).toFixed(1) : null;
    } else if (useMonthLevel) {
      // Aggregate selected months for this department
      let dPC = 0, dFC = 0;
      for (const monthNum of activeMonths) {
        const m = d.months?.[monthNum];
        if (!m) continue;
        dPC += m.planCount ?? 0; dFC += m.factCount ?? 0;
        if (isBudgetFiltered) {
          const bf = budgetPlanFact(m);
          plan += bf.plan; fact += bf.fact;
        } else {
          plan += m.planTotal ?? 0;
          fact += m.factTotal ?? 0;
        }
        kp += m.kpCount ?? 0;
        ep += m.epCount ?? 0;
      }
      pct = plan > 0 ? +((fact / plan) * 100).toFixed(1) : null;
      execCountPct = dPC > 0 ? +((dFC / dPC) * 100).toFixed(1) : null;
    } else {
      const q = d.quarters?.[periodKey];
      kp = q?.kpCount ?? d.competitiveCount ?? 0;
      ep = q?.epCount ?? d.soleCount ?? 0;
      execCountPct = q?.execCountPct ?? null;
      if (isBudgetFiltered) {
        const bf = budgetPlanFact(q);
        plan = bf.plan; fact = bf.fact;
        pct = plan > 0 ? +((fact / plan) * 100).toFixed(1) : null;
      } else {
        pct = q?.executionPct ?? d.executionPercent ?? null;
        plan = q?.planTotal ?? d.planTotal ?? 0;
        fact = q?.factTotal ?? d.factTotal ?? 0;
      }
    }

    return {
      name: d.department?.nameShort ?? d.department?.id ?? '?',
      nameShort: d.department?.nameShort ?? d.department?.id ?? '?',
      id: d.department?.id,
      pct,
      planTotal: isActivityFiltered && !activityBreakdownAvailable ? null : plan,
      factTotal: isActivityFiltered && !activityBreakdownAvailable ? null : fact,
      kpCount: isActivityFiltered && !activityBreakdownAvailable ? null : showKP ? kp : 0,
      epCount: isActivityFiltered && !activityBreakdownAvailable ? null : showEP ? ep : 0,
      execCountPct,
      ...(isActivityFiltered ? { activityBreakdownAvailable } : {}),
    };
  });
}

/**
 * §12: оверрайды план/факт/исполнения для департамент-карточек, когда активная
 * ось (деятельность / месяцы / бюджет) делает годовые значения департамента
 * нерепрезентативными. enabled=false = пустой объект (оверрайдов нет).
 */
export function buildDeptCardOverrides(
  barData: any[],
  enabled: boolean,
): Record<string, { planTotal: number; factTotal: number; executionPercent: number | null }> {
  const deptCardOverrides: Record<string, { planTotal: number; factTotal: number; executionPercent: number | null }> = {};
  if (enabled) {
    for (const bd of barData) {
      deptCardOverrides[bd.id] = {
        planTotal: bd.planTotal,
        factTotal: bd.factTotal,
        executionPercent: bd.pct,
      };
    }
  }
  return deptCardOverrides;
}
