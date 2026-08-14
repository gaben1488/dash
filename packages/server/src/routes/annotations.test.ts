/**
 * annotations.test.ts — inject-тесты /api/annotations/yearlong (канон п.83).
 *
 * Проверяется: пустая таблица = пустой список оверрайдов (стартовая разметка
 * живёт данными в @aemr/shared и сюда не дублируется), запись вида владельцем,
 * пометка «предварительная», валидация «вид только из девяти», снятие
 * оверрайда, неизвестная книга.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

vi.mock('../services/google-sheets.js', () => ({
  batchGetCells: vi.fn(async () => { throw new Error('net off'); }),
  batchGetFormulas: vi.fn(async () => { throw new Error('net off'); }),
  getSheetData: vi.fn(async () => { throw new Error('net off'); }),
  getSheetDataFromSpreadsheet: vi.fn(async () => { throw new Error('net off'); }),
  getSpreadsheetMetadata: vi.fn(async () => { throw new Error('net off'); }),
  readDeptSheet: vi.fn(async () => { throw new Error('net off'); }),
  fetchSHDYUSheet: vi.fn(async () => { throw new Error('net off'); }),
}));

describe('/api/annotations/yearlong', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      AEMR_API_KEY: '',
      SQLITE_PATH: ':memory:',
      LOG_LEVEL: 'silent',
    };
    const { createApp } = await import('../app.js');
    app = await createApp({ logger: false });
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it('GET: без оверрайдов — пустой список (стартовая разметка живёт в shared)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/annotations/yearlong' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.overrides).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('PUT: владелец размечает вид — оверрайд сохранён и виден в GET', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: `/api/annotations/yearlong/${encodeURIComponent('УКСиМП')}/3`,
      payload: { kind: 'events-by-estimates' },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({
      success: true, dept: 'УКСиМП', ppNum: '3', kind: 'events-by-estimates', provisional: false,
    });

    const res = await app.inject({ method: 'GET', url: '/api/annotations/yearlong' });
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.overrides[0]).toMatchObject({
      dept: 'УКСиМП', ppNum: '3', kind: 'events-by-estimates', provisional: false,
    });
  });

  it('PUT: повторная разметка той же строки перезаписывает, а не плодит дубли', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: `/api/annotations/yearlong/${encodeURIComponent('УКСиМП')}/3`,
      payload: { kind: 'on-demand-supply', provisional: true },
    });
    expect(put.statusCode).toBe(200);

    const body = (await app.inject({ method: 'GET', url: '/api/annotations/yearlong' })).json();
    expect(body.total).toBe(1);
    expect(body.overrides[0]).toMatchObject({
      kind: 'on-demand-supply', provisional: true,
    });
  });

  it('PUT: вид вне словаря девяти — 400 с перечнем допустимых', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/annotations/yearlong/${encodeURIComponent('УКСиМП')}/3`,
      payload: { kind: 'выдуманный-вид' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toContain('девяти');
    expect(body.allowed).toHaveLength(9);
  });

  it('PUT: неизвестная книга — 404 по-русски', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/annotations/yearlong/${encodeURIComponent('НЕТУ')}/3`,
      payload: { kind: 'on-demand-supply' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain('НЕТУ');
  });

  it('PUT: kind=null снимает оверрайд — возврат к стартовой разметке', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/annotations/yearlong/${encodeURIComponent('УКСиМП')}/3`,
      payload: { kind: null },
    });
    expect(res.statusCode).toBe(200);
    const body = (await app.inject({ method: 'GET', url: '/api/annotations/yearlong' })).json();
    expect(body.total).toBe(0);
  });
});
