import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

const ORIGINAL_ENV = { ...process.env };

// Сеть замокана «в отказ», а среда явно переведена в ПРОД-режим (GOOGLE_API_KEY
// задан): демо-фолбэк запрещён гейтом isDemoMode, и getSnapshot при сбое чтения
// обязан отдать последний сохранённый снимок из SQL — его сеет сам тест.
vi.mock('../services/google-sheets.js', () => ({
  batchGetCells: vi.fn(async () => { throw new Error('network disabled in test'); }),
  batchGetFormulas: vi.fn(async () => { throw new Error('network disabled in test'); }),
  getSheetData: vi.fn(async () => { throw new Error('network disabled in test'); }),
  getSpreadsheetMetadata: vi.fn(async () => { throw new Error('network disabled in test'); }),
  fetchSHDYUSheet: vi.fn(async () => { throw new Error('network disabled in test'); }),
}));

/**
 * B-4 RED test.
 *
 * Bug A (issues.ts ~line 175): INSERT into schema.issues on the first status
 * change of a not-yet-tracked issue uses snapshotId: 'manual' — a row with
 * id='manual' never exists in `snapshots`, and foreign_keys=ON (db/index.ts:18)
 * means the INSERT fails on the FK constraint. The error is swallowed by a
 * try/catch (only app.log.warn), the issueHistory insert then fails for the
 * same reason (the issue row was never created) and is also swallowed. The
 * response still says success:true even though neither `issues` nor
 * `issue_history` gained a row.
 *
 * Bug B (issues.ts ~line 41/54/66, and the same read pattern at ~105 and
 * ~292): GET /api/issues (and /api/issues/:id, and /api/export/issues) build
 * the list from snapshot.issues, which the pipeline recomputes from scratch on
 * every call and always assigns status:'open' (core/orchestrator.ts:479,621;
 * demo-data.ts likewise hardcodes statuses) — the persisted DB status is never
 * merged in. PUT changes the DB; GET never sees it.
 */
