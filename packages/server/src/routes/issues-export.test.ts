/**
 * Страж выгрузки замечаний (GET /api/export/issues) — реестр багов 09.07.2026,
 * раздел PLAUSIBLE «экспорт сверки и замечаний игнорирует фильтры».
 *
 * Обещание: набор отборов выгрузки совпадает со списком (GET /api/issues).
 * Человек сузил список до одного вида замечаний и нажал «Выгрузить» — файл
 * обязан содержать ровно то, что он видел, а не все замечания подряд.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

// Сеть «в отказ» + прод-режим (ключ задан): демо-фолбэк запрещён, снимок
// приходит из SQL — его сеет сам тест.
vi.mock('../services/google-sheets.js', () => ({
  batchGetCells: vi.fn(async () => { throw new Error('сеть в тесте выключена'); }),
  batchGetFormulas: vi.fn(async () => { throw new Error('сеть в тесте выключена'); }),
  getSheetData: vi.fn(async () => { throw new Error('сеть в тесте выключена'); }),
  getSpreadsheetMetadata: vi.fn(async () => { throw new Error('сеть в тесте выключена'); }),
  fetchSHDYUSheet: vi.fn(async () => { throw new Error('сеть в тесте выключена'); }),
}));

function seedIssue(id: string, category: string, severity: string) {
  return {
    id,
    severity,
    origin: 'system',
    category,
    title: `Замечание ${id}`,
    status: 'open',
    detectedAt: '2026-01-01T00:00:00Z',
  };
}

/** Значения колонки «Категория» (третья) из тела CSV. */
function categories(csv: string): string[] {
  return csv
    .replace(/^\ufeff/, '')
    .split('\r\n')
    .slice(1)
    .filter(Boolean)
    .map((line) => line.split(',')[2] ?? '');
}

describe('GET /api/export/issues — отборы выгрузки совпадают со списком', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      AEMR_API_KEY: '',
      SQLITE_PATH: ':memory:',
      LOG_LEVEL: 'silent',
      GOOGLE_SERVICE_ACCOUNT_EMAIL: '',
      GOOGLE_PRIVATE_KEY: '',
      GOOGLE_API_KEY: 'test-api-key',
    };
    const { createApp } = await import('../app.js');
    app = await createApp({ logger: false });

    const { db, schema } = await import('../db/index.js');
    const snapshotData = {
      id: 'seed-export-1',
      spreadsheetId: 'x',
      createdAt: '2026-01-01T00:00:00Z',
      officialMetrics: {},
      calculatedMetrics: {},
      deltas: [],
      issues: [
        seedIssue('export-1', 'data_quality', 'warning'),
        seedIssue('export-2', 'compliance', 'critical'),
      ],
      trust: { overall: 100, components: [], grade: 'A', computedAt: '2026-01-01T00:00:00Z', basedOnSnapshot: 'seed-export-1' },
      rowCount: 0,
      metadata: { sheetsRead: [], cellsRead: 0, readDurationMs: 0, pipelineDurationMs: 0 },
    };
    db.insert(schema.snapshots).values({
      id: 'seed-export-1',
      spreadsheetId: 'x',
      createdAt: '2026-01-01T00:00:00Z',
      data: JSON.stringify(snapshotData),
    }).run();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it('без отбора выгружаются все замечания', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/export/issues' });
    expect(res.statusCode).toBe(200);
    expect(categories(res.body).sort()).toEqual(['compliance', 'data_quality']);
  }, 30_000);

  it('отбор по виду замечания сужает файл так же, как список', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/export/issues?category=compliance' });
    expect(res.statusCode).toBe(200);
    expect(categories(res.body)).toEqual(['compliance']);
  }, 30_000);

  it('отбор по строгости сужает файл', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/export/issues?severity=warning' });
    expect(res.statusCode).toBe(200);
    expect(categories(res.body)).toEqual(['data_quality']);
  }, 30_000);
});
