import { describe, expect, it } from 'vitest';
import {
  ALL_ACTIVITY_KEYS, activityPeriodKeys, recalcTotalsByActivity, resolveActivityKeys,
  mergeSubordinateActivityPeriods,
} from './activity-aggregation';
import { makeBudgetPlanFact } from './budget-filter';
import { resolvePeriodSelection } from './period-resolution';

const noBudget = makeBudgetPlanFact(new Set());
const metric = (plan: number, fact: number, fb: number, kb = 0) => ({
  plan, fact, planSum: fb + kb, factSum: fb / 2 + kb / 2,
  planFB: fb, planKB: kb, planMB: 0,
  factFB: fb / 2, factKB: kb / 2, factMB: 0,
});

const comp = metric(2, 1, 40, 10);
const ep = metric(1, 1, 8, 2);
const dept = {
  byActivity: {
    q1: {
      program: { planCount: 3, byMethod: { competitive: comp, ep } },
      current_program: { planCount: 1, byMethod: { competitive: metric(0, 0, 0), ep: metric(1, 0, 20) } },
    },
    m1: { program: { planCount: 1, byMethod: {
      competitive: metric(0, 0, 0), ep: metric(1, 1, 8, 2),
    } } },
    m2: { program: { planCount: 2, byMethod: {
      competitive: comp, ep: metric(0, 0, 0),
    } } },
  },
};

describe('разрез деятельности × способа закупки', () => {
  it('пустой выбор означает все виды деятельности', () => {
    expect(resolveActivityKeys(new Set())).toBe(ALL_ACTIVITY_KEYS);
    expect(resolveActivityKeys(new Set(['program']))).toEqual(['program']);
  });
  it('считает реальные конкурентные и ЕП вместо planCount=КП/ЕП=0', () => {
    expect(recalcTotalsByActivity([dept], {
      actKeys: ['program'], periodKeys: ['q1'], budgetPlanFact: noBudget,
    })).toEqual({
      totalPlan: 60, totalFact: 30, totalKP: 2, totalEP: 1,
      planCount: 3, factCount: 2, complete: true,
    });
  });
  it('выбор только ЕП исключает конкурентные деньги и позиции', () => {
    const result = recalcTotalsByActivity([dept], {
      actKeys: ['program'], periodKeys: ['q1'], budgetPlanFact: noBudget,
      showKP: false, showEP: true,
    });
    expect(result).toMatchObject({ totalPlan: 10, totalFact: 5, totalKP: 0, totalEP: 1 });
  });
  it('выбор ФБ применяется к каждому способу, а не к общей неправильной сумме', () => {
    const result = recalcTotalsByActivity([dept], {
      actKeys: ['program'], periodKeys: ['q1'], budgetPlanFact: makeBudgetPlanFact(new Set(['fb'])),
    });
    expect(result).toMatchObject({ totalPlan: 48, totalFact: 24, totalKP: 2, totalEP: 1 });
  });
  it('нельзя складывать весь квартал и выбранный месяц дважды', () => {
    const partial = resolvePeriodSelection('year', new Set([1]), true);
    const full = resolvePeriodSelection('year', new Set([1, 2, 3]), true);
    expect(activityPeriodKeys(partial, true)).toEqual(['m1']);
    expect(activityPeriodKeys(full, true)).toEqual(['q1']);
    const t = recalcTotalsByActivity([dept], {
      actKeys: ['program'], periodKeys: activityPeriodKeys(partial, true), budgetPlanFact: noBudget,
    });
    expect(t).toMatchObject({ totalPlan: 10, totalEP: 1, totalKP: 0 });
  });
  it('устаревший снимок без оси способа НЕ объявляется нулём ЕП', () => {
    const old = { byActivity: { q1: { program: { planCount: 7, planTotal: 100 } } } };
    const t = recalcTotalsByActivity([old], {
      actKeys: ['program'], periodKeys: ['q1'], budgetPlanFact: noBudget,
    });
    expect(t.complete).toBe(false);
    expect(t.totalKP).toBe(0);
    expect(t.totalEP).toBe(0);
  });
  it('суммирует только выбранные подведы без подсоса всего управления', () => {
    const a = { activityByPeriod: { q1: { program: {
      planCount: 2, factCount: 1, planTotal: 50, factTotal: 20,
      byMethod: { competitive: comp, ep: metric(0, 0, 0) },
    } } } };
    const b = { activityByPeriod: { q1: { program: {
      planCount: 1, factCount: 1, planTotal: 10, factTotal: 5,
      byMethod: { competitive: metric(0, 0, 0), ep },
    } } } };
    const d = { byActivity: mergeSubordinateActivityPeriods([a, b]) };
    expect(recalcTotalsByActivity([d], {
      actKeys: ['program'], periodKeys: ['q1'], budgetPlanFact: noBudget,
    })).toMatchObject({ totalKP: 2, totalEP: 1, planCount: 3 });
    expect(mergeSubordinateActivityPeriods([a, {}])).toEqual({});
  });
});
