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
 * При отказе чтения или фиксации завершения обработчик получает явную ошибку.
 * Отказ приёма возвращает null; HTTP-обработчик обязан отклонить подтверждение.
 */
import { and, asc, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { isTransientSourceFailure } from './source-failure.js';
import { planForFile } from './refresh-targets.js';

/** Запись очереди, как её видит обработчик. */
export interface QueueEntry {
  id: number;
  book: string;
  fileId: string | null;
  receivedAt: string;
  attempts: number;
  lastError?: string | null;
}

export const MAX_QUEUE_ATTEMPTS = 3;
const TRANSIENT_REFRESH = 'SOURCE_REFRESH_TRANSIENT';
export function canRetryNotification(entry: Pick<QueueEntry, 'attempts' | 'lastError'>): boolean {
  return entry.attempts < MAX_QUEUE_ATTEMPTS && (entry.attempts === 0 ||
    entry.lastError === 'WEBHOOK_QUEUE_WRITE_FAILED' ||
    entry.lastError === 'SOURCE_STATE_READ_FAILED' ||
    entry.lastError === 'SOURCE_STATE_PERSIST_FAILED' ||
    entry.lastError === TRANSIENT_REFRESH || isTransientSourceFailure(entry.lastError));
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
 * `null` — запись не сохранена; подтверждать приём уведомления нельзя.
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

/** All pending evidence, including exhausted entries. A failed read is never an empty queue. */
export function pendingNotifications(): QueueEntry[] {
  try {
    return db
      .select({
        id: schema.webhookQueue.id,
        book: schema.webhookQueue.book,
        fileId: schema.webhookQueue.fileId,
        receivedAt: schema.webhookQueue.receivedAt,
        attempts: schema.webhookQueue.attempts,
        lastError: schema.webhookQueue.lastError,
      })
      .from(schema.webhookQueue)
      .where(eq(schema.webhookQueue.state, 'pending'))
      .orderBy(asc(schema.webhookQueue.id))
      .all();
  } catch (cause) {
    throw new Error('WEBHOOK_QUEUE_UNAVAILABLE', { cause });
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
  } catch (cause) {
    // Запись остаётся pending; вызывающий должен сообщить отказ и назначить повтор.
    throw new Error('WEBHOOK_QUEUE_WRITE_FAILED', { cause });
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
  retryableFailures?: readonly string[];
  svodRetryable?: boolean;
}

/**
 * Что именно читал ЭТОТ цикл — перечень его целей. Форма повторяет RefreshPlan,
 * но очередь берёт только нужное решению: какие книги были в плане, читался ли
 * лист СВОД, шла ли полная перечитка.
 */
export interface CycleTargetsView {
  full: boolean;
  books: readonly string[];
  svod: boolean;
}

/**
 * Покрывает ли план цикла цель записи. Исход цикла, который книгу записи не
 * читал, не имеет права её судить: «в упавших не значится» — потому что цикл
 * о ней вовсе не знал, а не потому что чтение состоялось.
 */
export function cycleCoversFile(fileId: string | null, cycle: CycleTargetsView): boolean {
  if (cycle.full) return true;
  const plan = planForFile(fileId);
  if (plan.full) return false; // неопознанный файл требует полной перечитки
  if (plan.books.length > 0) return plan.books.every((b) => cycle.books.includes(b));
  if (plan.svod) return cycle.svod;
  return true; // цели нет — читать нечего
}

/**
 * Судьба записей после цикла чтения источников.
 *
 * Судятся ТОЛЬКО записи, чью цель покрывал план ЭТОГО цикла: запись книги,
 * которую цикл не читал, остаётся невыполненной с нетронутым счётом попыток —
 * её дочитает свой цикл или повтор. Из покрытых запись выполнена, когда цель
 * прочитана: книга ГРБС — не в списке упавших; лист СВОД — прочитан;
 * неопознанный файл (полная перечитка) — ни одна книга не упала и лист СВОД
 * жив. Записи книги мониторинга этим циклом НЕ решаются — её читает отдельный
 * путь (settleMonitoring). Невыполненные получают счёт попытки и ждут повтора.
 */
export function settleAfterRefresh(
  entries: readonly QueueEntry[],
  outcome: RefreshOutcomeView,
  cycle: CycleTargetsView,
  now: Date = new Date(),
): { done: number[]; kept: number[]; skipped: number[] } {
  const done: number[] = [];
  const kept: number[] = [];
  const transient: number[] = [];
  const skipped: number[] = [];
  const failed = new Set(outcome.failed);
  for (const entry of entries) {
    const plan = planForFile(entry.fileId);
    if (!plan.full && plan.monitoring) continue; // чужой путь — книга мониторинга
    if (!cycleCoversFile(entry.fileId, cycle)) {
      skipped.push(entry.id); // цикл эту цель не читал — судить нечем
      continue;
    }
    let ok: boolean;
    if (plan.full) ok = failed.size === 0 && outcome.svodOk;
    else if (plan.books.length > 0) ok = plan.books.every((b) => !failed.has(b));
    else if (plan.svod) ok = outcome.svodOk;
    else ok = true; // цели нет — читать нечего, запись закрыта честно
    (ok ? done : kept).push(entry.id);
    if (!ok) {
      const failedTargets = plan.full ? outcome.failed : plan.books.filter(book => failed.has(book));
      const svodFailed = (plan.full || plan.svod) && !outcome.svodOk;
      if (failedTargets.every(book => outcome.retryableFailures?.includes(book)) && (!svodFailed || outcome.svodRetryable)) transient.push(entry.id);
    }
  }
  markProcessed(done, now);
  noteAttemptFailed(transient, TRANSIENT_REFRESH);
  noteAttemptFailed(kept.filter(id => !transient.includes(id)), 'SOURCE_REFRESH_REQUIRES_ATTENTION');
  return { done, kept, skipped };
}

/** Судьба записей книги мониторинга после её собственной перечитки. */
export function settleMonitoring(
  entries: readonly QueueEntry[],
  ok: boolean,
  error?: string,
  now: Date = new Date(),
  retryable = false,
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
  noteAttemptFailed(targets, retryable ? TRANSIENT_REFRESH : error ?? 'MONITORING_REQUIRES_ATTENTION');
  return { done: [], kept: targets };
}

/** Счётчик попытки и текст отказа — записи остаются невыполненными. */
export function noteAttemptFailed(ids: readonly number[], error: string): void {
  if (ids.length === 0) return;
  try {
    db.update(schema.webhookQueue)
      .set({ attempts: sql`${schema.webhookQueue.attempts} + 1`, lastError: error })
      .where(and(inArray(schema.webhookQueue.id, [...ids]), eq(schema.webhookQueue.state, 'pending')))
      .run();
  } catch (cause) {
    throw new Error('WEBHOOK_QUEUE_WRITE_FAILED', { cause });
  }
}

/** Снимок очереди для маршрута состояния — счётчики, без идентификаторов файлов. */
export interface QueueStats {
  /** База не далась — счётчики ниже ничего не значат, а не «нулевые». */
  unavailable: boolean;
  pending: number | null;
  processed: number | null;
  requiresAttention: number | null;
  /** Момент самой старой невыполненной записи; null — очередь чиста. */
  oldestPendingAt: string | null;
  /** Суммарный счёт упавших попыток по невыполненным записям. */
  failedAttempts: number | null;
}

export function queueStats(): QueueStats {
  try {
    const pending = db
      .select({
        receivedAt: schema.webhookQueue.receivedAt,
        attempts: schema.webhookQueue.attempts,
        lastError: schema.webhookQueue.lastError,
      })
      .from(schema.webhookQueue)
      .where(eq(schema.webhookQueue.state, 'pending'))
      .orderBy(asc(schema.webhookQueue.id))
      .all();
    // Выполненных записей за месяцы копится много — их СЧИТАЕТ база, а не
    // выборка всех строк в память ради .length.
    const processed = db
      .select({ n: sql<number>`count(*)` })
      .from(schema.webhookQueue)
      .where(eq(schema.webhookQueue.state, 'done'))
      .all()[0]?.n ?? 0;
    return {
      unavailable: false,
      pending: pending.length,
      requiresAttention: pending.filter(entry => !canRetryNotification(entry)).length,
      processed,
      oldestPendingAt: pending[0]?.receivedAt ?? null,
      failedAttempts: pending.reduce((sum, p) => sum + p.attempts, 0),
    };
  } catch {
    // Недоступная база — не «пустая очередь»: нули были бы ложью о здоровье.
    return { unavailable: true, pending: null, processed: null, requiresAttention: null, oldestPendingAt: null, failedAttempts: null };
  }
}

/** Сколько дней выполненные записи хранятся для диагностики, прежде чем уйти. */
export const DONE_RETENTION_DAYS = 14;

/**
 * Чистка выполненных записей старше срока хранения. Невыполненные не трогаются
 * никогда — их судьба решается только чтением. Вызывается ночным обходом
 * (drive-comments.ts): очередь без чистки росла бы на каждой правке вечно.
 */
export function pruneProcessedNotifications(now: Date = new Date()): number {
  try {
    const cutoff = new Date(now.getTime() - DONE_RETENTION_DAYS * 86_400_000).toISOString();
    const result = db
      .delete(schema.webhookQueue)
      .where(
        and(
          eq(schema.webhookQueue.state, 'done'),
          isNotNull(schema.webhookQueue.doneAt),
          lt(schema.webhookQueue.doneAt, cutoff),
        ),
      )
      .run();
    return result.changes;
  } catch {
    return 0; // базы нет — чистить нечего
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
