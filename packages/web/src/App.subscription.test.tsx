// @vitest-environment jsdom
import { Profiler, type ProfilerOnRenderCallback, type ReactNode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const probe = vi.hoisted(() => ({ dashboardRenders: 0 }));
import { useStore } from './store';
import { App } from './App';

vi.mock('./components/ThemeProvider', () => ({
  useThemeInit: () => undefined,
  pageDawnStyle: () => ({}),
}));
vi.mock('./hooks/useUrlSync', () => ({ useUrlSync: () => undefined }));
vi.mock('./components/Header', () => ({ Header: () => <div>Header fixture</div> }));
vi.mock('./components/OrgStrip', () => ({ OrgStrip: () => <div>Org fixture</div> }));
vi.mock('./components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('./components/ui/kb-tooltip', () => ({ setKBRegistry: () => undefined }));
vi.mock('./components/SourceCoverageNotice', () => ({ SourceCoverageNotice: () => null }));
vi.mock('./components/live/LiveUpdateBar', () => ({
  LiveUpdateBar: () => null,
  SnapshotFreshnessNotice: ({ snapshot }: { snapshot?: { id: string } }) => <span data-testid="snapshot-notice">{snapshot?.id ?? 'missing'}</span>,
}));
vi.mock('./pages/Dashboard', () => ({ Dashboard: () => { probe.dashboardRenders++; return <div>Dashboard fixture</div>; } }));
vi.mock('./pages/lazy-pages', () => ({
  EconomyPage: () => <div>Economy fixture</div>,
  PageSkeleton: () => null,
}));

const previous = useStore.getState();
beforeEach(() => {
  probe.dashboardRenders = 0;
  useStore.setState({ page: 'dashboard', year: 2026, dashboardData: null,
    fetchDashboard: vi.fn(async () => true), fetchSubordinates: vi.fn(async () => undefined) });
});
afterEach(() => { cleanup(); useStore.setState(previous); vi.restoreAllMocks(); });

it('does not rerender the product root for unrelated store changes while preserving page and year routing', () => {
  let commits = 0;
  const onRender: ProfilerOnRenderCallback = () => { commits++; };
  render(<Profiler id="App" onRender={onRender}><App /></Profiler>);
  expect(screen.getByText('Dashboard fixture')).toBeTruthy();
  const initial = commits;
  act(() => useStore.setState({ selectedBudgets: new Set(['fb']) }));
  expect(commits).toBe(initial);
  act(() => useStore.setState({ page: 'economy' }));
  expect(commits).toBeGreaterThan(initial);
  expect(screen.getByText('Economy fixture')).toBeTruthy();

  const fetchDashboard = useStore.getState().fetchDashboard as ReturnType<typeof vi.fn>;
  const earlierCalls = fetchDashboard.mock.calls.length;
  act(() => useStore.setState({ year: 2025 }));
  expect(fetchDashboard.mock.calls.length).toBe(earlierCalls + 1);
});


it('a new snapshot updates its notices without rerendering an unchanged active page', () => {
  render(<App />);
  expect(screen.getByTestId('snapshot-notice').textContent).toBe('missing');
  const beforePageRenders = probe.dashboardRenders;
  const data = { snapshot: { id: 'synthetic-new', metadata: {} } } as unknown as
    NonNullable<ReturnType<typeof useStore.getState>['dashboardData']>;
  act(() => useStore.setState({ dashboardData: data }));
  expect(screen.getByTestId('snapshot-notice').textContent).toBe('synthetic-new');
  expect(probe.dashboardRenders).toBe(beforePageRenders);
});
