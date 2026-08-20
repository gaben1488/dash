/**
 * Страж подключения двух разделов-новосёлов (21.08.2026).
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ТЕСТ. Инвентаризация сигналов 20.08.2026 описала болезнь, от
 * которой этот тест и страхует: механизм посчитан, тесты его модуля зелены, а
 * наружу он не выходит — потому что роут не зарегистрирован. Так прожили
 * двенадцать признаков детектора и три модуля целостности. Модульные тесты
 * такую пропажу не видят в принципе: они зовут функцию напрямую.
 *
 * ЧТО ОХРАНЯЕТСЯ:
 *   1. Оба маршрута ЖИВЫ в собранном приложении.
 *   2. Молчание источников даёт 200 с названными книгами, а не отказ: раздел
 *      существует ровно затем, чтобы показать, где следа нет. Ответ 503 спрятал
 *      бы главное — КАКАЯ книга молчит.
 *   3. Момент чтения назван (asOf) — канон п.58.
 *   4. Внутренние коды степеней наружу не выходят.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

/** Сеть выключена целиком — картина «книги не ответили» во всей полноте. */
vi.mock('../services/google-sheets.js', () => ({
  batchGetCells: vi.fn(async () => { throw new Error('net off'); }),
  batchGetFormulas: vi.fn(async () => { throw new Error('net off'); }),
  getSheetData: vi.fn(async () => { throw new Error('net off'); }),
  getSheetDataFromSpreadsheet: vi.fn(async () => { throw new Error('net off'); }),
  getSpreadsheetMetadata: vi.fn(async () => { throw new Error('net off'); }),
  readDeptSheet: vi.fn(async () => { throw new Error('net off'); }),
  fetchSHDYUSheet: vi.fn(async () => { throw new Error('net off'); }),
}));

/** Строка листа ГРБС: 34 колонки, ключевые ячейки по канону DEPT_COLUMNS. */
function sheetRow(id: string, subordinate: string, subject: string, plan: number): unknown[] {
  const r: unknown[] = new Array(34).fill('');
  r[0] = id;
  r[2] = subordinate;
  r[6] = subject;
  r[10] = plan;
  r[11] = 'ЕП';
  r[13] = '15.08.2026';
  return r;
}

interface AnomaliesDto {
  asOf: string;
  booksRead: string[];
  booksSilent: string[];
  journalsSilent: string[];
  rowsScanned: number;
  typo: Array<{ dept: string; title: string; sheetRow: number }>;
  fitted: Array<{ dept: string; title: string }>;
  dataset: Array<{ urgency: string; title: string }>;
  datasetAvailable: boolean;
  notes: string[];
}

interface IntegrityDto {
  asOf: string;
  books: Array<{ dept: string; rowsAvailable: boolean; sequence: unknown; note: string }>;
  totals: { gapCount: number; countableWithoutSeq: number; duplicates: number; dateFormat: number };
  comparison: unknown;
  comparisonNote: string;
  notes: string[];
}

describe('разделы «признаки» и «целостность» доходят до сети', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      AEMR_API_KEY: '',
      SQLITE_PATH: ':memory:',
      LOG_LEVEL: 'silent',
      PRODUCT_TZ_OFFSET_HOURS: '12',
    };

    const { setDeptSheetCache } = await import('../services/snapshot.js');
    const headers = [new Array(34).fill('h'), new Array(34).fill('h'), new Array(34).fill('h')];
    setDeptSheetCache({
      // Нумерация с пропуском (1, 2, 5) и одна счётная строка без номера.
      'УЭР': {
        values: [
          ...headers,
          sheetRow('1', 'МКУ ЦЭР', 'Обслуживание сети', 120),
          sheetRow('2', 'МКУ ЦЭР', 'Канцелярия', 80),
          sheetRow('5', 'Х', 'Закупка самого управления', 300),
          sheetRow('', 'Х', 'Строка без номера', 640),
        ],
        formulas: [],
        sheetName: 'УЭР',
      },
    });

    const { createApp } = await import('../app.js');
    const { resetAnomaliesCache } = await import('./anomalies.js');
    const { resetIntegrityCache } = await import('./integrity.js');
    resetAnomaliesCache();
    resetIntegrityCache();
    app = await createApp({ logger: false });
    await app.ready();
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    process.env = ORIGINAL_ENV;
  });

  it('GET /api/anomalies отвечает и называет молчащие книги, а не отказывает', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/anomalies' });
    expect(res.statusCode).toBe(200);
    const body = res.json<AnomaliesDto>();
    expect(Number.isNaN(Date.parse(body.asOf))).toBe(false);
    expect(body.booksRead).toContain('УЭР');
    // Семь книг района не ответили — они названы поимённо, а не забыты.
    expect(body.booksSilent.length).toBeGreaterThan(0);
    expect(body.notes.join(' ')).toContain('Строки не прочитаны');
    expect(body.rowsScanned).toBe(4);
  }, 90_000);

  it('GET /api/integrity отвечает и различает «не прочитано» от «порядок есть»', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/integrity' });
    expect(res.statusCode).toBe(200);
    const body = res.json<IntegrityDto>();
    expect(Number.isNaN(Date.parse(body.asOf))).toBe(false);

    const uer = body.books.find((b) => b.dept === 'УЭР');
    expect(uer?.rowsAvailable).toBe(true);
    expect(uer?.sequence).not.toBeNull();
    // Номера 3 и 4 пропущены; одна счётная строка осталась без адреса.
    expect(body.totals.gapCount).toBe(2);
    expect(body.totals.countableWithoutSeq).toBe(1);

    const silent = body.books.find((b) => b.rowsAvailable === false);
    expect(silent?.sequence).toBeNull();
    expect(silent?.note).toContain('не прочитаны');

    // Снимков со строками в памяти нет — причина названа словами, а не пустотой.
    expect(body.comparison).toBeNull();
    expect(body.comparisonNote.length).toBeGreaterThan(0);
  }, 90_000);
});
