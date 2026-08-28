/**
 * webhook-queue.ts — очередь уведомлений Drive, переживающая рестарт.
 *
 * Проект «служба, а не снимок» (docs/superpowers/specs/2026-08-22-seamless-
 * service.md, §2.3): вебхук не обрабатывает событие, а кладёт его в таблицу
 * очереди — книга, момент, номер сообщения — и отвечает Google мгновенно.
 * Обработчик берёт из очереди и помечает выполненным ТОЛЬКО после успешного
 * чтения. Прод был недоступен — уведомление не пришло вовсе (Google не
 * повторяет); но если пришло и упало на чтении, оно останется в очереди и
 * дочитается — повтором таймера или восстановлением после рестарта.
 *
 * Разделение обязанностей: здесь — только память очереди и правило «когда
 * запись считать выполненной»; сами таймеры и перечитка живут в
 * routes/webhook.ts, потому что цикл чтения — его зона.
 *
 * База может быть недоступна (стражи без базы, поломка файла) — каждый вызов
 * ловит свой отказ: очередь — страховка полноты, а не условие приёма
 * уведомления. Отказ очереди не имеет права стоить ответа Google.
 */
import { asc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { planForFile } from './refresh-targets.js';

/** Запись очереди, как её видит обработчик. */
export interface QueueEntry {
  id: number;
  book: string;
  fileId: string | null;
  receivedAt: string;
  attempts: number;
}

/** Что кладёт вебхук при уведомлении. */
export interface EnqueueInput {
  book: string;
  fileId: string | null;
  messageNumber: number | null;
  channelId: string;
  resourceState: string;
}

/**
 * Положить уведомление в очередь. Возвращает идентификатор записи;
 * `null` — база не далась (уведомление всё равно принято, страховкой
 * остаётся опрос по расписанию).
 */
export function enqueueNotification(input: EnqueueInput, now: Date = new Date()): number | null {
  try {
    const row = db
      .insert(schema.webhookQueue)
      .values({
        book: input.book,
        fileId: input.fileId,
        messageNumber: input.messageNumber,
        channelId: input.channelId,
        resourceState: input.resourceState,
        receivedAt: now.toISOString(),
      })
      .returning({ id: schema.webhookQueue.id })
      .all()[0];
    return row?.id ?? null;
  } catch {
    return null;
  }
}

/** Все невыполненные записи, старые первыми. Отказ базы — пустой список. */
export function pendingNotifications(): QueueEntry[] {
  try {
    return db
      .select({
        id: schema.webhookQueue.id,
        book: schema.webhookQueue.book,
        fileId: schema.webhookQueue.fileId,
        receivedAt: schema.webhookQueue.receivedAt,
        attempts: schema.webhookQueue.attempts,
      })
      .from(schema.webhookQueue)
      .where(eq(schema.webhookQueue.state, 'pending'))
      .orderBy(asc(schema.webhookQueue.id))
      .all();
  } catch {
    return [];
  }
}

/** Пометить записи выполненными — только после успешного чтения. */
export function markProcessed(ids: readonly number[], now: Date = new Date()): void {
  if (ids.length === 0) return;
  try {
    db.update(schema.webhookQueue)
      .set({ state: 'done', doneAt: now.toISOString() })
      .where(inArray(schema.webhookQueue.id, [...ids]))
      .run();
  } catch {
    // Чтение состоялось, а пометка не далась: запись останется невыполненной
    // и будет перечитана ещё раз — лишнее чтение дешевле потерянной правки.
  }
}

/**
 * Итог цикла чтения, которого достаточно очереди, чтобы решить судьбу записей.
 * Форма повторяет SourceRefreshResult, но очередь не тянет весь его тип:
 * решению нужны только «кто не прочитан» и «жив ли лист СВОД».
 */
export interface RefreshOutcomeView {
  failed: readonly string[];
  svodOk: boolean;
}

/**
 * Судьба записей после цикла чтения источников.
 *
 * Запись выполнена, когда её цель прочитана: книга ГРБС — не в списке упавших;
 * лист СВОД — прочитан; неопознанный файл (полная перечитка) — ни одна книга
 * не упала и лист СВОД жив. Записи книги мониторинга этим циклом НЕ решаются —
 * её читает отдельный путь (settleMonitoring). Невыполненные получают счёт
 * попытки и остаются ждать повтора.
 */
export function settleAfterRefresh(
  entries: readonly QueueEntry[],
  outcome: RefreshOutcomeView,
  now: Date = new Date(),
): { done: number[]; kept: number[] } {
  const done: number[] = [];
  const kept: number[] = [];
  const failed = new Set(outcome.failed);
  for (const entry of entries) {
    const plan = planForFile(entry.fileId);
    if (!plan.full && plan.monitoring) continue; // чужой путь — книга мониторинга
    let ok: boolean;
    if (plan.full) ok = failed.size === 0 && outcome.svodOk;
    else if (plan.books.length > 0) ok = plan.books.every((b) => !failed.has(b));
    else if (plan.svod) ok = outcome.svodOk;
    else ok = true; // цели нет — читать нечего, запись закрыта честно
    (ok ? done : kept).push(entry.id);
  }
  markProcessed(done, now);
  noteAttemptFailed(kept, `цикл чтения не покрыл цель: не прочитано ${[...failed].join(', ') || 'лист СВОД'}`);
  return { done, kept };
}

/** Судьба записей книги мониторинга после её собственной перечитки. */
export function settleMonitoring(
  entries: readonly QueueEntry[],
  ok: boolean,
  error?: string,
  now: Date = new Date(),
): { done: number[]; kept: number[] } {
  const targets = entries
    .filter((e) => {
      const plan = planForFile(e.fileId);
      return plan.monitoring && !plan.full;
    })
    .map((e) => e.id);
  if (ok) {
    markProcessed(targets, now);
    return { done: targets, kept: [] };
  }
  noteAttemptFailed(targets, error ?? 'книга мониторинга не прочитана');
  return { done: [], kept: targets };
}

/** Счётчик попытки и текст отказа — записи остаются невыполненными. */
export function noteAttemptFailed(ids: readonly number[], error: string): void {
  if (ids.length === 0) return;
  try {
    const rows = db
      .select({ id: schema.webhookQueue.id, attempts: schema.webhookQueue.attempts })
      .from(schema.webhookQueue)
      .where(inArray(schema.webhookQueue.id, [...ids]))
      .all();
    for (const row of rows) {
      db.update(schema.webhookQueue)
        .set({ attempts: row.attempts + 1, lastError: error })
        .where(eq(schema.webhookQueue.id, row.id))
        .run();
    }
  } catch {
    /* см. markProcessed */
  }
}

/** Снимок очереди для маршрута состояния — счётчики, без идентификаторов файлов. */
export interface QueueStats {
  pending: number;
  processed: number;
  /** Момент самой старой невыполненной записи; null — очередь чиста. */
  oldestPendingAt: string | null;
  /** Суммарный счёт упавших попыток по невыполненным записям. */
  failedAttempts: number;
}

export function queueStats(): QueueStats {
  try {
    const pending = db
      .select({
        receivedAt: schema.webhookQueue.receivedAt,
        attempts: schema.webhookQueue.attempts,
      })
      .from(schema.webhookQueue)
      .where(eq(schema.webhookQueue.state, 'pending'))
      .orderBy(asc(schema.webhookQueue.id))
      .all();
    const processed = db
      .select({ id: schema.webhookQueue.id })
      .from(schema.webhookQueue)
      .where(eq(schema.webhookQueue.state, 'done'))
      .all().length;
    return {
      pending: pending.length,
      processed,
      oldestPendingAt: pending[0]?.receivedAt ?? null,
      failedAttempts: pending.reduce((sum, p) => sum + p.attempts, 0),
    };
  } catch {
    return { pending: 0, processed: 0, oldestPendingAt: null, failedAttempts: 0 };
  }
}

/** Только для стражей: вычистить очередь. */
export function resetWebhookQueue(): void {
  try {
    db.delete(schema.webhookQueue).run();
  } catch {
    /* базы нет — чистить нечего */
  }
}
