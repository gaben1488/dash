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
const readCurrentDeptRowFormulas = vi.fn(async () => dataRow(1));

vi.mock('../services/google-sheets.js', () => ({
  writeCellValue,
  readCurrentDeptRow,
  readCurrentDeptRowFormulas,
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
  readCurrentDeptRow.mockReset();
  readCurrentDeptRow.mockImplementation(async () => sheetValues()[3]);
  readCurrentDeptRowFormulas.mockReset();
  readCurrentDeptRowFormulas.mockImplementation(async () => dataRow(1));
  writeCellValue.mockImplementation(async () => ({ updatedCells: 1, updatedRange: 'ВСЕ!G4' }));
  setDeptSheetCache({ 'УО': { values: sheetValues(), formulas: [], sheetName: 'ВСЕ' } });
});

describe('source row and actual formula protection', () => {
  async function save(method: 'PUT' | 'POST', expectedRevision?: string) {
    return method === 'PUT'
      ? app.inject({ method, url: '/api/rows/uo/4/field',
          payload: { field: 'H', value: 123, expectedRevision } })
      : app.inject({ method, url: '/api/data/rows',
          payload: { rows: [{ deptId: 'УО', rowIndex: 4, changes: { H: 123 }, expectedRevision }] } });
  }

  async function intentCount() {
    const { db, schema } = await import('../db/index.js');
    return db.select().from(schema.auditLog).all().filter(r => r.action === 'cell_edit_intent').length;
  }

  it.each(['PUT', 'POST'] as const)('%s refuses a total row read from the live source', async (method) => {
    const { rowRevision } = await import('../services/row-revision.js');
    const total = dataRow(1); total[6] = 'ИТОГО по управлению';
    readCurrentDeptRow.mockResolvedValueOnce(total);
    const before = await intentCount();
    const response = await save(method, rowRevision(total));
    expect(response.statusCode).toBe(method === 'PUT' ? 403 : 207);
    expect(response.json()).toMatchObject(method === 'PUT'
      ? { error: expect.stringContaining('служебная') }
      : { results: [{ success: false, error: expect.stringContaining('служебная') }] });
    expect(writeCellValue).not.toHaveBeenCalled();
    expect(await intentCount()).toBe(before);
  });

  it.each(['PUT', 'POST'] as const)('%s protects a live total even when the legacy cache still contains a purchase', async (method) => {
    const total = dataRow(1); total[0] = 'ИТОГО'; total[6] = '';
    readCurrentDeptRowFormulas.mockResolvedValueOnce(total);
    const response = await save(method);
    expect(response.statusCode).toBe(method === 'PUT' ? 403 : 207);
    expect(writeCellValue).not.toHaveBeenCalled();
  });

  it.each([
    ['PUT', 0], ['POST', 0], ['PUT', 6], ['POST', 6],
  ] as const)('%s protects a formula-computed total in column index %s despite a stale legacy cache', async (method, column) => {
    const total = dataRow(1); total[column] = 'ИТОГО по управлению';
    const formulas = [...total]; formulas[column] = '="ИТОГО по управлению"';
    readCurrentDeptRow.mockResolvedValueOnce(total);
    readCurrentDeptRowFormulas.mockResolvedValueOnce(formulas);
    const response = await save(method);
    expect(response.statusCode).toBe(method === 'PUT' ? 403 : 207);
    expect(writeCellValue).not.toHaveBeenCalled();
  });

  it.each(['PUT', 'POST'] as const)('%s refuses an actual formula in an otherwise editable column', async (method) => {
    const formulas = dataRow(1); formulas[7] = '=SUM(H8:H10)';
    readCurrentDeptRowFormulas.mockResolvedValueOnce(formulas);
    const before = await intentCount();
    const response = await save(method);
    expect(response.statusCode).toBe(method === 'PUT' ? 403 : 207);
    expect(response.json()).toMatchObject(method === 'PUT'
      ? { error: expect.stringContaining('формул') }
      : { results: [{ success: false, error: expect.stringContaining('формул') }] });
    expect(writeCellValue).not.toHaveBeenCalled();
    expect(await intentCount()).toBe(before);
  });

  it.each(['PUT', 'POST'] as const)('%s fails closed when the source formula read fails', async (method) => {
    readCurrentDeptRowFormulas.mockRejectedValueOnce(new Error('source unavailable'));
    const response = await save(method);
    expect(response.statusCode).toBe(method === 'PUT' ? 503 : 207);
    expect(writeCellValue).not.toHaveBeenCalled();
  });

  it.each(['PUT', 'POST'] as const)('%s does not treat a missing source row as proof of no formulas', async (method) => {
    readCurrentDeptRowFormulas.mockResolvedValueOnce([]);
    const response = await save(method);
    expect(response.statusCode).toBe(method === 'PUT' ? 409 : 207);
    expect(writeCellValue).not.toHaveBeenCalled();
  });

  it.each(['PUT', 'POST'] as const)('%s refuses a missing value row even if the later formula read is nonempty', async (method) => {
    readCurrentDeptRow.mockResolvedValueOnce([]);
    const response = await save(method);
    expect(response.statusCode).toBe(method === 'PUT' ? 409 : 207);
    expect(writeCellValue).not.toHaveBeenCalled();
  });

  it.each(['Итоговый отчёт', 'Разделочные доски', 'Блок питания'])('allows a real purchase named %s', async (subject) => {
    const values = sheetValues(); values[3]![6] = subject;
    setDeptSheetCache({ 'УО': { values, formulas: [], sheetName: 'ВСЕ' } });
    readCurrentDeptRowFormulas.mockResolvedValueOnce(values[3]!);
    const response = await save('PUT');
    expect(response.statusCode).toBe(200);
    expect(getDeptSheetValues().УО![3]![7]).toBe(123);
  });

  it('preserves the valid cell outcome in a mixed batch with a formula cell', async () => {
    const formulas = dataRow(1); formulas[7] = '=SUM(H8:H10)';
    readCurrentDeptRowFormulas.mockResolvedValueOnce(formulas);
    const response = await app.inject({ method: 'POST', url: '/api/data/rows',
      payload: { rows: [{ deptId: 'УО', rowIndex: 4, changes: { H: 123, G: 'Новый предмет' } }] } });
    expect(response.statusCode).toBe(207);
    expect(response.json()).toMatchObject({ results: [
      { field: 'H', success: false, error: expect.stringContaining('формул') },
      { field: 'G', success: true },
    ] });
    expect(writeCellValue).toHaveBeenCalledTimes(1);
    expect(writeCellValue).toHaveBeenCalledWith(expect.any(String), 'ВСЕ', 'G4', 'Новый предмет');
    expect(getDeptSheetValues().УО![3]![7]).toBe('');
  });
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


  it.each([0, 1, 2])('rejects source identity substitution in column index %s before writing', async (index) => {
    const { rowRevision } = await import('../services/row-revision.js');
    const source = sheetValues()[3]!; source[0] = '173/1'; source[1] = 'УО'; source[2] = 'Учреждение';
    const other = [...source]; other[index] = index === 0 ? '173/18' : 'Другая организация';
    readCurrentDeptRow.mockResolvedValueOnce(other);
    const response = await app.inject({ method: 'POST', url: '/api/data/rows',
      payload: { rows: [{ deptId: 'УО', rowIndex: 4, changes: { H: 12 }, expectedRevision: rowRevision(source) }] } });
    expect(response.statusCode).toBe(207);
    expect(writeCellValue).not.toHaveBeenCalled();
  });

  it('accepts an unchanged source row and performs the write', async () => {
    const { rowRevision } = await import('../services/row-revision.js');
    const expectedRevision = rowRevision(sheetValues()[3]);
    const confirmed = [...sheetValues()[3]!]; confirmed[6] = 'Допустимая правка';
    readCurrentDeptRow.mockResolvedValueOnce(sheetValues()[3]!).mockResolvedValueOnce(confirmed);
    const response = await app.inject({ method: 'POST', url: '/api/data/rows',
      payload: { rows: [{ deptId: 'УО', rowIndex: 4, changes: { G: 'Допустимая правка' }, expectedRevision }] } });
    expect(response.statusCode).toBe(200);
    expect(readCurrentDeptRow).toHaveBeenCalledTimes(2); // preflight + post-write revision
    expect(writeCellValue).toHaveBeenCalledTimes(1);
  });


  it.each(['other-row', 'unchanged-value', 'read-error'])('does not confirm a write after %s readback', async (mode) => {
    const { rowRevision } = await import('../services/row-revision.js');
    const source = sheetValues()[3]!;
    readCurrentDeptRow.mockResolvedValueOnce(source);
    if (mode === 'read-error') readCurrentDeptRow.mockRejectedValueOnce(new Error('source unavailable'));
    else readCurrentDeptRow.mockResolvedValueOnce(mode === 'other-row' ? sheetValues()[4]! : source);
    const response = await app.inject({ method: 'POST', url: '/api/data/rows',
      payload: { rows: [{ deptId: 'УО', rowIndex: 4, changes: { G: 'Новый предмет' }, expectedRevision: rowRevision(source) }] } });
    expect(response.statusCode).toBe(207);
    expect(response.json().results[0].success).toBe(false);
    expect(response.json().rowRevisions['УО:4']).toBeUndefined();
    expect(getDeptSheetValues()['УО']![3]![6]).toBe('Закупка 1');
  });


  it('stops remaining cells if the first write cannot be confirmed', async () => {
    const { rowRevision } = await import('../services/row-revision.js');
    const source = sheetValues()[3]!;
    readCurrentDeptRow.mockResolvedValueOnce(source).mockResolvedValueOnce(sheetValues()[4]!);
    const response = await app.inject({ method: 'POST', url: '/api/data/rows',
      payload: { rows: [{ deptId: 'УО', rowIndex: 4, changes: { G: 'Новый предмет', H: 12 }, expectedRevision: rowRevision(source) }] } });
    expect(response.statusCode).toBe(207);
    expect(response.json().results).toHaveLength(2);
    expect(response.json().results.every((result: { success: boolean }) => !result.success)).toBe(true);
    expect(writeCellValue).toHaveBeenCalledTimes(1);
  });


  it('does not mirror a confirmed edit into another row from a concurrent cache refresh', async () => {
    const { rowRevision } = await import('../services/row-revision.js');
    const source = sheetValues()[3]!; const confirmed = [...source]; confirmed[6] = 'Новый предмет';
    readCurrentDeptRow.mockResolvedValueOnce(source).mockResolvedValueOnce(confirmed);
    writeCellValue.mockImplementationOnce(async () => {
      setDeptSheetCache({ 'УО': { values: [[], [], [], dataRow(2)], formulas: [], sheetName: 'ВСЕ' } });
      return { updatedCells: 1, updatedRange: 'ВСЕ!G4' };
    });
    const response = await app.inject({ method: 'POST', url: '/api/data/rows',
      payload: { rows: [{ deptId: 'УО', rowIndex: 4, changes: { G: 'Новый предмет' }, expectedRevision: rowRevision(source) }] } });
    expect(response.statusCode).toBe(200);
    expect(getDeptSheetValues()['УО']![3]![6]).toBe('Закупка 2');
  });


  it('confirms each intended cell and returns only the final authoritative revision', async () => {
    const { rowRevision } = await import('../services/row-revision.js');
    const source = sheetValues()[3]!;
    const first = [...source]; first[7] = 12;
    const final = [...first]; final[16] = '12.10.2026';
    readCurrentDeptRow.mockResolvedValueOnce(source).mockResolvedValueOnce(first).mockResolvedValueOnce(final);
    const response = await app.inject({ method: 'POST', url: '/api/data/rows',
      payload: { rows: [{ deptId: 'УО', rowIndex: 4, changes: { H: 12, Q: '2026-10-12' }, expectedRevision: rowRevision(source) }] } });
    expect(response.statusCode).toBe(200);
    expect(response.json().rowRevisions['УО:4']).toBe(rowRevision(final));
    expect(writeCellValue).toHaveBeenCalledTimes(2);
    expect(readCurrentDeptRow).toHaveBeenCalledTimes(3);
  });


  it('mirrors the next confirmed cell after Sheets reformats an edited date', async () => {
    const { rowRevision } = await import('../services/row-revision.js');
    const source = sheetValues()[3]!;
    const first = [...source]; first[16] = '12.10.2026';
    const final = [...first]; final[7] = 12;
    readCurrentDeptRow.mockResolvedValueOnce(source).mockResolvedValueOnce(first).mockResolvedValueOnce(final);
    const response = await app.inject({ method: 'POST', url: '/api/data/rows',
      payload: { rows: [{ deptId: 'УО', rowIndex: 4, changes: { Q: '2026-10-12', H: 12 }, expectedRevision: rowRevision(source) }] } });
    expect(response.statusCode).toBe(200);
    expect(getDeptSheetValues()['УО']![3]![7]).toBe(12);
  });

  it('single-field PUT does not report success for a different post-write row', async () => {
    const { rowRevision } = await import('../services/row-revision.js');
    readCurrentDeptRow.mockResolvedValueOnce(sheetValues()[3]!).mockResolvedValueOnce(sheetValues()[4]!);
    const response = await app.inject({ method: 'PUT', url: '/api/rows/УО/4/field',
      payload: { field: 'G', value: 'Новый предмет', expectedRevision: rowRevision(sheetValues()[3]!) } });
    expect(response.statusCode).toBe(409);
    expect(response.json().success).not.toBe(true);
    expect(response.json().savedToSource).toBe(true);
    expect(getDeptSheetValues()['УО']![3]![6]).toBe('Закупка 1');
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
