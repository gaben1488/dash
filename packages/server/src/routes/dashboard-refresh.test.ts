/**
 * dashboard-refresh.test.ts — страж POST /api/refresh: полный цикл идёт через
 * ЕДИНЫЙ читатель источников (services/source-refresh), а не собственной копией.
 *
 * ЗАЧЕМ. До правки 20.08.2026 маршрут держал собственную перечитку: книги
 * управлений → потом лист СВОД → потом снимок, всё ПОДРЯД. Две беды сразу:
 *   • скорость: чтение листа СВОД ждало окончания восьми книг, хотя квоту
 *     Google они не делят с ним последовательностью — замер на заглушках по
 *     150 мс дал ~330 мс на цикл против ~160 мс параллельного;
 *   • устойчивость: ручное «Обновить» во время автоцикла или вебхука читало
 *     все девять книг ВТОРОЙ раз одновременно с циклом — ровно тот залп, на
 *     который Google отвечает «слишком часто» (реестр багов 09.07.2026).
 * Единый читатель уже умеет и параллельность, и склейку одновременных вызовов
 * (inFlight), и живые события, и журнал с числами — маршрут обязан брать его,
 * а не вести вторую правду о том, как читаются источники (канон п.112).
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

/** Задержка заглушки одного обращения к источнику. */
const SOURCE_DELAY_MS = 150;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface FakeDeptResult {
  values: unknown[][];
  formulas: unknown[][];
  sheetName: string;
}
type FetchResult = { data: Record<string, FakeDeptResult>; errors: Record<string, string> };

/**
 * Отрезки времени, занятые чтением источников. Параллельность проверяется
 * НАЛОЖЕНИЕМ отрезков, а не длительностью цикла: часы меряют загрузку
 * машины (страж падал на общем прогоне 75 файлов и проходил в одиночку),
 * а пересечение отрезков — само устройство кода.
 */
const spans: Array<{ who: 'books' | 'svod'; from: number; to: number }> = [];

function overlap(a: { from: number; to: number }, b: { from: number; to: number }): number {
  return Math.min(a.to, b.to) - Math.max(a.from, b.from);
}

const fetchDepartmentSpreadsheets = vi.fn<() => Promise<FetchResult>>(async () => {
  const from = Date.now();
  await sleep(SOURCE_DELAY_MS);
  spans.push({ who: 'books', from, to: Date.now() });
  return {
    data: {
      'УО': { values: [[1], [2], [3]], formulas: [], sheetName: 'ВСЕ' },
      'УКСиМП': { values: [[1], [2]], formulas: [], sheetName: 'Все' },
    },
    errors: {},
  };
});
const getSheetData = vi.fn(async () => {
  const from = Date.now();
  await sleep(SOURCE_DELAY_MS);
  spans.push({ who: 'svod', from, to: Date.now() });
  return [['СВОД']];
});

vi.mock('../services/google-sheets.js', () => ({
  fetchDepartmentSpreadsheets: (...a: unknown[]) => (fetchDepartmentSpreadsheets as (...a: unknown[]) => unknown)(...a),
  getSheetData: (...a: unknown[]) => (getSheetData as (...a: unknown[]) => unknown)(...a),
}));

/** Стейт снимка — маршрут строит ответ из него, поэтому заглушки хранят состояние. */
let deptSheetCache: Record<string, { values: unknown[][]; formulas: unknown[][]; sheetName: string }> = {};
let deptLoadMeta: Record<string, { loadedAt: string; rowCount: number; sheetName: string; error?: string }> = {};

const getSnapshot = vi.fn(async () => ({
  id: 'snap-1',
  createdAt: new Date().toISOString(),
  officialMetrics: { 'grbs.uo.year.plan_count': { numericValue: 1 } },
  calculatedMetrics: {},
  deltas: [],
  issues: [],
  trust: { overall: 87 },
}));

vi.mock('../services/snapshot.js', () => ({
  getSnapshot: (...a: unknown[]) => (getSnapshot as (...a: unknown[]) => unknown)(...a),
  invalidateCache: vi.fn(),
  setDeptSheetCache: (
    data: Record<string, { values: unknown[][]; formulas: unknown[][]; sheetName: string }>,
    failed: readonly string[] = [],
  ) => {
    deptSheetCache = { ...deptSheetCache, ...data };
    for (const name of failed) Reflect.deleteProperty(deptSheetCache, name);
  },
  getDeptSheetCache: () => deptSheetCache,
  setDeptLoadMeta: (meta: typeof deptLoadMeta) => {
    deptLoadMeta = { ...deptLoadMeta, ...meta };
  },
  getDeptLoadMeta: () => deptLoadMeta,
  setSvodGridCache: vi.fn(),
  setSvodLoadFailure: vi.fn(),
}));

