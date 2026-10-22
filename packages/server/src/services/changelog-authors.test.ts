import { describe, expect, it } from 'vitest';

// Never access an operator's SQLite database in a regression test.
process.env.NODE_ENV = 'test';
process.env.SQLITE_PATH = ':memory:';
process.env.LOG_LEVEL = 'silent';
process.env.GOOGLE_PRIVATE_KEY = '';
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = '';

const { db, schema } = await import('../db/index.js');
const { authorTimestampMatches, findChangeAuthor } = await import('./changelog-authors.js');

describe('source author attribution from _ChangeLog', () => {
  it('converts Kamchatka book clock to UTC only for the match window', () => {
    const localAt = Date.UTC(2026, 9, 22, 18, 20, 0);
    const eventNow = Date.UTC(2026, 9, 22, 6, 21, 0);
    expect(authorTimestampMatches(localAt, eventNow)).toBe(true);
    expect(authorTimestampMatches(localAt, eventNow + 10 * 60_000)).toBe(false);
    expect(authorTimestampMatches(localAt, eventNow - 4 * 60_000)).toBe(false);
  });

  it('never attributes date-only source events to a specific new live edit', () => {
    db.insert(schema.changelogEntries).values({
      id: 'journal-day-v2:' + 'a'.repeat(64) + ':0',
      dept: 'УО', sheet: 'ВСЕ', cell: 'K5',
      atMs: Date.UTC(2026, 9, 22),
      author: 'unverified-editor', recordedAt: '2026-10-22T09:00:00Z',
    }).run();
    expect(findChangeAuthor('УО', 'K5', Date.UTC(2026, 9, 22, 10))).toBeUndefined();
  });

  it('uses a recent, timed record but not a stale timed record', () => {
    const clock = Date.UTC(2026, 9, 22, 18, 20);
    db.insert(schema.changelogEntries).values({
      id: ['УО', 'ВСЕ', 'K6', clock, 'timed-editor'].join('|'),
      dept: 'УО', sheet: 'ВСЕ', cell: 'K6',
      atMs: clock, author: 'timed-editor', recordedAt: '2026-10-22T09:00:00Z',
    }).run();
    const now = Date.UTC(2026, 9, 22, 6, 21);
    expect(findChangeAuthor('УО', 'K6', now)).toBe('timed-editor');
    expect(findChangeAuthor('УО', 'K6', now + 10 * 60_000)).toBeUndefined();
  });
});
