/**
 * Страж скорости сборки снимка (21.08.2026).
 *
 * Сборка снимка читала листы сводной книги по одному — девять `values.get`
 * на КАЖДУЮ пересборку, а пересборка случается после каждого уведомления,
 * что-то изменившего. Здесь закреплено обратное: одно пакетное обращение, а
 * путь по одному листу остаётся только как запасной — на отказ пакета.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_SHEETS, SVOD_SHEET_NAME } from '@aemr/shared';

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
