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
          severity: 'warning',
          origin: 'system',
          category: 'test',
          title: 'seed',
          status: 'open',
          detectedAt: '2026-01-01T00:00:00Z',
        },
      ],
      trust: { overall: 100, components: [], grade: 'A', computedAt: '2026-01-01T00:00:00Z', basedOnSnapshot: 'seed-1' },
      rowCount: 0,
      metadata: { sheetsRead: [], cellsRead: 0, readDurationMs: 0, pipelineDurationMs: 0 },
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
        severity: 'warning',
        origin: 'system',
        category: 'test',
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
  }, 30_000);
});
