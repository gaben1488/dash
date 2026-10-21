import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEPT_COLUMNS, type Issue, type DataSnapshot, type DepartmentSummary } from '@aemr/shared';

const fixture = vi.hoisted(() => ({ snapshot: {} as DataSnapshot, rows: {} as Record<string, unknown[][]> }));
vi.mock('../config.js', () => ({ config: { database: { url: ':memory:' } }, DEPARTMENT_SPREADSHEETS: {} }));
vi.mock('../services/snapshot.js', () => ({
  getSnapshot: async () => fixture.snapshot,
  getDeptSheetValues: () => fixture.rows,
  getDeptSheetCache: () => ({}), getDeptLoadMeta: () => ({}),
  invalidateCache: vi.fn(), setSvodGridCache: vi.fn(),
}));
vi.mock('../services/google-sheets.js', () => ({ getSheetData: vi.fn() }));
vi.mock('../services/source-refresh.js', () => ({ refreshAllSources: vi.fn() }));
const app = Fastify({ logger: false });
let db: typeof import('../db/index.js')['db'];
let schema: typeof import('../db/index.js')['schema'];
function issue(id: string, departmentId: string): Issue {
  return { id, departmentId, status: 'open', severity: 'critical', origin: 'bi_heuristic',
    title: 'Control fixture', description: '', category: 'signal:dataQuality', group: 'data_quality',
    signal: 'dataQuality', row: 4, detectedAt: '2026-10-12T00:00:00Z', detectedBy: 'fixture' };
}
beforeAll(async () => {
  ({ db, schema } = await import('../db/index.js'));
  const [{ dashboardRoutes }, { auditRoutes }, { analyticsRoutes }, { computeTrustScore }] = await Promise.all([
    import('./dashboard.js'), import('./audit.js'), import('./analytics.js'), import('@aemr/core'),
  ]);
  const issues = [issue('control-fp', 'uksimp'), issue('control-uo', 'uo')];
  fixture.snapshot = { id: 'control-snapshot', spreadsheetId: 'fixture-book', rowCount: 1, createdAt: '2026-10-12T00:00:00Z', issues,
    officialMetrics: {}, calculatedMetrics: {}, deltas: [], metadata: { sheetsRead: [], cellsRead: 0, readDurationMs: 0, pipelineDurationMs: 0 },
    trust: computeTrustScore(new Map(), issues, [], 'control-snapshot'), recalcResults: { uksimp: { totalCompetitive: 1, totalEP: 0, year: { planTotal: 100 }, epSharePct: 0,
      quarters: Object.fromEntries(['q1', 'q2', 'q3', 'q4'].map(q => [q, { executionPct: 0.65, ep: { planSum: 0 } }])) } } } as unknown as DataSnapshot;
  const row = Array<unknown>(34).fill('');
  row[DEPT_COLUMNS.SUBJECT] = 'Control procurement'; row[DEPT_COLUMNS.METHOD] = 'ЭА';
  row[DEPT_COLUMNS.TOTAL_PLAN] = 100;
  fixture.rows = { 'УКСиМП': [[], [], [], row] };
  await app.register(dashboardRoutes); await app.register(auditRoutes); await app.register(analyticsRoutes);
});
beforeEach(() => {
  db.delete(schema.issues).run();
  db.insert(schema.issues).values({ ...fixture.snapshot.issues[0], status: 'false_positive' }).run();
});
afterAll(async () => { await app.close(); });

