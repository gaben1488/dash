// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useStore } from '../store';
import { useUrlSync, parseMonthsParam } from './useUrlSync';

beforeEach(() => {
  vi.useFakeTimers();
  useStore.setState(useStore.getInitialState(), true);
  window.history.replaceState(null, '', '/?page=economy&year=2025&period=year&depts=%25D0%25A3%25D0%259E&monitoring=retained#anchor');
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
it('restores page, annual explicit scope and organisations, preserving another module and hash', () => {
  renderHook(useUrlSync);
  expect(useStore.getState().page).toBe('economy');
  expect(useStore.getState().periodMode).toBe('explicit');
  expect([...useStore.getState().selectedDepartments]).toEqual(['УО']);
  act(() => useStore.getState().setPage('data'));
  expect(new URLSearchParams(location.search).get('page')).toBe('data');
  expect(new URLSearchParams(location.search).get('monitoring')).toBe('retained');
  expect(location.hash).toBe('#anchor');
});
it('applies Back/Forward atomically and clears absent filters rather than keeping a later selection', () => {
  renderHook(useUrlSync);
  act(() => {
    useStore.getState().setPage('quality');
    useStore.getState().setSearchQuery('newer input');
    window.history.replaceState(null, '', '/?page=analytics&year=2026&mode=week&week=2026-10-05');
    window.dispatchEvent(new PopStateEvent('popstate'));
    vi.advanceTimersByTime(1000);
  });
  const state = useStore.getState();
  expect(state.page).toBe('analytics');
  expect(state.year).toBe(2026);
  expect(state.periodMode).toBe('week');
  expect(state.focusedWeekStart.getDate()).toBe(5);
  expect(state.selectedDepartments.size).toBe(0);
  expect(state.searchQuery).toBe('');
  expect(state.searchQueryDebounced).toBe('');
  expect(new URLSearchParams(location.search).get('page')).toBe('analytics');
});
it('makes scope changes navigable and restores a multiyear selection on remount', () => {
  const push = vi.spyOn(window.history, 'pushState');
  const { unmount } = renderHook(useUrlSync);
  act(() => {
    useStore.setState({ page: 'quality', qualityTab: 'journal', periodMode: 'explicit',
      monthsByYear: { 2025: new Set([4]), 2026: new Set([1, 2]) }, activeMonths: new Set([4]), year: 2025 });
    vi.advanceTimersByTime(350);
  });
  expect(push).toHaveBeenCalled();
  unmount();
  useStore.setState(useStore.getInitialState(), true);
  renderHook(useUrlSync);
  expect(useStore.getState().page).toBe('quality');
  expect(useStore.getState().qualityTab).toBe('journal');
  expect([...useStore.getState().monthsByYear[2026]]).toEqual([1, 2]);
});
it('does not crash on malformed percent escapes or accept fractional months and numeric prefixes', () => {
  window.history.replaceState(null, '', '/?depts=%25ZZ&year=2025junk');
  expect(() => renderHook(useUrlSync)).not.toThrow();
  expect(useStore.getState().year).toBe(useStore.getInitialState().year);
  expect(parseMonthsParam('2026junk:1;2026:1.5,2', 2026)?.activeMonths).toEqual(new Set([2]));
});

it('restores the independent report context and a frozen Word ID from a shared URL', () => {
  const id = `REL-${'b'.repeat(64)}`;
  const contextKey = 'archive/date=2026-09-30&year=2026&quarter=3';
  const params = new URLSearchParams({ page: 'report', year: '2026', reportMode: 'archive', reportQuarter: '3', word: id, word_ctx: contextKey });
  history.replaceState(null, '', '/?' + params);
  renderHook(useUrlSync);
  expect(useStore.getState().reportMode).toBe('archive');
  expect(useStore.getState().reportQuarter).toBe(3);
  expect(useStore.getState().reportPinned).toEqual({ id, contextKey });
});
