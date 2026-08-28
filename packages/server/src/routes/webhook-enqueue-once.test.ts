/**
 * Страж одиночного вклада в очередь (находка 29.08): исключение в обработчике
 * уведомления НЕ имеет права класть ВТОРУЮ запись того же сообщения.
 *
 * Дорога дефекта: запись легла в очередь, затем учёт упал (например, на
 * журнале) — catch страховал правку повторным вкладом, и одно уведомление
 * читалось и считалось дважды. Теперь catch кладёт запись только если она
 * ещё НЕ легла; а если учёт упал ДО очереди — кладёт ровно одну.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';

const state = vi.hoisted(() => ({ noteThrows: false }));

vi.mock('../services/source-refresh.js', () => ({
  refreshAllSources: vi.fn(async () => ({
    loaded: [],
    failed: [],
    svodOk: true,
    at: 'x',
    changedBooks: [],
    svodChanged: false,
    booksRead: 0,
    skipped: [],
  })),
}));

vi.mock('../config.js', () => ({
  config: {
    webhook: { publicUrl: 'https://prod', secret: 'верный-секрет' },
    google: { spreadsheetId: 'file-svod', serviceAccountEmail: 'a@b', privateKey: 'k' },
    database: { url: ':memory:' },
  },
  DEPARTMENT_SPREADSHEETS: { 'УО': 'file-uo' },
  SHDYU_SPREADSHEET_ID: 'file-svod',
  webhookTuning: { debounceMs: 15_000, channelTtlMs: 86_400_000 },
}));

vi.mock('../services/monitoring.js', () => ({
  refreshMonitoringBook: vi.fn(async () => ({ read: true, changed: [], version: 1 })),
  MONITORING_SPREADSHEET_ID: 'file-monitoring',
}));

vi.mock('googleapis', () => ({
  google: { drive: () => ({}), auth: { GoogleAuth: vi.fn() } },
}));

vi.mock('../services/drive-comments.js', () => ({
  refreshCommentsForBooks: vi.fn(async () => []),
}));

// Очередь заглушена: предмет проверки — СКОЛЬКО раз маршрут кладёт запись.
const enqueueNotification = vi.fn(() => 1);
vi.mock('../services/webhook-queue.js', () => ({
  cycleCoversFile: vi.fn(() => true),
  enqueueNotification: (...a: unknown[]) => enqueueNotification(...(a as [])),
  noteAttemptFailed: vi.fn(),
  pendingNotifications: vi.fn(() => []),
  queueStats: vi.fn(() => ({ unavailable: false, pending: 0, processed: 0, oldestPendingAt: null, failedAttempts: 0 })),
  settleAfterRefresh: vi.fn(() => ({ done: [], kept: [], skipped: [] })),
  settleMonitoring: vi.fn(() => ({ done: [], kept: [] })),
}));

// Учёт канала настоящий, но noteNotification можно уронить ДО очереди.
vi.mock('../services/webhook-channel.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/webhook-channel.js')>();
  return {
    ...actual,
    noteNotification: (...a: Parameters<typeof actual.noteNotification>) => {
      if (state.noteThrows) throw new Error('учёт упал до очереди');
      return actual.noteNotification(...a);
    },
  };
});

/**
 * Журнал, падающий ровно на структурном следе уведомления — то есть ПОСЛЕ
 * того, как запись уже легла в очередь. Остальные записи журнала молчат.
 */
function loggerFailingOnNotificationTrace(): Record<string, unknown> {
  const log: Record<string, unknown> = {
    level: 'info',
    fatal: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
    trace: () => {},
    silent: () => {},
    info: (obj: unknown) => {
      if (typeof obj === 'object' && obj !== null && (obj as { event?: string }).event === 'drive-notification') {
        throw new Error('журнал упал после очереди');
      }
    },
  };
  log.child = () => log;
  return log;
}

async function buildApp(withThrowingLogger: boolean): Promise<FastifyInstance> {
  const { webhookRoutes } = await import('./webhook.js');
  const app = withThrowingLogger
    ? Fastify({ loggerInstance: loggerFailingOnNotificationTrace() as unknown as FastifyBaseLogger })
    : Fastify({ logger: false });
  await app.register(webhookRoutes);
  await app.ready();
  return app;
}

function notification(): Record<string, string> {
  return {
    'x-goog-channel-token': 'верный-секрет',
    'x-goog-channel-id': 'канал-1',
    'x-goog-resource-id': 'ресурс-1',
    'x-goog-resource-state': 'update',
    'x-goog-resource-uri': 'https://www.googleapis.com/drive/v3/files/file-uo?alt=json',
    'x-goog-message-number': '10',
    'x-goog-changed': 'content',
  };
}

afterEach(async () => {
  const { cancelPendingWebhookRefresh } = await import('./webhook.js');
  const { resetWebhookChannelState } = await import('../services/webhook-channel.js');
  cancelPendingWebhookRefresh();
  resetWebhookChannelState();
  enqueueNotification.mockClear();
  state.noteThrows = false;
  vi.useRealTimers();
});

describe('исключение в обработчике уведомления и очередь', () => {
  it('исключение ПОСЛЕ вклада не кладёт вторую запись того же сообщения', async () => {
    // Часы настоящие: подменённые таймеры останавливают подъём Fastify.
    // Взведённую перечитку снимает afterEach (cancelPendingWebhookRefresh).
    const app = await buildApp(true);
    const res = await app.inject({ method: 'POST', url: '/api/webhook/drive', headers: notification() });

    expect(res.statusCode).toBe(200);
    // Одна правка — одна запись: страховка catch увидела, что вклад уже был.
    expect(enqueueNotification).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('исключение ДО вклада — catch кладёт ровно одну запись', async () => {
    state.noteThrows = true;
    const app = await buildApp(false);
    const res = await app.inject({ method: 'POST', url: '/api/webhook/drive', headers: notification() });

    expect(res.statusCode).toBe(200);
    expect(enqueueNotification).toHaveBeenCalledTimes(1);
    await app.close();
  });
});
