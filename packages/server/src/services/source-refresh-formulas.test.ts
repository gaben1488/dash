/**
 * Стражи ЧТЕНИЯ И ДОСТАВКИ ФОРМУЛ в цикле источников (решение владельца §22 п.7).
 *
 * Охраняются обещания:
 *   1. Быстрое (плановое) обновление формулы НЕ читает: цикл идёт в
 *      `fetchDepartmentSpreadsheets` без флага.
 *   2. Просьба прочитать формулы доезжает до чтения и до итога цикла.
 *   3. Прочитанные формулы отдаются разбору целостности в форме, о которой
 *      договорились с ядром: `{ values, formulas, startRow, book }`.
 *   4. Разбор не подключён — это НЕ «дефектов нет»: след доставки честно
 *      говорит, что разбирать было некому.
 *   5. Просьба о формулах СКЛАДЫВАЕТСЯ в обещанном цикле: уведомление, попавшее
 *      в серию, не теряет чтения формул.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchDepartmentSpreadsheets = vi.fn();
const getSheetData = vi.fn(async () => [['СВОД']]);

vi.mock('./google-sheets.js', () => ({
  fetchDepartmentSpreadsheets: (...a: unknown[]) => fetchDepartmentSpreadsheets(...a),
  getSheetData: (...a: unknown[]) => getSheetData(...(a as [])),
}));

vi.mock('./snapshot.js', () => ({
  setDeptSheetCache: vi.fn(),
  setDeptLoadMeta: vi.fn(),
  setSvodGridCache: vi.fn(),
  setSvodLoadFailure: vi.fn(),
  invalidateCache: vi.fn(),
  getDeptSheetCache: () => ({}),
  getSvodLoadFailure: () => null,
}));

vi.mock('./file-revision.js', () => ({
  checkFileChanged: vi.fn(async () => 'unknown' as const),
  forgetRevision: vi.fn(),
  lastKnownRevision: vi.fn(() => null),
  seedRevision: vi.fn(),
}));

vi.mock('./book-watermark.js', () => ({
  SVOD_WATERMARK_KEY: 'лист СВОД',
  loadWatermarks: vi.fn(() => new Map()),
  saveWatermark: vi.fn(),
  noteHonestGap: vi.fn(() => true),
}));

vi.mock('../config.js', () => ({
  config: {
    google: { spreadsheetId: 'file-svod' },
    cache: { autoRefreshMinutes: 0 },
    weeklySnapshot: { utcOffsetHours: 12 },
  },
  DEPARTMENT_SPREADSHEETS: { 'УО': 'file-uo' },
}));

const log = { info: vi.fn(), warn: vi.fn() };

/** Журнал источников — в память: итог цикла пишется туда, а не в `log`. */
const journal: string[] = [];

/** Книга с прочитанными формулами: две строки данных, формулы в K и Y. */
function bookWithFormulas(): Record<string, unknown> {
  const formulas: unknown[][] = [];
  formulas[3] = [];
  formulas[3][10] = '=H4+I4+J4';
  formulas[3][24] = '=V4+W4+X4';
  return {
    'УО': {
      values: [['шапка'], ['шапка'], ['шапка'], [1], [2]],
      formulas,
      sheetName: 'ВСЕ',
      startRow: 1,
      formulasRead: true,
    },
  };
}

beforeEach(async () => {
  journal.length = 0;
  const { setSourceLogger } = await import('./source-log.js');
  setSourceLogger({
    info: (_f, msg) => { journal.push(msg); },
    warn: (_f, msg) => { journal.push(msg); },
    error: (_f, msg) => { journal.push(msg); },
  });
  fetchDepartmentSpreadsheets.mockReset();
  fetchDepartmentSpreadsheets.mockResolvedValue({ data: {}, errors: {} });
  const { resetSourcePrints, resetFormulaDeliveries, setFormulaSink } =
    await import('./source-refresh.js');
  resetSourcePrints();
  resetFormulaDeliveries();
  setFormulaSink(null);
});

afterEach(() => {
  log.info.mockClear();
  log.warn.mockClear();
});

