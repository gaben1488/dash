// @vitest-environment jsdom
import { Profiler, type ProfilerOnRenderCallback } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useStore } from '../store';
import { TimeDrum } from './Header';

vi.mock('../hooks/usePeriodCoverage', () => ({
  usePeriodCoverage: () => ({ status: 'ready', index: { weeks: {}, months: {}, years: {} } }),
}));

const original = useStore.getState();
beforeEach(() => useStore.getState().resetAllFilters());
afterEach(() => { cleanup(); useStore.setState(original); });

it('does not re-render the period drum on unrelated data or editor updates', () => {
  let renders = 0;
  const onRender: ProfilerOnRenderCallback = () => { renders++; };
  render(<Profiler id="time-drum" onRender={onRender}><TimeDrum /></Profiler>);
  const before = renders;
  act(() => useStore.setState({
    error: 'unrelated background warning',
    dashboardData: useStore.getState().dashboardData,
  }));
  expect(renders).toBe(before);
  // A real period change must still update the year in focus.
  const nextYear = useStore.getState().year === 2025 ? 2026 : 2025;
  act(() => useStore.setState({ year: nextYear }));
  expect(renders).toBeGreaterThan(before);
  expect(screen.getByRole('button', { name: new RegExp(nextYear + ' год целиком, год в фокусе') })).toBeTruthy();
});
