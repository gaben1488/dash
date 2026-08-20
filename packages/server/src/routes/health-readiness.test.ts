/**
 * Страж проверок живости и готовности — и объявленной формы ответа о здоровье.
 *
 * ЖИВОСТЬ И ГОТОВНОСТЬ — РАЗНОЕ. Процесс поднимается за доли секунды, а книги
 * управлений читаются с Google десятки секунд. В это окно сервер жив
 * (перезапускать нечего) и при этом ещё не готов (числа показывать не из чего).
 * Единственная прежняя проверка отвечала `status: 'ok'` уже в первую секунду —
 * и связка объявляла версию работающей, пуская читателей на пустой продукт.
 *
 * ОБЪЯВЛЕННАЯ ФОРМА ОТВЕТА О ЗДОРОВЬЕ. Маршрут /api/health ПУБЛИЧНЫЙ: проверка
 * ключа его пропускает. Объявленная форма отдаёт наружу ровно перечисленные
 * поля и вырезает любое другое — это дверь, закрытая от случайной утечки
 * идентификатора книги или почты служебной учётной записи. У строгой сборки
 * есть обратная сторона: поле, добавленное в ответ и забытое в объявлении,
 * пропадёт молча. Поэтому здесь прогон идёт ЧЕРЕЗ МАРШРУТ, а не мимо него:
 * прежний страж routes/health.test.ts зовёт `buildHealthReport` напрямую и
 * вырезанного поля не заметил бы.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.SQLITE_PATH = ':memory:';
process.env.LOG_LEVEL = 'silent';

type HealthModule = typeof import('./health.js');

let app: FastifyInstance;
let health: HealthModule;

beforeAll(async () => {
  health = await import('./health.js');
  app = Fastify({ logger: false });
  await health.healthRoutes(app);
  await app.ready();
  // Первый импорт тянет базу и расчётное ядро — на холодную это дольше
  // стандартного срока подготовки.
}, 60_000);

afterAll(async () => {
  await app.close();
});

describe('живость', () => {
  it('отвечает всегда и ничего не читает — подвиснуть на источнике не может', async () => {
    for (const url of ['/health/live', '/api/health/live']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok', service: 'aemr-server' });
    }
  });

  it('живёт вне /api — проверку ключа доступа оркестратору не выдают', async () => {
    // Проверка ключа охраняет только /api/*; адрес вне его доступен связке и
    // балансировщику без ключа. Это не дыра: ответ не несёт ничего, кроме
    // «процесс отвечает».
    const res = await app.inject({ method: 'GET', url: '/health/live' });
    expect(res.json()).not.toHaveProperty('sources');
  });
});

describe('готовность', () => {
  it('до первого чтения источников честно отвечает «не готов» и 503', async () => {
    const report = health.buildReadinessReport(new Date('2026-08-21T03:00:00.000Z'));

    expect(report.status).toBe('not_ready');
    expect(report.loaded).toBe(0);
    expect(report.total).toBeGreaterThan(0);
    expect(report.summary).toBe('Источники ещё не читались с запуска сервера');

    for (const url of ['/health/ready', '/api/health/ready']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(503);
      expect(res.json<{ status: string }>().status).toBe('not_ready');
    }
  });

  it('готовность не отменяется отказом отдельной книги: прочитан хотя бы один — работаем', async () => {
    const snapshot = await import('../services/snapshot.js');
    const config = await import('../config.js');
    const [firstDept] = Object.keys(config.DEPARTMENT_SPREADSHEETS);

    snapshot.setDeptLoadMeta({
      [firstDept]: { loadedAt: '2026-08-21T03:00:00.000Z', rowCount: 42, sheetName: 'ВСЕ' },
    });

    const report = health.buildReadinessReport(new Date('2026-08-21T03:05:00.000Z'));
    expect(report.status).toBe('ready');
    expect(report.loaded).toBe(1);

    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ status: string }>().status).toBe('ready');
  });
});

describe('объявленная форма ответа о здоровье', () => {
  it('через маршрут доезжают все поля, которые собрал строитель', async () => {
    const direct = health.buildHealthReport();
    const overWire = (await app.inject({ method: 'GET', url: '/api/health' }))
      .json<ReturnType<HealthModule['buildHealthReport']>>();

    // Состав верхнего уровня и состав сводки по источникам — без потерь.
    expect(Object.keys(overWire).sort()).toEqual(Object.keys(direct).sort());
    expect(Object.keys(overWire.sources).sort()).toEqual(Object.keys(direct.sources).sort());
    expect(overWire.sources.items.length).toBe(direct.sources.items.length);
    expect(Object.keys(overWire.sources.items[0]).sort()).toEqual(
      Object.keys(direct.sources.items[0]).sort(),
    );
    expect(overWire.status).toBe('ok');
    expect(overWire.service).toBe('aemr-server');
  });

  it('поле, не названное в объявлении, наружу не уходит', async () => {
    // Ровно та защита, ради которой форма объявлена. Здесь утечка подстроена
    // нарочно: в ответ подложены идентификатор книги и почта служебной учётной
    // записи — то самое, что однажды попадёт туда по недосмотру. Маршрут
    // публичный, и без объявленной формы это ушло бы в мир как есть.
    const leaky = Fastify({ logger: false });
    leaky.get('/api/health', { schema: { response: health.HEALTH_RESPONSE_SCHEMA } }, async () => ({
      ...health.buildHealthReport(),
      spreadsheetId: '1AbCdEfGhIjKlMnOpQrStUvWxYz',
      serviceAccount: 'aemr-reader@aemr-prod.iam.gserviceaccount.com',
      sources: {
        ...health.buildHealthReport().sources,
        googleError: 'The caller does not have permission on 1AbCdEfGhIjKlMnOpQrStUvWxYz',
      },
    }));
    await leaky.ready();

    const res = await leaky.inject({ method: 'GET', url: '/api/health' });

    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('spreadsheetId');
    expect(res.body).not.toContain('1AbCdEfGhIjKlMnOpQrStUvWxYz');
    expect(res.body).not.toContain('gserviceaccount.com');
    expect(res.body).not.toContain('googleError');
    // При этом законные поля на месте — вырезано только лишнее.
    expect(res.json<{ status: string }>().status).toBe('ok');
    await leaky.close();
  });
});
