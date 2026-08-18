/**
 * monitoring.test.ts — Fastify inject-тесты GET /api/monitoring (канон
 * п.69в/п.101а, спека docs/superpowers/specs/2026-08-14-daily-monitoring-tab.md).
 *
 * Проверяется контракт фундамента вкладки: реестр процедур с адресами и
 * стадиями, агрегаты экономии на торгах, честная неполнота (лист не прочитан —
 * поимённая плашка), сигнал нераспознанного кода, 503 при полном отказе книги.
 * Сеть замокана на уровне google-sheets: фикстурные гриды повторяют раскладку
 * листа управления (шапка 2 строки, данные со строки 3).
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

/**
 * Гриды по имени листа; тест меняет содержимое между сценариями.
 * Отсутствие имени в карте = лист «не прочитался» (отказ источника).
 */
const GRIDS = new Map<string, unknown[][]>();

vi.mock('../services/google-sheets.js', () => ({
  batchGetCells: vi.fn(async () => { throw new Error('net off'); }),
  batchGetFormulas: vi.fn(async () => { throw new Error('net off'); }),
  getSheetData: vi.fn(async () => { throw new Error('net off'); }),
  getSpreadsheetMetadata: vi.fn(async () => { throw new Error('net off'); }),
  readDeptSheet: vi.fn(async () => { throw new Error('net off'); }),
  fetchSHDYUSheet: vi.fn(async () => { throw new Error('net off'); }),
  getSheetDataFromSpreadsheet: vi.fn(async (_id: string, sheetName: string) => {
    const grid = GRIDS.get(sheetName);
    if (!grid) throw new Error(`Таблица-источник не ответила: чтение листа «${sheetName}»`);
    return grid;
  }),
}));

/** Строка листа управления (16 колонок раскладки спеки §2). */
function row(over: {
  customer?: string; subject?: string; nmck?: unknown;
  publication?: string; price?: unknown; check?: string; winner?: string;
}): unknown[] {
  const r: unknown[] = new Array(16).fill('');
  r[0] = 1;
  r[1] = over.customer ?? 'МКУ ЦЭР';
  r[2] = over.subject ?? '';
  r[3] = over.nmck ?? '';
  r[5] = over.publication ?? '';
  r[8] = over.price ?? '';
  r[10] = over.check ?? '';
  r[14] = over.winner ?? '';
  return r;
}

const HEADERS: unknown[][] = [new Array(16).fill('ш'), new Array(16).fill('ш')];

describe('/api/monitoring', () => {
  let app: FastifyInstance;
  let invalidateMonitoringCache: () => void;

  beforeAll(async () => {
    vi.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      AEMR_API_KEY: '',
      SQLITE_PATH: ':memory:',
      LOG_LEVEL: 'silent',
    };

    // УЭР: состоялась (снижение 33 336) и объявленная без итога.
    GRIDS.set('1. УЭР', [
      ...HEADERS,
      row({
        subject: 'ЭЗК426-25 Поставка брендированных шатров', nmck: 446_700,
        publication: '24.12.2025', price: 413_364, check: 'верно',
        winner: 'ИП ДОЙНЯК-НОВЫЙ ДМИТРИЙ ОЛЕГОВИЧ',
      }),
      row({ subject: 'ЭА11-26 Ремонт кровли', nmck: '2 250 000,00', publication: '05.02.2026' }),
    ]);
    // УО: без результата (цена 0) и искажённый код (дефис после префикса).
    GRIDS.set('8. УО', [
      ...HEADERS,
      row({ customer: 'МБОУ ЕСШ №1', subject: 'ЭА10-26 Поставка бумаги', nmck: 100_000, publication: '01.02.2026', price: 0 }),
      row({ customer: 'МБОУ ЕСШ №2', subject: 'ЭЗК-120-26 Стройматериалы', nmck: 10_000 }),
    ]);
    // Остальные шесть листов книги в этом сценарии «не прочитались».

    ({ invalidateMonitoringCache } = await import('../services/monitoring.js'));

    const { createApp } = await import('../app.js');
    app = await createApp({ logger: false });
  }, 60_000);

  afterAll(async () => {
    await app.close();
    process.env = { ...ORIGINAL_ENV };
  });

  it('отдаёт реестр процедур с адресами, стадиями и деньгами в рублях', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/monitoring' });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.source.bookName).toBe('Ежедневный мониторинг');
    expect(body.source.moneyUnit).toBe('руб');
    expect(typeof body.source.readAt).toBe('string');
    expect(body.source.sheetsRead).toEqual(['1. УЭР', '8. УО']);

    expect(body.procedures).toHaveLength(4);
    expect(body.procedures[0]).toMatchObject({
      sheet: '1. УЭР', row: 3, dept: 'УЭР', code: 'ЭЗК426-25',
      stage: 'awarded', nmck: 446_700, auctionPrice: 413_364, reductionRub: 33_336,
    });
    // НМЦК текстом с неразрывными пробелами разобрана в число (спека §3).
    expect(body.procedures[1]).toMatchObject({ stage: 'published', nmck: 2_250_000 });
    expect(body.procedures[2]).toMatchObject({ dept: 'УО', stage: 'no_result' });

    // Агрегаты: экономия на торгах — по состоявшимся, в рублях.
    expect(body.aggregates.total).toBe(4);
    expect(body.aggregates.byStage).toEqual({ application: 1, published: 1, awarded: 1, no_result: 1 });
    expect(body.aggregates.awarded.savingsTotal).toBe(33_336);
    expect(body.aggregates.awarded.avgReductionPct).toBeCloseTo(7.4627, 3);
  });

  it('честная неполнота: непрочитанные листы названы поимённо, а не замолчаны', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/monitoring' });
    const body = res.json();

    const failedNames = Object.keys(body.source.sheetsFailed);
    expect(failedNames).toHaveLength(6);
    expect(failedNames).toContain('6. УД');
    expect(body.notes.join(' ')).toContain('Листы не прочитаны');
    // Подпись единицы денег — правило волны: рубли, книги ГРБС — тысячи.
    expect(body.notes.join(' ')).toContain('в рублях');
  });

  it('искажённый код процедуры — сигнал с адресом, строка из реестра не выпадает', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/monitoring' });
    const body = res.json();

    expect(body.unparsedCodes).toEqual([
      { sheet: '8. УО', row: 4, text: 'ЭЗК-120-26 Стройматериалы' },
    ]);
    const broken = body.procedures.find((p: { row: number; sheet: string }) => p.sheet === '8. УО' && p.row === 4);
    expect(broken).toBeDefined();
    expect(broken.code).toBeNull();
  });

  it('полный отказ книги — 503 с русской причиной, а не пустой реестр под видом данных', async () => {
    GRIDS.clear();
    invalidateMonitoringCache();

    const res = await app.inject({ method: 'GET', url: '/api/monitoring' });
    expect(res.statusCode).toBe(503);
    expect(res.json().message).toContain('Ежедневный мониторинг');
  });
});
