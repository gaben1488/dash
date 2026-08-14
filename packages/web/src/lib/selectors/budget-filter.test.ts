import { describe, expect, it } from 'vitest';
import { makeBudgetPlanFact, recalcTotalsByBudget } from './budget-filter';
import { resolvePeriodSelection } from './period-resolution';
import type { PeriodScope } from '../../store';

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

  /** Опции из тех же полей, что в useFilteredData (resolution согласована). */
  function makeOpts(periodKey: PeriodScope, activeMonths = new Set<number>(), hasMonthData = false) {
    const resolution = resolvePeriodSelection(periodKey, activeMonths, hasMonthData);
    return {
      budgetPlanFact: f,
      useMonthLevel: resolution.useMonthLevel,
      activeMonths,
      hasActiveMonths: resolution.hasActiveMonths,
      coveredQuarters: resolution.coveredQuarters,
      periodKey: resolution.periodKey,
      resolution,
      hasMonthData,
    };
  }

  it('quarter-ветвь: суммирует бюджет-поля активного квартала', () => {
    const depts = [{ quarters: { q1: q } }, { quarters: { q1: q } }];
    expect(recalcTotalsByBudget(depts, makeOpts('q1'))).toEqual({ totalPlan: 12, totalFact: 6 });
  });

  it('_subFiltered при выборе года: суммирует все 4 квартала оверрайднутого депта', () => {
    const depts = [{ _subFiltered: true, quarters: { q1: q, q2: q } }];
    expect(recalcTotalsByBudget(depts, makeOpts('year'))).toEqual({ totalPlan: 12, totalFact: 6 });
  });

  it('_subFiltered + квартал: бюджет режется периодом, а не суммой года (баг #4)', () => {
    // До правки ветвь суммировала все 4 квартала независимо от periodKey:
    // под заголовком «I квартал» стоял год.
    const depts = [{ _subFiltered: true, quarters: { q1: q, q2: q } }];
    expect(recalcTotalsByBudget(depts, makeOpts('q1'))).toEqual({ totalPlan: 6, totalFact: 3 });
  });

  it('month-ветвь: суммирует выбранные месяцы', () => {
    const depts = [{ months: { 1: q, 2: q } }];
    expect(recalcTotalsByBudget(depts, makeOpts('q1', new Set([1]), true)))
      .toEqual({ totalPlan: 6, totalFact: 3 });
  });

  it('_subFiltered + месяц: бюджет из месячной разбивки подведов (баг #4)', () => {
    const depts = [{ _subFiltered: true, quarters: { q1: q, q2: q }, months: { 1: q, 2: q } }];
    expect(recalcTotalsByBudget(depts, makeOpts('q1', new Set([1]), true)))
      .toEqual({ totalPlan: 6, totalFact: 3 });
  });
});
