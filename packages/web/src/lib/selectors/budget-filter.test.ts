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
    expect(f(q)).toEqual({ plan: 10, fact: 5, complete: true });
  });

  it('агрегата нет — не подтверждённые нули не выдаются за факт', () => {
    expect(makeBudgetPlanFact(new Set())(undefined)).toEqual({ plan: 0, fact: 0, complete: false });
    expect(makeBudgetPlanFact(new Set(['fb']))(undefined)).toEqual({ plan: 0, fact: 0, complete: false });
  });

  it('один бюджет — только его поля', () => {
    expect(makeBudgetPlanFact(new Set(['fb']))(q)).toEqual({ plan: 6, fact: 3, complete: true });
  });

  it('C05.02 detects missing selected components without rejecting unselected budgets', () => {
    const fb = makeBudgetPlanFact(new Set(['fb']));
    expect(fb({ planFB: 0, factFB: 0 })).toEqual({ plan: 0, fact: 0, complete: true });
    expect(fb({ planFB: null, factFB: 0 })).toEqual({ plan: 0, fact: 0, complete: false });
    expect(fb({ planFB: 10, factFB: null })).toEqual({ plan: 10, fact: 0, complete: false });
    expect(fb({ planFB: 10, factFB: 3, planKB: null, factKB: null }))
      .toEqual({ plan: 10, fact: 3, complete: true });
    const two = makeBudgetPlanFact(new Set(['fb', 'kb']));
    expect(two({ planFB: 10, factFB: 3, planKB: null, factKB: 0 }).complete).toBe(false);
  });

  it('два бюджета — сумма их полей', () => {
    expect(makeBudgetPlanFact(new Set(['kb', 'mb']))(q)).toEqual({ plan: 4, fact: 2, complete: true });
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

  it('C05.02 marks a missing selected-quarter budget as incomplete', () => {
    const missing = [{ quarters: { q1: { ...q, planFB: null } } }];
    expect(recalcTotalsByBudget(missing, makeOpts('q1')))
      .toMatchObject({ totalPlan: 0, totalFact: 3, complete: false });
    expect(recalcTotalsByBudget([{ quarters: {} }], makeOpts('q1')).complete).toBe(false);
  });

  it('quarter-ветвь: суммирует бюджет-поля активного квартала', () => {
    const depts = [{ quarters: { q1: q } }, { quarters: { q1: q } }];
    expect(recalcTotalsByBudget(depts, makeOpts('q1'))).toEqual({ totalPlan: 12, totalFact: 6, complete: true });
  });

  it('_subFiltered при выборе года: суммирует все 4 квартала оверрайднутого депта', () => {
    const depts = [{ _subFiltered: true, quarters: { q1: q, q2: q } }];
    expect(recalcTotalsByBudget(depts, makeOpts('year'))).toEqual({ totalPlan: 12, totalFact: 6, complete: true });
  });

  it('_subFiltered + квартал: бюджет режется периодом, а не суммой года (баг #4)', () => {
    // До правки ветвь суммировала все 4 квартала независимо от periodKey:
    // под заголовком «I квартал» стоял год.
    const depts = [{ _subFiltered: true, quarters: { q1: q, q2: q } }];
    expect(recalcTotalsByBudget(depts, makeOpts('q1'))).toEqual({ totalPlan: 6, totalFact: 3, complete: true });
  });

  it('month-ветвь: суммирует выбранные месяцы', () => {
    const depts = [{ months: { 1: q, 2: q } }];
    expect(recalcTotalsByBudget(depts, makeOpts('q1', new Set([1]), true)))
      .toEqual({ totalPlan: 6, totalFact: 3, complete: true });
  });

  it('_subFiltered + месяц: бюджет из месячной разбивки подведов (баг #4)', () => {
    const depts = [{ _subFiltered: true, quarters: { q1: q, q2: q }, months: { 1: q, 2: q } }];
    expect(recalcTotalsByBudget(depts, makeOpts('q1', new Set([1]), true)))
      .toEqual({ totalPlan: 6, totalFact: 3, complete: true });
  });
});
