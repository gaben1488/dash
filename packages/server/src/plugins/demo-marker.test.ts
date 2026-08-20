/**
 * Страж признака показательных данных (реестр багов 09.07.2026, п.8).
 *
 * Обещание: когда учётные данные Google не настроены и продукт показывает
 * данные генератора-образца, ЛЮБОЙ ответ маршрутов /api/* несёт признак —
 * и карточка, и список, и справочник по управлениям, и выгрузка. Пометка на
 * одном экране не спасает: числа читают со всех.
 */
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { DEMO_HEADER, registerDemoMarker } from './demo-marker.js';

async function buildApp(demo: boolean) {
  const app = Fastify({ logger: false });
  registerDemoMarker(app, demo);
  app.get('/api/карточка', async () => ({ rows: 2, total: 100 }));
  app.get('/api/список', async () => [1, 2, 3]);
  // Справочник по управлениям: каждый ключ — идентификатор ГРБС.
  app.get('/api/справочник', async () => ({ uo: { grade: 'A' }, uer: { grade: 'B' } }));
  app.get('/api/выгрузка', async (_req, reply) => reply.type('text/csv').send('а;б\n1;2'));
  app.get('/не-наш-адрес', async () => ({ rows: 1 }));
  await app.ready();
  return app;
}

describe('признак показательных данных', () => {
  it('данные показательные → признак стоит у ответа любого рода', async () => {
    const app = await buildApp(true);
    for (const url of ['/api/карточка', '/api/список', '/api/справочник', '/api/выгрузка']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.headers[DEMO_HEADER]).toBe('1');
    }
    await app.close();
  });

  it('данные настоящие → признака нет ни в одном ответе', async () => {
    const app = await buildApp(false);
    const res = await app.inject({ method: 'GET', url: '/api/карточка' });
    expect(res.headers[DEMO_HEADER]).toBeUndefined();
    await app.close();
  });

  it('тело ответа не переписывается — справочник управлений не получает лишнего ключа', async () => {
    const app = await buildApp(true);
    const res = await app.inject({ method: 'GET', url: '/api/справочник' });
    expect(Object.keys(res.json<Record<string, unknown>>()).sort()).toEqual(['uer', 'uo']);
    const csv = await app.inject({ method: 'GET', url: '/api/выгрузка' });
    expect(csv.body).toBe('а;б\n1;2');
    await app.close();
  });

  it('адреса вне /api признака не несут', async () => {
    const app = await buildApp(true);
    const res = await app.inject({ method: 'GET', url: '/не-наш-адрес' });
    expect(res.headers[DEMO_HEADER]).toBeUndefined();
    await app.close();
  });
});
