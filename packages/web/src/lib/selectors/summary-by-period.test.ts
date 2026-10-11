import { describe, expect, it } from 'vitest';
import { makeBudgetPlanFact } from './budget-filter';
import { applyBudgetZeroing, recalcSummaryByPeriod } from './summary-by-period';

const noBudget = makeBudgetPlanFact(new Set());
const q1 = {
  kpCount: 2, kpFactCount: 1, kpPlanTotal: 100, kpFactTotal: 50,
  epCount: 1, epFactCount: 1, epPlanTotal: 40, epFactTotal: 10,
  planFB: 90, planKB: 30, planMB: 20, factFB: 40, factKB: 15, factMB: 5,
};
const depts = [{ quarters: { q1 } }];

describe('recalcSummaryByPeriod (извлечено из useFilteredData §11)', () => {
  it('квартальная ветвь: суммирует поля кварталов, периоды без данных — нули', () => {
    const s = recalcSummaryByPeriod(depts, {
      isActivityFiltered: false, actKeys: [], budgetPlanFact: noBudget, showKP: true, showEP: true,
    });
    expect(s.q1).toMatchObject({
      kpCount: 2, kpFactCount: 1, kpPlan: 100, kpFact: 50, kpPercent: 0.5,
      epCount: 1, epPercent: 1,
      fbPlan: 90, kbPlan: 30, mbPlan: 20,
      source: 'filtered',
    });
    expect(s.q2.kpCount).toBe(0);
    expect(Object.keys(s)).toEqual(['q1', 'q2', 'q3', 'q4', 'year']);
  });

  it('способ: невыбранный тип обнуляется (показываем только ЕП)', () => {
    const s = recalcSummaryByPeriod(depts, {
      isActivityFiltered: false, actKeys: [], budgetPlanFact: noBudget, showKP: false, showEP: true,
    });
    expect(s.q1.kpCount).toBe(0);
    expect(s.q1.kpPlan).toBe(0);
    expect(s.q1.epCount).toBe(1);
  });

  it('activity-ветвь: берёт метод из того же периода и деятельности', () => {
    const program = {
      planCount: 3, factCount: 2, planTotal: 60, factTotal: 30,
      byMethod: {
        competitive: { plan: 1, fact: 1, planSum: 40, factSum: 20, planFB: 30, factFB: 15 },
        ep: { plan: 2, fact: 1, planSum: 20, factSum: 10, planFB: 20, factFB: 10 },
      },
    };
    const actDepts = [{ byActivity: { q1: { program } } }];
    const both = recalcSummaryByPeriod(actDepts, {
      isActivityFiltered: true, actKeys: ['program'], budgetPlanFact: noBudget,
      showKP: true, showEP: true,
    });
    expect(both.q1).toMatchObject({
      kpCount: 1, kpFactCount: 1, kpPlan: 40, kpFact: 20,
      epCount: 2, epFactCount: 1, epPlan: 20, epFact: 10, fbPlan: 50,
    });
    const ep = recalcSummaryByPeriod(actDepts, {
      isActivityFiltered: true, actKeys: ['program'], budgetPlanFact: noBudget,
      showKP: false, showEP: true,
    });
    expect(ep.q1).toMatchObject({ kpCount: 0, kpPlan: 0, epCount: 2, epPlan: 20, fbPlan: 20 });
  });

  it('snapshot without the cross-dimension data is not comparable, not 100% competitive', () => {
    const legacy = [{ byActivity: { q1: { program: { planCount: 3, planTotal: 60 } } } }];
    const summary = recalcSummaryByPeriod(legacy, {
      isActivityFiltered: true, actKeys: ['program'], budgetPlanFact: noBudget,
      showKP: true, showEP: true,
    });
    expect(summary.q1).toMatchObject({ source: 'not_comparable', kpCount: null, epCount: null, kpPlan: null });
  });
});

describe('applyBudgetZeroing (извлечено из useFilteredData §11a)', () => {
  const summary = { q1: { fbPlan: 90, fbFact: 40, kbPlan: 30, kbFact: 15, mbPlan: 20, mbFact: 5 } };

  it('фильтр пуст — вход возвращается как есть (та же ссылка)', () => {
    expect(applyBudgetZeroing(summary, new Set())).toBe(summary);
  });

  it('обнуляет невыбранные бюджеты, вход не мутируется', () => {
    const out = applyBudgetZeroing(summary, new Set(['fb']));
    expect(out.q1).toMatchObject({ fbPlan: 90, fbFact: 40, kbPlan: 0, kbFact: 0, mbPlan: 0, mbFact: 0 });
    expect(summary.q1.kbPlan).toBe(30); // оригинал цел
  });
});
