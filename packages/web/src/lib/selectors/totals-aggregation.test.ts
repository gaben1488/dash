import { describe, expect, it } from 'vitest';
import type { PeriodResolution } from './period-resolution';
import { aggregateTotals } from './totals-aggregation';

const yearResolution: PeriodResolution = {
  periodKey: 'year', coveredQuarters: [], fullQuarters: [], partialMonths: [],
  useMonthLevel: false, hasActiveMonths: false,
};
const q1Resolution: PeriodResolution = { ...yearResolution, periodKey: 'q1' };
const noOpts = { showKP: true, showEP: true, activeMonths: new Set<number>(), hasMonthData: false };

const dept = {
  department: { id: 'uer' },
  planTotal: 500, factTotal: 250, competitiveCount: 10, soleCount: 4,
  quarters: {
    q1: {
      kpCount: 2, epCount: 1,
      kpPlanTotal: 100, kpFactTotal: 50, epPlanTotal: 40, epFactTotal: 10,
      planCount: 5, factCount: 2, planTotal: 140, factTotal: 60,
    },
  },
  months: {
    1: { kpCount: 1, epCount: 0, planCount: 2, factCount: 1, kpPlanTotal: 30, kpFactTotal: 15 },
  },
};

describe('aggregateTotals (извлечено из useFilteredData §8, выживший §3.4)', () => {
  it('фильтров нет (год, без месяцев) — годовой фолбэк на депт-уровень', () => {
    const t = aggregateTotals([dept], yearResolution, noOpts);
    expect(t.totalKP).toBe(10);
    expect(t.totalEP).toBe(4);
    expect(t.totalPlan).toBe(500);
    expect(t.totalFact).toBe(250);
    expect(t.totalPlanCount).toBe(0); // quarters.year нет — счётчики не суммируются
  });

  it('квартал с КП/ЕП-разбивкой — суммирует разбивку, не общий тотал', () => {
    const t = aggregateTotals([dept], q1Resolution, noOpts);
    expect(t.totalKP).toBe(2);
    expect(t.totalEP).toBe(1);
    expect(t.totalPlan).toBe(140); // kpPlan 100 + epPlan 40
    expect(t.totalFact).toBe(60);
    expect(t.totalPlanCount).toBe(5);
    expect(t.totalFactCount).toBe(2);
  });

  it('выбран только ЕП — КП-слагаемые исключены', () => {
    const t = aggregateTotals([dept], q1Resolution, { ...noOpts, showKP: false });
    expect(t.totalKP).toBe(0);
    expect(t.totalEP).toBe(1);
    expect(t.totalPlan).toBe(40);
    expect(t.totalFact).toBe(10);
  });

  it('подвед-оверрайд (_subFiltered) — короткое замыкание на депт-значениях', () => {
    const sub = {
      _subFiltered: true, competitiveCount: 3, soleCount: 2, planTotal: 70, factTotal: 30,
      quarters: { q1: { planCount: 4, factCount: 2 } },
    };
    const t = aggregateTotals([sub], q1Resolution, noOpts);
    expect(t).toEqual({
      totalKP: 3, totalEP: 2, totalPlan: 70, totalFact: 30,
      totalPlanCount: 4, totalFactCount: 2,
    });
  });

  it('чистый month-level: суммирует выбранные месяцы по разбивке', () => {
    const r: PeriodResolution = {
      periodKey: 'q1', coveredQuarters: ['q1'], fullQuarters: [], partialMonths: [1],
      useMonthLevel: true, hasActiveMonths: true,
    };
    const t = aggregateTotals([dept], r, { ...noOpts, activeMonths: new Set([1]), hasMonthData: true });
    expect(t.totalKP).toBe(1);
    expect(t.totalPlan).toBe(30);
    expect(t.totalFact).toBe(15);
    expect(t.totalPlanCount).toBe(2);
  });

  it('смешанный выбор: полный квартал quarter-level + частичный месяц month-level', () => {
    const r: PeriodResolution = {
      periodKey: 'year', coveredQuarters: ['q1', 'q3'], fullQuarters: ['q1'], partialMonths: [7],
      useMonthLevel: true, hasActiveMonths: true,
    };
    const d = {
      ...dept,
      months: { 7: { kpCount: 2, epCount: 1, planCount: 3, factCount: 1, planTotal: 20, factTotal: 10 } },
    };
    const t = aggregateTotals([d], r, { ...noOpts, activeMonths: new Set([1, 2, 3, 7]), hasMonthData: true });
    // месяц 7 без КП/ЕП-разбивки → общий тотал 20/10; q1 по разбивке 140/60
    expect(t.totalPlan).toBe(160);
    expect(t.totalFact).toBe(70);
    expect(t.totalKP).toBe(4); // 2 (месяц) + 2 (квартал)
    expect(t.totalEP).toBe(2);
    expect(t.totalPlanCount).toBe(8); // 3 + 5
  });
});
