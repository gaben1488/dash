import { beforeEach, expect, it, vi } from 'vitest';
import { seedRevision, forgetRevision, resetRevisionMemory } from './file-revision.js';
const source = vi.hoisted(() => vi.fn());
vi.mock('./google-sheets.js', () => ({ getSheetDataFromSpreadsheet: source }));
vi.mock('../config.js', () => ({ DEPARTMENT_SPREADSHEETS: {} }));
const { readBookJournal, resetProvenanceJournalCache, parseProvenanceJournal } = await import('./provenance-journal.js');
const rows = (value: unknown): unknown[][] => [['ВСЕ', 'H7', 'H', '173', value, 'updated', '2026-10-13', null]];
beforeEach(() => { source.mockReset(); resetRevisionMemory(); resetProvenanceJournalCache(); });
it('preserves parsed provenance for unchanged days and rereads a new revision immediately', async () => {
  seedRevision('file-A', { version: '1', modifiedTime: null });
  source.mockResolvedValueOnce(rows('original')).mockResolvedValueOnce(rows('changed'));
  const original = await readBookJournal('УО', 'file-A', 1000);
  expect(await readBookJournal('УО', 'file-A', 1000 + 2 * 86400000)).toBe(original);
  expect(original.records[0].source?.readAt).toBe(1000);
  expect(source).toHaveBeenCalledTimes(1);
  forgetRevision('file-A');
  seedRevision('file-A', { version: '2', modifiedTime: null });
  expect((await readBookJournal('УО', 'file-A', 1000 + 2 * 86400000 + 1)).records[0].was).toBe('changed');
  expect(source).toHaveBeenCalledTimes(2);
});
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

it('shared source grammar produces matching identity and raw provenance for 8/6 schema', async () => {
  const { parseChangeLogDetailed } = await import('./changelog.js');
  const sourceRows = [
    ['Лист', 'Ячейка', 'Столбец', 'Строка', 'Было', 'Стало', 'Время', 'Автор'],
    ['ВСЕ', 'J177', 10, '№ 195 · Услуги', 10, 12, '08.04.2026 9:09:54', null],
    ['УАГЗО!B48', 'old', 'new', '06.04.2026 12:58:16', '', 'sent'],
    ['Контроль', 'A1:C12', '(пакет)', '36', '', 'batchUpdate', '10.09.2026'],
  ];
  const provenance = parseProvenanceJournal(sourceRows, { spreadsheetId: 'book', at: 100 });
  const changes = parseChangeLogDetailed(sourceRows, 'УО');
  expect(provenance.records.map(row => row.cell)).toEqual(changes.records.map(row => row.cell));
  expect(provenance.rowKeyless).toBe(1);
  expect(provenance.records[0].row).toBe('№ 195 · Услуги');
  expect(provenance.records[0].source).toMatchObject({ journalRow: 2, spreadsheetId: 'book' });
  expect(provenance.records[1].sheet).toBe('УАГЗО');
  expect(provenance.records[1].row).toBe('');
  expect(changes.coverage).toMatchObject({ parsed: 2, nonCell: 1, unparsed: 1 });
});
