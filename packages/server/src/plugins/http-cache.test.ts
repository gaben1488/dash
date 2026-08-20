/**
 * Страж отпечатка ответа (ETag) и повторного чтения без пересылки тела.
 *
 * Охраняются обещания:
 *   1. Тяжёлое чтение получает отпечаток и указание «храни, но спрашивай».
 *   2. Повторное обращение с тем же отпечатком отвечает пустым 304 — байты
 *      второй раз по проводу не едут.
 *   3. Форма ответа не меняется: обычное обращение получает то же тело, что и
 *      до правки. Веб (`packages/web/src/api.ts`, `fetchJSON`) голого 304 не
 *      видит никогда — сверку ведёт браузер и отдаёт коду страницы обычные 200.
 *   4. Записывающие обращения и живая лента событий отпечатка не получают.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computeEtag, matchesIfNoneMatch, registerHttpCache, stripEncodingSuffix } from './http-cache.js';

const BODY = { rows: Array.from({ length: 50 }, (_, i) => ({ i, name: `строка ${i}` })) };

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  registerHttpCache(app);
  app.get('/api/heavy', async () => BODY);
  app.post('/api/heavy', async () => BODY);
  app.get('/api/events/stream', async () => BODY);
  app.get('/not-api', async () => BODY);
  app.get('/api/own-tag', async (_req, reply) => {
    reply.header('etag', '"own-tag"');
    return BODY;
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('отпечаток ответа', () => {
  it('тяжёлое чтение получает отпечаток и указание спрашивать перед показом', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/heavy' });

    expect(res.statusCode).toBe(200);
    expect(res.headers.etag).toMatch(/^"[\w-]+"$/);
    expect(res.headers['cache-control']).toBe('private, no-cache');
    // Тело — прежнее: отпечаток ничего в нём не меняет.
    expect(res.json()).toEqual(BODY);
  });

  it('один и тот же ответ даёт один и тот же отпечаток', async () => {
    const first = await app.inject({ method: 'GET', url: '/api/heavy' });
    const second = await app.inject({ method: 'GET', url: '/api/heavy' });

    expect(second.headers.etag).toBe(first.headers.etag);
  });

  it('повторное обращение с тем же отпечатком отвечает пустым 304', async () => {
    const first = await app.inject({ method: 'GET', url: '/api/heavy' });
    const etag = String(first.headers.etag);

    const second = await app.inject({
      method: 'GET',
      url: '/api/heavy',
      headers: { 'if-none-match': etag },
    });

    expect(second.statusCode).toBe(304);
    expect(second.body).toBe('');
    // Ради этого всё и затевалось: тело первого ответа заметно больше пустоты.
    expect(first.body.length).toBeGreaterThan(1000);
  });

  it('чужой отпечаток 304 не даёт — приезжает свежее тело', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/heavy',
      headers: { 'if-none-match': '"stale-tag"' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(BODY);
  });

  it('приписка кодировки сверке не мешает: сжатый ответ тоже попадает в 304', async () => {
    const first = await app.inject({ method: 'GET', url: '/api/heavy' });
    const withSuffix = `${String(first.headers.etag).slice(0, -1)}-gzip"`;

    const second = await app.inject({
      method: 'GET',
      url: '/api/heavy',
      headers: { 'if-none-match': withSuffix },
    });

    expect(second.statusCode).toBe(304);
  });
});

describe('кому отпечаток не ставится', () => {
  it('записывающему обращению', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/heavy' });
    expect(res.headers.etag).toBeUndefined();
  });

  it('живой ленте событий', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/events/stream' });
    expect(res.headers.etag).toBeUndefined();
  });

  it('обращению не к /api (страница приложения и статика)', async () => {
    const res = await app.inject({ method: 'GET', url: '/not-api' });
    expect(res.headers.etag).toBeUndefined();
  });

  it('ответу, который назвал свой отпечаток сам', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/own-tag' });
    expect(res.headers.etag).toBe('"own-tag"');
  });
});

describe('разбор заголовков', () => {
  it('отпечаток считается с целого тела, а не с его длины', () => {
    // Две строки одной длины обязаны дать разные подписи.
    expect(computeEtag('абв')).not.toBe(computeEtag('вба'));
  });

  it('приписка кодировки снимается', () => {
    expect(stripEncodingSuffix('"abc-gzip"')).toBe('"abc"');
    expect(stripEncodingSuffix('W/"abc-br"')).toBe('"abc"');
    expect(stripEncodingSuffix('"abc"')).toBe('"abc"');
  });

  it('список отпечатков разбирается целиком, а «*» означает любой', () => {
    expect(matchesIfNoneMatch('"нет", "abc", "тоже нет"', '"abc"')).toBe(true);
    expect(matchesIfNoneMatch('*', '"abc"')).toBe(true);
    expect(matchesIfNoneMatch('"нет"', '"abc"')).toBe(false);
    expect(matchesIfNoneMatch(undefined, '"abc"')).toBe(false);
  });
});
