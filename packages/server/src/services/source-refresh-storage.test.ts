import { afterAll, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const sqlitePath = process.env.SQLITE_PATH;
  process.env.SQLITE_PATH = ':memory:';
  return { sqlitePath, value: 'old', books: {} as Record<string, { values: unknown[][] }> };
});
const publishSummary = vi.hoisted(() => vi.fn());
vi.mock('./google-sheets.js', () => ({
  fetchDepartmentSpreadsheets: async () => ({
    data: { УО: { values: [[state.value]], formulas: [], sheetName: 'ВСЕ' } }, errors: {},
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
