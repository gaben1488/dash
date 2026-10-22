import { beforeEach, describe, expect, it } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.SQLITE_PATH = ':memory:';
process.env.LOG_LEVEL = 'silent';
process.env.GOOGLE_PRIVATE_KEY = '';
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = '';

const { db, schema } = await import('../db/index.js');
const { changeEntryKey, saveChangeLogEntries, readChangeLogEntriesSince } = await import('./changes.js');
const { parseChangeLog } = await import('../services/changelog.js');

const header = ['Лист', 'Ячейка', 'Столбец', 'Строка', 'Было', 'Стало', 'Время', 'Автор'];
const day = Date.UTC(2026, 9, 22);
const record = ['ВСЕ', 'L178', 12, 177, 'ЕП', 'ЭА', '22.10.2026', 'op'];
beforeEach(() => db.delete(schema.changelogEntries).run());

describe('durable change-history identity and cutoff', () => {
  it('writes a date-only event once, preserving uncertainty across database reads', () => {
    const events = parseChangeLog([header, record], 'УО');
    expect(saveChangeLogEntries(events)).toBe(1);
    expect(saveChangeLogEntries(events)).toBe(0);
    const afterCutoff = readChangeLogEntriesSince(day + 18 * 3600000);
    expect(afterCutoff).toHaveLength(1);
    expect(afterCutoff[0]).toMatchObject({
      cell: 'L178', timePrecision: 'day', atMs: day,
    });
    expect(readChangeLogEntriesSince(day + 86400000)).toEqual([]);
  });

  it('does not collapse repeated identical date-only source entries', () => {
    const events = parseChangeLog([header, record, record], 'УО');
    expect(changeEntryKey(events[0])).not.toBe(changeEntryKey(events[1]));
    expect(saveChangeLogEntries(events)).toBe(2);
    expect(saveChangeLogEntries(events)).toBe(0);
    expect(readChangeLogEntriesSince(day)).toHaveLength(2);
  });

  it('keeps both opposite transitions of one cell at a single second', () => {
    const events = parseChangeLog([
      ['ВСЕ', 'L178', 12, 177, 'ЕП', 'ЭА', '22.10.2026 19:00:00', 'op'],
      ['ВСЕ', 'L178', 12, 177, 'ЭА', 'ЕП', '22.10.2026 19:00:00', 'op'],
    ], 'УО');
    expect(changeEntryKey(events[0])).not.toBe(changeEntryKey(events[1]));
    expect(saveChangeLogEntries(events)).toBe(2);
    expect(readChangeLogEntriesSince(day + 18 * 3600000)).toHaveLength(2);
  });

  it('reuses an already-persisted content-aware legacy ID without duplicating its history', () => {
    const [event] = parseChangeLog([record], 'УО');
    const modern = changeEntryKey({ ...event, timePrecision: undefined });
    db.insert(schema.changelogEntries).values({
      id: modern, dept: event.dept, sheet: event.sheet,
      cell: event.cell, atMs: event.atMs,
      oldValue: event.oldValue, newValue: event.newValue,
      author: event.author, recordedAt: new Date().toISOString(),
    }).run();
    expect(saveChangeLogEntries([event])).toBe(0);
    const historical = readChangeLogEntriesSince(day + 18 * 3600000);
    expect(historical).toHaveLength(1);
    expect(historical[0].timePrecision).toBe('unknown');
  });
});
