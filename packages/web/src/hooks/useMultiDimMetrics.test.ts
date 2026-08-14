import { describe, expect, it } from 'vitest';
import { buildMultiDimMetricsFromFilteredData, type FilteredDataResult } from './useMultiDimMetrics';

describe('buildMultiDimMetricsFromFilteredData', () => {
  it('uses AD-gated economy totals from calculated department data for global totals', () => {
    const result = buildMultiDimMetricsFromFilteredData({
      depts: [
        {
          department: { id: 'uo', name: 'Управление образования', nameShort: 'УО' },
          planTotal: 600,
          factTotal: 450,
          executionPercent: 75,
          competitiveCount: 3,
          soleCount: 1,
          economyTotal: 25,
          quarters: {
            q1: { planTotal: 300, factTotal: 250, planCount: 3, factCount: 2, economyTotal: 10 },
            q2: { planTotal: 300, factTotal: 200, planCount: 3, factCount: 3, economyTotal: 15 },
          },
        },
        {
          department: { id: 'uer', name: 'Управление экономического развития', nameShort: 'УЭР' },
          planTotal: 400,
          factTotal: 250,
          executionPercent: 62.5,
          competitiveCount: 2,
          soleCount: 0,
          economyTotal: 17,
          quarters: {
            q1: { planTotal: 200, factTotal: 100, planCount: 2, factCount: 1, economyTotal: 7 },
            q2: { planTotal: 200, factTotal: 150, planCount: 2, factCount: 2, economyTotal: 10 },
          },
        },
      ],
      deptCardOverrides: {},
      barData: [],
      execCountPctByDeptId: {},
      periodKey: 'year',
      totalPlan: 1000,
      totalFact: 700,
      totalPlanCount: 10,
      totalFactCount: 8,
      overallExecCountPct: 80,
      totalKP: 5,
      totalEP: 1,
    } as unknown as FilteredDataResult);

    expect(result.totals.economyTotal).toBe(42);
    expect(result.totals.economyPct).toBe(4.2);
    expect(result.totals.economyTotal).not.toBe(300);
    expect(result.quarterSpark.find(q => q.quarter === 'q1')?.economy).toBe(17);
    expect(result.quarterSpark.find(q => q.quarter === 'q2')?.economy).toBe(25);
  });
});

// ── Страж бага #14 (реестр охоты 08.08; интервью пп. 14–16): «Δ кв.» на
// годовом виде сравнивала ПУСТОЙ IV квартал с III — рейтинг всегда показывал
// обвал. Текущий квартал на годовом виде — последний квартал С ФАКТОМ.
describe('Δ кв. на годовом виде (баг #14)', () => {
  const makeFd = (periodKey: string) => ({
    depts: [
      {
        department: { id: 'uo', name: 'УО', nameShort: 'УО' },
        planTotal: 600, factTotal: 450, competitiveCount: 3, soleCount: 1, economyTotal: 25,
        quarters: {
          q1: { planTotal: 200, factTotal: 180, executionPct: 90, economyTotal: 5 },
          q2: { planTotal: 200, factTotal: 160, executionPct: 80, economyTotal: 10 },
          q3: { planTotal: 200, factTotal: 110, executionPct: 55, economyTotal: 10 },
          q4: { planTotal: 0, factTotal: 0, executionPct: 0, economyTotal: 0 }, // будущий квартал: факта нет
        },
      },
    ],
    deptCardOverrides: {},
    barData: [],
    execCountPctByDeptId: {},
    periodKey,
    totalPlan: 600, totalFact: 450, totalPlanCount: 6, totalFactCount: 5,
    overallExecCountPct: 83.3, totalKP: 3, totalEP: 1,
  }) as unknown as FilteredDataResult;

  it('год: сравнивается последний квартал с фактом (q3 против q2), не пустой q4', () => {
    const r = buildMultiDimMetricsFromFilteredData(makeFd('year'));
    expect(r.globalDelta).not.toBeNull();
    // q3 (55%) против q2 (80%): −25, а не q4 (0%) против q3 (обвал −55)
    expect(r.globalDelta!.execPctChange).toBeCloseTo(-25, 5);
    expect(r.departments[0].delta?.execPctChange).toBeCloseTo(-25, 5);
  });

  it('явный выбор квартала уважается как раньше', () => {
    const r = buildMultiDimMetricsFromFilteredData(makeFd('q2'));
    expect(r.globalDelta!.execPctChange).toBeCloseTo(-10, 5); // q2 против q1
  });

  it('факта нет ни в одном квартале — дельта не выдумывается', () => {
    const fd = makeFd('year') as any;
    for (const qk of ['q1', 'q2', 'q3', 'q4']) fd.depts[0].quarters[qk].factTotal = 0;
    const r = buildMultiDimMetricsFromFilteredData(fd);
    expect(r.globalDelta).toBeNull();
    expect(r.departments[0].delta).toBeNull();
  });
});
