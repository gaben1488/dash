// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { DashboardDataSchema, DepartmentSummarySchema, type TrustScore } from '@aemr/shared';
import { api } from '../api';
import { TooltipProvider } from '../components/ui/tooltip';
import { useStore } from '../store';
import { Dashboard } from './Dashboard';
import { useFilteredData } from '../hooks/useFilteredData';

const initialState = useStore.getState();
const trust: TrustScore = {
  overall: 78, grade: 'B', computedAt: '2026-10-17T00:00:00Z', basedOnSnapshot: 'synthetic-trust',
  // Order and weights differ from the old hardcoded presentation.
  components: [
    { name: 'operational_risk', label: 'Операционные риски', score: 55, weight: 10 },
    { name: 'mapping_consistency', label: 'Согласованность привязок', score: 64, weight: 14 },
    { name: 'rule_compliance', label: 'Соответствие правилам', score: 73, weight: 20 },
    { name: 'formula_integrity', label: 'Целостность формул', score: 82, weight: 25 },
    { name: 'data_quality', label: 'Качество данных', score: 91, weight: 31 },
  ].map(component => ({ ...component, issues: 0, criticalIssues: 0, details: 'synthetic' })),
};

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(api, 'getSourceIntegrity').mockRejectedValue(new Error('Synthetic fixture does not read sources'));
  const createdAt = '2026-10-17T00:00:00Z';
  useStore.setState({ ...initialState, loading: false, error: null, page: 'dashboard',
    dashboardData: DashboardDataSchema.parse({
      snapshot: { id: 'synthetic-trust', spreadsheetId: 'synthetic', createdAt,
        officialMetrics: {}, calculatedMetrics: {}, deltas: [], issues: [], trust, rowCount: 0,
        metadata: { sheetsRead: [], cellsRead: 0, readDurationMs: 0, pipelineDurationMs: 0 } },
      trust, departmentSummaries: [], kpiCards: [], summaryByPeriod: {}, recentIssues: [], signalCounts: {},
      issueSummary: { total: 0, bySeverity: {}, byCategory: {}, byDepartment: {}, byOrigin: {}, signalCounts: {} },
      lastRefreshed: createdAt, year: 2026,
    }),
  });
});

afterEach(() => { cleanup(); useStore.setState(initialState); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Pulse trust expansion', () => {
  it.each([false, true])('uses API component scores, weights and Control addresses (real zero: %s)', zero => {
    const data = useStore.getState().dashboardData!;
    if (zero) {
      const current: TrustScore = { ...data.trust, overall: 72, grade: 'C',
        components: data.trust.components.map(c => c.name === 'operational_risk' ? { ...c, score: 0 } : c) };
      useStore.setState({ dashboardData: { ...data, trust: current, snapshot: { ...data.snapshot, trust: current } } });
    }
    render(<TooltipProvider><Dashboard /></TooltipProvider>);
    fireEvent.click(screen.getByRole('button', { name: /Доверие к данным/ }));
    const panel = screen.getByRole('region', { name: 'Подробности показателя «Доверие к данным»' });

    for (const component of useStore.getState().dashboardData!.trust.components) {
      const label = component.name === 'mapping_consistency'
        ? 'Согласованность сопоставлений' : component.label;
      const button = within(panel).getByRole('button', {
        name: `${label}: ${component.score} из 100. Открыть замечания этого слагаемого`,
      });
      expect(within(button).getByText(String(component.score))).toBeTruthy();
      expect(button.title).toContain(`вес ${component.weight} %`);
      expect(button.querySelector('[style]')?.getAttribute('style')).toContain(`width: ${component.score}%`);
      fireEvent.click(button);
      expect(useStore.getState().page).toBe('quality');
      expect(useStore.getState().qualityTab).toBe('issues');
      expect(useStore.getState().trustComponentSeed).toEqual({ id: component.name, label });
    }
  });
});

