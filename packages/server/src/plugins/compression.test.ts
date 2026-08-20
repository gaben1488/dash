/**
 * Страж сжатия ответов.
 *
 * Охраняются обещания:
 *   1. Тело сжимается, и сжатое ЗАМЕТНО короче исходного — иначе затея не
 *      стоит процессорного времени. Замер печатается в прогоне: это тот самый
 *      «до/после», без которого о скорости говорить нельзя.
 *   2. Содержимое не меняется: распакованное тело — байт в байт исходный JSON.
 *      Именно это видит `fetchJSON` в `packages/web/src/api.ts`: распаковку
 *      ведёт браузер, а код страницы получает прежний объект.
 *   3. Клиент, не объявивший поддержку сжатия, получает тело как раньше —
 *      поэтому ни один существующий прогон `app.inject()` не сломался.
 *   4. Короткий ответ не трогается: свёртка не окупается.
 */
import { gunzipSync, brotliDecompressSync } from 'node:zlib';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COMPRESS_MIN_BYTES, appendVary, pickEncoding, registerCompression } from './compression.js';

/** Похоже на настоящий ответ продукта: длинный однородный список записей. */
const RECORDS = Array.from({ length: 400 }, (_, i) => ({
  dept: 'УО',
  sheet: 'ВСЕ',
  cell: `G${i + 4}`,
  attribute: 'Способ определения поставщика',
  oldValue: 'Электронный аукцион',
  newValue: 'Закупка у единственного поставщика',
  atMs: 1_755_000_000_000 + i * 1000,
  author: 'Иванова И.И.',
}));

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  registerCompression(app);
  app.get('/api/changes', async () => ({ since: '2026-08-14', total: RECORDS.length, records: RECORDS }));
  app.get('/api/tiny', async () => ({ ok: true }));
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

const raw = () => app.inject({ method: 'GET', url: '/api/changes' });
const encoded = (accept: string) =>
  app.inject({ method: 'GET', url: '/api/changes', headers: { 'accept-encoding': accept } });

describe('замер: сколько байт уходит по проводу', () => {
  it('gzip и brotli режут длинный список в разы', async () => {
    const plain = await raw();
    const gz = await encoded('gzip');
    const br = await encoded('br, gzip');

    const plainBytes = Buffer.byteLength(plain.rawPayload);
    const gzBytes = gz.rawPayload.length;
    const brBytes = br.rawPayload.length;

    // Замер печатается: заявлять скорость без числа нельзя.
    console.log(
      `Ответ /api/changes (${RECORDS.length} записей): ` +
        `без сжатия ${plainBytes} Б, gzip ${gzBytes} Б (${(gzBytes / plainBytes * 100).toFixed(1)}%), ` +
        `brotli ${brBytes} Б (${(brBytes / plainBytes * 100).toFixed(1)}%)`,
    );

    expect(gz.headers['content-encoding']).toBe('gzip');
    expect(br.headers['content-encoding']).toBe('br');
    // Однородный список сжимается на порядок; берём заведомо достижимую границу.
    expect(gzBytes).toBeLessThan(plainBytes / 4);
    expect(brBytes).toBeLessThan(plainBytes / 4);
  });

  it('заявленная длина совпадает с настоящей длиной сжатого тела', async () => {
    const gz = await encoded('gzip');
    expect(Number(gz.headers['content-length'])).toBe(gz.rawPayload.length);
  });
});

describe('содержимое не меняется', () => {
  it('распакованный gzip — тот же JSON', async () => {
    const plain = await raw();
    const gz = await encoded('gzip');

    expect(gunzipSync(gz.rawPayload).toString('utf8')).toBe(plain.body);
  });

  it('распакованный brotli — тот же JSON', async () => {
    const plain = await raw();
    const br = await encoded('br');

    expect(brotliDecompressSync(br.rawPayload).toString('utf8')).toBe(plain.body);
  });
});

describe('кого не трогаем', () => {
  it('клиента, не объявившего поддержку сжатия (все прежние прогоны inject)', async () => {
    const res = await raw();

    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.json()).toMatchObject({ total: RECORDS.length });
    // Кэшу-посреднику всё равно сообщаем, что представление зависит от объявления.
    expect(String(res.headers.vary)).toContain('Accept-Encoding');
  });

  it('короткий ответ: свёртка не окупается', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/tiny',
      headers: { 'accept-encoding': 'gzip, br' },
    });

    expect(res.body.length).toBeLessThan(COMPRESS_MIN_BYTES);
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.json()).toEqual({ ok: true });
  });
});

describe('выбор кодировки по объявлению клиента', () => {
  it('brotli предпочитается при равных условиях', () => {
    expect(pickEncoding('gzip, deflate, br')).toBe('br');
  });

  it('прямой отказ от кодировки уважается', () => {
    expect(pickEncoding('br;q=0, gzip')).toBe('gzip');
    expect(pickEncoding('gzip;q=0')).toBeNull();
  });

  it('пустое или незнакомое объявление означает «без сжатия»', () => {
    expect(pickEncoding(undefined)).toBeNull();
    expect(pickEncoding('identity')).toBeNull();
  });

  it('Vary не плодит повторов', () => {
    expect(appendVary('Accept-Encoding', 'Accept-Encoding')).toBe('Accept-Encoding');
    expect(appendVary('Origin', 'Accept-Encoding')).toBe('Origin, Accept-Encoding');
    expect(appendVary(undefined, 'Accept-Encoding')).toBe('Accept-Encoding');
  });
});
