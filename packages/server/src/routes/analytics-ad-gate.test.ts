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
 * Строка конкурентной закупки с экономией 50 % от плана: без гейта это
 * гарантированный вердикт «высокая экономия» (порог 25 %).
 */
function rowWithEconomy(flag: string, factDate: string): unknown[] {
  const row = Array<unknown>(34).fill('');
  row[DEPT_COLUMNS.ID] = 1;
  row[DEPT_COLUMNS.SUBJECT] = 'Ремонт кровли';
  row[DEPT_COLUMNS.TOTAL_PLAN] = 100;
  row[DEPT_COLUMNS.METHOD] = 'ЭА';
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
  const body = res.json<{ issues: Array<{ ruleCode: string; rowIndex?: number }> }>();
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

describe('GET /api/analytics/compliance — антидемпинг считает только утверждённую экономию', () => {
  it('экономия не утверждена (флаг «нет») → вердикта нет', async () => {
    setDeptSheetCache({ 'УО': { values: [[], [], [], rowWithEconomy('нет', '15.03.2026')], formulas: [], sheetName: 'ВСЕ' } });
    expect(await antiDumpingIssues()).toEqual([]);
  }, 30_000);

  it('флаг стоит, но контракт не заключён (дата факта пуста) → вердикта нет', async () => {
    setDeptSheetCache({ 'УО': { values: [[], [], [], rowWithEconomy('да', '')], formulas: [], sheetName: 'ВСЕ' } });
    expect(await antiDumpingIssues()).toEqual([]);
  }, 30_000);

  it('экономия утверждена и контракт заключён → вердикт с адресом строки', async () => {
    setDeptSheetCache({ 'УО': { values: [[], [], [], rowWithEconomy('да', '15.03.2026')], formulas: [], sheetName: 'ВСЕ' } });
    const issues = await antiDumpingIssues();
    expect(issues.length).toBe(1);
    expect(issues[0]?.rowIndex).toBe(4);
  }, 30_000);
});
