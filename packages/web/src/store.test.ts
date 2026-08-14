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

// ── Страж бага #5 (реестр охоты 08.08; интервью пп. 5, 6): каждая точка
// «период очищен» обязана оставлять activeMonths ПУСТЫМ, как resetAllFilters.
// Раньше туда писались месяцы текущей недели — фильтр, невидимый для чипов
// (hasExplicitPeriodFilter) и URL, молча резал экран до месяца.
describe('сброс периода оставляет пустые месяцы (баг #5)', () => {
  const year = new Date().getFullYear();

  it('clearAllPeriods: пустой Set + week-режим', () => {
    useStore.getState().resetAllFilters();
    useStore.getState().toggleMonthInYear(year, 5);
    useStore.getState().clearAllPeriods();
    const st = useStore.getState();
    expect(st.periodMode).toBe('week');
    expect(st.activeMonths.size).toBe(0);
    expect(Object.keys(st.monthsByYear)).toHaveLength(0);
  });

  it('clearMonths: пустой Set', () => {
    useStore.getState().resetAllFilters();
    useStore.getState().toggleMonth(5);
    useStore.getState().clearMonths();
    expect(useStore.getState().activeMonths.size).toBe(0);
    expect(useStore.getState().periodMode).toBe('week');
  });

  it('toggleMonthInYear: снятие последнего месяца — пустой Set', () => {
    useStore.getState().resetAllFilters();
    useStore.getState().toggleMonthInYear(year, 5);
    useStore.getState().toggleMonthInYear(year, 5);
    expect(useStore.getState().activeMonths.size).toBe(0);
    expect(useStore.getState().periodMode).toBe('week');
  });

  it('toggleQuarterInYear: снятие последнего квартала — пустой Set', () => {
    useStore.getState().resetAllFilters();
    useStore.getState().toggleQuarterInYear(year, 'q2');
    useStore.getState().toggleQuarterInYear(year, 'q2');
    expect(useStore.getState().activeMonths.size).toBe(0);
    expect(useStore.getState().periodMode).toBe('week');
  });

  it('toggleYearFull: снятие полного года — пустой Set', () => {
    useStore.getState().resetAllFilters();
    useStore.getState().toggleYearFull(year);
    useStore.getState().toggleYearFull(year);
    expect(useStore.getState().activeMonths.size).toBe(0);
    expect(useStore.getState().periodMode).toBe('week');
  });

  it('setQuarterMonths: снятие последнего квартала — пустой Set', () => {
    useStore.getState().resetAllFilters();
    useStore.getState().setQuarterMonths('q2');
    useStore.getState().setQuarterMonths('q2');
    expect(useStore.getState().activeMonths.size).toBe(0);
    expect(useStore.getState().periodMode).toBe('week');
  });
});

// ── Стражи багов #5/#13 (реестр охоты 08.08): колесо недель ──
describe('shiftFocusedWeek — визуальная прокрутка, не фильтр', () => {
  it('week-режим: месяцы недели НЕ пишутся в activeMonths (баг #5)', () => {
    useStore.getState().resetAllFilters();
    useStore.getState().shiftFocusedWeek(1);
    useStore.getState().shiftFocusedWeek(-2);
    expect(useStore.getState().activeMonths.size).toBe(0);
  });

  it('explicit-режим: год и месяцы не меняются, данные не перезагружаются (баг #13)', () => {
    useStore.getState().resetAllFilters();
    const [yearA] = AVAILABLE_YEARS;
    useStore.getState().toggleMonthInYear(yearA, 12); // декабрь yearA, explicit
    const before = useStore.getState();
    // Прокрутка недель через границу года не должна дёргать year (перезагрузку)
    for (let i = 0; i < 60; i++) useStore.getState().shiftFocusedWeek(1);
    const after = useStore.getState();
    expect(after.year).toBe(before.year);
    expect(after.activeMonths).toEqual(before.activeMonths);
    expect(after.periodMode).toBe('explicit');
  });

  it('week-режим: год следует за неделей при пересечении границы года', () => {
    useStore.getState().resetAllFilters();
    const start = useStore.getState().focusedWeekStart;
    let guard = 0;
    // крутим, пока не сменится календарный год недели (или упрёмся в границу лет)
    while (useStore.getState().focusedWeekStart.getFullYear() === start.getFullYear() && guard < 60) {
      useStore.getState().shiftFocusedWeek(1);
      guard++;
    }
    const st = useStore.getState();
    if (st.focusedWeekStart.getFullYear() !== start.getFullYear()) {
      expect(st.year).toBe(st.focusedWeekStart.getFullYear());
    }
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
