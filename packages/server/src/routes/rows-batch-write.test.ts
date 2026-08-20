/**
 * Стражи пакетной правки строк (POST /api/data/rows) — реестр багов
 * 09.07.2026, пп. 3, 14, 16.
 *
 * Что охраняется:
 *   п.3  — запись за пределами данных листа отклоняется и в пакетном пути тоже
 *          (у одиночного PUT страж уже был, у пакета — нет);
 *   п.14 — правка ячейки не выдаёт книги за только что прочитанные: момент
 *          чтения книг остаётся прежним (канон п.58), а сохранённое значение
 *          ложится в ТЕ значения, что лежат в кэше СЕЙЧАС, — перечитка,
 *          прошедшая между сохранением и отражением, не откатывается;
 *   п.16 — код ответа отличает «сохранено всё» от «сохранено не всё»:
 *          прежде пакет всегда отвечал «всё хорошо», даже когда книга не
 *          приняла ни одной ячейки.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.AEMR_API_KEY = '';
process.env.SQLITE_PATH = ':memory:';
process.env.LOG_LEVEL = 'silent';
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = '';
process.env.GOOGLE_PRIVATE_KEY = '';
process.env.GOOGLE_API_KEY = '';

const writeCellValue = vi.fn(async () => ({ updatedCells: 1, updatedRange: 'ВСЕ!G4' }));

vi.mock('../services/google-sheets.js', () => ({
  writeCellValue,
  resolveDeptSheetName: vi.fn(async () => 'ВСЕ'),
  batchGetCells: vi.fn(async () => { throw new Error('сеть в тесте выключена'); }),
  batchGetFormulas: vi.fn(async () => { throw new Error('сеть в тесте выключена'); }),
  getSpreadsheetMetadata: vi.fn(async () => { throw new Error('сеть в тесте выключена'); }),
  getSheetData: vi.fn(async () => []),
  getSheetDataFromSpreadsheet: vi.fn(async () => []),
  readDeptSheet: vi.fn(async () => ({ values: [], formulas: [], sheetName: 'ВСЕ' })),
  fetchSHDYUSheet: vi.fn(async () => { throw new Error('сеть в тесте выключена'); }),
}));

/** Строка данных книги: 34 колонки, предмет закупки в G. */
function dataRow(id: number): unknown[] {
  const row = Array<unknown>(34).fill('');
  row[0] = id;
  row[6] = `Закупка ${id}`;
  return row;
}

/** Лист управления: 3 строки шапки + две строки данных (валидные строки 4 и 5). */
function sheetValues(): unknown[][] {
  return [[], [], [], dataRow(1), dataRow(2)];
}

let app: FastifyInstance;
let setDeptSheetCache: typeof import('../services/snapshot.js')['setDeptSheetCache'];
let getDeptSheetValues: typeof import('../services/snapshot.js')['getDeptSheetValues'];
let getDeptCacheFilledAt: typeof import('../services/snapshot.js')['getDeptCacheFilledAt'];

beforeAll(async () => {
  const [snapshot, { createApp }] = await Promise.all([
    import('../services/snapshot.js'),
    import('../app.js'),
  ]);
  setDeptSheetCache = snapshot.setDeptSheetCache;
  getDeptSheetValues = snapshot.getDeptSheetValues;
  getDeptCacheFilledAt = snapshot.getDeptCacheFilledAt;

  app = await createApp({ logger: false });
  await app.ready();
}, /* Шов 18 реестра швов (сверка 18.08.2026): холодная сборка всего графа
   сервера ради этой проверки укладывалась в 64 секунды при пределе в 60 — набор
   падал на подготовке, а не на существе. Предел поднят с запасом; сокращать его
   имеет смысл только вместе с отказом поднимать приложение целиком. */ 120_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  writeCellValue.mockClear();
  writeCellValue.mockImplementation(async () => ({ updatedCells: 1, updatedRange: 'ВСЕ!G4' }));
  setDeptSheetCache({ 'УО': { values: sheetValues(), formulas: [], sheetName: 'ВСЕ' } });
});

