/**
 * Страж утверждённой экономии в проверках закона (реестр багов 09.07.2026,
 * п.1 «обход флага экономии в антидемпинге»).
 *
 * Обещание: маршруты аналитики читают построчную экономию ТОЛЬКО через
 * approvedEconomy — сумму Z+AA+AB под гейтами «Учитывать в расчёте экономии =
 * да» и «дата заключения есть». Сырая сумма из неутверждённых ячеек порождала
 * вердикт «внимание, статья 37» о закупке, которую никто не согласовывал.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEPT_COLUMNS } from '@aemr/shared';

const ORIGINAL_ENV = { ...process.env };

vi.mock('../services/google-sheets.js', () => ({
  writeCellValue: vi.fn(async () => ({ updatedCells: 1, updatedRange: 'ВСЕ!A1' })),
  resolveDeptSheetName: vi.fn(async () => 'ВСЕ'),
  batchGetCells: vi.fn(async () => { throw new Error('сеть в тесте выключена'); }),
  batchGetFormulas: vi.fn(async () => { throw new Error('сеть в тесте выключена'); }),
  getSheetData: vi.fn(async () => []),
  getSheetDataFromSpreadsheet: vi.fn(async () => []),
  readDeptSheet: vi.fn(async () => ({ values: [], formulas: [], sheetName: 'ВСЕ' })),
  getSpreadsheetMetadata: vi.fn(async () => { throw new Error('сеть в тесте выключена'); }),
  fetchSHDYUSheet: vi.fn(async () => { throw new Error('сеть в тесте выключена'); }),
}));

/**
 * Строка с экономией 50 % от плана, но без НМЦК и предложенной цены.
 * Ни флаг AD, ни дата заключения не добавляют отсутствующие данные.
 */
function rowWithEconomy(flag: string, factDate: string, method = 'ЭА'): unknown[] {
  const row = Array<unknown>(34).fill('');
  row[DEPT_COLUMNS.ID] = 1;
  row[DEPT_COLUMNS.SUBJECT] = 'Ремонт кровли';
  row[DEPT_COLUMNS.TOTAL_PLAN] = 100;
  row[DEPT_COLUMNS.METHOD] = method;
  row[DEPT_COLUMNS.FACT_DATE] = factDate;
  row[DEPT_COLUMNS.TOTAL_FACT] = 50;
  row[DEPT_COLUMNS.ECONOMY_FB] = 50;
  row[DEPT_COLUMNS.FLAG] = flag;
  return row;
}

let app: FastifyInstance;
let setDeptSheetCache: typeof import('../services/snapshot.js')['setDeptSheetCache'];

async function antiDumpingIssues(): Promise<Array<{ ruleCode: string; rowIndex?: number }>> {
  const res = await app.inject({ method: 'GET', url: '/api/analytics/compliance' });
  expect(res.statusCode).toBe(200);
  const body = res.json<{
    issues: Array<{ ruleCode: string; rowIndex?: number }>;
    unavailableChecks: Array<{ ruleCode: string; status: string; reason: string }>;
  }>();
  expect(body.unavailableChecks).toContainEqual({
    ruleCode: 'anti_dumping',
    status: 'insufficient_data',
    reason: expect.stringContaining('НМЦК'),
  });
  return body.issues.filter((i) => i.ruleCode === 'anti_dumping');
}

beforeAll(async () => {
  vi.resetModules();
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: 'test',
    AEMR_API_KEY: '',
    SQLITE_PATH: ':memory:',
    LOG_LEVEL: 'silent',
    GOOGLE_SERVICE_ACCOUNT_EMAIL: '',
    GOOGLE_PRIVATE_KEY: '',
    GOOGLE_API_KEY: '',
  };
  const [snapshot, { createApp }] = await Promise.all([
    import('../services/snapshot.js'),
    import('../app.js'),
  ]);
  setDeptSheetCache = snapshot.setDeptSheetCache;
  app = await createApp({ logger: false });
  await app.ready();
}, 60_000);

afterAll(async () => {
  await app?.close();
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

describe('GET /api/analytics/compliance — экономия не доказывает антидемпинг', () => {
  it('экономия не утверждена (флаг «нет») → вердикта нет', async () => {
    setDeptSheetCache({ 'УО': { values: [[], [], [], rowWithEconomy('нет', '15.03.2026')], formulas: [], sheetName: 'ВСЕ' } });
    expect(await antiDumpingIssues()).toEqual([]);
  }, 30_000);

  it('флаг стоит, но контракт не заключён (дата факта пуста) → вердикта нет', async () => {
    setDeptSheetCache({ 'УО': { values: [[], [], [], rowWithEconomy('да', '')], formulas: [], sheetName: 'ВСЕ' } });
    expect(await antiDumpingIssues()).toEqual([]);
  }, 30_000);

  it('конкурентный алиас «ЭА (МЭП)» не восполняет отсутствующую НМЦК', async () => {
    setDeptSheetCache({ 'УО': { values: [[], [], [],
      rowWithEconomy('да', '15.03.2026', 'ЭА (МЭП)')], formulas: [], sheetName: 'ВСЕ' } });
    const issues = await antiDumpingIssues();
    expect(issues).toHaveLength(0);
  }, 30_000);

  it('утверждённая экономия и заключённый контракт не доказывают антидемпинг', async () => {
    setDeptSheetCache({ 'УО': { values: [[], [], [], rowWithEconomy('да', '15.03.2026')], formulas: [], sheetName: 'ВСЕ' } });
    const issues = await antiDumpingIssues();
    expect(issues).toHaveLength(0);
  }, 30_000);
});

it.each(['нет', 'да'])('does not infer competition or initial price from economy flag %s', async flag => {
  setDeptSheetCache({ 'УО': { values: [[], [], [], ...Array.from({ length: 6 }, () => rowWithEconomy(flag, '15.03.2026'))], formulas: [], sheetName: 'ВСЕ' } });
  const response = await app.inject({ method: 'GET', url: '/api/analytics/anticorruption' });
  expect(response.statusCode).toBe(200);
  const result = response.json().uo;
  expect(result).toBeDefined();
  expect(result.flags.some((f: { indicator: string }) => ['zero_competition', 'price_inflation'].includes(f.indicator))).toBe(false);
  expect(result.disciplinaryPenalty).toBe(0);
  expect(result.unavailableIndicators.map((f: { indicator: string }) => f.indicator)).toEqual(['zero_competition', 'price_inflation']);
}, 30_000);
