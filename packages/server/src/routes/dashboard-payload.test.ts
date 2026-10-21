import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DashboardDataSchema, type DataSnapshot, type NormalizedMetric } from '@aemr/shared';
import { computeTrustScore } from '@aemr/core';
const fixture = vi.hoisted(() => ({ snapshot: {} as DataSnapshot, failure: null as unknown }));
vi.mock('../config.js', () => ({ config: { database: { url: ':memory:' } }, DEPARTMENT_SPREADSHEETS: {} }));
vi.mock('../services/snapshot.js', () => ({ getSnapshot: async () => { if (fixture.failure) throw fixture.failure; return fixture.snapshot; },
  getDeptSheetCache: () => ({}), getDeptLoadMeta: () => ({}), invalidateCache: vi.fn(), setSvodGridCache: vi.fn() }));
vi.mock('../services/google-sheets.js', () => ({ getSheetData: vi.fn() }));
vi.mock('../services/source-refresh.js', () => ({ refreshAllSources: vi.fn() }));
const app = Fastify({ logger: false });
let saved: string;
let db: typeof import('../db/index.js')['db'];
let schema: typeof import('../db/index.js')['schema'];
const internalFields = ['rowsByDept', 'recalcResults', 'shdyuData', 'unifiedGrid',
  'unifiedReconciliation', 'svodGrid', 'weeklyTableContext'] as const;