describe('POST /api/data/rows — код ответа не врёт (п.16)', () => {
  it('все правки сохранены → 200 и ok:true', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/data/rows',
      payload: { rows: [{ deptId: 'УО', rowIndex: 4, changes: { G: 'Новый предмет' } }] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ ok: boolean; successCount: number; failCount: number }>();
    expect(body.ok).toBe(true);
    expect(body.successCount).toBe(1);
    expect(body.failCount).toBe(0);
  });

  it('книга не приняла ни одной ячейки → код НЕ 200, ok:false, причина у каждой ячейки', async () => {
    writeCellValue.mockImplementation(async () => { throw new Error('Google отказал'); });
    const res = await app.inject({
      method: 'POST',
      url: '/api/data/rows',
      payload: { rows: [{ deptId: 'УО', rowIndex: 4, changes: { G: 'Предмет', H: 10 } }] },
    });
    expect(res.statusCode).not.toBe(200);
    expect(res.statusCode).toBe(207);
    const body = res.json<{ ok: boolean; failCount: number; totalChanges: number; results: Array<{ error?: string }> }>();
    expect(body.ok).toBe(false);
    expect(body.failCount).toBe(body.totalChanges);
    expect(body.results.every(r => (r.error ?? '').length > 0)).toBe(true);
  });

  it('часть правок не сохранилась → 207 и разбор по ячейкам', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/data/rows',
      payload: { rows: [{ deptId: 'УО', rowIndex: 4, changes: { G: 'Предмет', K: 100 } }] },
    });
    expect(res.statusCode).toBe(207);
    const body = res.json<{ ok: boolean; successCount: number; failCount: number }>();
    expect(body.ok).toBe(false);
    expect(body.successCount).toBe(1); // G сохранена
    expect(body.failCount).toBe(1);    // K — формульный столбец
  });
});

describe('POST /api/data/rows — граница строки листа (п.3)', () => {
  it('номер строки за пределами книги не уходит в запись', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/data/rows',
      payload: { rows: [{ deptId: 'УО', rowIndex: 99999, changes: { G: 'мимо' } }] },
    });
    const body = res.json<{ ok: boolean; results: Array<{ success: boolean; error?: string }> }>();
    expect(body.ok).toBe(false);
    expect(body.results[0]?.success).toBe(false);
    expect(body.results[0]?.error).toMatch(/строк/i);
    expect(writeCellValue).not.toHaveBeenCalled();
  });
});

describe('признак показательных данных доходит до ответа (п.8)', () => {
  // Учётные данные Google в этом прогоне не заданы (см. окружение выше) —
  // значит данные показательные, и об этом обязан говорить каждый ответ.
  // Страж самого признака — plugins/demo-marker.test.ts; здесь проверяется,
  // что он действительно включён в собранное приложение.
  it('ответ живого приложения несёт признак', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/rows/УО?limit=1' });
    expect(res.headers['x-aemr-demo-data']).toBe('1');
  }, 30_000);
});

describe('правка ячейки и прочитанные книги (п.14)', () => {
  it('сохранённое значение видно в значениях книги', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/data/rows',
      payload: { rows: [{ deptId: 'УО', rowIndex: 4, changes: { G: 'Отражено' } }] },
    });
    expect(getDeptSheetValues()['УО']?.[3]?.[6]).toBe('Отражено');
  });

  it('правка НЕ выдаёт книги за только что прочитанные — момент чтения прежний', async () => {
    const filledAtBefore = getDeptCacheFilledAt();
    // Пауза, чтобы отметка «книги прочитаны сейчас» заведомо отличалась от
    // прежней: иначе страж прошёл бы и при возвращённой ошибке.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await app.inject({
      method: 'PUT',
      url: '/api/rows/УО/4/field',
      payload: { field: 'G', value: 'Одиночная правка' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/data/rows',
      payload: { rows: [{ deptId: 'УО', rowIndex: 5, changes: { G: 'Пакетная правка' } }] },
    });
    expect(getDeptCacheFilledAt()).toBe(filledAtBefore);
    expect(getDeptSheetValues()['УО']?.[3]?.[6]).toBe('Одиночная правка');
    expect(getDeptSheetValues()['УО']?.[4]?.[6]).toBe('Пакетная правка');
  });

  it('перечитка книги, случившаяся рядом с правкой, не откатывается', async () => {
    // Между сохранением в книгу и отражением правки прошла перечитка: она
    // положила в кэш ДРУГОЙ массив значений. Правка обязана лечь в него,
    // а прежние значения — не вернуться поверх свежих.
    const freshValues = sheetValues();
    freshValues[3]![6] = 'Свежее чтение';
    writeCellValue.mockImplementation(async () => {
      setDeptSheetCache({ 'УО': { values: freshValues, formulas: [], sheetName: 'ВСЕ' } });
      return { updatedCells: 1, updatedRange: 'ВСЕ!H4' };
    });

    await app.inject({
      method: 'POST',
      url: '/api/data/rows',
      payload: { rows: [{ deptId: 'УО', rowIndex: 4, changes: { H: 42 } }] },
    });

    const values = getDeptSheetValues()['УО'];
    expect(values).toBe(freshValues);
    expect(values?.[3]?.[7]).toBe(42);
  });
});
