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

/**
 * Страж гейта заключения в GET /api/rows/scatter (пп. 38-39 интервью 14.08.2026,
 * docs/superpowers/audits/2026-08-14-interview-register.md).
 *
 * Класс дефекта: точка облака «лимит vs цена» строилась из ЛЮБОЙ строки с планом.
 * Незаключённый контракт (цены нет, даты заключения нет) получал factTotal=0 и
 * рисовался как «экономия 100 %», попадая в «подозрительные» (п.38 — 2394 шт.);
 * закупка без плановой даты — не обеспеченная финансированием, как кредитная
 * линия УФБП на 32 млн, — попадала туда же (п.39). Экономия существует только
 * у ФАКТА заключения: дата в Q и цена Y > 0.
 *
 * Плюс п.38, хвост: тултип показывал 'uer'/'uagzo' — внутренний латинский ключ;
 * поле department обязано быть кириллическим каноном из реестра управлений.
 */

/** Строка листа: N (idx 13) = дата план, Q (idx 16) = дата факт, Y (idx 24) = цена. */
function sheetRow(
  id: string,
  planTotal: number,
  planDate: unknown,
  factDate: unknown,
  factTotal: number,
): unknown[] {
  const r: unknown[] = new Array(32).fill('');
  r[0] = id;               // A = ID
  r[6] = 'Закупка ' + id;  // G = SUBJECT
  r[10] = planTotal;       // K = TOTAL_PLAN (тыс. руб.)
  r[11] = 'ЭА';            // L = METHOD
  r[13] = planDate;        // N = PLAN_DATE
  r[16] = factDate;        // Q = FACT_DATE (дата заключения)
  r[24] = factTotal;       // Y = TOTAL_FACT (цена контракта, тыс. руб.)
  return r;
}

interface ScatterPoint {
  id: unknown;
  department: string;
  limitReductionPercent: number;
  planTotal: number;
  factTotal: number;
}

