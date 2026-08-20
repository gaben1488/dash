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
 * Насколько старую запись журнала считать объяснением свежей правки. Сутки:
 * журнал за прошлый месяц про сегодняшнюю правку ничего не знает, и подписывать
 * ею живое событие значило бы выдать старого автора за нынешнего.
 */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function findChangeAuthor(book: string, cell: string, now: number = Date.now()): string | undefined {
  try {
    const row = db
      .select({ author: schema.changelogEntries.author, atMs: schema.changelogEntries.atMs })
      .from(schema.changelogEntries)
      .where(and(eq(schema.changelogEntries.dept, book), eq(schema.changelogEntries.cell, cell)))
      .orderBy(desc(schema.changelogEntries.atMs))
      .limit(1)
      .all()[0];
    if (!row?.author) return undefined;
    if (now - row.atMs > MAX_AGE_MS) return undefined;
    return row.author;
  } catch {
    // База недоступна — событие о правке важнее подписи под ним.
    return undefined;
  }
}
