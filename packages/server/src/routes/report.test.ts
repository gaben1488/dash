/**
 * GET /api/report — роут-тесты (волна 2A, TDD).
 *
 * Калибровка эталоном ручного отчёта «Отчёт по закупкам на 20.03.2026»
 * (та же фикстура, что build-report.test.ts в core): УЭР 1 кв план 15 /
 * факт 6 → 40.00%. Сеть замокана «в отказ»: лист СВОД недоступен →
 * отчёт обязан отдаться без официальной колонки, с честной плашкой.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEPT_COLUMNS, dayNumberOf } from '@aemr/shared';
import type { DataSnapshot } from '@aemr/shared';
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

/** Тело ответа: Report + методология + ссылка «СВОД онлайн». */
type ReportResponse = Omit<Report, 'period'> & {
  period: Report['period'] & { asOfDay: number; live: boolean };
  methodology: string;
  svodOnlineUrl?: string;
};

/**
 * Минимальный DataSnapshot со строками-атомами — та форма, в которой пайплайн
 * сохраняет снимок в snapshots.data (rowsByDept — уже без шапки).
 */
function makeSnapshot(
  id: string,
  createdAt: string,
  rowsByDept: Record<string, unknown[][]>,
): DataSnapshot {
  return {
    id,
    spreadsheetId: 'test-spreadsheet',
    createdAt,
    officialMetrics: {},
    calculatedMetrics: {},
    deltas: [],
    issues: [],
    trust: { overall: 100, components: [], grade: 'A', computedAt: createdAt, basedOnSnapshot: id },
    rowCount: Object.values(rowsByDept).reduce((n, rows) => n + rows.length, 0),
    rowsByDept,
    metadata: { sheetsRead: [], cellsRead: 0, readDurationMs: 0, pipelineDurationMs: 0 },
  };
}

describe('GET /api/report — проекция отчёта (эталон 20.03.2026)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'test', AEMR_API_KEY: '', SQLITE_PATH: ':memory:', LOG_LEVEL: 'silent' };
    const { setDeptSheetCache } = await import('../services/snapshot.js');
    const headers = [new Array(32).fill('h'), new Array(32).fill('h'), new Array(32).fill('h')];
    // УЭР: 1 кв план 15 (10 ЭА + 5 ЕП), факт 6 (4 + 2) → 40.00% — эталон отчёта.
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

  it('svodOnlineUrl: ссылка на официальную сводную книгу Google Sheets', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/report?year=2026&quarter=1' });
    expect(res.statusCode).toBe(200);
    const body = res.json<ReportResponse>();
    // Ссылка ведёт на книгу СВОД целиком (без gid — вкладку читатель выберет сам)
    // и несёт ИМЕННО текущий config-id (не любой): смена источника в рантайме
    // должна менять и ссылку (URL считается на запрос, не на import).
    const { config } = await import('../config.js');
    expect(typeof body.svodOnlineUrl).toBe('string');
    expect(body.svodOnlineUrl!.startsWith('https://docs.google.com/spreadsheets/d/')).toBe(true);
    expect(body.svodOnlineUrl).toContain(config.google.spreadsheetId);
    expect(body.svodOnlineUrl).not.toContain('gid=');
  }, 30_000);

  it('без asOf: ПРЯМОЙ ЭФИР — сегодня по календарю продукта, флора к четвергу нет', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/report' });
    expect(res.statusCode).toBe(200);
    const body = res.json<ReportResponse>();
    // «Сегодня» — по календарю ПРОДУКТА (фиксированное смещение из конфига,
    // в тестовой env — дефолтные +12), а не по TZ машины CI: та же формула,
    // что в роуте, — тест не зависит от пояса, где он гоняется.
    const { productCalendarDay } = await import('../services/product-calendar.js');
    const { config } = await import('../config.js');
    const today = productCalendarDay(new Date(), config.weeklySnapshot.utcOffsetHours);
    expect(body.period.live).toBe(true);
    expect(body.period.asOfDay).toBe(today);
    // Год/квартал — из СЕГОДНЯШНЕЙ даты: эфир показывает текущее положение дел.
    const now = new Date(today * 86400000);
    expect(body.period.year).toBe(now.getUTCFullYear());
    expect(body.period.quarter).toBe(Math.floor(now.getUTCMonth() / 3) + 1);
  }, 30_000);

  it('эфир не режет факт: сверка со СВОДом сравнивает одинаковые моменты', async () => {
    const body = (await app.inject({ method: 'GET', url: '/api/report' })).json<ReportResponse>();
    // В эфире отчётные числа и живой счёт — одно и то же, поэтому примечания
    // не содержат оговорки про заключённое после среза.
    expect(body.notes.some((n) => n.includes('После даты среза'))).toBe(false);
    for (const b of body.grbsBlocks) {
      expect(b.quarter.live.kp.doneCount).toBe(b.quarter.methods.kp.doneCount);
      expect(b.quarter.live.ep.doneCount).toBe(b.quarter.methods.ep.doneCount);
    }
  }, 30_000);

  it('явный asOf = архив: режим не эфирный, гейт факта включён', async () => {
    const body = (await app.inject({ method: 'GET', url: '/api/report?asOf=2026-02-10' }))
      .json<ReportResponse>();
    expect(body.period.live).toBe(false);
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

describe('GET /api/report — id сводной книги не настроен', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.resetModules();
    // Пустая строка в env НЕ перекрывается дефолтом (?? пропускает только null/undefined)
    // — это и есть «конфига нет» для ссылки «СВОД онлайн».
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      AEMR_API_KEY: '',
      SQLITE_PATH: ':memory:',
      LOG_LEVEL: 'silent',
      GOOGLE_SHEETS_SPREADSHEET_ID: '',
    };
    const { setDeptSheetCache } = await import('../services/snapshot.js');
    const headers = [new Array(32).fill('h'), new Array(32).fill('h'), new Array(32).fill('h')];
    setDeptSheetCache({
      УЭР: {
        values: [...headers, ...planRows('uer-kp', 10, 4, 1, 'ЭА')],
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

  it('поля svodOnlineUrl в ответе нет (не пустая строка)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/report?year=2026&quarter=1' });
    expect(res.statusCode).toBe(200);
    const body = res.json<ReportResponse>();
    expect(body.svodOnlineUrl).toBeUndefined();
    expect('svodOnlineUrl' in body).toBe(false);
  }, 30_000);
});