describe('GET /api/rows/scatter — гейт заключения (пп. 38-39)', () => {
  let app: FastifyInstance;
  let uerSource: string;
  beforeAll(async () => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'test', AEMR_API_KEY: '', SQLITE_PATH: ':memory:', LOG_LEVEL: 'silent' };
    const { setDeptSheetCache } = await import('../services/snapshot.js');
    uerSource = (await import('../config.js')).DEPARTMENT_SPREADSHEETS['УЭР'];
    const headers = [new Array(32).fill('h'), new Array(32).fill('h'), new Array(32).fill('h')];
    setDeptSheetCache({
      'УЭР': {
        values: [
          ...headers,
          // Заключённый контракт: обе даты, цена > 0 → единственная законная точка.
          sheetRow('1', 1000, 46034, 46100, 900),
          // П.38: план есть, контракт НЕ заключён (Q пусто, цены нет) —
          // до гейта рисовался как «экономия 100 %».
          sheetRow('2', 500, 46034, '', 0),
          // П.39: кредитная линия — без плановой даты (Х), не обеспечена
          // финансированием; в облаке ей не место вовсе.
          sheetRow('3', 32_000, 'Х', 'Х', 0),
          // Дата заключения есть, но цена 0 — дефект листа, не экономия 100 %.
          sheetRow('4', 700, 46034, 46100, 0),
          // Дата заключения и цена есть, но плановой даты нет — вне облака (п.39).
          sheetRow('5', 800, '', 46100, 750),
        ],
        formulas: [],
        sheetName: 'УЭР',
        providerId: uerSource,
      },
    });
    const { createApp } = await import('../app.js');
    app = await createApp({ logger: false });
  }, 60_000);
  afterAll(async () => { await app?.close(); process.env = { ...ORIGINAL_ENV }; vi.resetModules(); });

  async function fetchPoints(url: string): Promise<ScatterPoint[]> {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    return res.json<{ points: ScatterPoint[] }>().points;
  }

  it('в облако попадает ТОЛЬКО заключённый контракт (дата Q + цена Y > 0); экономия — от реальной цены', async () => {
    const points = await fetchPoints('/api/rows/scatter');
    expect(points.map(p => String(p.id))).toEqual(['1']);
    expect(points[0].limitReductionPercent).toBe(10); // (1 - 900/1000) × 100, не «100 %»
    // Ни одной точки со «100 % экономии» из цены 0 — класс п.38 закрыт.
    expect(points.some(p => p.limitReductionPercent === 100)).toBe(false);
  }, 30_000);

  it('department — кириллический канон реестра управлений, не латинский ключ (п.38: «uagzo» в тултипе)', async () => {
    const points = await fetchPoints('/api/rows/scatter');
    expect(points[0].department).toBe('УЭР');
    expect(points[0].department).not.toBe('uer');
  }, 30_000);

  it('фильтр dept принимает обе формы ключа: латинскую uer и кириллическую УЭР', async () => {
    const latin = await fetchPoints('/api/rows/scatter?dept=uer');
    const cyrillic = await fetchPoints(`/api/rows/scatter?dept=${encodeURIComponent('УЭР')}`);
    expect(latin.map(p => String(p.id))).toEqual(['1']);
    expect(cyrillic.map(p => String(p.id))).toEqual(['1']);
  }, 30_000);
  it('непрочитанный выбранный периметр даёт 503, а не успешное пустое облако', async () => {
    const res = await app.inject('/api/rows/scatter?dept=uo');
    expect(res.statusCode).toBe(503);
  });
  it('частичный состав явно сопровождает точки и справочник подведов', async () => {
    const scatter = (await app.inject('/api/rows/scatter')).json();
    expect(scatter.coverage.complete).toBe(false);
    expect(scatter.coverage.readDepartments).toEqual(['УЭР']);
    const subs = (await app.inject('/api/rows/subordinates?coverage=1')).json();
    expect(subs.coverage.readDepartments).toEqual(['УЭР']);
    expect(subs.subordinates).toBeDefined();
  });

  it('uses full numbers, real N/Q dates, known methods and the same selected perimeter', async () => {
    const { setDeptSheetCache } = await import('../services/snapshot.js');
    const valid = sheetRow('valid', 1234.56, '12.01.2026', '15.01.2026', 1000);
    valid[2] = 'Школа 1'; valid[5] = 'Текущая деятельность'; valid[14] = 4; valid[15] = 2025;
    valid[10] = '1 234,56'; valid[25] = -15; valid[26] = 5; valid[29] = 'да';
    const cases = [valid, ...[
      ['unknown', 11, 'неизвестно'], ['garbage', 10, '123abc'],
      ['future', 16, '01.01.2099'], ['bad-date', 13, '31.02.2026'],
      ['other-year', 13, '12.01.2025'], ['other-month', 13, '12.02.2026'],
      ['other-org', 2, 'Школа 2'],
    ].map(([id, column, value]) => { const row = [...valid]; row[0] = id; row[Number(column)] = value; return row; })];
    setDeptSheetCache({ 'УЭР': { values: [[], [], [], ...cases], formulas: [], sheetName: 'УЭР', providerId: uerSource } });
    const res = await app.inject('/api/rows/scatter?dept=uer&type=competitive&activity=current_program&year=2026&period=q1&months=1&subordinate=' + encodeURIComponent('Школа 1'));
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.points.map((p: ScatterPoint) => p.id)).toEqual(['valid']);
    expect(body.points[0]).toMatchObject({ planTotal: 1234.56, factTotal: 1000, quarter: 1, planYear: 2026, approvedEconomy: -10 });
    expect(body.points[0].limitReductionPercent).toBeCloseTo((1 - 1000 / 1234.56) * 100, 2);
    expect(body.points[0]).not.toHaveProperty('economyPercent');
    expect(body.excluded.unknownMethod).toBe(1);
  });

  it('declares observed plan and fact columns without assigning legal financial categories', async () => {
    const response = await app.inject('/api/rows/scatter?dept=uer&type=competitive');
    expect(response.statusCode).toBe(200);
    expect(response.json().basis).toBe('plan_K_vs_recorded_fact_Y');
  });

  it('computes a weighted total over every eligible row beyond the display cap', async () => {
    const { setDeptSheetCache } = await import('../services/snapshot.js');
    const rows = Array.from({ length: 2501 }, (_, index) =>
      sheetRow(String(index + 1), index === 2500 ? 100000 : 1000, 46034, 46100, index === 2500 ? 100000 : 900));
    setDeptSheetCache({ 'УЭР': { values: [[], [], [], ...rows], formulas: [], sheetName: 'УЭР', providerId: uerSource } });
    const response = (await app.inject('/api/rows/scatter?dept=uer&type=competitive')).json();
    expect(response.points).toHaveLength(2500);
    expect(response.total).toBe(2501);
    expect(response.truncated).toBe(true);
    expect(response.summary.limitReductionPercent).toBeCloseTo(250000 / 2600000 * 100, 8);
  });

  it('rejects an invalid requested scope instead of returning the whole district', async () => {
    for (const query of ['year=2026abc', 'months=13', 'dept=nonexistent', 'activity=unknown']) {
      expect((await app.inject('/api/rows/scatter?' + query)).statusCode).toBe(400);
    }
  });

  it('reads the exact displayed snapshot instead of combining it with newer live rows', async () => {
    const { db, schema } = await import('../db/index.js');
    const row = sheetRow('frozen-position', 800, 46034, 46100, 700);
    const future = sheetRow('future-for-snapshot', 900, '01.01.2026', '19.10.2026', 800);
    future[25] = 100; future[29] = 'да';
    const snapshot = { id: 'frozen-scatter', createdAt: '2026-10-18T11:59:59Z',
      rowsByDept: { 'УЭР': [row, future] }, metadata: { sourceCoverage: {
        expectedDepartments: ['УЭР'], readDepartments: ['УЭР'], unreadDepartments: [], complete: true,
      } } };
    db.insert(schema.snapshots).values({ id: snapshot.id, spreadsheetId: 'synthetic', createdAt: snapshot.createdAt, data: JSON.stringify(snapshot) }).run();
    const response = await app.inject('/api/rows/scatter?dept=uer&snapshot_id=frozen-scatter');
    expect(response.statusCode).toBe(200);
    expect(response.json().points.map((point: ScatterPoint) => point.id)).toEqual(['frozen-position']);
    expect(response.json().sourceSnapshotId).toBe(snapshot.id);
    expect(response.json().asOf).toBe('2026-10-18');
    expect(response.json().excluded.futureFact).toBe(1);
    expect(response.json().summary.approvedEconomy).toBe(0);
    const next = { ...snapshot, id: 'frozen-scatter-next', createdAt: '2026-10-18T12:00:00Z' };
    db.insert(schema.snapshots).values({ id: next.id, spreadsheetId: 'synthetic', createdAt: next.createdAt, data: JSON.stringify(next) }).run();
    const afterBoundary = (await app.inject('/api/rows/scatter?dept=uer&snapshot_id=frozen-scatter-next')).json();
    expect(afterBoundary.asOf).toBe('2026-10-19');
    expect(afterBoundary.points).toHaveLength(2);
    expect(afterBoundary.summary.approvedEconomy).toBe(100);
    expect((await app.inject('/api/rows/scatter?dept=uer&snapshot_id=missing')).statusCode).toBe(404);
  });
});
