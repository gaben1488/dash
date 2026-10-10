/**
 * Contract-level tests: the portfolio is a read model over independent
 * sources. It never asserts a complete/atomic release or treats reader failure
 * as a zero of errors. No live Google requests or source writes.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSnapshot: vi.fn(async () => ({
    id: 'snap-1', createdAt: '2026-10-10T12:00:00.000Z',
    issues: [], deltas: [{ metricKey: 'plan', officialValue: null, calculatedValue: 9,
      withinTolerance: false }],
  })),
  getMonitoringBook: vi.fn(async () => ({ readAt: '2026-10-10T12:00:00.000Z', sheets: {}, failed: {} })),
  buildTextHygieneResponse: vi.fn(async () => ({
    asOf: '2026-10-10T12:00:00.000Z', rowsSource: 'none',
    booksChecked: [], booksSilent: ['УО', 'УИО'],
    totals: { cellsChecked: 0, hygieneFindings: 0, languageFindings: 0 },
  })),
  buildWorkloadResponse: vi.fn(async () => ({
    asOf: '2026-10-10T12:00:00.000Z', booksTotal: 2,
    booksMeasured: 0, booksSilent: ['УО', 'УИО'],
    events: { added: 0, cleared: 0, edits: 0 },
  })),
}));

vi.mock('../services/snapshot.js', () => ({ getSnapshot: mocks.getSnapshot }));
vi.mock('../services/issue-status-overlay.js', () => ({
  overlayPersistedIssueStatus: (issues: unknown[]) => issues,
}));
vi.mock('../services/source-refresh.js', () => ({
  formulaDeliveryState: () => ({ sinkConnected: false, books: [] }),
}));
vi.mock('../services/formula-sink.js', () => ({
  formulaVerdicts: () => [],
}));
vi.mock('../config.js', () => ({
  DEPARTMENT_SPREADSHEETS: { 'УО': 'uo', 'УИО': 'uio' },
}));
vi.mock('./integrity.js', () => ({
  buildIntegrityResponse: () => ({
    asOf: '2026-10-10T12:00:00.000Z',
    books: [
      { dept: 'УО', rowsAvailable: false, sequence: null, dateFormat: [] },
      { dept: 'УИО', rowsAvailable: false, sequence: null, dateFormat: [] },
    ],
    totals: { duplicates: 0, gapCount: 0, countableWithoutSeq: 0, dateFormat: 0 },
    comparison: null,
  }),
}));
vi.mock('./text-hygiene.js', () => ({
  buildTextHygieneResponse: mocks.buildTextHygieneResponse,
}));
vi.mock('./workload.js', () => ({
  buildWorkloadResponse: mocks.buildWorkloadResponse,
}));
vi.mock('../services/monitoring.js', () => ({ getMonitoringBook: mocks.getMonitoringBook }));
vi.mock('../services/monitoring-parsed.js', () => ({
  parsedMonitoringBook: () => { throw new Error('Should not parse unavailable monitoring master'); },
}));
vi.mock('../services/monitoring-diagnostics.js', () => ({
  monitoringFormulaDiagnostics: () => { throw new Error('Should not check unread master'); },
  queueDriftSignals: () => [],
}));

describe('GET /api/control/portfolio — one view, eight independent sources', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    const { controlPortfolioRoutes } = await import('./control-portfolio.js');
    await app.register(controlPortfolioRoutes);
    await app.ready();
  });

  afterAll(async () => { await app.close(); });

  it('says not checked, not clean, on unavailable input and separate UER authority', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/control/portfolio' });
    expect(response.statusCode).toBe(200);
    const data = response.json() as { channels: Array<{
      id: string; coverage: string; observations: number | null;
      cases: number | null; note: string;
    }>; atomicAcrossSources: boolean; uniqueCrossSourceCasesVerified: boolean };
    expect(data.channels).toHaveLength(8);
    expect(data.atomicAcrossSources).toBe(false);
    expect(data.uniqueCrossSourceCasesVerified).toBe(false);
    for (const id of ['formula_integrity', 'book_integrity', 'text_hygiene', 'procedure_monitoring']) {
      expect(data.channels.find(c => c.id === id)).toMatchObject({
        coverage: 'not_checked', observations: null, cases: null,
      });
    }
    expect(data.channels.find(c => c.id === 'reconciliation')).toMatchObject({
      coverage: 'not_checked', observations: null, cases: null,
    });
    expect(data.channels.find(c => c.id === 'uer_recommendations')).toMatchObject({
      coverage: 'separate_authority', observations: null, cases: null,
    });
  });

  it('isolates a failed external monitoring reader from unrelated sources', async () => {
    mocks.getMonitoringBook.mockRejectedValueOnce(new Error('Google unavailable'));
    const response = await app.inject({ method: 'GET', url: '/api/control/portfolio' });
    expect(response.statusCode).toBe(200);
    const { channels } = response.json() as {
      channels: Array<{ id: string; coverage: string; observations: number | null }>;
    };
    const monitoring = channels.find(c => c.id === 'procedure_monitoring');
    expect(monitoring).toMatchObject({ coverage: 'failed', observations: null });
    expect(channels.find(c => c.id === 'reconciliation')?.coverage).toBe('not_checked');
    expect(channels.find(c => c.id === 'uer_recommendations')?.coverage).toBe('separate_authority');
  });

  it('never sums event counts as verified corrections or employee scores', async () => {
    mocks.buildWorkloadResponse.mockResolvedValueOnce({
      asOf: '2026-10-10T12:00:00.000Z', booksTotal: 2, booksMeasured: 1, booksSilent: ['УИО'],
      events: { added: 4, cleared: 2, edits: 14 },
    });
    const response = await app.inject({ method: 'GET', url: '/api/control/portfolio' });
    expect(response.statusCode).toBe(200);
    const { channels } = response.json() as {
      channels: Array<{ id: string; coverage: string; observations: number | null;
        cases: number | null; note: string }>;
    };
    const workload = channels.find(c => c.id === 'workload_events');
    expect(workload).toMatchObject({
      coverage: 'partial', observations: 20, cases: null,
    });
    expect(workload?.note).toContain('не подтверждённые полезные действия');
  });
});