describe('PUT /api/issues/:id/status — persistence integrity (B-4)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      AEMR_API_KEY: '',
      SQLITE_PATH: ':memory:',
      LOG_LEVEL: 'silent',
      // ПРОД-режим явно: ключ задан → isDemoMode=false, демо-фолбэк запрещён.
      // Пустые креды существуют в env → dotenv не подставит машинные из .env.
      GOOGLE_SERVICE_ACCOUNT_EMAIL: '',
      GOOGLE_PRIVATE_KEY: '',
      GOOGLE_API_KEY: 'test-api-key',
      GOOGLE_SHEETS_SPREADSHEET_ID: 'x', // Сохранённая книга и запрошенная область совпадают.
    };
    const { createApp } = await import('../app.js');
    app = await createApp({ logger: false });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it('success:true implies the write actually persisted to issues + issue_history (Bug A)', async () => {
    const { db, schema } = await import('../db/index.js');

    // demo-issue-* отклоняется гейтом фикций (400) ДО какой-либо записи:
    // статусы демо-замечаний не должны оседать в реальной таблице issues.
    const res = await app.inject({
      method: 'PUT',
      url: '/api/issues/demo-issue-002/status',
      payload: { status: 'acknowledged' },
    });
    expect(res.statusCode).toBe(400);

    const body = res.json<{ success?: boolean }>();
    const responseClaimsSuccess = res.statusCode === 200 && body.success === true;

    const persistedIssue = db
      .select()
      .from(schema.issues)
      .where(eq(schema.issues.id, 'demo-issue-002'))
      .get();
    const persistedHistory = db
      .select()
      .from(schema.issueHistory)
      .where(eq(schema.issueHistory.issueId, 'demo-issue-002'))
      .all();

    // Invariant: if the response claims success, the DB must actually confirm it.
    expect(responseClaimsSuccess && !persistedIssue).toBe(false);
    expect(responseClaimsSuccess && persistedHistory.length === 0).toBe(false);
    // Гейт не оставляет следов фикции в БД вовсе.
    expect(persistedIssue).toBeUndefined();
    expect(persistedHistory.length).toBe(0);
  }, 30_000);

  it('GET /api/issues reflects the DB-persisted status, not the recomputed snapshot (Bug B)', async () => {
    const { db, schema } = await import('../db/index.js');

    // Сохранённый снимок в SQL: сеть замокана «в отказ», прод-режим запрещает
    // демо — getSnapshot обязан отдать именно этот снимок (фолбэк из истории),
    // и его список замечаний питает GET /api/issues.
    const snapshotData = {
      id: 'seed-1',
      spreadsheetId: 'x',
      createdAt: '2026-01-01T00:00:00Z',
      officialMetrics: {},
      calculatedMetrics: {},
      deltas: [],
      issues: [
        {
          id: 'seed-issue-003',
          severity: 'critical',
          origin: 'system',
          category: 'formula_continuity',
          title: 'seed',
          status: 'open',
          detectedAt: '2026-01-01T00:00:00Z',
        },
      ],
      trust: { overall: 100, components: [], grade: 'A', computedAt: '2026-01-01T00:00:00Z', basedOnSnapshot: 'seed-1' },
      rowCount: 0,
      metadata: { sheetsRead: [], cellsRead: 0, readDurationMs: 0, pipelineDurationMs: 0, targetYear: null },
    };
    db.insert(schema.snapshots)
      .values({
        id: 'seed-1',
        spreadsheetId: 'x',
        createdAt: '2026-01-01T00:00:00Z',
        data: JSON.stringify(snapshotData),
      })
      .run();
    // Isolate from Bug A: seed the issue directly in the DB with a valid
    // snapshotId so PUT takes the UPDATE branch (which already works today).
    db.insert(schema.issues)
      .values({
        id: 'seed-issue-003',
        snapshotId: 'seed-1',
        severity: 'critical',
        origin: 'system',
        category: 'formula_continuity',
        title: 'seed',
        status: 'open',
        detectedAt: '2026-01-01T00:00:00Z',
      })
      .run();

    const putRes = await app.inject({
      method: 'PUT',
      url: '/api/issues/seed-issue-003/status',
      payload: { status: 'acknowledged' },
    });
    expect(putRes.statusCode).toBe(200);

    const getRes = await app.inject({ method: 'GET', url: '/api/issues?limit=100' });
    expect(getRes.statusCode).toBe(200);
    const getBody = getRes.json<{ issues: Array<{ id: string; status: string }> }>();
    const issue = getBody.issues.find((i) => i.id === 'seed-issue-003');

    expect(issue?.status).toBe('acknowledged');
    const dashboard = await app.inject({ method: 'GET', url: '/api/dashboard' });
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json().recentIssues.find((i: { id: string }) => i.id === 'seed-issue-003')?.status).toBe('acknowledged');
    const before = dashboard.json().trust.overall;
    expect(before).toBeNull();
    expect((await app.inject({ method: 'PUT', url: '/api/issues/seed-issue-003/status', payload: { status: 'in_progress' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PUT', url: '/api/issues/seed-issue-003/status', payload: { status: 'resolved' } })).statusCode).toBe(200);
    const unconfirmed = (await app.inject({ method: 'GET', url: '/api/dashboard' })).json();
    expect(unconfirmed.recentIssues[0].status).toBe('resolved');
    expect(unconfirmed.trust.overall).toBe(before);
    expect((await app.inject({ method: 'PUT', url: '/api/issues/seed-issue-003/status', payload: { status: 'open' } })).statusCode).toBe(200);
    const falsePositive = await app.inject({ method: 'PUT', url: '/api/issues/seed-issue-003/status', payload: { status: 'false_positive', reason: 'Проверено владельцем' } });
    expect(falsePositive.statusCode).toBe(200);
    const after = (await app.inject({ method: 'GET', url: '/api/dashboard' })).json();
    expect(after.recentIssues.find((i: { id: string }) => i.id === 'seed-issue-003')?.status).toBe('false_positive');
    // A decision changes the case, but cannot create evidence in an empty source.
    expect(after.trust.overall).toBeNull();
    expect((await app.inject({ method: 'GET', url: '/api/trust' })).json().overall).toBe(after.trust.overall);
    const { getSnapshot } = await import('../services/snapshot.js');
    expect((await getSnapshot()).issues[0].status).toBe('open');


  }, 30_000);
  it('reads decisions and all case comments in the same typed history and journal, without guessing their author', async () => {
    const { db, schema } = await import('../db/index.js');
    const id = 'seed-issue-003';
    expect((await app.inject({ method: 'PUT', url: `/api/issues/${id}/status`, payload: { status: 'open' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PUT', url: `/api/issues/${id}/status`, payload: {
      status: 'false_positive', reason: 'Меры проверены', justification: 'Контракт содержит обеспечение',
      responsible: 'Координатор', deadline: '2026-10-22', comment: 'Проверка завершена',
    } })).statusCode).toBe(200);
    for (const comment of ['Первое пояснение', 'Второе пояснение']) {
      expect((await app.inject({ method: 'PUT', url: `/api/issues/${id}/comment`, payload: { comment } })).statusCode).toBe(200);
    }
    db.insert(schema.auditLog).values({ action: 'issue_comment', entity: 'row', entityId: id,
      details: 'Чужая сущность', timestamp: new Date().toISOString() }).run();
    const history = (await app.inject({ method: 'GET', url: `/api/issues/${id}/history` })).json().history;
    const { IssueHistoryResponseSchema } = await import('@aemr/shared');
    expect(IssueHistoryResponseSchema.safeParse({ issueId: id, history }).success).toBe(true);
    expect(history.filter((entry: { type: string }) => entry.type === 'comment').map((entry: { text: string }) => entry.text))
      .toEqual(['Первое пояснение', 'Второе пояснение']);
    const decision = history.find((entry: { reason?: string }) => entry.reason === 'Меры проверены');
    expect(decision).toMatchObject({ type: 'status_change', from: 'open', to: 'false_positive',
      author: null, source: 'dash_decision', text: 'Проверка завершена', justification: 'Контракт содержит обеспечение',
      responsible: 'Координатор', deadline: '2026-10-22' });
    expect(new Set(history.map((entry: { eventId: string }) => entry.eventId)).size).toBe(history.length);
    expect((await app.inject({ method: 'GET', url: `/api/issues/${id}` })).json().history).toEqual(history);
    const journal = (await app.inject({ method: 'GET', url: '/api/journal?limit=100' })).json().entries;
    expect(journal.find((entry: { details: string }) => entry.details.includes('Меры проверены')))
      .toMatchObject({ issueId: id, actor: null });
    expect(journal.find((entry: { details: string }) => entry.details === 'Первое пояснение'))
      .toMatchObject({ issueId: id, actor: null });
  }, 30_000);

  it('reads a moved rule case through its original decision/history ID and current source address', async () => {
    const { db, schema } = await import('../db/index.js');
    const { issueIdentity, ruleIssueIdentityParts } = await import('@aemr/core');
    const { buildCellDict } = await import('@aemr/shared');
    const { invalidateCache } = await import('../services/snapshot.js');
    const base = JSON.parse(db.select().from(schema.snapshots).where(eq(schema.snapshots.id, 'seed-1')).get()!.data!);
    const raw = new Array(34).fill(''); raw[0] = '173/18'; raw[1] = '42'; raw[2] = 'Учреждение'; raw[6] = 'Поставка';
    const oldId = issueIdentity([...ruleIssueIdentityParts('budget_sum_plan', 'УКСиМП', 'K4', buildCellDict(raw), true), 0]);
    const newId = issueIdentity([...ruleIssueIdentityParts('budget_sum_plan', 'УКСиМП', 'K5', buildCellDict(raw)), 0]);
    const issue = { ...base.issues[0], id: oldId, sheet: 'УКСиМП', row: 4, cell: 'K4', rowSeq: '173/18', category: 'budget_sum_plan', checkId: 'budget_sum_plan', detectedBy: 'rule:budget_sum_plan', status: 'open' };
    const old = { ...base, id: 'old-rule', createdAt: '2026-10-11T00:00:00Z', issues: [issue], rowsByDept: { 'УКСиМП': [raw] } };
    db.insert(schema.snapshots).values({ id: old.id, spreadsheetId: 'x', createdAt: old.createdAt, data: JSON.stringify(old) }).run();
    db.insert(schema.issues).values({ id: oldId, snapshotId: old.id, title: 'Budget', severity: 'critical', origin: 'spreadsheet_rule', category: 'budget_sum_plan', status: 'false_positive', detectedAt: old.createdAt }).run();
    db.insert(schema.issueHistory).values({ issueId: oldId, fromStatus: 'open', toStatus: 'false_positive', reason: 'Проверено', timestamp: old.createdAt }).run();
    const other = [...raw]; other[0] = 'other'; other[6] = 'Другое';
    const current = { ...old, id: 'new-rule', createdAt: '2026-10-12T00:00:00Z', issues: [{ ...issue, id: newId, row: 5, cell: 'K5' }], rowsByDept: { 'УКСиМП': [other, raw] } };
    db.insert(schema.snapshots).values({ id: current.id, spreadsheetId: 'x', createdAt: current.createdAt, data: JSON.stringify(current) }).run();
    // The pipeline saves its new open ID before the user requests the view.
    db.insert(schema.issues).values({ id: newId, snapshotId: current.id, title: 'Budget', severity: 'critical', origin: 'spreadsheet_rule', category: 'budget_sum_plan', status: 'open', detectedAt: current.createdAt }).run();
    const { pruneSnapshotsByRetention } = await import('../services/snapshot-retention.js');
    pruneSnapshotsByRetention(new Date('2026-11-12T00:00:00Z'));
    expect(db.select().from(schema.snapshots).where(eq(schema.snapshots.id, old.id)).get()).toBeDefined();
    invalidateCache();
    const list = (await app.inject({ method: 'GET', url: '/api/issues' })).json();
    expect(list.issues[0]).toMatchObject({ id: oldId, status: 'false_positive', row: 5, cell: 'K5' });
    const detail = (await app.inject({ method: 'GET', url: `/api/issues/${oldId}` })).json();
    expect(detail.issue.cell).toBe('K5');
    expect(detail.history).toHaveLength(1);
    expect(detail.history[0].reason).toBe('Проверено');
    expect((await app.inject({ method: 'PUT', url: `/api/issues/${oldId}/status`, payload: { status: 'open' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/issues/${oldId}` })).json().history).toHaveLength(2);
    expect(db.select().from(schema.issues).where(eq(schema.issues.id, newId)).get()!.status).toBe('open');
  }, 30_000);

  it('does not report empty history when either persisted history source cannot be read', async () => {
    const { db } = await import('../db/index.js');
    const id = (await app.inject({ method: 'GET', url: '/api/issues' })).json().issues[0].id;
    for (const url of [`/api/issues/${id}/history`, `/api/issues/${id}`]) {
      const transaction = vi.spyOn(db, 'transaction').mockImplementationOnce(() => { throw new Error('read unavailable'); });
      try {
        const response = await app.inject({ method: 'GET', url });
        expect(response.statusCode).toBe(503);
        expect(response.json()).toMatchObject({ code: 'ISSUE_HISTORY_UNAVAILABLE' });
        expect(response.json()).not.toHaveProperty('history');
      } finally { transaction.mockRestore(); }
    }
  });

  it('acknowledges an identical saved decision once and rejects a different explanation without losing it', async () => {
    const { db, schema } = await import('../db/index.js');
    const id = 'status-retry-proof';
    db.insert(schema.issues).values({ id, title: 'Проверка', severity: 'significant',
      origin: 'user', category: 'high_economy', status: 'open', detectedAt: new Date().toISOString() }).run();
    const payload = { status: 'false_positive', reason: 'Меры проверены',
      justification: 'Обеспечение включено в контракт', comment: 'Подтверждено', responsible: 'Координатор', deadline: '2026-10-22' };
    const save = (body: typeof payload) => app.inject({ method: 'PUT', url: `/api/issues/${id}/status`, payload: body });
    expect((await save(payload)).statusCode).toBe(200);
    const before = db.select().from(schema.issueHistory).where(eq(schema.issueHistory.issueId, id)).all();
    const retry = await save(payload);
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({ success: true, issueId: id, toStatus: 'false_positive', replayed: true });
    expect(db.select().from(schema.issueHistory).where(eq(schema.issueHistory.issueId, id)).all()).toEqual(before);
    for (const field of ['reason', 'justification', 'comment', 'responsible', 'deadline'] as const) {
      const changed = await save({ ...payload, [field]: 'Другое основание' });
      expect(changed.statusCode).toBe(409);
      expect(changed.json()).toMatchObject({ success: false, code: 'ISSUE_DECISION_CONFLICT' });
      expect(db.select().from(schema.issueHistory).where(eq(schema.issueHistory.issueId, id)).all()).toEqual(before);
    }
    expect((await save({ ...payload, reason: '   ' })).statusCode).toBe(400);
    // Reopening is a new real transition; the old request cannot erase it.
    expect((await app.inject({ method: 'PUT', url: `/api/issues/${id}/status`, payload: { status: 'open' } })).statusCode).toBe(200);
    expect((await save({ ...payload, reason: '   ' })).statusCode).toBe(400);
    expect((await save(payload)).statusCode).toBe(200);
    expect(db.select().from(schema.issueHistory).where(eq(schema.issueHistory.issueId, id)).all()).toHaveLength(3);
    db.delete(schema.issueHistory).where(eq(schema.issueHistory.issueId, id)).run();
    expect((await save(payload)).statusCode).toBe(409);
  });

  it('does not apply a direct-ID false positive to occurrence zero after an identical row is inserted', async () => {
    const { db, schema } = await import('../db/index.js');
    const { issueIdentity, ruleIssueIdentityParts } = await import('@aemr/core');
    const { buildCellDict } = await import('@aemr/shared');
    const { overlayPersistedStatus } = await import('../services/issue-decisions.js');
    const raw = new Array(34).fill(''); raw[0] = 'duplicate'; raw[1] = '42'; raw[2] = 'Учреждение'; raw[6] = 'Поставка';
    const parts = ruleIssueIdentityParts('budget_sum_plan', 'УКСиМП', 'K4', buildCellDict(raw));
    const id = issueIdentity([...parts, 0]);
    const base = JSON.parse(db.select().from(schema.snapshots).where(eq(schema.snapshots.id, 'seed-1')).get()!.data!);
    const issue = { ...base.issues[0], id, sheet: 'УКСиМП', row: 4, cell: 'K4', checkId: 'budget_sum_plan', detectedBy: 'rule:budget_sum_plan', status: 'open' };
    db.insert(schema.issues).values({ id, title: 'Budget', severity: 'critical', origin: 'spreadsheet_rule', category: 'budget_sum_plan', status: 'false_positive', detectedAt: base.createdAt }).run();
    const current = { ...base, issues: [issue, { ...issue, id: issueIdentity([...parts, 1]), row: 5, cell: 'K5' }], rowsByDept: { 'УКСиМП': [raw, [...raw]] } };
    expect(overlayPersistedStatus(current.issues, current).map(i => i.status)).toEqual(['open', 'open']);
    expect(db.select().from(schema.issues).where(eq(schema.issues.id, id)).get()!.status).toBe('false_positive');
    // Missing historical raw rows cannot support this ambiguity check; retain
    // compatibility with prior direct-ID readback rather than invent an anchor.
    expect(overlayPersistedStatus([issue])[0].status).toBe('false_positive');
    expect(overlayPersistedStatus([{ ...issue, detectedBy: 'pipeline:signal:overdue' }], current)[0].status).toBe('false_positive');
    expect(overlayPersistedStatus([{ ...issue, sheet: 'СВОД ТД-ПМ' }], current)[0].status).toBe('false_positive');
  });

});
