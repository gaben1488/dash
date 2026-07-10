import { describe, expect, it } from 'vitest';
import { AVAILABLE_YEARS, getActiveFilterCount, hasExplicitPeriodFilter, useStore } from './store';

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

describe('useStore setYear (B-5: activeMonths must track the newly selected year)', () => {
  it('syncs activeMonths from monthsByYear[target] like toggleMonthInYear/toggleQuarterInYear/toggleYearFull, instead of leaving stale months from the previously selected year', () => {
    useStore.getState().resetAllFilters();
    const [yearA, yearB] = AVAILABLE_YEARS;

    // User explicitly selects March in yearA (e.g. clicking a month in TimeDrum).
    useStore.getState().toggleMonthInYear(yearA, 3);
    expect(useStore.getState().year).toBe(yearA);
    expect(useStore.getState().activeMonths).toEqual(new Set([3]));

    // User scrolls the TimeDrum year wheel to yearB (Header.tsx's only setYear call site).
    // yearB has no explicit month selection of its own.
    useStore.getState().setYear(yearB);

    const state = useStore.getState();
    expect(state.year).toBe(yearB);
    // activeMonths must reflect yearB's own selection (empty), not stay stuck on yearA's March —
    // otherwise useFilteredData keeps filtering yearB's data down to month 3 while the TimeDrum
    // UI (which reads monthsByYear[yr] per year) shows no month highlighted for yearB.
    expect(state.activeMonths).toEqual(state.monthsByYear[yearB] ?? new Set());
  });
});

describe('useStore changeWindow (история изменений)', () => {
  it('по умолчанию выключено, дата в формате YYYY-MM-DD', () => {
    const cw = useStore.getState().changeWindow;
    expect(cw.enabled).toBe(false);
    expect(cw.sinceISO).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('setChangeWindow мержит частично', () => {
    useStore.getState().setChangeWindow({ enabled: true });
    expect(useStore.getState().changeWindow.enabled).toBe(true);
    expect(useStore.getState().changeWindow.sinceISO).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    useStore.getState().setChangeWindow({ sinceISO: '2026-05-29' });
    expect(useStore.getState().changeWindow).toEqual({ enabled: true, sinceISO: '2026-05-29' });
  });
});
