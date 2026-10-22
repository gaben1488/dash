/**
 * C03.01: a scoped summary must never silently reuse the district-wide
 * summary when an organization/search/subordinate selector changes the rows.
 * Legacy snapshots without activity×method facts may show known budget
 * amounts, but must not attribute a department's method totals to a sub.
 */
import { describe, expect, it } from 'vitest';
import { computeFilteredData } from './useFilteredData';

function fixture() {
  const dept = {
    department: { id: 'uo', nameShort: 'УО', name: 'Управление образования' },
    planTotal: 100,
    factTotal: 45,
    competitiveCount: 2,
    soleCount: 1,
    quarters: {
      q1: {
        planCount: 3, factCount: 2, kpCount: 2, epCount: 1,
        kpPlanTotal: 70, epPlanTotal: 30, kpFactTotal: 35, epFactTotal: 10,
        planTotal: 100, factTotal: 45, planFB: 100, factFB: 45,
      },
    },
    subordinates: [{
      name: 'Школа № 1', rowCount: 1, planTotal: 25, factTotal: 10,
      competitiveCount: 1, epCount: 0, economyTotal: 0,
      quarters: {
        q1: {
          planCount: 1, factCount: 1, planTotal: 25, factTotal: 10,
          planFB: 25, factFB: 10, planKB: 0, planMB: 0, factKB: 0, factMB: 0,
        },
      },
      // Real historical reader: no exact activity×method partition.
    }],
  };
  return {
    dashboardData: {
      departmentSummaries: [dept],
      // A district-wide series must not survive a selection that has no rows.
      summaryByPeriod: { q1: { kpCount: 99, epCount: 99, kpPlan: 9900, fbPlan: 9900 } },
      kpiCards: [],
      snapshot: { issues: [], deltas: [] },
    } as any,
    selectedDepartments: new Set<string>(),
    selectedSubordinates: new Set<string>(),
    deptOnlyMode: new Set<string>(),
    subordinatesMap: { 'УО': ['Школа № 1'] },
    period: 'q1' as const,
    activeMonths: new Set<number>(),
    periodMode: 'explicit' as const,
    selectedMethods: new Set<string>(),
    selectedActivities: new Set<string>(),
    selectedBudgets: new Set<string>(),
    activityFilter: 'all' as const,
    searchQuery: '',
    year: 2026,
    dataYear: 2026,
    loading: false,
  };
}

describe('C03.01 — shared organization/search/subordinate perimeter', () => {
  it('stale department selection has zero scoped rows, not the entire district series', () => {
    const fd = computeFilteredData({
      ...fixture(), selectedDepartments: new Set(['nonexistent']),
    });
    expect(fd.depts).toHaveLength(0);
    expect(fd.summaryByPeriod.q1.kpCount).toBe(0);
    expect(fd.summaryByPeriod.q1.fbPlan).toBe(0);
  });

  it('stale subordinate selection does not fall back to district-wide results', () => {
    const fd = computeFilteredData({
      ...fixture(), selectedSubordinates: new Set(['Уже удалённое учреждение']),
    });
    expect(fd.depts).toHaveLength(0);
    expect(fd.summaryByPeriod.q1.kpCount).toBe(0);
    expect(fd.summaryByPeriod.q1.fbPlan).toBe(0);
  });

  it('search with no matches scopes the same summary to zero', () => {
    const fd = computeFilteredData({ ...fixture(), searchQuery: 'нет такого управления' });
    expect(fd.depts).toHaveLength(0);
    expect(fd.summaryByPeriod.q1.kpCount).toBe(0);
  });

  it('legacy subordinate keeps known budget money but does not inherit parent method counts', () => {
    const fd = computeFilteredData({
      ...fixture(), selectedSubordinates: new Set(['Школа № 1']),
    });
    expect(fd.depts).toHaveLength(1);
    expect(fd.totalPlan).toBe(25);
    expect(fd.totalFact).toBe(10);
    expect(fd.summaryByPeriod.q1).toMatchObject({
      source: 'unverified_activity_method',
      fbPlan: 25, fbFact: 10,
      kpCount: null, epCount: null,
      kpPlan: null, epPlan: null,
    });
  });
});
