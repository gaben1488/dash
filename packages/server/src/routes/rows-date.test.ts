import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

vi.mock('../google-sheets.js', () => ({
  batchGetCells: vi.fn(async () => { throw new Error('net off'); }),
  batchGetFormulas: vi.fn(async () => { throw new Error('net off'); }),
  getSheetData: vi.fn(async () => { throw new Error('net off'); }),
  getSpreadsheetMetadata: vi.fn(async () => { throw new Error('net off'); }),
}));
vi.mock('../services/google-sheets.js', () => ({
  fetchSHDYUSheet: vi.fn(async () => { throw new Error('net off'); }),
}));

/**
 * Строка листа: N (idx 13) = дата план, Q (idx 16) = дата факт.
 * 6 из 8 книг хранят даты серийными числами (46034 = 12.01.2026),
 * 2 книги — строками «дд.мм.гггг». DTO обязан отдавать канон.
 */
function sheetRow(id: string, planDate: unknown, factDate: unknown): unknown[] {
  const r: unknown[] = new Array(32).fill('');
  r[0] = id;              // A = ID
  r[6] = 'Закупка ' + id; // G = SUBJECT
  r[10] = 100;            // K = TOTAL_PLAN
  r[11] = 'ЭА';           // L = METHOD
  r[13] = planDate;       // N = PLAN_DATE
  r[16] = factDate;       // Q = FACT_DATE
  return r;
}

describe('GET /api/rows/:dept — дата-канон в DTO (fidelity §2.2)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'test', AEMR_API_KEY: '', SQLITE_PATH: ':memory:', LOG_LEVEL: 'silent' };
    const { setDeptSheetCache } = await import('../services/snapshot.js');
    const headers = [new Array(32).fill('h'), new Array(32).fill('h'), new Array(32).fill('h')];
    setDeptSheetCache({
      'УЭР': {
        values: [
          ...headers,
          sheetRow('1', 46034, ''),            // serial-число (класс 6 книг)
          sheetRow('2', '15.03.2026', 46100),  // строка дд.мм.гггг (класс 2 книг) + serial-факт
          sheetRow('3', 'не дата', ''),        // мусор — не дата
        ],
        formulas: [],
        sheetName: 'УЭР',
      },
    });
    const { createApp } = await import('../app.js');
    app = await createApp({ logger: false });
  }, 60_000);
  afterAll(async () => { await app?.close(); process.env = { ...ORIGINAL_ENV }; vi.resetModules(); });

  type DateDto = {
    id: string;
    planDate: string | null; planDateRaw: unknown;
    factDate: string | null; factDateRaw: unknown;
  };

  async function fetchRows(): Promise<DateDto[]> {
    const res = await app.inject({ method: 'GET', url: '/api/rows/УЭР?limit=100' });
    expect(res.statusCode).toBe(200);
    return res.json<{ rows: DateDto[] }>().rows;
  }

  it('serial 46034 → ISO 2026-01-12, сырое значение сохранено в planDateRaw', async () => {
    const rows = await fetchRows();
    const r = rows.find(x => String(x.id) === '1')!;
    expect(r).toBeDefined();
    expect(r.planDate).toBe('2026-01-12');
    expect(r.planDateRaw).toBe(46034);
    // пустой факт → null, сырое — как в листе
    expect(r.factDate).toBeNull();
    expect(r.factDateRaw).toBe('');
  }, 30_000);

  it('строка «дд.мм.гггг» → ISO без сдвига дня; serial-факт тоже ISO', async () => {
    const rows = await fetchRows();
    const r = rows.find(x => String(x.id) === '2')!;
    expect(r.planDate).toBe('2026-03-15');
    expect(r.planDateRaw).toBe('15.03.2026');
    expect(r.factDate).toBe('2026-03-19'); // 46100 = 19.03.2026 (канон shared-теста)
    expect(r.factDateRaw).toBe(46100);
  }, 30_000);

  it('мусорное значение → planDate null, сырое сохранено', async () => {
    const rows = await fetchRows();
    const r = rows.find(x => String(x.id) === '3')!;
    expect(r.planDate).toBeNull();
    expect(r.planDateRaw).toBe('не дата');
  }, 30_000);
});
