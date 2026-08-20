/**
 * Характеризационный замок ПЕРЕД упрощением S3/S6 (SIMPLIFY_REGISTER_2026-06-05).
 *
 * Роут дашборда собирал блок периода тремя почти одинаковыми списками полей:
 * кварталы, месяцы и годовой срез перечисляли одни и те же двадцать с лишним
 * ключей отдельно, а сами блоки объявлялись как `Record<string, any>`. Списки
 * обязаны совпадать — расхождение означает, что месяц и квартал показывают
 * разные наборы чисел на одном экране.
 *
 * Замок фиксирует: состав полей блока, совпадение состава у квартала и месяца,
 * пересчёт долей в проценты с одним знаком и правило «месяц без строк не
 * материализуется». После сведения к одному строителю он обязан остаться
 * зелёным.
 *
 * Фикстура: УО, две строки 2026 года — первый квартал (январь, план 100, факт
 * 90 в марте) и второй квартал (апрель, план 200, факт не наступил).
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEPT_COLUMNS } from '@aemr/shared';
import type { DepartmentSummary } from '@aemr/shared';

const ORIGINAL_ENV = { ...process.env };

// Сети в тесте нет: чтения официальных ячеек и листов возвращают пусто, и
// снимок собирается ровно из подложенного кэша книги ГРБС.
vi.mock('../services/google-sheets.js', () => ({
  batchGetCells: vi.fn(async () => []),
  batchGetFormulas: vi.fn(async () => []),
  getSpreadsheetMetadata: vi.fn(async () => ({ sheets: [] })),
  fetchSHDYUSheet: vi.fn(async () => ({ values: [], formulas: [], sheetName: 'СВОД с месяцами' })),
  getSheetData: vi.fn(async () => []),
  readDeptSheet: vi.fn(async () => ({ values: [], formulas: [], sheetName: '' })),
  fetchDepartmentSpreadsheets: vi.fn(async () => ({})),
}));

const COL = DEPT_COLUMNS;

function makeRow(o: {
  id: string;
  quarter: number;
  planDate: string;
  plan: number;
  factDate?: string;
  fact?: number;
}): unknown[] {
  const row: unknown[] = new Array(34).fill('');
  row[COL.ID] = o.id;
  row[COL.TYPE] = 'Текущая деятельность';
  row[COL.SUBJECT] = `Закупка ${o.id}`;
  row[COL.METHOD] = 'ЭА';
  row[COL.FB_PLAN] = o.plan;
  row[COL.TOTAL_PLAN] = o.plan;
  row[COL.PLAN_DATE] = o.planDate;
  row[COL.PLAN_QUARTER] = o.quarter;
  row[COL.PLAN_YEAR] = 2026;
  if (o.factDate) {
    row[COL.FACT_DATE] = o.factDate;
    row[COL.FB_FACT] = o.fact ?? o.plan;
    row[COL.TOTAL_FACT] = o.fact ?? o.plan;
  }
  return row;
}

const HEADERS = [new Array(34).fill('h'), new Array(34).fill('h'), new Array(34).fill('h')];

const UO_ROWS = [
  ...HEADERS,
  makeRow({ id: 'uo-1', quarter: 1, planDate: '15.01.2026', plan: 100, factDate: '10.03.2026', fact: 90 }),
  makeRow({ id: 'uo-2', quarter: 2, planDate: '20.04.2026', plan: 200 }),
];

interface DashboardResponse {
  departmentSummaries: DepartmentSummary[];
}

async function buildApp(): Promise<FastifyInstance> {
  const { dashboardRoutes } = await import('./dashboard.js');
  const app = Fastify({ logger: false });
  await app.register(dashboardRoutes);
  await app.ready();
  return app;
}

describe('GET /api/dashboard — блок периода у ГРБС', () => {
  let app: FastifyInstance;
  let uo: DepartmentSummary;

  beforeAll(async () => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'test', AEMR_API_KEY: '', SQLITE_PATH: ':memory:', LOG_LEVEL: 'silent' };
    const { setDeptSheetCache } = await import('../services/snapshot.js');
    setDeptSheetCache({ УО: { values: UO_ROWS, formulas: [], sheetName: 'ВСЕ' } });
    app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/dashboard?year=2026' });
    expect(res.statusCode).toBe(200);
    const body = res.json<DashboardResponse>();
    const found = body.departmentSummaries.find(d => d.department.id === 'uo');
    expect(found).toBeDefined();
    uo = found!;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  /** Состав полей блока периода — тот же список, что роут отдавал до сведения. */
  const FIELDS = [
    'planCount', 'factCount', 'planTotal', 'factTotal',
    'planFB', 'planKB', 'planMB', 'factFB', 'factKB', 'factMB',
    'economyTotal', 'economyFB', 'economyKB', 'economyMB',
    'executionPct', 'execCountPct', 'compExecCountPct', 'epExecCountPct',
    'kpCount', 'kpFactCount', 'kpPlanTotal', 'kpFactTotal',
    'epCount', 'epFactCount', 'epPlanTotal', 'epFactTotal',
  ].sort();

  it('квартал несёт ровно этот набор полей', () => {
    expect(Object.keys(uo.quarters!.q1).sort()).toEqual(FIELDS);
  });

  it('годовой срез собран тем же набором, что и квартал', () => {
    expect(Object.keys(uo.quarters!.year).sort()).toEqual(FIELDS);
  });

  it('месяц собран тем же набором, что и квартал', () => {
    expect(Object.keys(uo.months![1]).sort()).toEqual(FIELDS);
  });

  it('числа квартала: план и факт первого квартала', () => {
    const q1 = uo.quarters!.q1;
    expect(q1.planCount).toBe(1);
    expect(q1.factCount).toBe(1);
    expect(q1.planTotal).toBe(100);
    expect(q1.factTotal).toBe(90);
    expect(q1.kpCount).toBe(1);
    expect(q1.kpPlanTotal).toBe(100);
  });

  it('доли приходят процентами с одним знаком после запятой, а не долями единицы', () => {
    expect(uo.quarters!.q1.execCountPct).toBe(100);
    expect(uo.quarters!.q2.execCountPct).toBe(0);
    expect(uo.quarters!.year.execCountPct).toBe(50);
  });

  it('месяц без плана и факта не материализуется', () => {
    expect(uo.months![1]).toBeDefined();
    expect(uo.months![7]).toBeUndefined();
  });

  it('квартал без строк всё равно материализуется — в отличие от месяца', () => {
    // Третий квартал строк не имеет, но блок кварталов строится по всем четырём
    // ключам и приходит с тем же набором полей. Асимметрия с месяцами (те без
    // строк не материализуются) — сегодняшнее поведение роута, правка S3 его
    // не меняет. Сами значения пустого квартала здесь не проверяются: их вид
    // (пустота или ноль) определяет расчёт ядра, а не сборка блока.
    expect(uo.quarters!.q3).toBeDefined();
    expect(Object.keys(uo.quarters!.q3).sort()).toEqual(FIELDS);
  });
});
