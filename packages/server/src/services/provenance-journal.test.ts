import { beforeEach, expect, it, vi } from 'vitest';
const source = vi.hoisted(() => vi.fn());
vi.mock('./google-sheets.js', () => ({ getSheetDataFromSpreadsheet: source }));
vi.mock('../config.js', () => ({ DEPARTMENT_SPREADSHEETS: {} }));
const { readBookJournal, resetProvenanceJournalCache } = await import('./provenance-journal.js');
const rows = (value: unknown): unknown[][] => [['ВСЕ', 'H7', 'H', '173', value, 'updated', '2026-10-13', null]];
beforeEach(() => { source.mockReset(); resetProvenanceJournalCache(); });
it('concurrent cold parsed consumers share one result and preserve originals', async () => {
  let release!: (rows: unknown[][]) => void;
  source.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const original = { nested: ['original'] }; const raw = rows(original);
  const pending = Array.from({ length: 5 }, () => readBookJournal('УО', 'file-A', 1000));
  release(raw); const results = await Promise.all(pending);
  expect(source).toHaveBeenCalledTimes(1);
  for (const result of results) {
    expect(result).toBe(results[0]); expect(result.records[0].was).toBe(original); expect(result.records[0].author).toBeNull();
  }
  expect(raw).toEqual(rows(original));
});
it('same department switched to B cannot reuse parsed A', async () => {
  source.mockResolvedValueOnce(rows('A')).mockResolvedValueOnce(rows('B'));
  await readBookJournal('УО', 'file-A', 1000);
  expect((await readBookJournal('УО', 'file-B', 1001)).records[0].was).toBe('B');
  expect(source).toHaveBeenLastCalledWith('file-B', '_ChangeLog', true);
});
it('stale reset completion cannot populate or detach the winning parsed reading', async () => {
  let oldDone!: (rows: unknown[][]) => void; let newDone!: (rows: unknown[][]) => void;
  source.mockImplementationOnce(() => new Promise(resolve => { oldDone = resolve; })).mockImplementationOnce(() => new Promise(resolve => { newDone = resolve; }));
  const old = readBookJournal('УО', 'file-A', 1000); resetProvenanceJournalCache();
  const winner = readBookJournal('УО', 'file-A', 2000);
  oldDone(rows('old')); await old;
  const follower = readBookJournal('УО', 'file-A', 2001); newDone(rows('new'));
  expect(await follower).toBe(await winner);
  expect((await readBookJournal('УО', 'file-A', 2002)).records[0].was).toBe('new'); expect(source).toHaveBeenCalledTimes(2);
});
it('failure is unavailable and is not cached', async () => {
  source.mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce(rows('restored'));
  expect(await readBookJournal('УО', 'file-A', 1000)).toMatchObject({ available: false, error: 'unavailable' });
  expect((await readBookJournal('УО', 'file-A', 1001)).records[0].was).toBe('restored'); expect(source).toHaveBeenCalledTimes(2);
});
it('late parsed A cannot replace a newer B reading', async () => {
  let oldDone!: (rows: unknown[][]) => void;
  source.mockImplementationOnce(() => new Promise(resolve => { oldDone = resolve; })).mockResolvedValueOnce(rows('B'));
  const old = readBookJournal('УО', 'file-A', 1000);
  const current = await readBookJournal('УО', 'file-B', 2000);
  oldDone(rows('A')); await old;
  expect(await readBookJournal('УО', 'file-B', 2001)).toBe(current);
  expect(current.records[0].was).toBe('B');
  expect(source).toHaveBeenCalledTimes(2);
});

it('preserves the original log row before skipping headers and blanks, bound to the actual cached reading', async () => {
  const { readChangelogRows } = await import('./changelog-source.js');
  const raw = [['Лист', 'Ячейка'], [], ...rows(100), ...rows(100)];
  source.mockResolvedValueOnce(raw);
  await readChangelogRows('УО', 'file-A', 1000);
  const result = await readBookJournal('УО', 'file-A', 2000);
  expect(result.records.map(record => record.source)).toEqual([
    { spreadsheetId: 'file-A', journalSheet: '_ChangeLog', journalRow: 3, readAt: 1000 },
    { spreadsheetId: 'file-A', journalSheet: '_ChangeLog', journalRow: 4, readAt: 1000 },
  ]);
  expect(raw).toEqual([['Лист', 'Ячейка'], [], ...rows(100), ...rows(100)]);
});

it('binds an old in-flight reply to its own reading rather than the newer winning cache', async () => {
  let finish!: (rows: unknown[][]) => void;
  source.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValueOnce(rows('new'));
  const old = readBookJournal('УО', 'file-A', 1000);
  resetProvenanceJournalCache();
  const newer = await readBookJournal('УО', 'file-A', 2000);
  finish(rows('old'));
  expect((await old).records[0].source?.readAt).toBe(1000);
  expect(newer.records[0].source?.readAt).toBe(2000);
});
