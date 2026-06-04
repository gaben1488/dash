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
