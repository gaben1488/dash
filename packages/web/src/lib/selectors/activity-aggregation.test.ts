import { describe, expect, it } from 'vitest';
import { ALL_ACTIVITY_KEYS, recalcTotalsByActivity, resolveActivityKeys } from './activity-aggregation';
import { makeBudgetPlanFact } from './budget-filter';

describe('resolveActivityKeys (извлечено из useFilteredData §9b)', () => {
  it('фильтр пуст — все виды деятельности', () => {
    expect(resolveActivityKeys(new Set())).toBe(ALL_ACTIVITY_KEYS);
  });

  it('выбранные — только они', () => {
    expect(resolveActivityKeys(new Set(['program']))).toEqual(['program']);
  });
});

describe('recalcTotalsByActivity (извлечено из useFilteredData §9b)', () => {
  const noBudget = makeBudgetPlanFact(new Set());
  const dept = {
    byActivity: {
      q1: {
        program: { planCount: 2, planTotal: 50, factTotal: 25 },
        current_program: { planCount: 1, planTotal: 30, factTotal: 10 },
      },
    },
  };

  it('суммирует выбранные виды по активным периодам; ЕП обнуляется (byActivity не делит КП/ЕП)', () => {
    const t = recalcTotalsByActivity([dept], { actKeys: ['program'], periodKeys: ['q1'], budgetPlanFact: noBudget });
    expect(t).toEqual({ totalPlan: 50, totalFact: 25, totalKP: 2, totalEP: 0 });
  });

  it('все ключи (фильтр пуст) — сумма всех видов', () => {
    const t = recalcTotalsByActivity([dept], { actKeys: ALL_ACTIVITY_KEYS, periodKeys: ['q1'], budgetPlanFact: noBudget });
    expect(t.totalPlan).toBe(80);
    expect(t.totalKP).toBe(3);
  });

  it('нет byActivity за период — нули', () => {
    const t = recalcTotalsByActivity([dept], { actKeys: ['program'], periodKeys: ['q2'], budgetPlanFact: noBudget });
    expect(t.totalPlan).toBe(0);
  });

  it('учитывает бюджет-фильтр через budgetPlanFact', () => {
    const d = { byActivity: { q1: { program: { planCount: 1, planTotal: 50, factTotal: 25, planFB: 40, factFB: 20 } } } };
    const t = recalcTotalsByActivity([d], {
      actKeys: ['program'], periodKeys: ['q1'], budgetPlanFact: makeBudgetPlanFact(new Set(['fb'])),
    });
    expect(t.totalPlan).toBe(40);
    expect(t.totalFact).toBe(20);
  });
});
