import { describe, expect, it } from 'vitest';
import { getActiveFilterCount, hasExplicitPeriodFilter, useStore } from './store';

describe('useStore navigation filters', () => {
  it('opens the quality workspace on reconciliation by default', () => {
    expect(useStore.getState().qualityTab).toBe('recon');
  });

  it('syncs navigateTo activity filter into selectedActivities used by useFilteredData', () => {
    useStore.getState().resetAllFilters();

    useStore.getState().navigateTo('analytics', { activity: 'program' });

    expect(useStore.getState().activityFilter).toBe('program');
    expect([...useStore.getState().selectedActivities]).toEqual(['program']);
  });

  it('syncs navigateTo procurement filter into selectedMethods used by useFilteredData', () => {
    useStore.getState().resetAllFilters();

    useStore.getState().navigateTo('analytics', { procurement: 'single' });

    expect(useStore.getState().procurementFilter).toBe('single');
    expect([...useStore.getState().selectedMethods]).toEqual(['single']);
  });

  it('does not count implicit week months as an explicit period filter', () => {
    expect(hasExplicitPeriodFilter('week', new Set([6]), {})).toBe(false);
  });

  it('counts manually selected months as an explicit period filter', () => {
    expect(hasExplicitPeriodFilter('explicit', new Set([4, 5]), {})).toBe(true);
  });

  it('keeps active filter count aligned with explicit period semantics', () => {
    expect(getActiveFilterCount({
      yearChanged: false,
      moneyUnitChanged: false,
      selectedMethods: new Set(),
      selectedActivities: new Set(),
      selectedBudgets: new Set(),
      selectedDepartments: new Set(),
      selectedSubordinates: new Set(),
      activeMonths: new Set([6]),
      monthsByYear: {},
      periodMode: 'week',
      searchQuery: '',
    })).toBe(0);

    expect(getActiveFilterCount({
      yearChanged: false,
      moneyUnitChanged: false,
      selectedMethods: new Set(),
      selectedActivities: new Set(),
      selectedBudgets: new Set(),
      selectedDepartments: new Set(),
      selectedSubordinates: new Set(),
      activeMonths: new Set([6]),
      monthsByYear: {},
      periodMode: 'explicit',
      searchQuery: '',
    })).toBe(1);
  });

  it('marks full-year time drum selection as an explicit period filter', () => {
    useStore.getState().resetAllFilters();

    const year = new Date().getFullYear();
    expect(useStore.getState().periodMode).toBe('week');

    useStore.getState().toggleYearFull(year);

    const state = useStore.getState();
    expect(state.periodMode).toBe('explicit');
    expect(state.monthsByYear[year]?.size).toBe(12);
    expect(hasExplicitPeriodFilter(state.periodMode, state.activeMonths, state.monthsByYear)).toBe(true);
  });
});
