/**
 * B-9: getSnapshot() TOCTOU-гонка (нет in-flight дедупа) + setDeptSheetCache()
 * merge-семантика маскирует отвалившийся в этом цикле деп-лист старыми данными.
 *
 * Регрессия bug-hunt 2026-07-09/10, item B-9.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

const batchGetCells = vi.fn(async () => {
  // Искусственная задержка — гарантирует, что параллельные getSnapshot(true)
  // пересекутся во времени; без неё TOCTOU-гонка не проявится в тесте.
  await new Promise((resolve) => setTimeout(resolve, 20));
  return [];
});
const batchGetFormulas = vi.fn(async () => []);
const getSheetData = vi.fn(async () => []);

vi.mock('../google-sheets.js', () => ({ batchGetCells, batchGetFormulas, getSheetData }));
vi.mock('./google-sheets.js', () => ({
  fetchSHDYUSheet: vi.fn(async () => ({ values: [], formulas: [], sheetName: 'monthly' })),
}));

beforeEach(() => {
  batchGetCells.mockClear();
  batchGetFormulas.mockClear();
  getSheetData.mockClear();
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: 'test',
    AEMR_API_KEY: '',
    SQLITE_PATH: ':memory:',
    LOG_LEVEL: 'silent',
  };
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('getSnapshot — дедупликация конкурентных загрузок (TOCTOU, B-9)', () => {
  it('два параллельных force-refresh вызова шарят один in-flight load, а не гоняют createSnapshot дважды', async () => {
    const { getSnapshot } = await import('./snapshot.js');

    await Promise.all([getSnapshot(true), getSnapshot(true)]);

    // batchGetCells вызывается ровно 1 раз за один createSnapshot(). Без дедупа два
    // конкурентных force-refresh независимо гоняют createSnapshot() → 2 вызова.
    expect(batchGetCells).toHaveBeenCalledTimes(1);
  });
});

describe('setDeptSheetCache — replace-per-dept-key при отвалившемся департаменте (B-9)', () => {
  it('не должен молча отдавать старые строки упавшего в этом цикле деп-листа как текущие', async () => {
    const { setDeptSheetCache, getDeptSheetCache } = await import('./snapshot.js');

    // Цикл 1: оба ГРБС загрузились успешно.
    setDeptSheetCache({
      УО: { values: [['old-uo-row']], formulas: [], sheetName: 'ВСЕ' },
      УИО: { values: [['uio-row']], formulas: [], sheetName: 'УИО' },
    });

    // Цикл 2: УО провалился (его нет в data), УИО обновился. Вызывающий код обязан
    // явно сообщить кэшу, какие депы провалились в этом цикле.
    setDeptSheetCache(
      { УИО: { values: [['uio-row-fresh']], formulas: [], sheetName: 'УИО' } },
      ['УО'],
    );

    const cache = getDeptSheetCache();
    // Провалившийся в этом цикле УО не должен молча отдавать старые строки как текущие.
    expect(cache.УО).toBeUndefined();
    // Успешно обновлённый УИО должен отражать новые данные.
    expect(cache.УИО?.values).toEqual([['uio-row-fresh']]);
  });
});
