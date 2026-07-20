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

  it('activity-ветвь: суммирует byActivity, счётчики — аппроксимация в kp*', () => {
    const actDepts = [{
      byActivity: { q1: { program: { planCount: 3, factCount: 2, planTotal: 60, factTotal: 30, planFB: 50, factFB: 25 } } },
    }];
    const s = recalcSummaryByPeriod(actDepts, {
      isActivityFiltered: true, actKeys: ['program'], budgetPlanFact: noBudget, showKP: true, showEP: true,
    });
    expect(s.q1).toMatchObject({ kpCount: 3, kpFactCount: 2, kpPlan: 60, kpFact: 30, fbPlan: 50, epCount: 0 });
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
