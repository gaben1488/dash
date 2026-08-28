/**
 * drive-comments.ts — комментарии-облачка книг: «зачем» поменяли.
 *
 * Решение владельца (проект «служба, а не снимок» + разбор
 * docs/superpowers/audits/2026-08-22-google-api-provenance.md §4): комментарии
 * Диска — третий след правки. Журнал правок говорит «что», заметки ячеек —
 * «что было», комментарии — «зачем». Продукт этот слой не видел вообще.
 *
 * Как читается. Перечень комментариев файла Drive (comments.list) — 1–3 с на
 * книгу (замер 22.08: полный обход девяти книг 12 с, самая тяжёлая — УО,
 * 2,9 с). Привязка к ячейке публичными средствами не разворачивается
 * (внутренний номер области), родное чтение Таблиц отвергается сервером —
 * поэтому честно храним цитату содержимого ячейки, а не адрес.
 *
 * Когда читается (решение §17.2):
 *   • при уведомлении вебхука о книге — вместе с перечиткой самой книги;
 *   • ночью — полный обход всех книг (сеть безопасности для книг, которые
 *     днём не правили);
 *   • руками — POST /api/comments/refresh (routes/comments.ts).
 *
 * Удалённые комментарии Google отдаёт без автора и текста — остаются только
 * факт и момент. На экране это обязано читаться «здесь был комментарий,
 * удалён», без домысливания содержания.
 */
import { google } from 'googleapis';
import { desc, eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db, schema } from '../db/index.js';
import { watchedBooks } from './webhook-channel.js';

/** Комментарий, как его отдаёт перечень Диска (нужные нам поля). */
export interface DriveCommentItem {
  id: string;
  author: string | null;
  content: string | null;
  /** Цитата содержимого ячейки на момент написания. */
  quoted: string | null;
  createdTime: string | null;
  modifiedTime: string | null;
  resolved: boolean;
  deleted: boolean;
  replies: number;
}

/** Одна страница перечня. */
export interface CommentPage {
  items: DriveCommentItem[];
  nextPageToken: string | null;
}

/** Тонкая обёртка над Drive — подменяется в стражах, чтобы не ходить в сеть. */
export interface CommentApi {
  list(fileId: string, pageToken: string | null): Promise<CommentPage>;
}

let realApi: CommentApi | null = null;

function googleCommentApi(): CommentApi | null {
  if (realApi) return realApi;
  const { serviceAccountEmail, privateKey } = config.google;
  if (!serviceAccountEmail || !privateKey) return null;
  const drive = google.drive({
    version: 'v3',
    auth: new google.auth.GoogleAuth({
      credentials: { client_email: serviceAccountEmail, private_key: privateKey },
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    }),
  });
  realApi = {
    async list(fileId, pageToken) {
      // fields обязателен у comments.list (документация Drive v3, reference/
      // comments/list); includeDeleted — удалённые видны отдельным признаком.
      const res = await drive.comments.list({
        fileId,
        pageSize: 100,
        includeDeleted: true,
        pageToken: pageToken ?? undefined,
        fields:
          'nextPageToken,comments(id,author/displayName,content,quotedFileContent/value,createdTime,modifiedTime,resolved,deleted,replies/id)',
      });
      const items = (res.data.comments ?? []).map((c): DriveCommentItem => ({
        id: c.id ?? '',
        author: c.author?.displayName ?? null,
        content: c.content ?? null,
        quoted: c.quotedFileContent?.value ?? null,
        createdTime: c.createdTime ?? null,
        modifiedTime: c.modifiedTime ?? null,
        resolved: c.resolved ?? false,
        deleted: c.deleted ?? false,
        replies: c.replies?.length ?? 0,
      }));
      return { items, nextPageToken: res.data.nextPageToken ?? null };
    },
  };
  return realApi;
}

/** Итог чтения комментариев одной книги. */
export interface BookCommentsResult {
  book: string;
  read: boolean;
  /** Почему не читали, если не читали. */
  skippedBecause?: string;
  total: number;
  open: number;
  resolvedCount: number;
  deletedCount: number;
}

