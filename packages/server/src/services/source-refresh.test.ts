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