describe('persisted false-positive decisions across control routes', () => {
  it('keeps the decision in history while excluding it from department risk badges and signals', async () => {
    const response = await app.inject('/api/dashboard');
    expect(response.statusCode).toBe(200);
    const data = response.json();
    const local = data.departmentSummaries.find((d: DepartmentSummary) => d.department.id === 'uksimp');
    const other = data.departmentSummaries.find((d: DepartmentSummary) => d.department.id === 'uo');
    expect(local.criticalIssueCount).toBe(0);
    expect(local.status).toBe('normal');
    expect(local.signalCounts.dataQuality ?? 0).toBe(0);
    expect(other.criticalIssueCount).toBe(1);
    expect(data.signalCounts.dataQuality).toBe(1);
    expect(data.recentIssues.find((i: Issue) => i.id === 'control-fp').status).toBe('false_positive');
    expect(data.issueSummary.total).toBe(2);
    expect(data.issueSummary.bySeverity.critical).toBe(2);
  });

  it('keeps audit history but separates active critical counts', async () => {
    const data = (await app.inject('/api/export/audit')).json();
    expect(data.issues).toHaveLength(2);
    expect(data.snapshot.issuesSummary.critical).toBe(1);
    expect(data.snapshot.issuesSummary.total).toBe(2);
  });

  it('preserves decisions in factual quality without an unconfirmed grade or discipline index', async () => {
    const data = (await app.inject('/api/analytics/scorecard')).json();
    const value = data.uksimp.dataQuality;
    db.delete(schema.issues).run();
    const unreviewed = (await app.inject('/api/analytics/scorecard')).json();
    expect(value - unreviewed.uksimp.dataQuality).toBe(1);
    expect(data.uksimp).toMatchObject({ assessmentStatus: 'unconfirmed_methodology', execPct: 0.65 });
    expect(data.uksimp).not.toHaveProperty('grade');
    expect(data.uksimp).not.toHaveProperty('discipline');
    expect(data.uksimp).not.toHaveProperty('riskLevel');
    expect(fixture.snapshot.issues[0].status).toBe('open');
  });

  it('does not certify data quality when aggregate metrics exist but source rows are unavailable', async () => {
    const rows = fixture.rows;
    fixture.rows = {};
    try {
      const data = (await app.inject('/api/analytics/scorecard')).json();
      expect(data.uksimp.dataQuality).toBeNull();
      expect(data.uksimp.execPct).toBe(0.65);
      expect(data.uksimp).not.toHaveProperty('grade');
    } finally { fixture.rows = rows; }
  });
});

it('использует реальную группу completeness вместо вымышленной data_quality', async () => {
  const original = fixture.snapshot.issues[0];
  fixture.snapshot.issues[0] = { ...original, group: 'completeness', checkId: 'data_quality' };
  try {
    const reviewed = (await app.inject('/api/analytics/scorecard')).json();
    db.delete(schema.issues).run();
    const unreviewed = (await app.inject('/api/analytics/scorecard')).json();
    expect(reviewed.uksimp.dataQuality - unreviewed.uksimp.dataQuality).toBe(1);
  } finally { fixture.snapshot.issues[0] = original; }
});

it('сохраняет header-историю, но не штрафует управление и не добавляет действующий риск', async () => {
  const original = fixture.snapshot.issues[0];
  const header: Issue = { ...original, id: 'historical-header', sheet: 'УКСиМП', row: 1, cell: 'AA1', rowSeq: '1', checkId: 'formula_overwritten', group: 'formula_consistency', signal: 'formulaBroken' };
  fixture.snapshot.issues[0] = header;
  try {
    const dashboard = (await app.inject('/api/dashboard')).json();
    const local = dashboard.departmentSummaries.find((d: DepartmentSummary) => d.department.id === 'uksimp');
    expect(local.criticalIssueCount).toBe(0);
    expect(local.signalCounts.formulaBroken ?? 0).toBe(0);
    expect(dashboard.recentIssues.find((i: Issue) => i.id === header.id).severity).toBe('critical');
    const audit = (await app.inject('/api/export/audit')).json();
    expect(audit.snapshot.issuesSummary.critical).toBe(1);
    expect(audit.issues).toHaveLength(2);
    expect(fixture.snapshot.issues[0]).toBe(header);
  } finally { fixture.snapshot.issues[0] = original; }
});

it('не считает отсутствие финансирования дефектом дисциплины заполнения', async () => {
  const original = fixture.snapshot.issues[0];
  fixture.snapshot.issues[0] = { ...original, category: 'signal:planYearMissing', checkId: 'plan_year_missing', group: 'data_integrity' };
  try {
    const reviewed = (await app.inject('/api/analytics/scorecard')).json();
    db.delete(schema.issues).run();
    const unreviewed = (await app.inject('/api/analytics/scorecard')).json();
    expect(reviewed.uksimp.dataQuality).toBe(unreviewed.uksimp.dataQuality);
  } finally { fixture.snapshot.issues[0] = original; }
});

it('не превращает исторический дефект формулы без checkId в ошибку заполнения', async () => {
  const original = fixture.snapshot.issues[0];
  fixture.snapshot.issues[0] = { ...original, category: 'formula_mutant', checkId: undefined, group: 'formula_consistency', origin: 'spreadsheet_rule' };
  try {
    const reviewed = (await app.inject('/api/analytics/scorecard')).json();
    db.delete(schema.issues).run();
    const unreviewed = (await app.inject('/api/analytics/scorecard')).json();
    expect(reviewed.uksimp.dataQuality).toBe(unreviewed.uksimp.dataQuality);
  } finally { fixture.snapshot.issues[0] = original; }
});
