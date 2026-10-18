/**
 * Страж очереди при недоступной базе: снимок очереди обязан честно отвечать
 * «база не далась» (unavailable: true), а не нулями. Нули на мёртвой базе —
 * ложь о здоровье: «очередь чиста, всё выполнено», когда неизвестно ничего.
 * Этот же признак уезжает наружу в /api/webhook/drive/state (поле queue).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

// База, у которой не дастся ни один вызов: любой доступ к db бросает.
vi.mock('../db/index.js', async () => {
  const schema = await import('../db/schema.js');
  const db = new Proxy(
    {},
    {
      get(): never {
        throw new Error('база недоступна');
      },
    },
  );
  return { db, schema };
});

let queue: typeof import('./webhook-queue.js');

beforeAll(async () => {
  process.env = { ...process.env, NODE_ENV: 'test', SQLITE_PATH: ':memory:' };
  queue = await import('./webhook-queue.js');
}, 60_000);

describe('очередь уведомлений без базы', () => {
  it('снимок очереди отвечает unavailable: true и неизвестными счётчиками', () => {
    const stats = queue.queueStats();
    expect(stats.unavailable).toBe(true);
    // Неизвестное значение не выдаётся за пустую очередь.
    expect(stats.pending).toBeNull();
    expect(stats.processed).toBeNull();
    expect(stats.oldestPendingAt).toBeNull();
  });

  it('отказ выборки явный; best-effort вклад и чистка сохраняют прежний контракт', () => {
    expect(
      queue.enqueueNotification({
        book: 'УО',
        fileId: 'файл',
        messageNumber: 1,
        channelId: 'канал',
        resourceState: 'update',
      }),
    ).toBeNull();
    expect(() => queue.pendingNotifications()).toThrow('WEBHOOK_QUEUE_UNAVAILABLE');
    expect(queue.pruneProcessedNotifications()).toBe(0);
  });
});
