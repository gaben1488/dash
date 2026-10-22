/**
 * Страж скорости сборки снимка (21.08.2026).
 *
 * Сборка снимка читала листы сводной книги по одному — девять `values.get`
 * на КАЖДУЮ пересборку, а пересборка случается после каждого уведомления,
 * что-то изменившего. Здесь закреплено обратное: одно пакетное обращение, а
 * путь по одному листу остаётся только как запасной — на отказ пакета.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_SHEETS, SVOD_SHEET_NAME, DEPARTMENTS, DEPT_HEADER_ROWS } from '@aemr/shared';

const ORIGINAL_ENV = { ...process.env };

const batchGetCells = vi.fn(async () => []);
const batchGetFormulas = vi.fn(async () => []);
const getSheetData = vi.fn(async () => [['строка']] as unknown[][]);
const batchGetSheetValues = vi.fn(async (names: readonly string[]) =>
  Object.fromEntries(names.map((n) => [n, [['строка']] as unknown[][]])),
);

vi.mock('./google-sheets.js', () => ({
  batchGetCells,
  batchGetFormulas,
  batchGetSheetValues,
  getSheetData,
  fetchSHDYUSheet: vi.fn(async () => ({ values: [], formulas: [], sheetName: 'monthly' })),
}));

beforeEach(() => {
  batchGetCells.mockClear();
  batchGetFormulas.mockClear();
  getSheetData.mockClear();
  batchGetSheetValues.mockClear();
  batchGetSheetValues.mockImplementation(async (names: readonly string[]) =>
    Object.fromEntries(names.map((n) => [n, [['строка']] as unknown[][]])),
  );
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
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('сборка снимка: чтение листов сводной книги', () => {
  it('keeps an unchanged complete model past TTL until an explicit invalidation', async () => {
    process.env.SOURCE_AUTO_REFRESH_MINUTES = '0';
    process.env.GOOGLE_API_KEY = 'synthetic-configured';
    const source = await import('./snapshot.js');
    source.setDeptSheetCache(Object.fromEntries(DEPARTMENTS.map(dept => [dept.nameShort, {
      values: Array.from({ length: DEPT_HEADER_ROWS }, () => []), formulas: [], sheetName: dept.nameShort,
    }])));
    const first = await source.getSnapshot(true);
    expect(first.metadata.sourceCoverage?.complete).toBe(true);
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 600_000);
    batchGetSheetValues.mockClear();
    try {
      expect((await source.getSnapshot()).id).toBe(first.id);
      expect(batchGetSheetValues).not.toHaveBeenCalled();
      source.invalidateCache();
      await source.getSnapshot(true);
      expect(batchGetSheetValues).toHaveBeenCalledOnce();
    } finally { clock.mockRestore(); }
  }, 20000);
  it('неподтверждённое зеркало не подменяет отсутствующую основную книгу', async () => {
    const values = [[], [], [], ['1', '', '', '', '', '', 'Закупка', 100, '', '', 100]];
    batchGetSheetValues.mockResolvedValueOnce({ УЭР: values });
    const { getSnapshot } = await import('./snapshot.js');
    const result = await getSnapshot(true);
    expect(result.rowsByDept?.['УЭР']).toBeUndefined();
    expect(result.metadata.sourceCoverage?.readDepartments).toEqual([]);
    expect(result.metadata.sourceCoverage?.complete).toBe(false);
  }, 20000);
  it('берёт все листы ОДНИМ пакетом, а не по одному запросу на лист', async () => {
    const { getSnapshot } = await import('./snapshot.js');
    await getSnapshot(true);

    expect(batchGetSheetValues).toHaveBeenCalledTimes(1);
    expect(batchGetSheetValues.mock.calls[0][0]).toEqual([...ALL_SHEETS]);
    // Ни одного одиночного чтения листа: ради этого всё и затевалось.
    expect(getSheetData).not.toHaveBeenCalled();
  }, 20000);

  it('лист СВОД, прочитанный циклом минуту назад, второй раз не читается', async () => {
    const { getSnapshot, setSvodGridCache } = await import('./snapshot.js');
    setSvodGridCache([['СВОД', 1], ['строка', 2]]);
    await getSnapshot(true);

    const asked = batchGetSheetValues.mock.calls[0][0] as string[];
    expect(asked).not.toContain(SVOD_SHEET_NAME);
    expect(asked.length).toBe(ALL_SHEETS.length - 1);
  }, 20000);

  it('пакет отказал — листы дочитываются по одному, снимок всё равно собирается', async () => {
    batchGetSheetValues.mockRejectedValueOnce(new Error('Unable to parse range'));
    const { getSnapshot } = await import('./snapshot.js');
    await getSnapshot(true);

    expect(batchGetSheetValues).toHaveBeenCalledTimes(1);
    expect(getSheetData).toHaveBeenCalledTimes(ALL_SHEETS.length);
  }, 20000);
});

it('excludes a mismatched primary binding from the snapshot even if the old cache has rows', async () => {
  const { getSnapshot, setDeptSheetCache } = await import('./snapshot.js');
  const vals = [[], [], [], ['1', '', '', '', '', '', 'Закупка', 100]];
  setDeptSheetCache({ УЭР: { providerId: 'old-master-id', values: vals,
    sheetName: 'ВСЕ', formulas: [], formulasRead: false } });
  const snapshot = await getSnapshot(true);
  expect(snapshot.rowsByDept?.['УЭР']).toBeUndefined();
  expect(snapshot.metadata.sourceCoverage?.unreadDepartments).toEqual(
    expect.arrayContaining([expect.objectContaining({ department: 'УЭР' })]),
  );
}, 20000);

it('does not renew eight-master freshness after an individual or empty refresh', async () => {
  const { setDeptSheetCache, getDeptCacheFilledAt } = await import('./snapshot.js');
  const { DEPARTMENT_SPREADSHEETS } = await import('../config.js');
  const initial = '2026-10-22T11:00:00.000Z';
  const later = '2026-10-22T12:00:00.000Z';
  const books = Object.fromEntries(Object.entries(DEPARTMENT_SPREADSHEETS).map(([name, providerId]) =>
    [name, { providerId, values: [[], [], []], formulas: [], sheetName: 'ВСЕ' }]));
  const departments = Object.keys(books);
  expect(departments.length).toBe(8);
  setDeptSheetCache(books, [], initial);
  expect(getDeptCacheFilledAt()).toBe(Date.parse(initial));
  setDeptSheetCache({ [departments[0]]: books[departments[0]] }, [], later);
  expect(getDeptCacheFilledAt()).toBe(Date.parse(initial));
  setDeptSheetCache({}, [], later);
  expect(getDeptCacheFilledAt()).toBe(Date.parse(initial));
  setDeptSheetCache({}, [], later, departments);
  expect(getDeptCacheFilledAt()).toBe(Date.parse(later));
  setDeptSheetCache({}, [departments[1]], later);
  expect(getDeptCacheFilledAt()).toBe(0);
});

it('a stored snapshot with unknown source coverage is not an indefinitely fresh live calculation', async () => {
  // Old serialized snapshots have no sourceCoverage; absence is not "complete".
  const { getSnapshot, setDeptSheetCache } = await import('./snapshot.js');
  const first = await getSnapshot(true);
  expect(first.metadata.sourceCoverage?.complete).toBe(false);
  // This assertion is structural: a missing source never becomes a valid new
  // complete capture only because a cache timestamp was recently updated.
  setDeptSheetCache({}, [], '2026-10-22T12:00:00.000Z');
  expect((await getSnapshot()).metadata.sourceCoverage?.complete).not.toBe(true);
}, 20000);