describe('чтение формул в цикле источников', () => {
  it('плановое обновление формулы не просит', async () => {
    const { refreshAllSources } = await import('./source-refresh.js');
    const result = await refreshAllSources(log, 'cycle');

    const options = fetchDepartmentSpreadsheets.mock.calls[0][1] as { withFormulas: boolean };
    expect(options.withFormulas).toBe(false);
    expect(result.formulaBooks).toEqual([]);
    // В журнале это сказано СЛОВАМИ: строка без упоминания формул
    // читалась бы как «формулы в порядке».
    expect(journal.some((line) => line.includes('формулы не читались'))).toBe(true);
  }, 30_000);

  it('просьба о формулах доезжает до чтения и до итога цикла', async () => {
    fetchDepartmentSpreadsheets.mockResolvedValue({ data: bookWithFormulas(), errors: {} });
    const { refreshAllSources } = await import('./source-refresh.js');
    const result = await refreshAllSources(log, 'webhook', { withFormulas: true });

    const options = fetchDepartmentSpreadsheets.mock.calls[0][1] as { withFormulas: boolean };
    expect(options.withFormulas).toBe(true);
    expect(result.formulaBooks).toEqual(['УО']);
    expect(journal.some((line) => line.includes('формулы прочитаны: УО'))).toBe(true);
  });

  it('формулы приезжают в разбор в договорённой форме', async () => {
    fetchDepartmentSpreadsheets.mockResolvedValue({ data: bookWithFormulas(), errors: {} });
    const { refreshAllSources, setFormulaSink, formulaDeliveryState } =
      await import('./source-refresh.js');

    const seen: Array<{ book: string; startRow: number; formulas: unknown[][]; values: unknown[][] }> = [];
    setFormulaSink((delivery) => { seen.push(delivery); });
    await refreshAllSources(log, 'webhook', { withFormulas: true });

    expect(seen).toHaveLength(1);
    expect(seen[0].book).toBe('УО');
    expect(seen[0].startRow).toBe(1);
    expect(seen[0].formulas[3][10]).toBe('=H4+I4+J4');
    expect(seen[0].values).toHaveLength(5);

    const state = formulaDeliveryState();
    expect(state.sinkConnected).toBe(true);
    expect(state.books[0].handled).toBe(true);
    expect(state.books[0].cells).toBe(2);
  });

  it('разбор не подключён — след говорит об этом, а не молчит', async () => {
    fetchDepartmentSpreadsheets.mockResolvedValue({ data: bookWithFormulas(), errors: {} });
    const { refreshAllSources, formulaDeliveryState } = await import('./source-refresh.js');
    await refreshAllSources(log, 'webhook', { withFormulas: true });

    const state = formulaDeliveryState();
    expect(state.sinkConnected).toBe(false);
    expect(state.books[0].handled).toBe(false);
    expect(state.books[0].failedBecause).toBe('разбор формул не подключён');
  });

  it('книга без чтения формул в перечень доставок не попадает', async () => {
    fetchDepartmentSpreadsheets.mockResolvedValue({
      data: { 'УО': { values: [[1]], formulas: [], sheetName: 'ВСЕ' } },
      errors: {},
    });
    const { refreshAllSources, formulaDeliveryState } = await import('./source-refresh.js');
    await refreshAllSources(log, 'cycle');

    // Ни следа доставки, ни книги в итоге: молчание про формулы означает
    // «не читали», и выдать его за «дефектов нет» нечему.
    expect(formulaDeliveryState().books).toEqual([]);
  });

  it('просьба о формулах складывается в обещанном цикле', async () => {
    const { widenScopeForTests } = await import('./source-refresh.js');
    const scope = widenScopeForTests(null, { books: ['УО'] });
    expect(scope.withFormulas).toBe(false);
    const wider = widenScopeForTests(scope, { books: ['УИО'], withFormulas: true });
    expect(wider.withFormulas).toBe(true);
    // Обратный порядок: просьба о формулах уже стояла — обычный вызов её не снимает.
    const kept = widenScopeForTests(wider, { books: ['УД'] });
    expect(kept.withFormulas).toBe(true);
  });
});
