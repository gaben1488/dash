import { afterAll, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const sqlitePath = process.env.SQLITE_PATH;
  process.env.SQLITE_PATH = ':memory:';
  return { sqlitePath, value: 'old', grid: undefined as unknown[][] | undefined, books: {} as Record<string, { values: unknown[][] }> };
});
const publishSummary = vi.hoisted(() => vi.fn());
vi.mock('./google-sheets.js', () => ({
  fetchDepartmentSpreadsheets: async () => ({
    data: { УО: { values: state.grid ?? [[state.value]], formulas: [], sheetName: 'ВСЕ' } }, errors: {},
  }),
  getSheetData: async () => [[state.value]],
}));
vi.mock('./snapshot.js', () => ({
  getDeptSheetCache: () => state.books,
  setDeptSheetCache: (books: typeof state.books) => { state.books = books; },
  setDeptLoadMeta: vi.fn(), setSvodGridCache: publishSummary,
  setSvodLoadFailure: vi.fn(), getSvodLoadFailure: () => null, invalidateCache: vi.fn(),
}));
vi.mock('./file-revision.js', () => ({
  readRevision: vi.fn(async () => null),
  checkFileChanged: vi.fn(), lastKnownRevision: () => null,
  forgetRevision: vi.fn(), seedRevision: vi.fn(),
}));
afterAll(() => {
  if (state.sqlitePath === undefined) delete process.env.SQLITE_PATH;
  else process.env.SQLITE_PATH = state.sqlitePath;
});

it('rolls back earlier watermarks when a later SQLite write fails, then accepts a retry', async () => {
  const { refreshAllSources } = await import('./source-refresh.js');
  const { loadWatermarks } = await import('./book-watermark.js');
  const { db } = await import('../db/index.js');
  await refreshAllSources(undefined, 'cycle', { askDrive: false });
  const accepted = loadWatermarks();
  const books = state.books;
  publishSummary.mockClear();
  state.value = 'new';
  db.$client.exec("CREATE TEMP TRIGGER fail_book BEFORE INSERT ON book_watermarks WHEN NEW.book = 'УО' BEGIN SELECT RAISE(ABORT, 'injected write failure'); END");
  try {
    await expect(refreshAllSources(undefined, 'cycle', { askDrive: false })).rejects.toThrow('SOURCE_STATE_PERSIST_FAILED');
    expect(loadWatermarks()).toEqual(accepted);
    expect(state.books).toBe(books);
    expect(publishSummary).not.toHaveBeenCalled();
  } finally {
    db.$client.exec('DROP TRIGGER fail_book');
  }
  const retry = await refreshAllSources(undefined, 'cycle', { askDrive: false });
  expect(retry.changedBooks).toEqual(['УО']);
  expect(retry.svodChanged).toBe(true);
  expect(state.books['УО'].values).toEqual([['new']]);
  expect(loadWatermarks().get('УО')?.fingerprint).not.toBe(accepted.get('УО')?.fingerprint);
}, 30_000);


it('records missing manual numbers after restarting with only the accepted SQLite state', async () => {
  const { refreshAllSources, resetSourcePrints } = await import('./source-refresh.js');
  const { readSourceRowObservations } = await import('./source-row-observations.js');
  const numbers = [1094, 1506, 1507, 1510, 1512, 1514, 1518];
  const row = (n: number) => { const r: unknown[] = []; r[0] = n; r[2] = 'Учреждение';
    r[6] = `Предмет ${n}`; r[10] = 100; r[11] = 'ЕП'; return r; };
  const headers = [[], [], []];
  state.grid = [...headers, row(1000), ...numbers.map(row), row(1600)];
  await refreshAllSources(undefined, 'cycle', { books: ['УО'], svod: false, askDrive: false });
  state.books = {}; // A fresh process has no in-memory matrices.
  resetSourcePrints();
  state.grid = [...headers, row(1000), row(1600)];
  await refreshAllSources(undefined, 'webhook', { books: ['УО'], svod: false, askDrive: false });
  const entries = readSourceRowObservations(0);
  expect(entries.map(e => e.rowSeq).sort()).toEqual(numbers.map(String).sort());
  expect(entries.every(e => e.at === null && !!e.observedAt && e.author === null)).toBe(true);
  resetSourcePrints(); state.books = {};
  await refreshAllSources(undefined, 'webhook', { books: ['УО'], svod: false, askDrive: false });
  expect(readSourceRowObservations(0)).toHaveLength(7);
}, 30_000);
