// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useStore } from '../store';
import { useFilteredData } from './useFilteredData';

const baseline = useStore.getState();
afterEach(() => { cleanup(); useStore.setState(baseline); });

it('reuses filtered data when only the loading indicator changes, without stale year or department filters', () => {
  act(() => useStore.setState({
    dashboardData: null,
    year: 2026,
    dataYear: 2025,
    loading: false,
    selectedDepartments: new Set<string>(),
    selectedSubordinates: new Set<string>(),
    selectedActivities: new Set<string>(),
    selectedMethods: new Set<string>(),
    selectedBudgets: new Set<string>(),
  }));
  const { result } = renderHook(() => useFilteredData());
  const arrays = { depts: result.current.depts, barData: result.current.barData,
    issues: result.current.issues, topKpis: result.current.topKpis };
  expect(result.current.yearMismatch).toBe(true);
  act(() => useStore.setState({ loading: true }));
  expect(result.current.yearMismatch).toBe(false);
  for (const [field, reference] of Object.entries(arrays)) {
    expect(result.current[field as keyof typeof arrays]).toBe(reference);
  }
  act(() => useStore.setState({ loading: false }));
  expect(result.current.yearMismatch).toBe(true);
  expect(result.current.barData).toBe(arrays.barData);
  act(() => useStore.setState({ selectedDepartments: new Set(['УО']) }));
  expect(result.current.barData).not.toBe(arrays.barData);
  expect(result.current.hasDeptFilter).toBe(true);
});
