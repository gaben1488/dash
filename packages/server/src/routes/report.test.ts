/**
 * GET /api/report — роут-тесты (волна 2A, TDD).
 *
 * Калибровка эталоном ручного отчёта «Отчёт по закупкам на 20.03.2026»
 * (та же фикстура, что build-report.test.ts в core): УЭР Q1 план 15 /
 * факт 6 → 40.00%. Сеть замокана «в отказ»: лист СВОД недоступен →
 * отчёт обязан отдаться без официальной колонки, с честной плашкой.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEPT_COLUMNS, dayNumberOf } from '@aemr/shared';
import type { Report } from '@aemr/core';

const ORIGINAL_ENV = { ...process.env };

vi.mock('../google-sheets.js', () => ({
  batchGetCells: vi.fn(async () => { throw new Error('net off'); }),
  batchGetFormulas: vi.fn(async () => { throw new Error('net off'); }),
  getSheetData: vi.fn(async () => { throw new Error('net off'); }),
  getSpreadsheetMetadata: vi.fn(async () => { throw new Error('net off'); }),
}));
vi.mock('../services/google-sheets.js', () => ({
  fetchSHDYUSheet: vi.fn(async () => { throw new Error('net off'); }),
  getSheetData: vi.fn(async () => { throw new Error('net off'); }),
  readDeptSheet: vi.fn(async () => { throw new Error('net off'); }),
}));

const COL = DEPT_COLUMNS;

/** Синтетическая строка ГРБС-листа (32 колонки, формат фикстур core). */
function makeRow(id: string, method: string, quarter: number, factDate: string): unknown[] {
  const row: unknown[] = new Array(32).fill('');
  row[COL.ID] = id;
  row[COL.TYPE] = 'Текущая деятельность';
  row[COL.SUBJECT] = 'Закупка ' + id;
  row[COL.METHOD] = method;
  row[COL.PLAN_DATE] = '15.01.2026';
  row[COL.PLAN_QUARTER] = quarter;
  row[COL.PLAN_YEAR] = 2026;
  row[COL.FACT_DATE] = factDate;
  return row;
}

/** n строк плана квартала q, из них первые withFact — с датой заключения. */
function planRows(prefix: string, n: number, withFact: number, q: number, method: string): unknown[][] {
  return Array.from({ length: n }, (_, i) =>
    makeRow(`${prefix}-${i + 1}`, method, q, i < withFact ? '20.02.2026' : ''),
  );
}

/** Тело ответа: Report + методология. */
type ReportResponse = Report & { methodology: string };

describe('GET /api/report — проекция отчёта (эталон 20.03.2026)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'test', AEMR_API_KEY: '', SQLITE_PATH: ':memory:', LOG_LEVEL: 'silent' };
    const { setDeptSheetCache } = await import('../services/snapshot.js');
    const headers = [new Array(32).fill('h'), new Array(32).fill('h'), new Array(32).fill('h')];
    // УЭР: Q1 план 15 (10 ЭА + 5 ЕП), факт 6 (4 + 2) → 40.00% — эталон отчёта.
    setDeptSheetCache({
      УЭР: {
        values: [...headers, ...planRows('uer-kp', 10, 4, 1, 'ЭА'), ...planRows('uer-ep', 5, 2, 1, 'ЕП')],
        formulas: [],
        sheetName: 'УЭР',
      },
    });
    const { createApp } = await import('../app.js');
    app = await createApp({ logger: false });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it('year+quarter: 200, форма Report, исполнение УЭР 6/15 = 40.00%', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/report?year=2026&quarter=1' });
    expect(res.statusCode).toBe(200);
    const body = res.json<ReportResponse>();

    expect(body.period.year).toBe(2026);
    expect(body.period.quarter).toBe(1);
    expect(typeof body.period.asOfDay).toBe('number');

    const uer = body.grbsBlocks.find((b) => b.dept === 'УЭР');
    expect(uer).toBeDefined();
    expect(uer!.quarter.execution.planCount).toBe(15);
    expect(uer!.quarter.execution.doneCount).toBe(6);
    expect(uer!.quarter.execution.pct).toBeCloseTo(40.0, 2);
    expect(uer!.quarter.pendingCount).toBe(9);

    // Интеграл = Σ блоков (в кэше один ГРБС — числа совпадают с блоком).
    expect(body.integralSummary.quarter.total.planCount).toBe(15);
    expect(body.integralSummary.quarter.total.doneCount).toBe(6);
    expect(body.integralSummary.quarter.kp.planCount).toBe(10);
    expect(body.integralSummary.quarter.ep.planCount).toBe(5);

    // Методология — непустая русская строка про канон G = E/D.
    expect(typeof body.methodology).toBe('string');
    expect(body.methodology).toContain('E/D');

    // СВОД в тесте недоступен (сеть в отказе) — честная плашка вместо пустоты.
    expect(body.integralSummary.svodQuarter).toBeUndefined();
    expect(body.notes.some((n) => n.includes('СВОД'))).toBe(true);
  }, 30_000);

  it('без asOf: дефолт среза — ПОСЛЕДНИЙ ЧЕТВЕРГ (еженедельный канон), период из него', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/report' });
    expect(res.statusCode).toBe(200);
    const body = res.json<ReportResponse>();
    const today = dayNumberOf(new Date())!;
    // День 0 эпохи (1970-01-01) — четверг → четверги имеют day % 7 === 0.
    const lastThursday = today - (today % 7);
    expect(body.period.asOfDay).toBe(lastThursday);
    expect(lastThursday % 7).toBe(0);
    expect(lastThursday).toBeLessThanOrEqual(today);
    // Год/квартал — из даты СРЕЗА (четверга), не из «сегодня».
    const slice = new Date(lastThursday * 86400000);
    expect(body.period.year).toBe(slice.getUTCFullYear());
    expect(body.period.quarter).toBe(Math.floor(slice.getUTCMonth() / 3) + 1);
  }, 30_000);

  it('явный asOf НЕ флорится к четвергу (уважается как задан)', async () => {
    // 2026-02-10 — вторник; срез должен остаться вторником.
    const res = await app.inject({ method: 'GET', url: '/api/report?asOf=2026-02-10' });
    expect(res.json<ReportResponse>().period.asOfDay).toBe(dayNumberOf('2026-02-10'));
    expect(dayNumberOf('2026-02-10')! % 7).not.toBe(0);
  }, 30_000);

  it('asOf=YYYY-MM-DD задаёт срез: квартал и год из даты', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/report?asOf=2026-02-10' });
    expect(res.statusCode).toBe(200);
    const body = res.json<ReportResponse>();
    expect(body.period.year).toBe(2026);
    expect(body.period.quarter).toBe(1);
    expect(body.period.asOfDay).toBe(dayNumberOf('2026-02-10'));
  }, 30_000);

  it('кривой quarter → 400, кривой asOf → 400', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/report?quarter=5' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/report?year=1999' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/report?asOf=garbage' })).statusCode).toBe(400);
  }, 30_000);
});

describe('GET /api/report — пустой кэш листов', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'test', AEMR_API_KEY: '', SQLITE_PATH: ':memory:', LOG_LEVEL: 'silent' };
    // Кэш НЕ наполняем — холодный старт без preload.
    const { createApp } = await import('../app.js');
    app = await createApp({ logger: false });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it('503 с честным текстом: данных ГРБС ещё нет', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/report?year=2026&quarter=1' });
    expect(res.statusCode).toBe(503);
    const body = res.json<{ message: string }>();
    expect(body.message).toContain('ГРБС');
  }, 30_000);
});
