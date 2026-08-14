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
  economyPercent: number;
  planTotal: number;
  factTotal: number;
}

describe('GET /api/rows/scatter — гейт заключения (пп. 38-39)', () => {
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
    expect(points[0].economyPercent).toBe(10); // (1 - 900/1000) × 100, не «100 %»
    // Ни одной точки со «100 % экономии» из цены 0 — класс п.38 закрыт.
    expect(points.some(p => p.economyPercent === 100)).toBe(false);
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
});
