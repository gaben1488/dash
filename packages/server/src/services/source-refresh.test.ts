import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Страж канона п.66 («прямой эфир»): обе стороны сверки читаются одним циклом.
 *
 * Прецедент 14.08.2026: официальные ячейки читались свежими при каждой сборке
 * снимка, а строки книг брались из кэша, наполненного при старте сервера.
 * Продукт показывал −181,9 по УКСиМП и −313,6 по УО как расхождения расчёта,
 * тогда как обе стороны были согласованы — разошлись МОМЕНТЫ чтения.
 */

const fetchDepartmentSpreadsheets = vi.fn();
const getSheetData = vi.fn();
const setDeptSheetCache = vi.fn();
const setDeptLoadMeta = vi.fn();
const setSvodGridCache = vi.fn();

vi.mock('./google-sheets.js', () => ({
  fetchDepartmentSpreadsheets: (...a: unknown[]) => fetchDepartmentSpreadsheets(...a),
  getSheetData: (...a: unknown[]) => getSheetData(...a),
}));

vi.mock('./snapshot.js', () => ({
  setDeptSheetCache: (...a: unknown[]) => setDeptSheetCache(...a),
  setDeptLoadMeta: (...a: unknown[]) => setDeptLoadMeta(...a),
  setSvodGridCache: (...a: unknown[]) => setSvodGridCache(...a),
}));

const log = { info: vi.fn(), warn: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  fetchDepartmentSpreadsheets.mockResolvedValue({
    data: {
      'УКСиМП': { values: [[1], [2]], formulas: [], sheetName: 'ВСЕ' },
      'УО': { values: [[1]], formulas: [], sheetName: 'ВСЕ' },
    },
    errors: {},
  });
  getSheetData.mockResolvedValue([['СВОД']]);
});

afterEach(async () => {
  const { stopSourceAutoRefresh } = await import('./source-refresh.js');
  stopSourceAutoRefresh();
});

describe('перечитка источников одним циклом', () => {
  it('книги и лист СВОД читаются в одном вызове и кладутся в кэш', async () => {
    const { refreshAllSources } = await import('./source-refresh.js');
    const r = await refreshAllSources(log);

    expect(fetchDepartmentSpreadsheets).toHaveBeenCalledTimes(1);
    expect(getSheetData).toHaveBeenCalledTimes(1);
    expect(setDeptSheetCache).toHaveBeenCalledTimes(1);
    expect(setSvodGridCache).toHaveBeenCalledTimes(1);
    expect(r.loaded).toEqual(['УКСиМП', 'УО']);
    expect(r.svodOk).toBe(true);
  });

  it('параллельные вызовы разделяют один цикл, а не читают книги дважды', async () => {
    const { refreshAllSources } = await import('./source-refresh.js');
    const [a, b] = await Promise.all([refreshAllSources(log), refreshAllSources(log)]);

    expect(fetchDepartmentSpreadsheets).toHaveBeenCalledTimes(1);
    expect(a.at).toBe(b.at);
  });

  it('упавшая книга удаляется из кэша, а не остаётся под видом свежей', async () => {
    fetchDepartmentSpreadsheets.mockResolvedValueOnce({
      data: { 'УО': { values: [[1]], formulas: [], sheetName: 'ВСЕ' } },
      errors: { 'УКСиМП': 'таймаут' },
    });
    const { refreshAllSources } = await import('./source-refresh.js');
    const r = await refreshAllSources(log);

    expect(r.failed).toEqual(['УКСиМП']);
    expect(setDeptSheetCache).toHaveBeenCalledWith(expect.anything(), ['УКСиМП']);
  });

  it('недоступный лист СВОД не валит цикл: книги всё равно обновлены', async () => {
    getSheetData.mockRejectedValueOnce(new Error('403'));
    const { refreshAllSources } = await import('./source-refresh.js');
    const r = await refreshAllSources(log);

    expect(r.svodOk).toBe(false);
    expect(r.loaded.length).toBe(2);
    expect(log.warn).toHaveBeenCalled();
  });
});

describe('рабочее окно опроса (канон п.87/20: 8:45–18:20 по Камчатке)', () => {
  it('границы окна включительны, ночь и раннее утро — вне окна', async () => {
    const { isWithinWorkHours } = await import('./source-refresh.js');
    const kamchatka = 12;
    // 8:45 по Камчатке = 20:45 UTC предыдущего дня
    expect(isWithinWorkHours(new Date(Date.UTC(2026, 7, 13, 20, 45)), kamchatka)).toBe(true);
    // 18:20 включительно
    expect(isWithinWorkHours(new Date(Date.UTC(2026, 7, 14, 6, 20)), kamchatka)).toBe(true);
    // 18:21 — уже вне
    expect(isWithinWorkHours(new Date(Date.UTC(2026, 7, 14, 6, 21)), kamchatka)).toBe(false);
    // 8:44 — ещё вне
    expect(isWithinWorkHours(new Date(Date.UTC(2026, 7, 13, 20, 44)), kamchatka)).toBe(false);
    // полночь по Камчатке
    expect(isWithinWorkHours(new Date(Date.UTC(2026, 7, 14, 12, 0)), kamchatka)).toBe(false);
  });
});
