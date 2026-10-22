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
    metadata: { sheetsRead: ['СВОД ТД-ПМ'], cellsRead: 34, readDurationMs: 1, pipelineDurationMs: 1,
      targetYear: 2026, sourceCoverage: { expectedDepartments: ['УО'], readDepartments: ['УО'], unreadDepartments: [], complete: true } },
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
  it.each([
    { name: 'master zero must survive contradictory official positives', kp: 4, ep: 8, computed: 0, expected: 0 },
    { name: 'master positive with unread official components', kp: undefined, ep: undefined, computed: 7, expected: 7 },
    { name: 'official zero and positive cannot fill missing master result', kp: 0, ep: 7, computed: undefined, expected: null },
    { name: 'two official zeros do not fabricate a computed zero', kp: 0, ep: 0, computed: undefined, expected: null },
    { name: 'no observation in either source', kp: undefined, ep: undefined, computed: undefined, expected: null },
  ])('keeps accepted master economy separate from incomplete official comparison: $name', async ({ kp, ep, computed, expected }) => {
    const previous = fixture.snapshot;
    const base = Object.values(previous.officialMetrics)[0]!;
    const officialMetrics = { ...previous.officialMetrics };
    const calculatedMetrics = { ...previous.calculatedMetrics };
    if (kp !== undefined) {
      const metricKey = 'grbs.uo.economy.kp';
      officialMetrics[metricKey] = { ...base, metricKey, numericValue: kp, value: kp };
    }
    if (ep !== undefined) {
      const metricKey = 'grbs.uo.economy.ep';
      officialMetrics[metricKey] = { ...base, metricKey, numericValue: ep, value: ep };
    }
    if (computed !== undefined) {
      const metricKey = 'grbs.uo.year.economy_total';
      calculatedMetrics[metricKey] = { ...base, metricKey, numericValue: computed, value: computed, origin: 'calculated' };
    }
    fixture.snapshot = { ...previous, officialMetrics, calculatedMetrics };
    try {
      const response = await app.inject('/api/dashboard?year=2026');
      expect(response.statusCode).toBe(200);
      const summary = response.json().departmentSummaries.find(
        (d: { department: { id: string } }) => d.department.id === 'uo',
      );
      expect(summary?.economyTotal).toBe(expected);
    } finally {
      fixture.snapshot = previous;
    }
  });

  it('C04.01 keeps the API year and all quarters on the same calculated master version as the generator', async () => {
    const previous = fixture.snapshot;
    const base = Object.values(previous.officialMetrics)[0]!;
    const materialize = (entries: Record<string, number>) =>
      Object.fromEntries(Object.entries(entries).map(([metricKey, numericValue]) =>
        [metricKey, { ...base, metricKey, numericValue, value: numericValue, origin: 'calculated' as const }]));
    fixture.snapshot = {
      ...previous,
      // Different official numbers must remain available for reconciliation,
      // but must never become the master-derived summary's values.
      officialMetrics: {
        ...previous.officialMetrics,
        'competitive.q1.count': { ...base, metricKey: 'competitive.q1.count', numericValue: 999, value: 999 },
        'competitive.year.count': { ...base, metricKey: 'competitive.year.count', numericValue: 888, value: 888 },
        'grbs.uo.kp.year.total_plan': { ...base, metricKey: 'grbs.uo.kp.year.total_plan', numericValue: 777, value: 777 },
      },
      calculatedMetrics: materialize({
        'competitive.q1.count': 3, 'competitive.q1.fact_count': 2,
        'competitive.q1.total_plan': 120, 'competitive.q1.total_fact': 80,
        'competitive.q1.percent': 2 / 3,
        'sole.q1.count': 1, 'sole.q1.fact_count': 0,
        'sole.q1.total_plan': 40, 'sole.q1.total_fact': 0,
        'competitive.year.count': 8, 'competitive.year.fact_count': 4,
        'competitive.year.total_plan': 300, 'competitive.year.total_fact': 200,
        'competitive.year.percent': 0.5,
        'sole.year.count': 2, 'sole.year.fact_count': 1,
        'sole.year.total_plan': 70, 'sole.year.total_fact': 30,
        'sole.year.percent': 0.5,
        'grbs.uo.year.plan_total': 370, 'grbs.uo.year.fact_total': 230,
        'grbs.uo.year.economy_total': -5, 'grbs.uo.year.execution_pct': 0.35,
        'grbs.uo.year.exec_count_pct': 0.5,
        'grbs.uo.kp.year.count': 8, 'grbs.uo.ep.year.count': 2,
      }),
    };
    try {
      const response = await app.inject('/api/dashboard?year=2026');
      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.summaryByPeriod.q1).toMatchObject({
        kpCount: 3, kpFactCount: 2, kpPlan: 120, kpFact: 80,
        kpPercent: 2 / 3, epCount: 1, epFactCount: 0, source: 'calculated',
      });
      expect(data.summaryByPeriod.year).toMatchObject({
        kpCount: 8, kpFactCount: 4, kpPlan: 300, kpFact: 200,
        kpPercent: 0.5, epCount: 2, epFactCount: 1, source: 'calculated',
      });
      expect(['q1', 'q2', 'q3', 'q4', 'year'].map(p => data.summaryByPeriod[p].source))
        .toEqual(Array(5).fill('calculated'));
      expect(data.departmentSummaries.find((item: { department: { id: string } }) => item.department.id === 'uo'))
        .toMatchObject({
          planTotal: 370, factTotal: 230, economyTotal: -5,
          competitiveCount: 8, soleCount: 2, executionPercent: 35,
        });
      expect(data.snapshot.officialMetrics['competitive.q1.count'].numericValue).toBe(999);
    } finally {
      fixture.snapshot = previous;
    }
  });

  it('C04.01 does not replace absent calculated master values with stale SVOD numbers', async () => {
    const previous = fixture.snapshot;
    const base = Object.values(previous.officialMetrics)[0]!;
    fixture.snapshot = {
      ...previous,
      calculatedMetrics: {},
      officialMetrics: {
        ...previous.officialMetrics,
        'competitive.year.count': { ...base, metricKey: 'competitive.year.count', value: 888, numericValue: 888 },
        'grbs.uo.kp.year.total_plan': { ...base, metricKey: 'grbs.uo.kp.year.total_plan', value: 777, numericValue: 777 },
      },
    };
    try {
      const response = await app.inject('/api/dashboard?year=2026');
      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.summaryByPeriod.year.kpCount).toBeNull();
      expect(data.summaryByPeriod.year.source).toBe('calculated');
      const uo = data.departmentSummaries.find((item: { department: { id: string } }) => item.department.id === 'uo');
      expect(uo.planTotal).toBeNull();
      expect(uo.competitiveCount).toBeNull();
      expect(data.snapshot.officialMetrics['competitive.year.count'].numericValue).toBe(888);
    } finally {
      fixture.snapshot = previous;
    }
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
  it('rejects a missing modern Dashboard axis or calculated budget field without confusing it with null', async () => {
    const response = await app.inject('/api/dashboard?year=2026');
    expect(response.statusCode).toBe(200);
    const data = response.json();
    expect(DashboardDataSchema.safeParse(data).success).toBe(true);
    const department = data.departmentSummaries.find((d: { department: { id: string } }) => d.department.id === 'uo');
    expect(department).toBeDefined();
    for (const field of ['months', 'quarters', 'competitiveCount', 'soleCount', 'trustComponents',
      'signalCounts', 'byActivity', 'subordinates', 'economyConflicts']) {
      const original = department[field];
      Reflect.deleteProperty(department, field);
      expect(DashboardDataSchema.safeParse(data).success).toBe(false);
      department[field] = original;
    }

    // C04.01 now materializes every period from master. Every calculated
    // budget slice is present, even when its observed value is unknown.
    for (const period of ['q1', 'q2', 'year']) {
      const calculated = data.summaryByPeriod[period];
      expect(calculated.source).toBe('calculated');
      for (const field of ['epFbPlan', 'epKbPlan', 'epMbPlan', 'epFbFact', 'epKbFact', 'epMbFact']) {
        const original = calculated[field];
        calculated[field] = null;
        expect(DashboardDataSchema.safeParse(data).success).toBe(true);
        Reflect.deleteProperty(calculated, field);
        expect(DashboardDataSchema.safeParse(data).success).toBe(false);
        calculated[field] = original;
      }
    }
    expect(DashboardDataSchema.safeParse(data).success).toBe(true);
    // Older official payloads remain parseable without a synthetic EP breakdown.
    const originalQ1 = data.summaryByPeriod.q1;
    data.summaryByPeriod.q1 = { ...originalQ1, source: 'official' };
    for (const field of ['epFbPlan', 'epKbPlan', 'epMbPlan', 'epFbFact', 'epKbFact', 'epMbFact']) {
      Reflect.deleteProperty(data.summaryByPeriod.q1, field);
    }
    expect(DashboardDataSchema.safeParse(data).success).toBe(true);
    data.summaryByPeriod.q1 = originalQ1;
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
  it('C04.01 preserves only a validated shared report source revision in the browser DTO', async () => {
    const previous = fixture.snapshot;
    const sourceRevision = 'SRC-' + 'f'.repeat(64);
    fixture.snapshot = { ...previous, metadata: { ...previous.metadata, sourceRevision } };
    try {
      const response = await app.inject('/api/dashboard?year=2026');
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.snapshot.metadata.sourceRevision).toBe(sourceRevision);
      const parsed = DashboardDataSchema.parse(body);
      expect(parsed.snapshot.metadata.sourceRevision).toBe(sourceRevision);

      const altered = structuredClone(body);
      altered.snapshot.metadata.sourceRevision = 'SRC-invalid';
      expect(DashboardDataSchema.safeParse(altered).success).toBe(false);
    } finally {
      fixture.snapshot = previous;
    }
  });

  it('gives release readback the exact active snapshot identity without a second source or full DTO', async () => {
    const response = await app.inject('/api/dashboard?year=2026&identity=1');
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.json()).toEqual({ snapshot: { id: fixture.snapshot.id, createdAt: fixture.snapshot.createdAt } });
    expect(Buffer.byteLength(response.body)).toBeLessThan(200);
    expect(response.body).not.toContain('privateHistory');
    const normal = (await app.inject('/api/dashboard?year=2026')).json();
    expect(normal.snapshot.id).toBe(response.json().snapshot.id);
    expect(normal.snapshot.createdAt).toBe(response.json().snapshot.createdAt);
  });
  it('fails closed for a malformed or forced identity read, without downgrading full dashboard validation', async () => {
    for (const query of ['identity=0', 'identity=1&refresh=true', 'identity=1&year=2026junk',
      'identity=1&compact=1', 'identity=1&unexpected=foo', 'identity=1&identity=1']) {
      expect((await app.inject('/api/dashboard?' + query)).statusCode).toBe(400);
    }
    const previous = fixture.snapshot;
    fixture.snapshot = { ...previous, rowCount: -1 };
    try {
      const response = await app.inject('/api/dashboard?year=2026&identity=1');
      expect(response.statusCode).toBe(500);
      expect(response.json().code).toBe('SNAPSHOT_IDENTITY_INVALID');
    } finally {
      fixture.snapshot = previous;
    }
  });
  it('never signs a stale or still refreshing snapshot as installed runtime evidence', async () => {
    const previous = fixture.snapshot;
    try {
      fixture.snapshot = { ...previous, metadata: {
        ...previous.metadata, readModel: { state: 'refreshing', reason: 'SOURCE_CHANGED' },
      } } as DataSnapshot;
      const pending = await app.inject('/api/dashboard?year=2026&identity=1');
      expect(pending.statusCode).toBe(503);
      expect(pending.json().code).toBe('SNAPSHOT_IDENTITY_NOT_READY');
      fixture.snapshot = { ...previous, metadata: {
        ...previous.metadata, sourceCoverage: { expectedDepartments: ['УО'], readDepartments: [],
          unreadDepartments: [{ department: 'УО', reason: 'Не прочитано' }], complete: false },
      } } as DataSnapshot;
      const incomplete = await app.inject('/api/dashboard?year=2026&identity=1');
      expect(incomplete.statusCode).toBe(503);
      expect(incomplete.json().code).toBe('SNAPSHOT_IDENTITY_NOT_READY');
      fixture.snapshot = { ...previous, metadata: {
        ...previous.metadata, sourceCoverage: undefined,
      } } as DataSnapshot;
      const unknown = await app.inject('/api/dashboard?year=2026&identity=1');
      expect(unknown.statusCode).toBe(503);
      expect(unknown.json().code).toBe('SNAPSHOT_IDENTITY_NOT_READY');
    } finally {
      fixture.snapshot = previous;
    }
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
    expect(data.snapshot.metadata).toMatchObject(fixture.snapshot.metadata);
    expect(data.snapshot.metadata.decisionView).toMatchObject({ basedOnContext: null, revision: expect.any(String) });
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
