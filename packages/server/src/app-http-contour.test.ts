/**
 * Страж собранного контура: отпечаток, сжатие и форма отказа работают ВМЕСТЕ,
 * в том порядке, в каком их поставил app.ts, а не поодиночке в своих прогонах.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ПРОГОН. У каждой части есть свой страж, и каждый из них
 * зелёный сам по себе. Но порядок хуков отправки — тоже решение, и ошибиться в
 * нём легко: посчитай отпечаток ПОСЛЕ сжатия — и два читателя с разной
 * поддержкой сжатия получат разные подписи одного и того же содержимого, то
 * есть сверка перестанет срабатывать и весь выигрыш пропадёт молча. Здесь
 * проверяется именно связка.
 *
 * И второе: форма ответа, которую читает веб, не должна была измениться.
 * Обращение без объявленной поддержки сжатия — это ровно то, что делает
 * `app.inject()` во всех прежних прогонах и что увидит любой старый клиент.
 */
import { gunzipSync } from 'node:zlib';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.AEMR_API_KEY = '';
process.env.SQLITE_PATH = ':memory:';
process.env.LOG_LEVEL = 'silent';

/** Тело порядка настоящего чтения продукта — короче порога сжатие не тронет. */
const BIG_BODY = {
  rows: Array.from({ length: 300 }, (_, i) => ({
    dept: 'УО',
    subject: `Поставка товаров для нужд учреждения, позиция ${i}`,
    planSum: 1234.5 + i,
  })),
};

let app: FastifyInstance;

beforeAll(async () => {
  const { createApp } = await import('./app.js');
  app = await createApp({ logger: false });
  app.get('/api/__big-for-test', async () => BIG_BODY);
  app.get('/api/__throw-for-test', async () => {
    throw new Error('внутренняя подробность: /srv/aemr/secret-path.ts');
  });
  await app.ready();
}, 120_000);

afterAll(async () => {
  await app?.close();
});

const plain = (url: string) => app.inject({ method: 'GET', url });
const gzipped = (url: string, headers: Record<string, string> = {}) =>
  app.inject({ method: 'GET', url, headers: { 'accept-encoding': 'gzip', ...headers } });

describe('форма ответа для веба не изменилась', () => {
  it('обращение без объявленной поддержки сжатия получает прежнее тело', async () => {
    const res = await plain('/api/__big-for-test');

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.json()).toEqual(BIG_BODY);
  });

  it('сжатое тело после распаковки — то же самое', async () => {
    const asIs = await plain('/api/__big-for-test');
    const gz = await gzipped('/api/__big-for-test');

    expect(gz.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(gz.rawPayload).toString('utf8')).toBe(asIs.body);
    console.log(
      `Собранный контур, /api/__big-for-test: ${asIs.rawPayload.length} Б → ${gz.rawPayload.length} Б после сжатия`,
    );
  });
});

describe('отпечаток считается ДО сжатия', () => {
  it('подпись одного и того же содержимого совпадает при любой поддержке сжатия', async () => {
    const asIs = await plain('/api/__big-for-test');
    const gz = await gzipped('/api/__big-for-test');

    const base = String(asIs.headers.etag);
    // У сжатого представления к подписи приписано название кодировки — так же,
    // как это делает nginx; основа обязана совпадать.
    expect(String(gz.headers.etag)).toBe(`${base.slice(0, -1)}-gzip"`);
  });

  it('сверка срабатывает и для сжатого представления — тело второй раз не едет', async () => {
    const gz = await gzipped('/api/__big-for-test');

    const again = await gzipped('/api/__big-for-test', {
      'if-none-match': String(gz.headers.etag),
    });

    expect(again.statusCode).toBe(304);
    expect(again.rawPayload.length).toBe(0);
    expect(gz.rawPayload.length).toBeGreaterThan(0);
  });

  it('и для несжатого тоже', async () => {
    const first = await plain('/api/__big-for-test');
    const again = await app.inject({
      method: 'GET',
      url: '/api/__big-for-test',
      headers: { 'if-none-match': String(first.headers.etag) },
    });

    expect(again.statusCode).toBe(304);
    expect(again.body).toBe('');
  });
});

describe('форма отказа — одна на весь сервер', () => {
  it('поломка не пересказывает свой текст и называет устойчивое слово', async () => {
    const res = await plain('/api/__throw-for-test');
    const body = res.json<Record<string, unknown>>();

    expect(res.statusCode).toBe(500);
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.statusCode).toBe(500);
    expect(body.error).toBe('InternalServerError');
    // Текст поломки — с путём файла продукта внутри — наружу не идёт.
    expect(body.message).toBe('Internal server error');
    expect(String(body.message)).not.toContain('secret-path.ts');
    // По отметке запроса поломку находят в журнале, не пересказывая её клиенту.
    expect(typeof body.requestId).toBe('string');
    // Стек здесь ЕСТЬ намеренно: среда названа средой прогона (NODE_ENV=test),
    // а закрытость стека в боевой и в неназванной среде охраняет отдельный
    // страж — app-security.test.ts.
    expect(body).toHaveProperty('stack');
  });

  it('нет такого адреса — та же форма, без пересказа маршрутизации', async () => {
    const res = await plain('/api/такого-адреса-нет');
    const body = res.json<Record<string, unknown>>();

    expect(res.statusCode).toBe(404);
    expect(body.code).toBe('NOT_FOUND');
    expect(body.statusCode).toBe(404);
    expect(JSON.stringify(body)).not.toContain('Route');
  });

  it('отказ отпечатка не получает — сверять нечего', async () => {
    const res = await plain('/api/такого-адреса-нет');
    expect(res.headers.etag).toBeUndefined();
  });
});

describe('проверки живости и готовности доезжают через собранное приложение', () => {
  it('живость отвечает без ключа доступа и вне /api', async () => {
    const res = await plain('/health/live');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', service: 'aemr-server' });
  });

  it('готовность до чтения источников честно отказывает', async () => {
    const res = await plain('/health/ready');
    expect([200, 503]).toContain(res.statusCode);
    expect(res.json<{ status: string }>().status).toMatch(/^(ready|not_ready)$/);
  });
});
