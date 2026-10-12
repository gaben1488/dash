import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

vi.mock('../services/google-sheets.js', () => ({
  batchGetCells: vi.fn(async () => { throw new Error('net off'); }),
  batchGetFormulas: vi.fn(async () => { throw new Error('net off'); }),
  getSheetData: vi.fn(async () => { throw new Error('net off'); }),
  getSpreadsheetMetadata: vi.fn(async () => { throw new Error('net off'); }),
  fetchSHDYUSheet: vi.fn(async () => { throw new Error('net off'); }),
}));

function sheetRow(id: string, y: number): unknown[] {
  const r: unknown[] = new Array(32).fill('');
  r[0] = id;    // A = ID
  r[6] = 'Закупка ' + id; // G = SUBJECT
  r[10] = 100;  // K = TOTAL_PLAN
  r[11] = 'ЭА'; // L = METHOD
  r[15] = y;    // P = PLAN_YEAR
  return r;
}

describe('GET /api/rows/:dept — фильтр по году (T3)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'test', AEMR_API_KEY: '', SQLITE_PATH: ':memory:', LOG_LEVEL: 'silent' };
    const { setDeptSheetCache } = await import('../services/snapshot.js');
    const headers = [new Array(32).fill('h'), new Array(32).fill('h'), new Array(32).fill('h')];
    setDeptSheetCache({ 'УЭР': { values: [...headers, sheetRow('1', 2025), sheetRow('2', 2026)], formulas: [], sheetName: 'УЭР' } });
    const { createApp } = await import('../app.js');
    app = await createApp({ logger: false });
  }, 60_000);
  afterAll(async () => { await app?.close(); process.env = { ...ORIGINAL_ENV }; vi.resetModules(); });

  it('year=2026 отдаёт только строки с planYear=2026', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/rows/УЭР?year=2026&limit=100' });
    const body = res.json<{ rows: Array<{ planYear: number }> }>();
    expect(body.rows.length).toBeGreaterThan(0);
    expect(body.rows.every(r => r.planYear === 2026)).toBe(true);
  }, 30_000);

  it('detail and list keep the same annual-series badge for comma-formatted amounts', async () => {
    const { setDeptSheetCache } = await import('../services/snapshot.js');
    const r: unknown[] = new Array(34).fill('');
    r[0] = '3'; r[6] = 'Окорока (куриные)'; r[11] = 'ЕП';
    r[10] = '1 200,00'; r[24] = '800,00'; r[16] = 'Х'; r[15] = 2026;
    setDeptSheetCache({ 'УКСиМП': { values: [[], [], [], r], formulas: [], sheetName: 'ВСЕ' } });
    const list = (await app.inject('/api/rows/УКСиМП?limit=100')).json();
    const detail = (await app.inject('/api/rows/УКСиМП/4')).json();
    expect(list.rows[0].badges.find((b: { label: string }) => b.label.includes('договоров'))).toMatchObject({ color: 'blue' });
    expect(detail.badges.find((b: { label: string }) => b.label.includes('договоров'))).toMatchObject({ color: 'blue' });
  });
  it.each(['', 2027])('does not carry a curated 2026 annual-series identity into source year %s', async sourceYear => {
    const { setDeptSheetCache } = await import('../services/snapshot.js');
    const r: unknown[] = new Array(34).fill('');
    r[0] = '3'; r[6] = 'Окорока (куриные)'; r[11] = 'ЕП';
    r[10] = '1 200,00'; r[24] = '800,00'; r[16] = 'Х'; r[15] = sourceYear;
    setDeptSheetCache({ 'УКСиМП': { values: [[], [], [], r], formulas: [], sheetName: 'ВСЕ' } });
    const list = (await app.inject('/api/rows/УКСиМП?limit=100')).json();
    const detail = (await app.inject('/api/rows/УКСиМП/4')).json();
    expect(list.rows[0].badges.some((b: { label: string }) => b.label.includes('договоров'))).toBe(false);
    expect(detail.badges.some((b: { label: string }) => b.label.includes('договоров'))).toBe(false);
  });
  it('без year отдаёт все годы', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/rows/УЭР?limit=100' });
    const body = res.json<{ rows: Array<{ planYear: number }> }>();
    const years = new Set(body.rows.map(r => r.planYear));
    expect(years.has(2025) && years.has(2026)).toBe(true);
  }, 30_000);
});
