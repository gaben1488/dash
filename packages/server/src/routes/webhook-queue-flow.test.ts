/**
 * Сквозной страж очереди уведомлений (проект «служба, а не снимок», §2.3):
 * маршрут вебхука + настоящая очередь в базе (:memory:).
 *
 * Дорога целиком: уведомление кладёт запись и получает 200 мгновенно;
 * успешное чтение помечает запись выполненной; упавшее чтение оставляет её в
 * очереди, и повтор дочитывает; недочитанное прежней жизнью процесса
 * поднимается при старте (recoverWebhookQueue).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const ORIGINAL_ENV = { ...process.env };

const refreshAllSources = vi.fn(async () => ({
  loaded: ['УО'],
  failed: [] as string[],
  svodOk: true,
  at: 'x',
  changedBooks: ['УО'],
  svodChanged: false,
  booksRead: 1,
  skipped: [] as string[],
}));

vi.mock('../services/source-refresh.js', () => ({
  refreshAllSources: (...args: unknown[]) => refreshAllSources(...(args as [])),
}));

vi.mock('../config.js', () => ({
  config: {
    webhook: { publicUrl: 'https://prod', secret: 'верный-секрет' },
    google: { spreadsheetId: 'file-svod', serviceAccountEmail: 'a@b', privateKey: 'k' },
    database: { url: ':memory:' },
  },
  DEPARTMENT_SPREADSHEETS: { 'УО': 'file-uo', 'УКСиМП': 'file-uksimp' },
  SHDYU_SPREADSHEET_ID: 'file-svod',
  webhookTuning: { debounceMs: 15_000, channelTtlMs: 86_400_000 },
}));

const refreshMonitoringBook = vi.fn(async () => ({ read: true, changed: [], version: 1 }));
vi.mock('../services/monitoring.js', () => ({
  refreshMonitoringBook: () => refreshMonitoringBook(),
  MONITORING_SPREADSHEET_ID: 'file-monitoring',
}));

vi.mock('googleapis', () => ({
  google: { drive: () => ({}), auth: { GoogleAuth: vi.fn() } },
}));

// Комментарии здесь не предмет проверки — заглушены, чтобы таймер не тянул сеть.
vi.mock('../services/drive-comments.js', () => ({
  refreshCommentsForBooks: vi.fn(async () => []),
}));

let app: FastifyInstance;
let queue: typeof import('../services/webhook-queue.js');

beforeAll(async () => {
  const { webhookRoutes } = await import('./webhook.js');
  queue = await import('../services/webhook-queue.js');
  app = Fastify({ logger: false });
  await app.register(webhookRoutes);
  await app.ready();
}, 60_000);

afterAll(async () => {
  await app.close();
  process.env = { ...ORIGINAL_ENV };
});

afterEach(async () => {
  const { cancelPendingWebhookRefresh } = await import('./webhook.js');
  const { resetWebhookChannelState } = await import('../services/webhook-channel.js');
  cancelPendingWebhookRefresh();
  resetWebhookChannelState();
  queue.resetWebhookQueue();
  refreshAllSources.mockClear();
  refreshAllSources.mockResolvedValue({
    loaded: ['УО'],
    failed: [],
    svodOk: true,
    at: 'x',
    changedBooks: ['УО'],
    svodChanged: false,
    booksRead: 1,
    skipped: [],
  });
  vi.useRealTimers();
});

let messageNumber = 100;
function notification(over: Record<string, string> = {}): Record<string, string> {
  messageNumber += 1;
  return {
    'x-goog-channel-token': 'верный-секрет',
    'x-goog-channel-id': 'канал-1',
    'x-goog-resource-id': 'ресурс-1',
    'x-goog-resource-state': 'update',
    'x-goog-resource-uri': 'https://www.googleapis.com/drive/v3/files/file-uo?alt=json',
    'x-goog-message-number': String(messageNumber),
    'x-goog-changed': 'content',
    ...over,
  };
}

function post(headers: Record<string, string>) {
  return app.inject({ method: 'POST', url: '/api/webhook/drive', headers });
}

describe('очередь уведомлений — сквозная дорога', () => {
  it('уведомление отвечает 200 мгновенно, запись лежит в очереди невыполненной', async () => {
    vi.useFakeTimers();
    const res = await post(notification());

    expect(res.statusCode).toBe(200);
    // Чтение ещё не шло — а запись уже есть: она и переживёт падение.
    expect(refreshAllSources).not.toHaveBeenCalled();
    const pending = queue.pendingNotifications();
    expect(pending).toHaveLength(1);
    expect(pending[0].book).toBe('УО');
  });

  it('успешное чтение помечает запись выполненной', async () => {
    vi.useFakeTimers();
    await post(notification());
    await vi.advanceTimersByTimeAsync(15_000);

    expect(refreshAllSources).toHaveBeenCalledTimes(1);
    expect(queue.pendingNotifications()).toHaveLength(0);
    expect(queue.queueStats().processed).toBe(1);
  });

  it('упавшее чтение остаётся в очереди и дочитывается повтором', async () => {
    vi.useFakeTimers();
    refreshAllSources.mockResolvedValueOnce({
      loaded: [],
      failed: ['УО'],
      svodOk: true,
      at: 'x',
      changedBooks: [],
      svodChanged: false,
      booksRead: 1,
      skipped: [],
    });

    await post(notification());
    await vi.advanceTimersByTimeAsync(15_000);

    // Чтение упало — запись НЕ выполнена, счёт попытки идёт.
    const pending = queue.pendingNotifications();
    expect(pending).toHaveLength(1);
    expect(pending[0].attempts).toBe(1);

    // Повтор (60 с) взводит перечитку заново, склейка (15 с) её запускает —
    // на этот раз чтение удаётся, и запись закрыта.
    await vi.advanceTimersByTimeAsync(60_000 + 15_000);
    expect(refreshAllSources).toHaveBeenCalledTimes(2);
    expect(queue.pendingNotifications()).toHaveLength(0);
  });

  it('серия уведомлений двух книг — одна перечитка, обе записи закрыты ею', async () => {
    vi.useFakeTimers();
    await post(notification());
    await post(notification({
      'x-goog-channel-id': 'канал-2',
      'x-goog-resource-uri': 'https://www.googleapis.com/drive/v3/files/file-uksimp?alt=json',
    }));
    expect(queue.pendingNotifications()).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(refreshAllSources).toHaveBeenCalledTimes(1);
    expect(queue.pendingNotifications()).toHaveLength(0);
  });

  it('в очереди книга Б, цикл читал только книгу А — запись Б осталась невыполненной', async () => {
    // КРАСНОЕ 29.08: раньше цикл забирал ВСЕ невыполненные записи и судил их
    // своим исходом, даже когда их книгу не читал: «в упавших не значится» —
    // и запись УКСиМП закрывалась чтением одной УО. Теперь судьбу записи
    // решает только цикл, чей план покрывает её цель.
    vi.useFakeTimers();
    // Запись книги УКСиМП лежит в очереди (осталась от прежней жизни — своих
    // таймеров у неё нет).
    queue.enqueueNotification({
      book: 'УКСиМП',
      fileId: 'file-uksimp',
      messageNumber: 8,
      channelId: 'канал-старый',
      resourceState: 'update',
    });

    // Приходит уведомление о книге УО — цикл читает только её.
    await post(notification());
    await vi.advanceTimersByTimeAsync(15_000);

    expect(refreshAllSources).toHaveBeenCalledTimes(1);
    const call = refreshAllSources.mock.calls[0] as unknown[];
    expect((call[2] as { books?: string[] }).books).toEqual(['УО']);

    // Запись УКСиМП жива, счёт попыток нетронут: цикл её не читал.
    const pending = queue.pendingNotifications();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ book: 'УКСиМП', attempts: 0 });

    // Повтор (60 с) строит цель из самой записи, склейка (15 с) читает УКСиМП —
    // и только это чтение её закрывает.
    await vi.advanceTimersByTimeAsync(60_000 + 15_000);
    expect(refreshAllSources).toHaveBeenCalledTimes(2);
    expect(queue.pendingNotifications()).toHaveLength(0);
  });

  it('недочитанное прежней жизнью процесса поднимается при старте', async () => {
    vi.useFakeTimers();
    // Запись «из прошлой жизни»: в очереди есть, таймеров нет.
    queue.enqueueNotification({
      book: 'УО',
      fileId: 'file-uo',
      messageNumber: 7,
      channelId: 'канал-старый',
      resourceState: 'update',
    });

    const { recoverWebhookQueue } = await import('./webhook.js');
    const picked = recoverWebhookQueue({ info: () => {}, warn: () => {} });
    expect(picked).toBe(1);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(refreshAllSources).toHaveBeenCalledTimes(1);
    expect(queue.pendingNotifications()).toHaveLength(0);
  });

  it('состояние наблюдения показывает очередь: невыполненные и выполненные', async () => {
    vi.useFakeTimers();
    await post(notification());
    let state = (await app.inject({ method: 'GET', url: '/api/webhook/drive/state' })).json();
    expect(state.queue.pending).toBe(1);

    await vi.advanceTimersByTimeAsync(15_000);
    state = (await app.inject({ method: 'GET', url: '/api/webhook/drive/state' })).json();
    expect(state.queue.pending).toBe(0);
    expect(state.queue.processed).toBe(1);
  });
});