describe('GET /api/report — прошлая неделя строится из снимка', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'test', AEMR_API_KEY: '', SQLITE_PATH: ':memory:', LOG_LEVEL: 'silent' };
    const { setDeptSheetCache, saveSnapshot } = await import('../services/snapshot.js');
    const headers = [new Array(32).fill('h'), new Array(32).fill('h'), new Array(32).fill('h')];
    // Живой кэш НАРОЧНО с другими числами (15 план / 6 факт): возьми роут живые
    // данные вместо снимка — числа выдадут подмену и тест её поймает.
    setDeptSheetCache({
      УЭР: {
        values: [...headers, ...planRows('live-kp', 10, 4, 1, 'ЭА'), ...planRows('live-ep', 5, 2, 1, 'ЕП')],
        formulas: [],
        sheetName: 'УЭР',
      },
    });
    // Снимок прошлой недели (четверг 19.03.2026): 10 план / 3 факт → 30.00%.
    await saveSnapshot(
      makeSnapshot('snap-past-week', '2026-03-19T08:00:00.000Z', {
        УЭР: planRows('snap-kp', 10, 3, 1, 'ЭА'),
      }),
    );
    const { createApp } = await import('../app.js');
    app = await createApp({ logger: false });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it('asOf прошлой недели: числа из снимка (не из живого кэша) + плашка про снимок', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/report?asOf=2026-03-19&year=2026&quarter=1' });
    expect(res.statusCode).toBe(200);
    const body = res.json<ReportResponse>();

    const uer = body.grbsBlocks.find((b) => b.dept === 'УЭР');
    expect(uer).toBeDefined();
    // Числа снимка (10/3), а не живого кэша (15/6) — история не переписана.
    expect(uer!.quarter.execution.planCount).toBe(10);
    expect(uer!.quarter.execution.doneCount).toBe(3);
    expect(uer!.quarter.execution.pct).toBeCloseTo(30.0, 2);

    // Плашка об источнике — с датой снимка в человеческом формате.
    expect(body.notes.some((n) => n.includes('снимка 19.03.2026'))).toBe(true);
  }, 30_000);
});

describe('GET /api/report — прошлая неделя без снимка: живой кэш + честная плашка', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'test', AEMR_API_KEY: '', SQLITE_PATH: ':memory:', LOG_LEVEL: 'silent' };
    const { setDeptSheetCache } = await import('../services/snapshot.js');
    const headers = [new Array(32).fill('h'), new Array(32).fill('h'), new Array(32).fill('h')];
    setDeptSheetCache({
      УЭР: {
        values: [...headers, ...planRows('uer-kp', 10, 4, 1, 'ЭА'), ...planRows('uer-ep', 5, 2, 1, 'ЕП')],
        formulas: [],
        sheetName: 'УЭР',
      },
    });
    // Снимков в БД нет — прошлое запрошено, а истории не существует.
    const { createApp } = await import('../app.js');
    app = await createApp({ logger: false });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it('asOf прошлой недели без снимка: текущие данные + плашка «снимка нет»', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/report?asOf=2026-03-19&year=2026&quarter=1' });
    expect(res.statusCode).toBe(200);
    const body = res.json<ReportResponse>();

    // Фолбэк на живой кэш: числа текущих данных, не пустота и не 5xx.
    const uer = body.grbsBlocks.find((b) => b.dept === 'УЭР');
    expect(uer!.quarter.execution.planCount).toBe(15);
    expect(uer!.quarter.execution.doneCount).toBe(6);

    // Честная плашка: читатель знает, что видит текущие данные под датой среза.
    expect(body.notes.some((n) => n.includes('Снимка на 19.03.2026 нет'))).toBe(true);
    expect(body.notes.some((n) => n.includes('текущие данные'))).toBe(true);
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
