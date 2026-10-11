import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

// Поднимаем приложение на :memory: БД (как app-security.test.ts), засеваем два
// снимка с метриками и проверяем контракт роутов истории end-to-end.
describe('history routes', () => {
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
    // Импортируем тот же singleton-db, что использует app, и засеваем его.
    const { db, schema } = await import('./db/index.js');
    db.insert(schema.snapshots)
      .values([
        { id: 's1', spreadsheetId: 'x', createdAt: '2026-05-29T00:00:00Z' },
        { id: 's2', spreadsheetId: 'x', createdAt: '2026-06-05T00:00:00Z' },
      ])
      .run();
    db.insert(schema.metricHistory)
      .values([
        { snapshotId: 's1', metricKey: 'sole.year.share', numericValue: 0.5039, createdAt: '2026-05-29T00:00:00Z' },
        { snapshotId: 's1', metricKey: 'economy.year.total', numericValue: 33503, createdAt: '2026-05-29T00:00:00Z' },
        { snapshotId: 's2', metricKey: 'sole.year.share', numericValue: 0.5406, createdAt: '2026-06-05T00:00:00Z' },
        { snapshotId: 's2', metricKey: 'economy.year.total', numericValue: 52781, createdAt: '2026-06-05T00:00:00Z' },
      ])
      .run();
    const { createApp } = await import('./app.js');
    app = await createApp({ logger: false });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it('GET /api/history/snapshots → 200 + список снимков', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/history/snapshots' });
    expect(res.statusCode).toBe(200);
    const body = res.json<Array<{ id: string }>>();
    expect(body.map((s) => s.id).sort()).toEqual(['s1', 's2']);
  });

  it('GET /api/history/diff без from/to → 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/history/diff' });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/history/diff?from=s1&to=s2 → дельты с направлением и сентиментом', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/history/diff?from=s1&to=s2' });
    expect(res.statusCode).toBe(200);
    const body = res.json<Array<{ metricKey: string; direction: string; sentiment: string }>>();
    const map = Object.fromEntries(body.map((d) => [d.metricKey, d]));
    expect(map['sole.year.share'].direction).toBe('up');
    expect(map['sole.year.share'].sentiment).toBe('bad'); // рост доли ЕП = внимание
    expect(map['economy.year.total'].sentiment).toBe('good'); // рост экономии = хорошо
  });

  it('GET /api/history/diff с несуществующими снимками → 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/history/diff?from=nope&to=nada' });
    expect(res.statusCode).toBe(404);
  });
  // API истории закупок не требует подключения Google: при пустом архиве
  // не обещает отсутствие изменений и возвращает проверяемую пустоту.
  it('GET /api/history/procurement-lineage без контрольных срезов даёт честный пустой ответ', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/history/procurement-lineage' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      source: 'confirmed-weekly-snapshots',
      anchorId: null,
      periods: [],
      total: 0,
      shown: 0,
      nextOffset: null,
    });
  });

  it('параметры пагинации и масштаба проверяются, неизвестная книга отвергается', async () => {
    const invalid = [
      '/api/history/procurement-lineage?weeks=0',
      '/api/history/procurement-lineage?weeks=13',
      '/api/history/procurement-lineage?weeks=abc',
      '/api/history/procurement-lineage?limit=0',
      '/api/history/procurement-lineage?offset=-1',
      '/api/history/procurement-lineage?book=НЕСУЩЕСТВУЮЩИЙ_ГРБС',
    ];
    for (const url of invalid) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(400);
    }
  });

  it('не подменяет чужим снимком несуществующий anchor', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/history/procurement-lineage?anchor=absent',
    });
    expect(res.statusCode).toBe(404);
  });
});