vi.mock('../config.js', () => ({
  DEPARTMENT_SPREADSHEETS: { 'УО': 'ss-uo', 'УКСиМП': 'ss-uksimp' },
  config: {
    cache: { autoRefreshMinutes: 0, ttlSeconds: 300, sourceFreshnessSeconds: 300 },
    weeklySnapshot: { utcOffsetHours: 12 },
    google: { spreadsheetId: 'ss-main' },
    // Единый читатель тянет водяной знак, а тот — базу: без адреса база не
    // откроется. В стражах она живёт в памяти.
    database: { url: ':memory:' },
  },
}));

let app: FastifyInstance;

beforeAll(async () => {
  const { dashboardRoutes } = await import('./dashboard.js');
  app = Fastify({ logger: false });
  await dashboardRoutes(app);
  await app.ready();
}, 60_000);

beforeEach(() => {
  fetchDepartmentSpreadsheets.mockClear();
  getSheetData.mockClear();
  deptSheetCache = {};
  deptLoadMeta = {};
  spans.length = 0;
});

const refresh = (qs = '') => app.inject({ method: 'POST', url: `/api/refresh${qs}` });

describe('POST /api/refresh — полный цикл', () => {
  it('книги и лист СВОД читаются ПАРАЛЛЕЛЬНО, а не одно за другим', async () => {
    const res = await refresh();
    expect(res.statusCode).toBe(200);

    const books = spans.find((s) => s.who === 'books');
    const svod = spans.find((s) => s.who === 'svod');
    expect(books, 'книги не читались вовсе').toBeDefined();
    expect(svod, 'лист СВОД не читался вовсе').toBeDefined();

    // Последовательное чтение даёт непересекающиеся отрезки; параллельное —
    // наложение почти во всю длину. Требуем перекрытия хотя бы наполовину:
    // запас покрывает и дрожание таймеров, и занятую машину.
    const shared = overlap(books!, svod!);
    console.log(`наложение чтений: ${shared} мс из ${SOURCE_DELAY_MS} мс задержки источника`);
    expect(shared).toBeGreaterThan(SOURCE_DELAY_MS / 2);
  });

  it('одновременный второй вызов НЕ читает книги второй раз (склейка циклов)', async () => {
    const [a, b] = await Promise.all([refresh(), refresh()]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(fetchDepartmentSpreadsheets).toHaveBeenCalledTimes(1);
  });

  it('ответ сохраняет прежнюю форму: источники с числом строк, счётчики снимка', async () => {
    const body = refreshBody(await refresh());

    expect(body.success).toBe(true);
    expect(body.snapshotId).toBe('snap-1');
    const deptSources = (body.sources as Array<Record<string, unknown>>).filter((s) => s.type === 'department');
    expect(deptSources).toHaveLength(2);
    expect(deptSources.find((s) => s.name === 'УО')).toMatchObject({ loaded: true, rowCount: 3 });
    const svod = (body.sources as Array<Record<string, unknown>>).find((s) => s.type === 'svod');
    expect(svod).toMatchObject({ loaded: true });
    expect(body.departmentRowCounts).toMatchObject({ 'УО': 3, 'УКСиМП': 2 });
  });

  it('упавшая книга видна в ответе с причиной, остальные — прочитаны', async () => {
    fetchDepartmentSpreadsheets.mockImplementationOnce(async () => {
      await sleep(5);
      return {
        data: { 'УО': { values: [[1]], formulas: [], sheetName: 'ВСЕ' } },
        errors: { 'УКСиМП': 'Request failed with status code 429' },
      };
    });
    const body = refreshBody(await refresh());

    const failed = (body.sources as Array<Record<string, unknown>>).find((s) => s.name === 'УКСиМП');
    expect(failed).toMatchObject({ loaded: false });
    expect(String(failed?.error ?? '')).not.toBe('');
    const ok = (body.sources as Array<Record<string, unknown>>).find((s) => s.name === 'УО');
    expect(ok).toMatchObject({ loaded: true, rowCount: 1 });
  });
});

describe('POST /api/refresh?quick=true', () => {
  it('быстрый путь книги не трогает — только лист СВОД и снимок', async () => {
    const res = await refresh('?quick=true');
    expect(res.statusCode).toBe(200);
    expect(fetchDepartmentSpreadsheets).not.toHaveBeenCalled();
    expect(getSheetData).toHaveBeenCalledTimes(1);
  });
});

function refreshBody(res: { statusCode: number; json: () => Record<string, unknown> }): Record<string, unknown> {
  expect(res.statusCode).toBe(200);
  return res.json();
}
