// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { DashboardDataSchema, type TrustScore } from '@aemr/shared';
import { api } from '../api';
import { TooltipProvider } from '../components/ui/tooltip';
import { useStore } from '../store';
import { Dashboard } from './Dashboard';

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