beforeAll(async () => {
  ({ db, schema } = await import('../db/index.js'));
  const metric: NormalizedMetric = { metricKey: 'fixture.plan', value: 100, numericValue: 100,
    displayValue: '100', origin: 'official', period: 'annual', unit: 'thousand_rubles',
    sourceSheet: 'СВОД ТД-ПМ', sourceCell: 'K4', formula: '=SUM(H4:J4)', confidence: 1,
    readAt: '2026-10-12T00:00:00Z', warnings: [] };
  const issues = [{ id: 'payload-issue', severity: 'warning' as const, origin: 'bi_heuristic' as const,
    category: 'signal:dataQuality', title: 'Синтетическая проверка', description: 'Проверка контракта', detectedBy: 'fixture', status: 'open' as const,
    detectedAt: metric.readAt, signal: 'dataQuality', departmentId: 'uksimp' }];
  fixture.snapshot = { id: 'payload-snapshot', spreadsheetId: 'fixture-book', createdAt: metric.readAt,
    officialMetrics: { 'fixture.plan': metric }, calculatedMetrics: { 'fixture.calculated': { ...metric, origin: 'calculated' } },
    deltas: [], issues, trust: computeTrustScore(new Map(), issues, [], 'payload-snapshot'), rowCount: 1,
    metadata: { sheetsRead: ['СВОД ТД-ПМ'], cellsRead: 34, readDurationMs: 1, pipelineDurationMs: 1, targetYear: 2026 },
    datasetAnalyses: { uksimp: { marker: 'Используется экраном аналитики' } },
    ...Object.fromEntries(internalFields.map(key => [key, { privateHistory: 'Синтетическая строка'.repeat(10_000) }])) };
  saved = JSON.stringify(fixture.snapshot);
  db.insert(schema.snapshots).values({ id: fixture.snapshot.id, spreadsheetId: fixture.snapshot.spreadsheetId,
    createdAt: fixture.snapshot.createdAt, data: saved }).run();
  const { dashboardRoutes } = await import('./dashboard.js');
  await app.register(dashboardRoutes);
});
afterAll(async () => { await app.close(); });
describe('представление снимка для HTTP Dashboard', () => {
  it.each(['/api/dashboard', '/api/trust/uo', '/api/svod/unified', '/api/reconciliation/quarterly'])('preserves first-start readiness on %s without disguising a source failure', async url => {
    try {
      fixture.failure = Object.assign(new Error('private source'), { code: 'SNAPSHOT_NOT_READY' });
      const pending = await app.inject(url);
      expect(pending.statusCode).toBe(503);
      expect(pending.json().code).toBe('SNAPSHOT_NOT_READY');
      fixture.failure = new Error('private source');
      const failed = await app.inject(url);
      expect(failed.statusCode).toBe(503);
      expect(failed.json().code).not.toBe('SNAPSHOT_NOT_READY');
      expect(failed.body).not.toContain('private source');
    } finally { fixture.failure = null; }
  });
  it('uses canonical position execution for Q2 instead of another money calculation', async () => {
    const previous = fixture.snapshot;
    const base = Object.values(previous.officialMetrics)[0]!;
    const values = { 'competitive.q2.count': 4, 'competitive.q2.fact_count': 1,
      'competitive.q2.total_plan': 100, 'competitive.q2.total_fact': 90,
      'competitive.q2.percent': 0.25, 'sole.q2.count': 0, 'sole.q2.fact_count': 0 };
    fixture.snapshot = { ...previous, calculatedMetrics: Object.fromEntries(Object.entries(values)
      .map(([metricKey, numericValue]) => [metricKey, { ...base, metricKey, numericValue, value: numericValue }])) };
    try {
      const data = (await app.inject('/api/dashboard?year=2026')).json();
      expect(data.summaryByPeriod.q2).toMatchObject({ kpCount: 4, kpFactCount: 1,
        kpPlan: 100, kpFact: 90, kpPercent: 0.25, epCount: 0, epPercent: null });
      expect(data.summaryByPeriod.q2.fbPlan).toBeNull();
    } finally { fixture.snapshot = previous; }
  });
  it('does not publish perfect trust from valid numbers without proof of check coverage', async () => {
    const response = await app.inject('/api/dashboard?year=2026');
    expect(response.statusCode).toBe(200);
    const data = response.json();
    expect(data.trust.overall).toBeNull();
    expect(data.trust.grade).toBeNull();
    for (const name of ['formula_integrity', 'rule_compliance']) {
      expect(data.trust.components.find((c: { name: string }) => c.name === name).score).toBeNull();
    }
    expect(data.snapshot.issues).toEqual(fixture.snapshot.issues);
  });
  it('distinguishes an explicit unknown amount from a missing period field', async () => {
    const data = (await app.inject('/api/dashboard?year=2026')).json();
    const period = data.departmentSummaries[0].quarters.q1;
    period.factTotal = null;
    expect(DashboardDataSchema.safeParse(data).success).toBe(true);
    delete period.factTotal;
    expect(DashboardDataSchema.safeParse(data).success).toBe(false);
  });
  it('does not publish an incomplete snapshot as a successful dashboard response', async () => {
    const previous = fixture.snapshot;
    fixture.snapshot = { ...previous };
    Reflect.deleteProperty(fixture.snapshot, 'rowCount');
    try {
      const response = await app.inject('/api/dashboard?year=2026');
      expect(response.statusCode).toBe(500);
      expect(response.json().code).toBe('DASHBOARD_CONTRACT_INVALID');
      expect(response.json()).not.toHaveProperty('snapshot');
    } finally {
      fixture.snapshot = previous;
    }
  });
  it('does not attribute УДТХ metrics or comparisons to УД in either trust view', async () => {
    const previous = fixture.snapshot;
    const metricKey = 'grbs.udtx.year.plan_total';
    fixture.snapshot = { ...previous, officialMetrics: {
      [metricKey]: { ...Object.values(previous.officialMetrics)[0]!, metricKey },
    }, deltas: [{ metricKey, label: 'УДТХ', officialValue: 100, calculatedValue: 100,
      delta: 0, deltaPercent: 0, withinTolerance: true, explanation: '' }] };
    try {
      const detail = await app.inject('/api/trust/ud');
      expect(detail.statusCode).toBe(200);
      expect(detail.json().deltas).toEqual([]);
      expect(detail.json().trust.overall).toBeNull();
      const dashboard = (await app.inject('/api/dashboard?year=2026')).json();
      expect(dashboard.departmentSummaries.find((d: { department: { id: string } }) => d.department.id === 'ud').trustScore).toBeNull();
      expect((await app.inject('/api/trust/udtx')).json().deltas).toHaveLength(1);
    } finally {
      fixture.snapshot = previous;
    }
  });
  it('rejects malformed or ambiguous year scope instead of serving an unintended dataset', async () => {
    for (const query of ['year=2026junk', 'year=2026.5', 'year=2026&year=2025', 'year=1999', 'year=']) {
      expect((await app.inject('/api/dashboard?' + query)).statusCode).toBe(400);
      expect((await app.inject('/api/svod/unified?' + query)).statusCode).toBe(400);
    }
    expect((await app.inject('/api/dashboard?year=all')).statusCode).toBe(200);
  });
  it('transmits the complete issue set once when the workspace opts into references', async () => {
    const response = await app.inject('/api/dashboard?year=2026&compact=1');
    expect(response.statusCode).toBe(200);
    const data = response.json();
    expect(data.recentIssuesRef).toBe('snapshot.issues');
    expect(data.recentIssues).toEqual([]);
    expect(data.snapshot.issues).toEqual(fixture.snapshot.issues);
    expect(data.issueSummary.total).toBe(fixture.snapshot.issues.length);
  });
  it('не передаёт внутренние таблицы и контексты истории при сохранении контракта экранов', async () => {
    const response = await app.inject('/api/dashboard?year=2026');
    expect(response.statusCode).toBe(200);
    const data = response.json();
    for (const key of internalFields) expect(data.snapshot).not.toHaveProperty(key);
    expect(DashboardDataSchema.safeParse(data).error?.issues ?? []).toEqual([]);
    expect(data.snapshot.id).toBe(fixture.snapshot.id);
    expect(data.snapshot.officialMetrics).toEqual(fixture.snapshot.officialMetrics);
    expect(data.snapshot.calculatedMetrics).toEqual(fixture.snapshot.calculatedMetrics);
    expect(data.snapshot.metadata).toEqual(fixture.snapshot.metadata);
    expect(data.snapshot.datasetAnalyses).toEqual(fixture.snapshot.datasetAnalyses);
    expect(data.snapshot.issues).toEqual(fixture.snapshot.issues);
    expect(data.recentIssues).toEqual(data.snapshot.issues);
    expect(data.signalCounts).toEqual({ dataQuality: 1 });
    expect(data.issueSummary.total).toBe(1);
  });
  it('не изменяет полный исходный или сохранённый исторический снимок', async () => {
    await app.inject('/api/dashboard?year=2026');
    expect(JSON.stringify(fixture.snapshot)).toBe(saved);
    expect(db.select().from(schema.snapshots).all()[0]!.data).toBe(saved);
    for (const key of internalFields) expect(JSON.parse(saved)).toHaveProperty(key);
  });
});
