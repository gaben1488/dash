import type { BudgetPlanFactFn } from './budget-filter';

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
}): any[] {
  const {
    budgetPlanFact, isBudgetFiltered, isActivityFiltered, actKeys,
    useMonthLevel, activeMonths, hasActiveMonths, coveredQuarters, periodKey,
    showKP, showEP,
  } = opts;

  return depts.map((d: any) => {
    let pct: number, plan = 0, fact = 0, kp = 0, ep = 0;
    let execCountPct: number | null = null;

    // Subordinate-filtered: use the already-overridden dept-level values
    if (d._subFiltered) {
      kp = d.competitiveCount ?? 0;
      ep = d.soleCount ?? 0;
      if (isBudgetFiltered) {
        for (const qk of ['q1', 'q2', 'q3', 'q4']) {
          const bf = budgetPlanFact(d.quarters?.[qk]);
          plan += bf.plan; fact += bf.fact;
        }
      } else {
        plan = d.planTotal ?? 0;
        fact = d.factTotal ?? 0;
      }
      pct = plan > 0 ? +((fact / plan) * 100).toFixed(1) : (d.executionPercent ?? 0);
      // Sum plan/fact counts from sub quarters for execCountPct
      let dPC = 0, dFC = 0;
      for (const qk of ['q1', 'q2', 'q3', 'q4']) {
        const sq = d.quarters?.[qk];
        if (sq) { dPC += sq.planCount ?? 0; dFC += sq.factCount ?? 0; }
      }
      execCountPct = dPC > 0 ? +((dFC / dPC) * 100).toFixed(1) : null;
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
