import { describe, expect, it } from 'vitest';
import type { LimitComparisonResponse } from '@aemr/shared';
import { conditionalEpProjection } from './scatter-scenario';

const sample: LimitComparisonResponse = {
  sourceSnapshotId: 'frozen', points: [], total: 2, departments: ['uer'],
  unreadDepartments: [], coverage: {
    expectedDepartments: ['УЭР'], readDepartments: ['УЭР'],
    unreadDepartments: [], complete: true,
  },
  truncated: false, pointLimit: 2500, asOf: '2026-10-19',
  basis: 'plan_K_vs_recorded_fact_Y', unit: 'thousand_rubles',
  excluded: { invalidAmount: 0, invalidDate: 0, futureFact: 0, unknownMethod: 0 },
  summary: {
    count: 2, limitTotal: 3200, contractTotal: 2500,
    approvedEconomy: -30, limitReductionPercent: 21.875,
  },
};
const base = {
  scatter: sample, epPlan: 10000, epHasData: true,
  dashboardLoading: false, yearMatches: true, activityAligned: true,
  budgetAligned: true, searchAligned: true, institutionAligned: true,
};

describe('C04.03 arithmetic scenario (never approved AD economy)', () => {
  it('uses full weighted K/Y ratio, not average of displayed points or AD amount', () => {
    expect(conditionalEpProjection(base)).toBe(2187.5); // 10000 × (3200−2500)/3200
    expect(conditionalEpProjection({ ...base, scatter: {
      ...sample, truncated: true, points: [],
    } })).toBe(2187.5); // 2500-point display limit is not the aggregate limit
  });

  it('never invents a comparison when activity, year, completeness or EP volume differ', () => {
    expect(conditionalEpProjection({ ...base, activityAligned: false })).toBeNull();
    expect(conditionalEpProjection({ ...base, budgetAligned: false })).toBeNull();
    expect(conditionalEpProjection({ ...base, searchAligned: false })).toBeNull();
    expect(conditionalEpProjection({ ...base, institutionAligned: false })).toBeNull();
    expect(conditionalEpProjection({ ...base, yearMatches: false })).toBeNull();
    expect(conditionalEpProjection({ ...base, dashboardLoading: true })).toBeNull();
    expect(conditionalEpProjection({ ...base, epHasData: false })).toBeNull();
    expect(conditionalEpProjection({ ...base, epPlan: Number.NaN })).toBeNull();
    expect(conditionalEpProjection({ ...base, scatter: { ...sample, coverage: {
      ...sample.coverage, complete: false,
    } } })).toBeNull();
  });

  it('treats missing or zero base as unavailable, rather than money or savings', () => {
    expect(conditionalEpProjection({ ...base, scatter: null })).toBeNull();
    expect(conditionalEpProjection({ ...base, scatter: { ...sample, summary: {
      ...sample.summary, count: 0, limitReductionPercent: null,
    } } })).toBeNull();
    expect(conditionalEpProjection({ ...base, scatter: { ...sample, summary: {
      ...sample.summary, limitReductionPercent: Number.NaN,
    } } })).toBeNull();
  });
});
