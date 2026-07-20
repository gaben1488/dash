import { describe, expect, it } from 'vitest';
import { makeBudgetPlanFact, recalcTotalsByBudget } from './budget-filter';

const q = {
  planTotal: 10, factTotal: 5,
  planFB: 6, factFB: 3, planKB: 3, factKB: 1, planMB: 1, factMB: 1,
};

describe('makeBudgetPlanFact (извлечено из useFilteredData §9a, выживший §3.4)', () => {
  it('фильтр пуст — сырые planTotal/factTotal (всё проходит)', () => {
    const f = makeBudgetPlanFact(new Set());
    expect(f(q)).toEqual({ plan: 10, fact: 5 });
  });

  it('агрегата нет — нули', () => {
    expect(makeBudgetPlanFact(new Set())(undefined)).toEqual({ plan: 0, fact: 0 });
    expect(makeBudgetPlanFact(new Set(['fb']))(undefined)).toEqual({ plan: 0, fact: 0 });
  });

  it('один бюджет — только его поля', () => {
    expect(makeBudgetPlanFact(new Set(['fb']))(q)).toEqual({ plan: 6, fact: 3 });
  });

  it('два бюджета — сумма их полей', () => {
    expect(makeBudgetPlanFact(new Set(['kb', 'mb']))(q)).toEqual({ plan: 4, fact: 2 });
  });
});

describe('recalcTotalsByBudget (извлечено из useFilteredData §9c)', () => {
  const f = makeBudgetPlanFact(new Set(['fb']));
  const base = {
    budgetPlanFact: f, useMonthLevel: false, activeMonths: new Set<number>(),
    hasActiveMonths: false, coveredQuarters: [] as string[], periodKey: 'q1',
  };

  it('quarter-ветвь: суммирует бюджет-поля активного квартала', () => {
    const depts = [{ quarters: { q1: q } }, { quarters: { q1: q } }];
    expect(recalcTotalsByBudget(depts, base)).toEqual({ totalPlan: 12, totalFact: 6 });
  });

  it('_subFiltered-ветвь: суммирует все 4 квартала оверрайднутого депта', () => {
    const depts = [{ _subFiltered: true, quarters: { q1: q, q2: q } }];
    expect(recalcTotalsByBudget(depts, base)).toEqual({ totalPlan: 12, totalFact: 6 });
  });

  it('month-ветвь: суммирует выбранные месяцы', () => {
    const depts = [{ months: { 1: q, 2: q } }];
    expect(recalcTotalsByBudget(depts, {
      ...base, useMonthLevel: true, hasActiveMonths: true, activeMonths: new Set([1]),
    })).toEqual({ totalPlan: 6, totalFact: 3 });
  });
});
