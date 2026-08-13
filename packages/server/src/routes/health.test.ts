/**
 * Ответ о здоровье: наблюдаемость без утечки.
 *
 * Охраняются четыре обещания:
 *   1. Видно состояние КАЖДОГО настроенного источника — включая тот, до
 *      которого ни разу не дошли (иначе непрочитанная книга просто исчезает
 *      из списка и картина выглядит лучше, чем есть).
 *   2. Непрочитанный источник честно пуст: ни времени чтения, ни числа строк,
 *      а не ноль, выданный за прочитанный ноль строк.
 *   3. Причина отказа — русская фраза из закрытого списка. Исходное сообщение
 *      Google наружу не идёт: маршрут публичный, а в этом сообщении бывают и
 *      адрес книги, и почта служебной учётной записи.
 *   4. Поле `status` наверху сохраняет прежний смысл «процесс отвечает» — на
 *      нём стоит проверка живости контейнера и вкладка «Подключение».
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.SQLITE_PATH = ':memory:';
process.env.LOG_LEVEL = 'silent';

type HealthModule = typeof import('./health.js');
type SnapshotModule = typeof import('../services/snapshot.js');
type ConfigModule = typeof import('../config.js');

let health: HealthModule;
let snapshot: SnapshotModule;
let deptNames: string[];

beforeAll(async () => {
  const config: ConfigModule = await import('../config.js');
  health = await import('./health.js');
  snapshot = await import('../services/snapshot.js');
  deptNames = Object.keys(config.DEPARTMENT_SPREADSHEETS);
  // Первый импорт тянет базу и расчётное ядро — на холодную это дольше
  // стандартного срока подготовки.
}, 60_000);

describe('до первого чтения источников', () => {
  it('честно сообщает, что источники ещё не читались, и не показывает нулей', () => {
    const report = health.buildHealthReport(new Date('2026-08-08T03:00:00.000Z'));

    expect(report.status).toBe('ok');
    expect(report.timestamp).toBe('2026-08-08T03:00:00.000Z');
    expect(report.sources.state).toBe('unknown');
    expect(report.sources.summary).toBe('Источники ещё не читались с запуска сервера');
    expect(report.sources.lastSuccessAt).toBeNull();

    // Каждая настроенная книга плюс лист СВОД.
    expect(report.sources.items).toHaveLength(deptNames.length + 1);
    for (const item of report.sources.items) {
      expect(item.state).toBe('pending');
      expect(item.rowCount).toBeNull();
      expect(item.loadedAt).toBeNull();
    }
  });
});

describe('после чтения с частичным отказом', () => {
  const RAW_GOOGLE_ERROR =
    'The caller does not have permission to spreadsheet 1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789 ' +
    '(service account aemr-reader@aemr-project.iam.gserviceaccount.com)';

  beforeAll(() => {
    snapshot.setSvodGridCache([[1], [2], [3]]);
    snapshot.setDeptLoadMeta({
      [deptNames[0]]: {
        loadedAt: '2026-08-08T02:00:00.000Z',
        rowCount: 673,
        sheetName: 'ВСЕ',
      },
      [deptNames[1]]: {
        loadedAt: '2026-08-08T02:00:01.000Z',
        rowCount: 0,
        sheetName: deptNames[1],
        error: RAW_GOOGLE_ERROR,
      },
    });
  });

  it('называет прочитанные и непрочитанные книги поимённо', () => {
    const { sources } = health.buildHealthReport();

    expect(sources.state).toBe('degraded');
    expect(sources.summary).toContain(`Не прочитаны: ${deptNames[1]} (нет доступа к книге)`);
    expect(sources.loaded).toBeGreaterThanOrEqual(2); // книга + лист СВОД
    expect(sources.failed).toBe(1);
  });

  it('у прочитанной книги есть время и число строк, у непрочитанной — пусто', () => {
    const { sources } = health.buildHealthReport();
    const ok = sources.items.find((i) => i.name === deptNames[0]);
    const failed = sources.items.find((i) => i.name === deptNames[1]);

    expect(ok).toMatchObject({
      state: 'ok',
      loadedAt: '2026-08-08T02:00:00.000Z',
      rowCount: 673,
    });
    expect(failed).toMatchObject({ state: 'failed', loadedAt: null, rowCount: null });
    // Время ПОПЫТКИ остаётся: по нему видно, что источник опрашивали.
    expect(failed?.checkedAt).toBe('2026-08-08T02:00:01.000Z');
  });

  it('исходное сообщение источника наружу не выходит', () => {
    const body = JSON.stringify(health.buildHealthReport());

    expect(body).not.toContain('1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789');
    expect(body).not.toContain('aemr-reader@aemr-project.iam.gserviceaccount.com');
    expect(body).not.toContain('permission');
  });

  it('время последнего успеха — самое свежее из успешных', () => {
    const { sources } = health.buildHealthReport();
    expect(sources.lastSuccessAt).not.toBeNull();
    expect(sources.lastSuccessAt! >= '2026-08-08T02:00:00.000Z').toBe(true);
  });
});

describe('классификация причины отказа', () => {
  it('переводит ответы источника в закрытый список русских фраз', () => {
    const cases: Array<[string, string]> = [
      ['Таблица-источник не ответила за 20 с: чтение листа «ВСЕ»', 'источник не ответил вовремя'],
      ['Quota exceeded for quota metric', 'источник ограничил частоту обращений'],
      ['The caller does not have permission', 'нет доступа к книге'],
      ['getaddrinfo ENOTFOUND sheets.googleapis.com', 'нет связи с источником'],
      ['Internal error encountered. (500)', 'источник временно недоступен'],
      ['No readable sheet found in spreadsheet for УО', 'нужный лист в книге не найден'],
      ['нечто небывалое', 'книга не прочитана'],
    ];

    for (const [raw, expected] of cases) {
      expect(health.classifySourceFailure(raw), raw).toBe(expected);
    }
  });
});

describe('маршрут', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(health.healthRoutes);
    await app.ready();
  });

  it('отвечает 200 и сохраняет прежний вид ответа для проверки живости', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);

    const body = res.json<Record<string, unknown>>();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('aemr-server');
    expect(typeof body.timestamp).toBe('string');
    expect(body).not.toHaveProperty('spreadsheetId');
    expect(body.sources).toBeTruthy();

    await app.close();
  });
});
