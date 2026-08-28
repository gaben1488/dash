/**
 * book-watermark.ts — водяной знак книги и честные пропуски журнала.
 *
 * Проект «служба, а не снимок» (docs/superpowers/specs/2026-08-22-seamless-
 * service.md):
 *
 *  • §2.4 — у каждой книги в БАЗЕ хранится момент последнего успешно
 *    разобранного состояния и отпечаток содержимого. База сравнения переживает
 *    перезапуск: первое чтение после подъёма сравнивается с тем, что было до
 *    падения, а не с пустотой. Рядом лежит отметка версии файла Drive — чтобы
 *    и ворота «а файл вообще менялся» переживали рестарт.
 *
 *  • §2.2, правило полноты — если отметка времени файла говорит «книга
 *    менялась», а все содержательные свидетели молчат (отпечаток тот же),
 *    в журнал пишется запись «изменение было, содержание не установлено».
 *    Это и есть гарантия: не «мы ничего не потеряли», а «мы знаем обо всём,
 *    что потеряли».
 *
 * База может быть недоступна — каждый вызов ловит свой отказ: водяной знак
 * улучшает сравнение, но его отсутствие не имеет права валить цикл чтения.
 */
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

/** Ключ водяного знака листа СВОД — он не книга ГРБС, но база сравнения нужна и ему. */
export const SVOD_WATERMARK_KEY = 'лист СВОД';

export interface Watermark {
  fingerprint: string;
  parsedAt: string;
  driveVersion: string | null;
  driveModifiedTime: string | null;
}

/** Все водяные знаки из базы — для посева памяти цикла после рестарта. */
export function loadWatermarks(): Map<string, Watermark> {
  const out = new Map<string, Watermark>();
  try {
    const rows = db
      .select()
      .from(schema.bookWatermarks)
      .all();
    for (const row of rows) {
      out.set(row.book, {
        fingerprint: row.fingerprint,
        parsedAt: row.parsedAt,
        driveVersion: row.driveVersion,
        driveModifiedTime: row.driveModifiedTime,
      });
    }
  } catch {
    /* базы нет — сравнение начнётся с пустоты, как раньше */
  }
  return out;
}

/** Записать водяной знак после успешного разбора книги (upsert по книге). */
export function saveWatermark(
  book: string,
  fingerprint: string,
  parsedAt: string,
  drive?: { version: string | null; modifiedTime: string | null },
): void {
  try {
    db.insert(schema.bookWatermarks)
      .values({
        book,
        fingerprint,
        parsedAt,
        driveVersion: drive?.version ?? null,
        driveModifiedTime: drive?.modifiedTime ?? null,
      })
      .onConflictDoUpdate({
        target: schema.bookWatermarks.book,
        set: {
          fingerprint,
          parsedAt,
          driveVersion: drive?.version ?? null,
          driveModifiedTime: drive?.modifiedTime ?? null,
        },
      })
      .run();
  } catch {
    /* без знака следующее сравнение просто беднее — не повод валить цикл */
  }
}

/**
 * Записать честный пропуск: изменение было, содержание не установлено.
 * Один и тот же пропуск (книга + отметка файла) не пишется дважды — повторная
 * перечитка того же немого изменения не делает пропуск вторым.
 */
export function noteHonestGap(
  book: string,
  fileModifiedTime: string | null,
  now: Date = new Date(),
): boolean {
  try {
    const inserted = db
      .insert(schema.journalGaps)
      .values({ book, fileModifiedTime, notedAt: now.toISOString() })
      .onConflictDoNothing()
      .run();
    return inserted.changes > 0;
  } catch {
    return false;
  }
}

export interface JournalGap {
  book: string;
  fileModifiedTime: string | null;
  notedAt: string;
}

/** Свежие честные пропуски — для журнала и стражей. */
export function recentGaps(limit = 50): JournalGap[] {
  try {
    return db
      .select({
        book: schema.journalGaps.book,
        fileModifiedTime: schema.journalGaps.fileModifiedTime,
        notedAt: schema.journalGaps.notedAt,
      })
      .from(schema.journalGaps)
      .orderBy(desc(schema.journalGaps.id))
      .limit(limit)
      .all();
  } catch {
    return [];
  }
}

/** Только для стражей: вычистить знаки и пропуски. */
export function resetWatermarks(): void {
  try {
    db.delete(schema.bookWatermarks).run();
    db.delete(schema.journalGaps).run();
  } catch {
    /* базы нет — чистить нечего */
  }
}

/** Водяной знак одной книги — для стражей и точечных вопросов. */
export function watermarkOf(book: string): Watermark | null {
  try {
    const row = db
      .select()
      .from(schema.bookWatermarks)
      .where(eq(schema.bookWatermarks.book, book))
      .all()[0];
    if (!row) return null;
    return {
      fingerprint: row.fingerprint,
      parsedAt: row.parsedAt,
      driveVersion: row.driveVersion,
      driveModifiedTime: row.driveModifiedTime,
    };
  } catch {
    return null;
  }
}
