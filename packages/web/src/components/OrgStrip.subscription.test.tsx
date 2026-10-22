// @vitest-environment jsdom
import { Profiler, type ProfilerOnRenderCallback } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useStore } from '../store';
import { OrgStrip } from './OrgStrip';

vi.mock('./SourceCoverageNotice', () => ({ SourceCoverageNotice: () => null }));
const before = useStore.getState();
beforeEach(() => useStore.setState({
  subordinatesMap: { 'УО': ['Школа № 1'] }, selectedDepartments: new Set(),
  selectedSubordinates: new Set(), deptOnlyMode: new Set(), subordinatesError: null,
}));
afterEach(() => { cleanup(); useStore.setState(before); });

it('does not rebuild organization strip on unrelated store updates, but updates the selected scope', () => {
  let commits = 0;
  const onRender: ProfilerOnRenderCallback = () => { commits++; };
  const view = render(<Profiler id="OrgStrip" onRender={onRender}><OrgStrip /></Profiler>);
  const original = commits;
  act(() => useStore.setState({ moneyUnit: useStore.getState().moneyUnit === 'млн' ? 'тыс' : 'млн' }));
  expect(commits).toBe(original);
  act(() => useStore.setState({ selectedDepartments: new Set(['УО']) }));
  expect(commits).toBeGreaterThan(original);
  expect(view.container.querySelector('aside[data-selective]')).not.toBeNull();
});