function toMs(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Прочитать комментарии одной книги и осадить их в базе (upsert по паре
 * книга + идентификатор: повторное чтение обновляет, а не плодит дубли).
 */
export async function refreshBookComments(
  book: string,
  fileId: string,
  api: CommentApi | null = googleCommentApi(),
  now: Date = new Date(),
): Promise<BookCommentsResult> {
  if (!api) {
    return {
      book,
      read: false,
      skippedBecause: 'нет служебной учётной записи — спросить Диск не у кого',
      total: 0,
      open: 0,
      resolvedCount: 0,
      deletedCount: 0,
    };
  }

  const items: DriveCommentItem[] = [];
  let pageToken: string | null = null;
  do {
    const page: CommentPage = await api.list(fileId, pageToken);
    items.push(...page.items);
    pageToken = page.nextPageToken;
  } while (pageToken);

  const recordedAt = now.toISOString();
  for (const item of items) {
    if (!item.id) continue;
    const values = {
      id: `${book}#${item.id}`,
      book,
      commentId: item.id,
      author: item.author,
      content: item.content,
      quoted: item.quoted,
      createdAtMs: toMs(item.createdTime),
      modifiedAtMs: toMs(item.modifiedTime),
      resolved: item.resolved ? 1 : 0,
      deleted: item.deleted ? 1 : 0,
      replies: item.replies,
      recordedAt,
    };
    db.insert(schema.driveComments)
      .values(values)
      .onConflictDoUpdate({ target: schema.driveComments.id, set: values })
      .run();
  }

  const deletedCount = items.filter((i) => i.deleted).length;
  const resolvedCount = items.filter((i) => i.resolved && !i.deleted).length;
  return {
    book,
    read: true,
    total: items.length,
    open: items.length - resolvedCount - deletedCount,
    resolvedCount,
    deletedCount,
  };
}

export interface CommentsLog {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}

/**
 * Прочитать комментарии названных книг (или всех наблюдаемых). Отказ одной
 * книги не валит остальные — итог честно перечисляет, кто не дался.
 */
export async function refreshCommentsForBooks(
  books: readonly string[] | 'all',
  log?: CommentsLog,
  api: CommentApi | null = googleCommentApi(),
): Promise<BookCommentsResult[]> {
  const watched = watchedBooks();
  const targets = books === 'all' ? watched : watched.filter((w) => books.includes(w.book));
  const results = await Promise.all(
    targets.map(async ({ book, fileId }) => {
      try {
        return await refreshBookComments(book, fileId, api);
      } catch (err) {
        log?.warn(`Комментарии книги «${book}» не прочитаны: ${(err as Error).message}`);
        return {
          book,
          read: false,
          skippedBecause: (err as Error).message,
          total: 0,
          open: 0,
          resolvedCount: 0,
          deletedCount: 0,
        } satisfies BookCommentsResult;
      }
    }),
  );
  const read = results.filter((r) => r.read);
  if (read.length > 0) {
    log?.info(
      `Комментарии книг: прочитано ${read.length} из ${results.length}, записей ${read.reduce((s, r) => s + r.total, 0)}`,
    );
  }
  return results;
}

/** Хранимый комментарий — для маршрута чтения. */
export interface StoredComment {
  book: string;
  commentId: string;
  author: string | null;
  content: string | null;
  quoted: string | null;
  createdAtMs: number | null;
  modifiedAtMs: number | null;
  resolved: boolean;
  deleted: boolean;
  replies: number;
  recordedAt: string;
}

/** Комментарии из базы: свежие сверху, при желании — по одной книге. */
export function listStoredComments(book?: string, limit = 200): StoredComment[] {
  try {
    const rows = book
      ? db
          .select()
          .from(schema.driveComments)
          .where(eq(schema.driveComments.book, book))
          .orderBy(desc(schema.driveComments.createdAtMs))
          .limit(limit)
          .all()
      : db
          .select()
          .from(schema.driveComments)
          .orderBy(desc(schema.driveComments.createdAtMs))
          .limit(limit)
          .all();
    return rows.map((row) => ({
      book: row.book,
      commentId: row.commentId,
      author: row.author,
      content: row.content,
      quoted: row.quoted,
      createdAtMs: row.createdAtMs,
      modifiedAtMs: row.modifiedAtMs,
      resolved: row.resolved === 1,
      deleted: row.deleted === 1,
      replies: row.replies,
      recordedAt: row.recordedAt,
    }));
  } catch {
    return [];
  }
}

/** Только для стражей: вычистить осевшие комментарии. */
export function resetStoredComments(): void {
  try {
    db.delete(schema.driveComments).run();
  } catch {
    /* базы нет — чистить нечего */
  }
}

// ---------------------------------------------------------------------------
// Ночной полный обход
// ---------------------------------------------------------------------------

/** Час продукта (Камчатка), в который идёт полный обход. */
export const NIGHT_SWEEP_HOUR = 3;
const SWEEP_TICK_MS = 60 * 60 * 1000;

let sweepTimer: ReturnType<typeof setInterval> | null = null;
let lastSweepDay: string | null = null;

/** День продукта по фиксированному смещению (как у четверг-cron). */
function productDayAndHour(now: Date, utcOffsetHours: number): { day: string; hour: number } {
  const shifted = new Date(now.getTime() + utcOffsetHours * 3_600_000);
  return { day: shifted.toISOString().slice(0, 10), hour: shifted.getUTCHours() };
}

/**
 * Решение одного тика: пора ли идти в полный обход. Чистая функция — страж
 * проверяет расписание без таймеров и сети.
 */
export function sweepDueNow(
  now: Date,
  utcOffsetHours: number,
  lastDay: string | null,
): { due: boolean; day: string } {
  const { day, hour } = productDayAndHour(now, utcOffsetHours);
  return { due: hour === NIGHT_SWEEP_HOUR && lastDay !== day, day };
}

/**
 * Включить ночной полный обход: раз в час проверяется «а не три ли часа ночи
 * по продуктовому поясу», обход идёт один раз в сутки. Днём книги, о которых
 * говорил вебхук, уже перечитаны адресно; ночной обход добирает молчавшие.
 */
export function startNightlyCommentsSweep(log: CommentsLog): () => void {
  if (sweepTimer) return stopNightlyCommentsSweep;
  sweepTimer = setInterval(() => {
    const check = sweepDueNow(new Date(), config.weeklySnapshot.utcOffsetHours, lastSweepDay);
    if (!check.due) return;
    lastSweepDay = check.day;
    void refreshCommentsForBooks('all', log).catch((err: unknown) => {
      log.warn(`Ночной обход комментариев не удался: ${(err as Error).message}`);
    });
  }, SWEEP_TICK_MS);
  sweepTimer.unref?.();
  log.info(`Ночной обход комментариев включён: ${NIGHT_SWEEP_HOUR}:00 по продуктовому поясу`);
  return stopNightlyCommentsSweep;
}

export function stopNightlyCommentsSweep(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
  lastSweepDay = null;
}
