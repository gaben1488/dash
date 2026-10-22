import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./google-sheets.js', () => {
  const unavailable = vi.fn(async () => { throw new Error('Источник недоступен'); });
  return { batchGetCells: unavailable, batchGetFormulas: unavailable, batchGetSheetValues: unavailable,
    getSheetData: unavailable, fetchSHDYUSheet: unavailable };
});
vi.mock('../config.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../config.js')>();
  return { ...actual, config: { ...actual.config, google: { ...actual.config.google, spreadsheetId: 'book' } }, isDemoMode: false };
});

const originalEnv = { ...process.env };
describe('C07 — аварийное чтение сохранённой головы после scoped retention', () => {
  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: 'test', SQLITE_PATH: ':memory:', LOG_LEVEL: 'silent' };
    vi.resetModules();
  });
  afterEach(() => { process.env = { ...originalEnv }; vi.resetModules(); });

  it.each([undefined, 2027])('находит область %s за пределами пяти более новых чужих годов', async year => {
    const { db, schema } = await import('../db/index.js');
    const { pruneSnapshotsByRetention } = await import('./snapshot-retention.js');
    const { getSnapshot } = await import('./snapshot.js');
    const make = (id: string, targetYear: number | null, day: number, spreadsheetId = 'book') => {
      const createdAt = `2026-10-${String(day).padStart(2, '0')}T00:00:00.000Z`;
      const snapshot = { id, spreadsheetId, createdAt, officialMetrics: {}, calculatedMetrics: {},
        deltas: [], issues: [], rowCount: 0, trust: { overall: 100, components: [], grade: 'A', computedAt: createdAt, basedOnSnapshot: id },
        metadata: { targetYear, sheetsRead: [], cellsRead: 0, readDurationMs: 0, pipelineDurationMs: 0 } };
      db.insert(schema.snapshots).values({ id, spreadsheetId, createdAt, data: JSON.stringify(snapshot) }).run();
    };
    make('required-head', year ?? null, 1);
    for (let index = 0; index < 6; index++) make(`other-${index}`, 2020 + index, 2 + index);
    make('foreign-book-head', year ?? null, 8, 'other-book');
    expect(pruneSnapshotsByRetention(new Date('2026-10-15T00:00:00Z'))).toBe(0);
    const result = await getSnapshot(true, year);
    expect(result.id).toBe('required-head');
    expect(result.metadata.targetYear).toBe(year ?? null);
  });
});
