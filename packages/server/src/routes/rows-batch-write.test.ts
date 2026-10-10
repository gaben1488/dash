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
process.env.AEMR_ALLOW_LEGACY_WRITES = 'true';
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = '';
process.env.GOOGLE_PRIVATE_KEY = '';
process.env.GOOGLE_API_KEY = '';

const writeCellValue = vi.fn(async () => ({ updatedCells: 1, updatedRange: 'ВСЕ!G4' }));
const readCurrentDeptRow = vi.fn(async () => {
  const row: unknown[] = Array(34).fill('');
  row[0] = 1; row[6] = 'Закупка 1';
  return row;
});

vi.mock('../services/google-sheets.js', () => ({
  writeCellValue,
  readCurrentDeptRow,
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
  readCurrentDeptRow.mockClear();
  readCurrentDeptRow.mockImplementation(async () => sheetValues()[3]);
  writeCellValue.mockImplementation(async () => ({ updatedCells: 1, updatedRange: 'ВСЕ!G4' }));
  setDeptSheetCache({ 'УО': { values: sheetValues(), formulas: [], sheetName: 'ВСЕ' } });
});

describe('guarded row writes against live source movement', () => {
  it('refuses a stale row revision without touching Google', async () => {
    const { rowRevision } = await import('../services/row-revision.js');
    const source = sheetValues()[3];
    const expectedRevision = rowRevision(source);
    readCurrentDeptRow.mockResolvedValueOnce(sheetValues()[4]);
    const response = await app.inject({ method: 'POST', url: '/api/data/rows',
      payload: { rows: [{ deptId: 'УО', rowIndex: 4, changes: { G: 'Чужая правка' }, expectedRevision }] } });
    expect(response.statusCode).toBe(207);
    expect(response.json<{ results: Array<{ success: boolean; error: string }> }>().results[0]).toMatchObject({
      success: false, error: expect.stringContaining('перемещена'),
    });
    expect(writeCellValue).not.toHaveBeenCalled();
  });

  it('accepts an unchanged source row and performs the write', async () => {
    const { rowRevision } = await import('../services/row-revision.js');
    const expectedRevision = rowRevision(sheetValues()[3]);
    const response = await app.inject({ method: 'POST', url: '/api/data/rows',
      payload: { rows: [{ deptId: 'УО', rowIndex: 4, changes: { G: 'Допустимая правка' }, expectedRevision }] } });
    expect(response.statusCode).toBe(200);
    expect(readCurrentDeptRow).toHaveBeenCalledTimes(1);
    expect(writeCellValue).toHaveBeenCalledTimes(1);
  });

  it('rejects unversioned production writes even when the cache is populated', async () => {
    const old = process.env.AEMR_ALLOW_LEGACY_WRITES;
    delete process.env.AEMR_ALLOW_LEGACY_WRITES;
    try {
      const response = await app.inject({ method: 'POST', url: '/api/data/rows',
        payload: { rows: [{ deptId: 'УО', rowIndex: 4, changes: { G: 'Без версии' } }] } });
      expect(response.statusCode).toBe(207);
      expect(writeCellValue).not.toHaveBeenCalled();
    } finally {
      if (old === undefined) delete process.env.AEMR_ALLOW_LEGACY_WRITES;
      else process.env.AEMR_ALLOW_LEGACY_WRITES = old;
    }
  });
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

describe('серверная валидация ввода: числа, даты и размер пакета', () => {
  it('не отбрасывает хвост денежной строки и не принимает Infinity', async () => {
    for (const bad of ['12abc', '1.2.3', '1e309', 'Infinity']) {
      const res = await app.inject({ method: 'POST', url: '/api/data/rows',
        payload: { rows: [{ deptId: 'УО', rowIndex: 4, changes: { H: bad } }] } });
      expect(res.statusCode).toBe(207);
      expect(res.json<{ ok: boolean }>().ok).toBe(false);
    }
    expect(writeCellValue).not.toHaveBeenCalled();
  });

  it('принимает русские разделители и записывает полное число', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/data/rows',
      payload: { rows: [{ deptId: 'УО', rowIndex: 4, changes: { H: '1 234,50' } }] } });
    expect(res.statusCode).toBe(200);
    expect(writeCellValue).toHaveBeenCalledWith(expect.any(String), 'ВСЕ', 'H4', 1234.5);
  });

  it('не считает календарную ошибку корректной датой', async () => {
    for (const bad of ['31.02.2026', '2026-13-99', '2026-01-14garbage']) {
      const res = await app.inject({ method: 'POST', url: '/api/data/rows',
        payload: { rows: [{ deptId: 'УО', rowIndex: 4, changes: { N: bad } }] } });
      expect(res.statusCode).toBe(207);
    }
    expect(writeCellValue).not.toHaveBeenCalled();
  });

  it('отклоняет большой или некорректный пакет до первой записи', async () => {
    const over = await app.inject({ method: 'POST', url: '/api/data/rows',
      payload: { rows: Array.from({ length: 51 }, () => ({ deptId: 'УО', rowIndex: 4, changes: { G: 'a' } })) } });
    expect(over.statusCode).toBe(413);
    const malformed = await app.inject({ method: 'POST', url: '/api/data/rows',
      payload: { rows: [{ deptId: 'УО', rowIndex: 4, changes: { G: 'a' } }, { deptId: 'УО', rowIndex: 5, changes: null }] } });
    expect(malformed.statusCode).toBe(400);
    expect(writeCellValue).not.toHaveBeenCalled();
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
