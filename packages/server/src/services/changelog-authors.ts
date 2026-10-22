/**
 * Кто правил ячейку — по журналу правок книги («_ChangeLog»), уже осевшему в
 * нашей базе (таблица changelog_entries, наполняется чтением /api/changes).
 *
 * Смысл узкий и намеренно скромный: живому событию «строка изменилась» нужна
 * подпись автора. Журнал книги мы здесь НЕ читаем — это девять обращений к
 * Google на каждую правку. Читаем то, что уже прочитано; не нашли — автора нет,
 * и экран честно молчит про автора вместо того, чтобы кого-то назначить.
 */
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

/**
 * Every live department source has timeZone=Asia/Kamchatka (UTC+12).
 * _ChangeLog writes local wall-clock strings; changelog.ts deliberately keeps
 * their historical UTC-shaped representation to preserve existing DB IDs.
 * Convert only for temporal comparison, never rewrite persisted timestamps.
 *
 * A date-only record has NO reliable instant; it cannot identify the author
 * of a specific live event. Even exact-time records only support a narrow
 * correlation window, not proof of identity.
 */
const BOOK_UTC_OFFSET_MS = 12 * 60 * 60 * 1000;
const MAX_AUTHOR_MATCH_AGE_MS = 5 * 60 * 1000;

export function authorTimestampMatches(atMs: number, now: number): boolean {
  const age = now - (atMs - BOOK_UTC_OFFSET_MS);
  return age >= -60_000 && age <= MAX_AUTHOR_MATCH_AGE_MS;
}

export function findChangeAuthor(book: string, cell: string, now: number = Date.now()): string | undefined {
  try {
    const row = db
      .select({ id: schema.changelogEntries.id,
        author: schema.changelogEntries.author, atMs: schema.changelogEntries.atMs })
      .from(schema.changelogEntries)
      .where(and(eq(schema.changelogEntries.dept, book), eq(schema.changelogEntries.cell, cell)))
      .orderBy(desc(schema.changelogEntries.atMs))
      .limit(1)
      .all()[0];
    if (!row?.author) return undefined;
    // Date-only source rows have an artificial midnight anchor and must
    // never be attributed to a different live operation.
    if (row.id.startsWith('journal-day-v2:') || row.id.includes('|day-row-')) return undefined;
    if (!authorTimestampMatches(row.atMs, now)) return undefined;
    return row.author;
  } catch {
    // База недоступна — событие о правке важнее подписи под ним.
    return undefined;
  }
}
