/**
 * Страж очереди уведомлений (проект «служба, а не снимок», §2.3).
 *
 * Проверяется главное обещание очереди: запись помечается выполненной ТОЛЬКО
 * после успешного чтения её цели; упавшее чтение оставляет запись в очереди со
 * счётом попытки; записи книги мониторинга решаются своим путём, а не циклом
 * источников; снимок очереди отдаёт честные счётчики.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

let queue: typeof import('./webhook-queue.js');

beforeAll(async () => {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV, NODE_ENV: 'test', SQLITE_PATH: ':memory:' };
  queue = await import('./webhook-queue.js');
}, 60_000);

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

beforeEach(() => {
  queue.resetWebhookQueue();
});

/** Идентификаторы файлов из живой настройки — цель строится по ним. */
async function fileIds(): Promise<{ uo: string; uksimp: string; monitoring: string }> {
  const { DEPARTMENT_SPREADSHEETS } = await import('../config.js');
  const { MONITORING_SPREADSHEET_ID } = await import('./monitoring.js');
  return {
    uo: DEPARTMENT_SPREADSHEETS['УО'],
    uksimp: DEPARTMENT_SPREADSHEETS['УКСиМП'],
    monitoring: MONITORING_SPREADSHEET_ID,
  };
}

/** План цикла, читавшего названные книги (без листа СВОД и полной перечитки). */
function cycleOf(...books: string[]): { full: boolean; books: string[]; svod: boolean } {
  return { full: false, books, svod: false };
}

function enqueueUO(fileId: string): number {
  const id = queue.enqueueNotification({
    book: 'УО',
    fileId,
    messageNumber: 10,
    channelId: 'канал-1',
    resourceState: 'update',
  });
  expect(id).not.toBeNull();
  return id as number;
}

