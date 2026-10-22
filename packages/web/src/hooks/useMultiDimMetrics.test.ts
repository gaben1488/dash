import { describe, expect, it } from 'vitest';
import { buildMultiDimMetricsFromFilteredData, type FilteredDataResult } from './useMultiDimMetrics';
import { resolvePeriodSelection } from '../lib/selectors/period-resolution';

describe('buildMultiDimMetricsFromFilteredData', () => {
  it.each(['activity', 'method'] as const)('считает подтверждённый разрез %s одинаково для частей и итога', (axis) => {
    const zero = { plan: 0, fact: 0, planSum: 0, factSum: 0,
      planFB: 0, planKB: 0, planMB: 0, factFB: 0, factKB: 0, factMB: 0,
      economyTotal: 0, economyFB: 0, economyKB: 0, economyMB: 0 };
    const competitive = { ...zero, plan: 1, fact: 1, planSum: 200, factSum: 50,
      planFB: 200, factFB: 50, economyTotal: 7, economyFB: 7 };
    const ep = { ...zero, plan: 3, fact: 2, planSum: 300, factSum: 240,
      planKB: 300, factKB: 240, economyTotal: 11, economyKB: 11 };
    const byActivity = { year: {
      program: { planCount: 1, factCount: 1, byMethod: { competitive, ep: zero } },
      current_non_program: { planCount: 3, factCount: 2, byMethod: { competitive: zero, ep } },
    } };
    const node = { planTotal: 500, factTotal: 290, planCount: 4, factCount: 3,
      economyTotal: 18, planFB: 200, planKB: 300, factFB: 50, factKB: 240,
      economyFB: 7, economyKB: 11, competitiveCount: 1, soleCount: 3 };
    const activity = axis === 'activity';
    const result = buildMultiDimMetricsFromFilteredData({
      depts: [{ ...node, byActivity, department: { id: 'uo', nameShort: 'УО' },
        subordinates: [{ ...node, name: 'Школа', activityByPeriod: byActivity }] }],
      selectedActivities: new Set(activity ? ['program'] : []),
      periodResolution: resolvePeriodSelection('year', new Set(), false),
      nodeAggregateOpts: { showKP: activity, showEP: true, activeMonths: new Set(), hasMonthData: false },
      selectedBudgets: new Set(), deptCardOverrides: {}, barData: [], execCountPctByDeptId: {},
      periodKey: 'year', totalPlan: activity ? 200 : 300, totalFact: activity ? 50 : 240,
      totalPlanCount: activity ? 1 : 4, totalFactCount: activity ? 1 : 3,
      overallExecCountPct: activity ? 100 : 75, totalKP: activity ? 1 : 0, totalEP: activity ? 0 : 3,
    } as unknown as FilteredDataResult);
    for (const metrics of [result.departments[0].total, result.allSubs[0].metrics, result.totals]) {
      expect(metrics).toMatchObject({ planTotal: activity ? 200 : 300, factTotal: activity ? 50 : 240,
        executionPct: activity ? 25 : 80, economyTotal: activity ? 7 : 11,
        competitiveCount: activity ? 1 : 0, epCount: activity ? 0 : 3,
        planCount: activity ? 1 : 4, factCount: activity ? 1 : 3 });
    }
  });

  it.each([
    ['fb', 200, 50, 25, 7],
    ['kb', 300, 240, 80, 11],
    ['mb', 0, 0, null, 0],
  ] as const)('применяет бюджет %s к суммам и процентам управления и подведа',
    (budget, plan, fact, pct, economy) => {
      const quarter = {
        planTotal: 500, factTotal: 290, planCount: 4, factCount: 3,
        planFB: 200, factFB: 50, planKB: 300, factKB: 240, planMB: 0, factMB: 0,
        economyTotal: 18, economyFB: 7, economyKB: 11, economyMB: 0,
      };
      const node = { ...quarter, quarters: { q1: quarter } };
      const result = buildMultiDimMetricsFromFilteredData({
        depts: [{ ...node, department: { id: 'uo', nameShort: 'УО' },
          subordinates: [{ ...node, name: 'Школа' }] }],
        selectedBudgets: new Set([budget]), deptCardOverrides: {},
        barData: [], execCountPctByDeptId: {}, periodKey: 'year',
        totalPlan: plan, totalFact: fact, totalPlanCount: 4, totalFactCount: 3,
        overallExecCountPct: 75, totalKP: 4, totalEP: 0,
      } as unknown as FilteredDataResult);
      for (const metrics of [result.departments[0].total, result.allSubs[0].metrics]) {
        expect(metrics).toMatchObject({
          planTotal: plan, factTotal: fact, executionPct: pct, economyTotal: economy,
          planCount: 4, factCount: 3, execCountPct: 75,
        });
      }
      expect(result.departments[0].total.economyTotal).toBe(result.totals.economyTotal);
    });

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
