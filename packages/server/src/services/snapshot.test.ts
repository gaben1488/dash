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
const batchGetSheetValues = vi.fn(async () => ({}));

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
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: 'test',
    AEMR_API_KEY: '',
    SQLITE_PATH: ':memory:',
    LOG_LEVEL: 'silent',
    // Явный демо-режим: пустые ключи существуют → dotenv их не перезапишет
    // из .env машины. Иначе тест зависел бы от того, лежат ли на машине креды.
    GOOGLE_SERVICE_ACCOUNT_EMAIL: '',
    GOOGLE_PRIVATE_KEY: '',
    GOOGLE_API_KEY: '',
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
    // Таймаут 15s: тест гоняет ПОЛНЫЙ createSnapshot-пайплайн (демо-данные +
    // unifiedGrid + SQLite :memory:) — на нагруженной машине упирается в
    // дефолтные 5s. Ассерт — счёт вызовов, к латентности нечувствителен.
  }, 15000);
});

/** Минимальный снимок; rowsByDept опционален — как у старых снимков в БД. */
function snap(id: string, createdAt: string, rowsByDept?: Record<string, unknown[][]>) {
  return {
    id,
    spreadsheetId: 'test',
    createdAt,
    officialMetrics: {},
    calculatedMetrics: {},
    deltas: [],
    issues: [],
    trust: { overall: 100, components: [], grade: 'A' as const, computedAt: createdAt, basedOnSnapshot: id },
    rowCount: 0,
    ...(rowsByDept ? { rowsByDept } : {}),
    metadata: { sheetsRead: [], cellsRead: 0, readDurationMs: 0, pipelineDurationMs: 0 },
  };
}

describe('getSnapshotAtOrBefore — выбор снимка для отчёта прошлой недели', () => {
  it('берёт последний снимок ≤ дня СО строками, пропуская новее-но-без-строк; за границей — null', async () => {
    const { saveSnapshot, getSnapshotAtOrBefore } = await import('./snapshot.js');
    const { dayNumberOf } = await import('@aemr/shared');

    const rows = { УЭР: [['r1'], ['r2']] };
    await saveSnapshot(snap('old-with-rows', '2026-03-12T08:00:00.000Z', rows));
    // Новее, но БЕЗ строк (старый формат) — для истории непригоден, пропускается.
    await saveSnapshot(snap('new-no-rows', '2026-03-19T08:00:00.000Z'));

    const day = dayNumberOf('2026-03-19')!;
    expect(getSnapshotAtOrBefore(day)?.id).toBe('old-with-rows');
    // Граница «≤ day»: день снимка со строками включается.
    expect(getSnapshotAtOrBefore(dayNumberOf('2026-03-12')!)?.id).toBe('old-with-rows');
    // Раньше любого снимка — истории нет, честный null (не подмена).
    expect(getSnapshotAtOrBefore(dayNumberOf('2026-03-11')!)).toBeNull();
  });

  it('граница «≤ день» — в оси календаря ПРОДУКТА (+12 по умолчанию), не UTC-суток', async () => {
    const { saveSnapshot, getSnapshotAtOrBefore } = await import('./snapshot.js');
    const { dayNumberOf } = await import('@aemr/shared');

    const rows = { УЭР: [['r1']] };
    const thursday = dayNumberOf('2026-03-19')!; // четверг

    // Четверг 12:30 UTC = ПЯТНИЦА продукта 00:30 (+12): фильтр «≤ четверг»
    // пропускать его НЕ должен — иначе снимок «из будущего» затеняет срез.
    await saveSnapshot(snap('fri-product', '2026-03-19T12:30:00.000Z', rows));
    expect(getSnapshotAtOrBefore(thursday)).toBeNull();

    // Четверг 11:00 UTC = четверг продукта 23:00 — ещё внутри дня среза.
    await saveSnapshot(snap('thu-late', '2026-03-19T11:00:00.000Z', rows));
    expect(getSnapshotAtOrBefore(thursday)?.id).toBe('thu-late');
  });
});

describe('saveSnapshot — честный boolean-результат (не глотать ошибки молча)', () => {
  it('true при записи, false при сбое БД (дубликат id), без выброса', async () => {
    const { saveSnapshot } = await import('./snapshot.js');
    expect(await saveSnapshot(snap('dup', '2026-03-19T08:00:00.000Z'))).toBe(true);
    // Повторный insert того же id — конфликт первичного ключа: не бросает, а false.
    expect(await saveSnapshot(snap('dup', '2026-03-19T08:00:00.000Z'))).toBe(false);
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
