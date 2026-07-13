import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerAuthHook } from './auth.js';

/**
 * Публичный read-only деплой (AEMR_PUBLIC_READONLY=true): чтения открыты без
 * ключа, мутации на /api/* отклоняются 403. Защищает исходные Google-таблицы
 * от анонимной записи при публичном URL.
 */
const ORIGINAL = process.env.AEMR_PUBLIC_READONLY;

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerAuthHook(app);
  app.get('/api/dashboard', async () => ({ ok: true }));
  app.post('/api/data/rows', async () => ({ saved: true }));
  app.put('/api/rows/uer/4/field', async () => ({ written: true }));
  app.post('/api/refresh', async () => ({ refreshed: true }));
  app.post('/api/sources/УЭР/test', async () => ({ ok: true }));
  app.get('/api/health', async () => ({ status: 'ok' }));
  await app.ready();
  return app;
}

describe('registerAuthHook — публичный read-only режим', () => {
  beforeEach(() => { process.env.AEMR_PUBLIC_READONLY = 'true'; });
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.AEMR_PUBLIC_READONLY;
    else process.env.AEMR_PUBLIC_READONLY = ORIGINAL;
  });

  it('GET /api/* открыт без ключа', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/dashboard' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('POST /api/* отклоняется 403 (запись заблокирована)', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/data/rows', payload: {} });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('PUT записи в лист отклоняется 403', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'PUT', url: '/api/rows/uer/4/field', payload: { field: 'K', value: '1' } });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('POST /api/refresh РАЗРЕШЁН (перечитка из Google, в таблицы не пишет)', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/refresh' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('POST /api/sources/:name/test РАЗРЕШЁН (тест-чтение источника)', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/sources/%D0%A3%D0%AD%D0%A0/test' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
