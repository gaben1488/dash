import type { BudgetPlanFactFn } from './budget-filter';
import type { PeriodResolution } from './period-resolution';
import { aggregateNodeTotals } from './totals-aggregation';

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
    let pct: number, plan = 0, fact = 0, kp = 0, ep = 0;
    let execCountPct: number | null = null;

    // Subordinate-filtered: считаем ТЕМ ЖЕ ядром, что итоги страницы.
    // Баг #4 реестра охоты 08.08: раньше ветвь брала годовые значения узла и
    // суммировала все 4 квартала независимо от выбранного периода — бар
    // управления показывал год под заголовком квартала. aggregateNodeTotals
    // сам разбирает _subFiltered-узел периодной ветвью (см. totals-aggregation).
    if (d._subFiltered) {
      const n = aggregateNodeTotals(d, resolution, { showKP: true, showEP: true, activeMonths, hasMonthData });
      kp = n.kp;
      ep = n.ep;
      // budgetPlanFact без фильтра вернёт planTotal/factTotal, с фильтром —
      // сумму выбранных бюджетов из периодной разбивки узла.
      const bf = budgetPlanFact({ ...n.budget, planTotal: n.planTotal, factTotal: n.factTotal });
      plan = bf.plan; fact = bf.fact;
      pct = plan > 0 ? +((fact / plan) * 100).toFixed(1) : (d.executionPercent ?? 0);
      execCountPct = n.planCount > 0 ? +((n.factCount / n.planCount) * 100).toFixed(1) : null;
    } else if (isActivityFiltered) {
      // Use byActivity breakdown for activity-filtered bar data
      const ba = d.byActivity ?? {};
      const periodKeys = hasActiveMonths && coveredQuarters.length > 0
        ? coveredQuarters
        : [periodKey];

      for (const pk of periodKeys) {
        const qAct = ba[pk];
        if (!qAct) continue;
        for (const ak of actKeys) {
          const a = qAct[ak];
          if (!a) continue;
          // Apply budget filter when active; ActivityMetrics has planFB/factFB fields
          const bf = budgetPlanFact(a);
          plan += bf.plan;
          fact += bf.fact;
          kp += a.planCount ?? 0;
        }
      }
      pct = plan > 0 ? +((fact / plan) * 100).toFixed(1) : 0;
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
      pct = plan > 0 ? +((fact / plan) * 100).toFixed(1) : 0;
      execCountPct = dPC > 0 ? +((dFC / dPC) * 100).toFixed(1) : null;
    } else {
      const q = d.quarters?.[periodKey];
      kp = q?.kpCount ?? d.competitiveCount ?? 0;
      ep = q?.epCount ?? d.soleCount ?? 0;
      execCountPct = q?.execCountPct ?? null;
      if (isBudgetFiltered) {
        const bf = budgetPlanFact(q);
        plan = bf.plan; fact = bf.fact;
        pct = plan > 0 ? +((fact / plan) * 100).toFixed(1) : 0;
      } else {
        pct = q?.executionPct ?? d.executionPercent ?? 0;
        plan = q?.planTotal ?? d.planTotal ?? 0;
        fact = q?.factTotal ?? d.factTotal ?? 0;
      }
    }

    return {
      name: d.department?.nameShort ?? d.department?.id ?? '?',
      nameShort: d.department?.nameShort ?? d.department?.id ?? '?',
      id: d.department?.id,
      pct,
      planTotal: plan,
      factTotal: fact,
      kpCount: showKP ? kp : 0,
      epCount: showEP ? ep : 0,
      execCountPct,
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