describe('очередь уведомлений', () => {
  it('вебхук кладёт запись — она видна невыполненной со всеми полями', async () => {
    const { uo } = await fileIds();
    enqueueUO(uo);

    const pending = queue.pendingNotifications();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ book: 'УО', fileId: uo, attempts: 0 });
  });

  it('успешное чтение цели помечает запись выполненной', async () => {
    const { uo } = await fileIds();
    enqueueUO(uo);

    const settled = queue.settleAfterRefresh(
      queue.pendingNotifications(),
      { failed: [], svodOk: true },
      cycleOf('УО'),
    );

    expect(settled.done).toHaveLength(1);
    expect(queue.pendingNotifications()).toHaveLength(0);
    expect(queue.queueStats().processed).toBe(1);
  });

  it('упавшее чтение НЕ помечает выполненным: запись остаётся со счётом попытки', async () => {
    const { uo } = await fileIds();
    enqueueUO(uo);

    const settled = queue.settleAfterRefresh(
      queue.pendingNotifications(),
      { failed: ['УО'], svodOk: true },
      cycleOf('УО'),
    );

    expect(settled.done).toHaveLength(0);
    const pending = queue.pendingNotifications();
    expect(pending).toHaveLength(1);
    expect(pending[0].attempts).toBe(1);

    // Второй провал — второй счёт попытки, запись всё ещё ждёт.
    queue.settleAfterRefresh(queue.pendingNotifications(), { failed: ['УО'], svodOk: true }, cycleOf('УО'));
    expect(queue.pendingNotifications()[0].attempts).toBe(2);

    // Наконец удачное чтение закрывает её.
    queue.settleAfterRefresh(queue.pendingNotifications(), { failed: [], svodOk: true }, cycleOf('УО'));
    expect(queue.pendingNotifications()).toHaveLength(0);
  });

  it('чужой отказ не закрывает и не наказывает запись другой книги', async () => {
    const { uo } = await fileIds();
    enqueueUO(uo);

    // Цикл читал обе книги; упала УКСиМП — запись про УО выполнена, попыток
    // по ней не считается.
    const settled = queue.settleAfterRefresh(
      queue.pendingNotifications(),
      { failed: ['УКСиМП'], svodOk: false },
      cycleOf('УО', 'УКСиМП'),
    );
    expect(settled.done).toHaveLength(1);
    expect(queue.pendingNotifications()).toHaveLength(0);
  });

  it('цикл, читавший только книгу А, не судит запись книги Б — она остаётся ждать', async () => {
    // КРАСНОЕ 29.08: раньше судьбу решал исход цикла, который книгу записи
    // мог вовсе не читать — «в упавших не значится» превращалось в done без
    // единого чтения цели. Теперь запись вне плана цикла не судится вообще.
    const { uksimp } = await fileIds();
    const id = queue.enqueueNotification({
      book: 'УКСиМП',
      fileId: uksimp,
      messageNumber: 3,
      channelId: 'канал-2',
      resourceState: 'update',
    });
    expect(id).not.toBeNull();

    // Цикл читал только УО, и читал успешно.
    const settled = queue.settleAfterRefresh(
      queue.pendingNotifications(),
      { failed: [], svodOk: true },
      cycleOf('УО'),
    );

    expect(settled.done).toHaveLength(0);
    expect(settled.skipped).toEqual([id]);
    const pending = queue.pendingNotifications();
    expect(pending).toHaveLength(1);
    // Счёт попыток нетронут: цикл её не читал — «попытки» не было.
    expect(pending[0].attempts).toBe(0);
  });

  it('запись неопознанного файла закрывается только полной перечиткой', async () => {
    const id = queue.enqueueNotification({
      book: 'книга вне списка наблюдения',
      fileId: 'файл-неизвестный',
      messageNumber: 4,
      channelId: 'канал-3',
      resourceState: 'update',
    });
    expect(id).not.toBeNull();

    // Адресный цикл по одной книге такую запись не покрывает.
    const partial = queue.settleAfterRefresh(
      queue.pendingNotifications(),
      { failed: [], svodOk: true },
      cycleOf('УО'),
    );
    expect(partial.skipped).toEqual([id]);
    expect(queue.pendingNotifications()[0].attempts).toBe(0);

    // Полная перечитка без упавших — закрывает.
    const full = queue.settleAfterRefresh(
      queue.pendingNotifications(),
      { failed: [], svodOk: true },
      { full: true, books: [], svod: true },
    );
    expect(full.done).toEqual([id]);
    expect(queue.pendingNotifications()).toHaveLength(0);
  });

  it('запись книги мониторинга решается своим путём, а не циклом источников', async () => {
    const { monitoring } = await fileIds();
    if (!monitoring) return; // книги мониторинга в настройке нет — цели нет
    queue.enqueueNotification({
      book: 'Ежедневный мониторинг',
      fileId: monitoring,
      messageNumber: 1,
      channelId: 'канал-м',
      resourceState: 'update',
    });

    // Цикл источников её не трогает — даже полный.
    queue.settleAfterRefresh(
      queue.pendingNotifications(),
      { failed: [], svodOk: true },
      { full: true, books: [], svod: true },
    );
    expect(queue.pendingNotifications()).toHaveLength(1);

    // Провал её собственной перечитки — счёт попытки, запись ждёт.
    queue.settleMonitoring(queue.pendingNotifications(), false, 'сеть');
    expect(queue.pendingNotifications()[0].attempts).toBe(1);

    // Успех — выполнена.
    queue.settleMonitoring(queue.pendingNotifications(), true);
    expect(queue.pendingNotifications()).toHaveLength(0);
  });

  it('снимок очереди: невыполненные, выполненные, момент самой старой, счёт попыток', async () => {
    const { uo } = await fileIds();
    const first = enqueueUO(uo);
    enqueueUO(uo);
    queue.noteAttemptFailed([first], 'таймаут');
    queue.markProcessed([first]);

    const stats = queue.queueStats();
    expect(stats.unavailable).toBe(false);
    expect(stats.processed).toBe(1);
    expect(stats.pending).toBe(1);
    expect(stats.oldestPendingAt).not.toBeNull();
  });

  it('чистка убирает выполненные старше срока хранения, не трогая свежие и невыполненные', async () => {
    const { uo } = await fileIds();
    const old = enqueueUO(uo);
    const fresh = enqueueUO(uo);
    enqueueUO(uo); // остаётся невыполненной

    const now = new Date('2026-08-29T00:00:00.000Z');
    // Выполнена 20 дней назад — старше срока хранения (14 дней).
    queue.markProcessed([old], new Date('2026-08-09T00:00:00.000Z'));
    // Выполнена вчера — хранится для диагностики.
    queue.markProcessed([fresh], new Date('2026-08-28T00:00:00.000Z'));

    expect(queue.pruneProcessedNotifications(now)).toBe(1);

    const stats = queue.queueStats();
    expect(stats.processed).toBe(1); // свежая выполненная жива
    expect(stats.pending).toBe(1); // невыполненную чистка не трогает никогда
  });
});