it('selects the Russian department filter from the rating and carries the same quarter to the registry', () => {
  const departments = [['uo', 'УО', 1], ['uer', 'УЭР', 3]] as const;
  const summaries = departments.map(([id, nameShort, scale]) => {
    const q4 = { planTotal: 300_000 * scale, factTotal: 150_000 * scale,
      planCount: 2 * scale, factCount: scale, kpCount: 2 * scale, epCount: 0,
      kpPlanTotal: 300_000 * scale, kpFactTotal: 150_000 * scale,
      epPlanTotal: 0, epFactTotal: 0, economyTotal: 0,
      planFB: 0, planKB: 0, planMB: 300_000 * scale,
      factFB: 0, factKB: 0, factMB: 150_000 * scale,
      economyFB: 0, economyKB: 0, economyMB: 0,
      executionPct: 50, execCountPct: 50, compExecCountPct: 50, epExecCountPct: null,
      kpFactCount: scale, epFactCount: 0 };
    const q1 = { ...q4, planTotal: 5_000_000 * scale, planMB: 5_000_000 * scale,
      factTotal: 0, factMB: 0, factCount: 0, kpFactCount: 0, kpFactTotal: 0,
      kpPlanTotal: 5_000_000 * scale, executionPct: 0, execCountPct: 0, compExecCountPct: 0 };
    return DepartmentSummarySchema.parse({
      department: { id, name: nameShort, nameShort, sheetName: nameShort,
        svodRange: { startRow: 1, endRow: 2 }, controlCells: {} },
      planTotal: q1.planTotal + q4.planTotal, factTotal: q4.factTotal,
      executionPercent: 50, economyTotal: 0, competitiveCount: 2 * scale, soleCount: 0,
      issueCount: 0, criticalIssueCount: 0, trustScore: 90, status: 'normal',
      quarters: { q1, q4 }, subordinates: [],
    });
  });
  const data = useStore.getState().dashboardData!;
  useStore.setState({ year: 2026, period: 'q4', periodMode: 'explicit',
    activeMonths: new Set(), monthsByYear: {},
    dashboardData: { ...data, departmentSummaries: summaries },
  });
  const filtered = renderHook(() => useFilteredData());
  render(<TooltipProvider><Dashboard /></TooltipProvider>);
  expect(filtered.result.current.totalPlan).toBe(1_200_000);
  fireEvent.click(screen.getByRole('button', { name: 'Состав управления УО' }));
  expect(useStore.getState().selectedDepartments.size).toBe(0);
  expect(filtered.result.current.totalPlan).toBe(1_200_000);
  const rating = screen.getByRole('button', { name: 'Состав управления УО' }).closest('table')!;
  fireEvent.click(within(rating).getByRole('button', { name: 'УО' }));
  expect([...useStore.getState().selectedDepartments]).toEqual(['УО']);
  expect(filtered.result.current.totalPlan).toBe(300_000);
  expect(filtered.result.current.totalFact).toBe(150_000);
  expect(filtered.result.current.totalPlanCount).toBe(2);
  expect(screen.getByText('Активные фильтры:').parentElement?.textContent).toContain('УО');
  fireEvent.click(screen.getByRole('button', { name: 'Открыть реестр строк' }));
  expect(useStore.getState().page).toBe('data');
  expect([...useStore.getState().selectedDepartments]).toEqual(['УО']);
  expect(useStore.getState().period).toBe('q4');
  expect(useStore.getState().year).toBe(2026);
});

it('does not fabricate a zero-plan statement when quarterly summary cells are missing', () => {
  render(<TooltipProvider><Dashboard /></TooltipProvider>);
  expect(screen.getByText(/Часть квартальных сумм не прочитана/)).toBeTruthy();
  expect(screen.queryByText(/ни плановых, ни фактических сумм в книгах нет/)).toBeNull();
});

it('does not borrow annual values or create 0% when the selected quarter is incomplete', () => {
  const q4 = {
    planTotal: 1000, factTotal: null, planCount: 2, factCount: null, economyTotal: null,
    planFB: 0, planKB: 0, planMB: 1000, factFB: null, factKB: null, factMB: null,
    economyFB: null, economyKB: null, economyMB: null,
    executionPct: null, execCountPct: null, compExecCountPct: null, epExecCountPct: null,
    kpCount: 2, epCount: 0, kpPlanTotal: 1000, kpFactTotal: null,
    epPlanTotal: 0, epFactTotal: null, kpFactCount: null, epFactCount: null,
  };
  const summary = DepartmentSummarySchema.parse({
    department: { id: 'uo', name: 'УО', nameShort: 'УО', sheetName: 'УО',
      svodRange: { startRow: 1, endRow: 2 }, controlCells: {} },
    planTotal: 1000, factTotal: 500, executionPercent: 50, economyTotal: 250,
    competitiveCount: 2, soleCount: 0, issueCount: 0, criticalIssueCount: 0,
    trustScore: 90, status: 'normal', quarters: { q4, year: { ...q4, economyTotal: 250 } },
    subordinates: [],
  });
  const data = useStore.getState().dashboardData!;
  useStore.setState({
    year: 2026, period: 'q4', periodMode: 'explicit', activeMonths: new Set(), monthsByYear: {},
    dashboardData: { ...data, departmentSummaries: [summary] },
  });

  render(<TooltipProvider><Dashboard /></TooltipProvider>);
  const tiles = screen.getByRole('region', { name: 'Ключевые показатели за выбранный период' });
  fireEvent.click(within(tiles).getByRole('button', { name: /Экономия/ }));
  expect(screen.getByRole('button', { name: 'УО: экономия не подтверждена' })).toBeTruthy();
  fireEvent.click(within(tiles).getByRole('button', { name: /Исполнение/ }));
  expect(screen.getByRole('button', { name: 'УО: факт не прочитан' })).toBeTruthy();
});
