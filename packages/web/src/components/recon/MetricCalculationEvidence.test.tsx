// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MetricExplanation } from '@aemr/shared';
import { api } from '../../api';
import { MetricCalculationEvidence } from './MetricCalculationEvidence';

vi.mock('../../api', () => ({ api: { getMetric: vi.fn() } }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const evidence: MetricExplanation = {
  status: 'available', evidenceKind: 'reproduced_from_retained_rows',
  snapshotId: 'snapshot-a', asOf: '2026-10-21T00:00:00Z',
  period: 'q1', year: 2026, department: 'uo',
  definition: { key: 'exec_count_pct', label: 'Исполнение по количеству', unit: 'percent' },
  value: 0.5, rows: [{ sheet: 'УО', row: 4 }, { sheet: 'УО', row: 5 }],
  operands: [
    { key: 'fact_count', label: 'Заключено', unit: 'count', value: 1, rows: [{ sheet: 'УО', row: 4 }] },
    { key: 'plan_count', label: 'План', unit: 'count', value: 2, rows: [{ sheet: 'УО', row: 4 }, { sheet: 'УО', row: 5 }] },
  ],
  resultContext: {
    grain: 'department_sheet_row',
    scope: { sourceSheets: ['УО'], department: 'uo', method: null, period: 'q1', year: 2026 },
    dependencies: ['fact_count', 'plan_count'],
    version: { snapshotId: 'snapshot-a', status: 'legacy_without_context',
      calculationContextId: null, semanticsHash: null, sourceContentHash: null, sourceProfilesHash: null },
  },
};

type Detail = Awaited<ReturnType<typeof api.getMetric>>;

describe('metric calculation evidence', () => {
  it('identifies the exact saved period, source rows and missing historical version', async () => {
    vi.mocked(api.getMetric).mockResolvedValue({ explanation: evidence } as Detail);
    render(<MetricCalculationEvidence metricKey="grbs.uo.q1.exec_count_pct"
      snapshotId="snapshot-a" year={2026} />);
    fireEvent.click(screen.getByText('Показать основания расчёта'));
    await waitFor(() => expect(screen.getByTestId('metric-evidence-scope').textContent)
      .toContain('УО'));
    fireEvent.click(screen.getByText('Контекст расчёта и версия правил'));
    expect(screen.getByTestId('metric-evidence-version').textContent).toContain('snapshot-a');
    expect(screen.getByTestId('metric-evidence-version').textContent).toContain('не удостоверен');
    expect(screen.getByText('Строки источников: 2')).toBeTruthy();
  });

  it('never flashes the previous snapshot evidence while a new scope loads', async () => {
    vi.mocked(api.getMetric)
      .mockResolvedValueOnce({ explanation: evidence } as Detail)
      .mockReturnValueOnce(new Promise<Detail>(() => {}));
    const view = render(<MetricCalculationEvidence metricKey="grbs.uo.q1.exec_count_pct"
      snapshotId="snapshot-a" year={2026} />);
    fireEvent.click(screen.getByText('Показать основания расчёта'));
    await waitFor(() => expect(screen.getByTestId('metric-evidence-scope')).toBeTruthy());
    view.rerender(<MetricCalculationEvidence metricKey="grbs.uo.q1.exec_count_pct"
      snapshotId="snapshot-b" year={2026} />);
    expect(screen.queryByTestId('metric-evidence-scope')).toBeNull();
    expect(screen.getByText('Загружаем основания сохранённого расчёта…')).toBeTruthy();
  });
});
