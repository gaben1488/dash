/**
 * Страж: ФОРМУЛЫ ЧИТАЮТСЯ ПО УВЕДОМЛЕНИЮ ВЕБХУКА (решение владельца §22 п.7).
 *
 * Уведомление Drive означает, что книгу трогали рукой, — а формулу перебивают
 * именно рукой. Плановый цикл опроса за формулы не платит: его страж живёт в
 * services/source-refresh-formulas.test.ts, здесь охраняется вторая половина
 * правила — что по уведомлению просьба о формулах ДОХОДИТ до цикла.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const refreshAllSources = vi.fn(async () => ({
  loaded: ['УО'],
  failed: [],
  svodOk: true,
  at: 'x',
  changedBooks: ['УО'],
  svodChanged: false,
  booksRead: 1,
  skipped: [],
  formulaBooks: ['УО'],
}));

vi.mock('../services/source-refresh.js', () => ({
  refreshAllSources: (...args: unknown[]) => refreshAllSources(...(args as [])),
}));

vi.mock('../config.js', () => ({
  config: {
    webhook: { secret: 'секрет-канала' },
    google: { spreadsheetId: 'file-svod', serviceAccountEmail: 'a@b', privateKey: 'k' },
  },
  DEPARTMENT_SPREADSHEETS: { 'УО': 'file-uo' },
  SHDYU_SPREADSHEET_ID: 'file-svod',
  // Окно склейки в ноль: страж не имеет права ждать пятнадцать секунд.
  webhookTuning: { debounceMs: 0, channelTtlMs: 86_400_000 },
}));

vi.mock('../services/monitoring.js', () => ({
  refreshMonitoringBook: vi.fn(async () => ({ read: false, changed: [], version: 1 })),
  MONITORING_SPREADSHEET_ID: 'file-monitoring',
}));

vi.mock('googleapis', () => ({
  google: { drive: () => ({}), auth: { GoogleAuth: vi.fn() } },
}));

vi.mock('../services/webhook-queue.js', () => ({
  cycleCoversFile: vi.fn(() => true),
  enqueueNotification: vi.fn(() => 1),
  noteAttemptFailed: vi.fn(),
  pendingNotifications: vi.fn(() => []),
  queueStats: vi.fn(() => ({
    unavailable: false, pending: 0, processed: 0, oldestPendingAt: null, failedAttempts: 0,
  })),
  settleAfterRefresh: vi.fn(() => ({ done: [], kept: [], skipped: [] })),
  settleMonitoring: vi.fn(() => ({ done: [], kept: [] })),
}));

vi.mock('../services/drive-comments.js', () => ({
  refreshCommentsForBooks: vi.fn(async () => []),
}));

let app: FastifyInstance;

beforeAll(async () => {
  const { webhookRoutes } = await import('./webhook.js');
  app = Fastify({ logger: false });
  await app.register(webhookRoutes);
  await app.ready();
});

afterAll(async () => {
  const { cancelPendingWebhookRefresh } = await import('./webhook.js');
  cancelPendingWebhookRefresh();
  await app.close();
});

afterEach(async () => {
  const { cancelPendingWebhookRefresh } = await import('./webhook.js');
  cancelPendingWebhookRefresh();
  refreshAllSources.mockClear();
});

/** Дождаться, пока взведённая перечитка состоится. */
async function waitForRefresh(limitMs = 2_000): Promise<void> {
  const deadline = Date.now() + limitMs;
  while (refreshAllSources.mock.calls.length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('вебхук и формулы', () => {
  it('уведомление о правке книги просит прочитать формулы', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/webhook/drive',
      headers: {
        'x-goog-channel-token': 'секрет-канала',
        'x-goog-channel-id': 'канал-1',
        'x-goog-resource-id': 'ресурс-1',
        'x-goog-resource-state': 'update',
        'x-goog-message-number': '2',
        'x-goog-resource-uri': 'https://www.googleapis.com/drive/v3/files/file-uo?alt=json',
      },
    });
    expect(response.statusCode).toBe(200);

    await waitForRefresh();
    expect(refreshAllSources).toHaveBeenCalledTimes(1);
    const options = (refreshAllSources.mock.calls[0] as unknown[])[2] as {
      withFormulas: boolean;
      fresh: boolean;
      books?: string[];
    };
    expect(options.withFormulas).toBe(true);
    // И по-прежнему адресно: правка в одной книге не тащит остальные семь.
    expect(options.fresh).toBe(true);
    expect(options.books).toEqual(['УО']);
  }, 30_000);
});
