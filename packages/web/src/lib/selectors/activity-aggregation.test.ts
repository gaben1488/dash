import { describe, expect, it } from 'vitest';
import { ALL_ACTIVITY_KEYS, recalcTotalsByActivity, resolveActivityKeys } from './activity-aggregation';
import { makeBudgetPlanFact } from './budget-filter';

const noBudget = makeBudgetPlanFact(new Set());
const a = {
  planCount: 3, factCount: 2, planTotal: 60, factTotal: 30,
  byMethod: {
    competitive: { plan: 1, fact: 1, planSum: 40, factSum: 25, planFB: 30, factFB: 20, planKB: 10, factKB: 5, economyTotal: 3, economyFB: 2, economyKB: 1 },
    ep: { plan: 2, fact: 1, planSum: 20, factSum: 5, planFB: 20, factFB: 5, economyTotal: 4, economyFB: 4 },
  },
};
const dept = { byActivity: { q1: { program: a } } };

describe('resolveActivityKeys', () => {
  it('without a selection, all activities are eligible', () => {
    expect(resolveActivityKeys(new Set())).toBe(ALL_ACTIVITY_KEYS);
  });
  it('selected activities are preserved', () => {
    expect(resolveActivityKeys(new Set(['program']))).toEqual(['program']);
  });
});

describe('recalcTotalsByActivity from exact activity × method evidence', () => {
  it('preserves competitive and EP separately in the same activity', () => {
    const t = recalcTotalsByActivity([dept], {
      actKeys: ['program'], periodKeys: ['q1'], budgetPlanFact: noBudget,
      showKP: true, showEP: true,
    });
    expect(t).toMatchObject({
      totalPlan: 60, totalFact: 30, totalEconomy: 7, totalKP: 1, totalEP: 2,
      totalPlanCount: 3, totalFactCount: 2, methodBreakdownAvailable: true,
    });
  });

  it('EP-only does not claim competitive money or counts', () => {
    const t = recalcTotalsByActivity([dept], {
      actKeys: ['program'], periodKeys: ['q1'], budgetPlanFact: noBudget,
      showKP: false, showEP: true,
    });
    expect(t).toMatchObject({
      totalPlan: 20, totalFact: 5, totalEconomy: 4, totalKP: 0, totalEP: 2,
      totalPlanCount: 2, totalFactCount: 1, methodBreakdownAvailable: true,
    });
  });

  it('a selected budget is applied INSIDE the method intersection', () => {
    const t = recalcTotalsByActivity([dept], {
      actKeys: ['program'], periodKeys: ['q1'],
      budgetPlanFact: makeBudgetPlanFact(new Set(['fb'])),
      selectedBudgets: new Set(['fb']),
      showKP: true, showEP: true,
    });
    expect(t).toMatchObject({ totalPlan: 50, totalFact: 25, totalEconomy: 6, totalKP: 1, totalEP: 2 });
  });

  it('a zero selected period is zero and is still comparable', () => {
    const t = recalcTotalsByActivity([dept], {
      actKeys: ['program'], periodKeys: ['q2'], budgetPlanFact: noBudget,
    });
    expect(t.totalPlan).toBe(0);
    expect(t.methodBreakdownAvailable).toBe(true);
  });

  it('does not manufacture competitive purchases from legacy snapshots without method splits', () => {
    const t = recalcTotalsByActivity([{
      byActivity: { q1: { program: { planCount: 3, planTotal: 60, factTotal: 30 } } },
    }], {
      actKeys: ['program'], periodKeys: ['q1'], budgetPlanFact: noBudget,
      showKP: true, showEP: true,
    });
    expect(t).toMatchObject({
      totalPlan: 0, totalKP: 0, totalEP: 0, methodBreakdownAvailable: false,
    });
  });
});
