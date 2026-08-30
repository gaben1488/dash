import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { WebhookChannelState } from '../services/webhook-channel.js';

/**
 * Страж приёмника push-уведомлений Drive (канон п.66, домен п.69а).
 *
 * Проверяется вся дорога уведомления: без настроенного секрета маршрут закрыт
 * наглухо; чужой POST отклоняется; неполные заголовки отвергаются без
 * подробностей; подтверждение канала не запускает перечитку; серия правок
 * схлопывается в один цикл; повтор доставки и опоздавшее сообщение не множат
 * перечитки; удаление книги — тоже повод перечитать; состояние состояний и
 * счётчики видны отдельным маршрутом.
 */
const refreshAllSources = vi.fn(async () => ({ loaded: ['УО'], failed: [], svodOk: true, at: 'x' }));

vi.mock('../services/source-refresh.js', () => ({
  refreshAllSources: (...args: unknown[]) => refreshAllSources(...(args as [])),
}));

const webhookConfig: { publicUrl?: string; secret?: string } = {};

vi.mock('../config.js', () => ({
  config: {
    webhook: webhookConfig,
    google: { spreadsheetId: 'file-svod', serviceAccountEmail: 'a@b', privateKey: 'k' },
  },
  // Учёт каналов живёт в services/webhook-channel.ts и тянет тот же config:
  // список книг здесь короткий и предсказуемый, чтобы страж проверял разбор
  // уведомления, а не совпадение с боевыми идентификаторами.
  DEPARTMENT_SPREADSHEETS: { 'УО': 'file-uo', 'УКСиМП': 'file-uksimp' },
  SHDYU_SPREADSHEET_ID: 'file-svod',
  webhookTuning: { debounceMs: 15_000, channelTtlMs: 86_400_000 },
}));

// Книга «Ежедневный мониторинг» живёт вне цикла refreshAllSources, поэтому
// вебхук сбрасывает её кэш отдельно. В тесте сервис заглушён: настоящий при
// импорте тянет полный config (здесь он подменён огрызком) и клиент Google.
// Вебхук больше не «сбрасывает кэш и ждёт запроса»: он ПЕРЕЧИТЫВАЕТ книгу и
// объявляет изменившиеся листы в эфир. Заглушка обязана отдавать тот же итог,
// что настоящая перечитка, иначе маршрут падает на первом же уведомлении.
const refreshMonitoringBook = vi.fn(async () => ({
  read: true,
  changed: ['УО'],
  version: 2,
}));
vi.mock('../services/monitoring.js', () => ({
  refreshMonitoringBook: () => refreshMonitoringBook(),
  MONITORING_SPREADSHEET_ID: 'file-monitoring',
}));

// Клиент Google в стражах не нужен ни разу: каналы здесь не заводятся, а
// настоящая библиотека тянется секундами.
vi.mock('googleapis', () => ({
  google: { drive: () => ({}), auth: { GoogleAuth: vi.fn() } },
}));

// Очередь уведомлений живёт в базе; здесь она заглушена — судьбу записей
// проверяет собственный страж (services/webhook-queue.test.ts) и сквозной
// (routes/webhook-queue-flow.test.ts), а этот файл отвечает за сам приём.
const enqueueNotification = vi.fn(() => 1);
const settleAfterRefresh = vi.fn(() => ({ done: [], kept: [], skipped: [] }));
const settleMonitoring = vi.fn(() => ({ done: [], kept: [] }));
vi.mock('../services/webhook-queue.js', () => ({
  cycleCoversFile: vi.fn(() => true),
  enqueueNotification: (...a: unknown[]) => enqueueNotification(...(a as [])),
  noteAttemptFailed: vi.fn(),
  pendingNotifications: vi.fn(() => []),
  queueStats: vi.fn(() => ({ unavailable: false, pending: 0, processed: 0, oldestPendingAt: null, failedAttempts: 0 })),
  settleAfterRefresh: (...a: unknown[]) => settleAfterRefresh(...(a as [])),
  settleMonitoring: (...a: unknown[]) => settleMonitoring(...(a as [])),
}));

// Комментарии-облачка читаются настоящим клиентом Drive — в стражах приёма
// они заглушены; их разбор проверяет services/drive-comments.test.ts.
const refreshCommentsForBooks = vi.fn(async () => []);
vi.mock('../services/drive-comments.js', () => ({
  refreshCommentsForBooks: (...a: unknown[]) => refreshCommentsForBooks(...(a as [])),
}));

let app: FastifyInstance;

beforeAll(async () => {
  const { webhookRoutes } = await import('./webhook.js');
  app = Fastify({ logger: false });
  // Регистрация плагином, как в app.ts: разборщик тела, объявленный внутри
  // вебхука, обязан действовать в своей области и не менять разбор на всём
  // остальном API — проверить это можно только в настоящей форме подключения.
  await app.register(webhookRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

afterEach(async () => {
  const { cancelPendingWebhookRefresh } = await import('./webhook.js');
  const { resetWebhookChannelState } = await import('../services/webhook-channel.js');
  cancelPendingWebhookRefresh();
  resetWebhookChannelState();
  refreshAllSources.mockClear();
  refreshMonitoringBook.mockClear();
  enqueueNotification.mockClear();
  settleAfterRefresh.mockClear();
  settleMonitoring.mockClear();
  refreshCommentsForBooks.mockClear();
  vi.useRealTimers();
});

function post(headers: Record<string, string>) {
  return app.inject({ method: 'POST', url: '/api/webhook/drive', headers });
}

/** Уведомление о правке книги УО — с полным набором заголовков Drive. */
function notification(over: Record<string, string> = {}): Record<string, string> {
  return {
    'x-goog-channel-token': 'верный-секрет',
    'x-goog-channel-id': 'канал-1',
    'x-goog-resource-id': 'ресурс-1',
    'x-goog-resource-state': 'update',
    'x-goog-resource-uri': 'https://www.googleapis.com/drive/v3/files/file-uo?alt=json',
    'x-goog-message-number': '10',
    'x-goog-changed': 'content,properties',
    ...over,
  };
}

async function state(): Promise<WebhookChannelState> {
  const res = await app.inject({ method: 'GET', url: '/api/webhook/drive/state' });
  return res.json() as WebhookChannelState;
}

describe('POST /api/webhook/drive', () => {
  it('без настроенного секрета маршрут закрыт (404), перечитка не запускается', async () => {
    delete webhookConfig.secret;
    const res = await post({ 'x-goog-channel-token': 'что-угодно' });
    expect(res.statusCode).toBe(404);
    expect(refreshAllSources).not.toHaveBeenCalled();
  });

  it('уведомление с неверным токеном канала отклоняется (403) без подробностей', async () => {
    webhookConfig.secret = 'верный-секрет';
    const res = await post({ 'x-goog-channel-token': 'чужой', 'x-goog-resource-state': 'update' });
    expect(res.statusCode).toBe(403);
    expect(res.body).toBe('');
    expect(refreshAllSources).not.toHaveBeenCalled();
  });

  it('секрет канала сверяется целиком: ни общее начало, ни отсутствие заголовка не проходят', async () => {
    // Реестр безопасности 05.06.2026, LOW-1: маршрут открыт без ключа доступа,
    // поэтому сверка секрета сравнением строк подсказывала подбирающему, где
    // расходится первый знак. Теперь сверка идёт за постоянное время; здесь
    // проверяется её итог — отказ во всех трёх случаях.
    webhookConfig.secret = 'верный-секрет';
    const prefix = await post({ 'x-goog-channel-token': 'верный', 'x-goog-resource-state': 'update' });
    const longer = await post({ 'x-goog-channel-token': 'верный-секрет-хвост', 'x-goog-resource-state': 'update' });
    const missing = await post({ 'x-goog-resource-state': 'update' });

    expect([prefix.statusCode, longer.statusCode, missing.statusCode]).toEqual([403, 403, 403]);
    expect(refreshAllSources).not.toHaveBeenCalled();
  });

  it('неполные заголовки отвергаются (400) и в ответе нет подсказки, чего не хватило', async () => {
    webhookConfig.secret = 'верный-секрет';
    const noChannel = await post({ 'x-goog-channel-token': 'верный-секрет', 'x-goog-resource-state': 'update' });
    const noState = await post({ 'x-goog-channel-token': 'верный-секрет', 'x-goog-channel-id': 'канал-1' });

    expect([noChannel.statusCode, noState.statusCode]).toEqual([400, 400]);
    expect(noChannel.body).toBe('');
    expect(refreshAllSources).not.toHaveBeenCalled();
  });

  it('настоящая форма уведомления Drive — пустое тело с json-типом — принимается, а не 400', async () => {
    // Google шлёт POST с `Content-Type: application/json; utf-8` и
    // `Content-Length: 0`. Разборщик JSON по умолчанию отвечал на это 400
    // (FST_ERR_CTP_EMPTY_JSON_BODY) до входа в обработчик, а 400 по документации
    // Drive — «сообщение не доставлено», без повторов. Проверяем все три
    // написания типа, встречающиеся в документации и в жизни.
    // Часы здесь настоящие: разбор тела идёт через поток, а подменённые таймеры
    // останавливают его окончание. Взведённую перечитку снимает afterEach.
    webhookConfig.secret = 'верный-секрет';
    const types = ['application/json; utf-8', 'application/json', 'application/json; charset=utf-8'];
    const codes: number[] = [];
    for (const [i, type] of types.entries()) {
      const res = await post({
        ...notification({ 'x-goog-message-number': String(30 + i) }),
        'content-type': type,
        'content-length': '0',
      });
      codes.push(res.statusCode);
    }

    expect(codes).toEqual([200, 200, 200]);
    const { isRefreshArmed } = await import('./webhook.js');
    expect(isRefreshArmed()).toBe(true);
  });

  it('разбор тела вебхука не меняет разбор на остальном API', async () => {
    // Разборщик объявлен внутри плагина вебхука; соседний маршрут, поднятый
    // рядом, обязан по-прежнему получать разобранный JSON и по-прежнему
    // отвергать пустое тело — иначе тихая правка чужого контура.
    const neighbour = Fastify({ logger: false });
    const { webhookRoutes } = await import('./webhook.js');
    await neighbour.register(webhookRoutes);
    neighbour.post('/api/чужой', async (request) => ({ got: request.body }));
    await neighbour.ready();

    const parsed = await neighbour.inject({
      method: 'POST',
      url: '/api/чужой',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ a: 1 }),
    });
    const empty = await neighbour.inject({
      method: 'POST',
      url: '/api/чужой',
      headers: { 'content-type': 'application/json', 'content-length': '0' },
    });

    expect(parsed.json()).toEqual({ got: { a: 1 } });
    expect(empty.statusCode).toBe(400);
    await neighbour.close();
  });

  it('подтверждение канала (sync) принимается без перечитки', async () => {
    webhookConfig.secret = 'верный-секрет';
    const res = await post(notification({ 'x-goog-resource-state': 'sync', 'x-goog-message-number': '1' }));
    expect(res.statusCode).toBe(200);
    expect(refreshAllSources).not.toHaveBeenCalled();
    expect((await state()).notifications.sync).toBe(1);
  });

  it('серия изменений схлопывается в одну отложенную перечитку', async () => {
    vi.useFakeTimers();
    webhookConfig.secret = 'верный-секрет';
    for (let i = 0; i < 5; i++) {
      const res = await post(notification({ 'x-goog-message-number': String(10 + i) }));
      expect(res.statusCode).toBe(200);
    }
    expect(refreshAllSources).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(refreshAllSources).toHaveBeenCalledTimes(1);
    // Правка в книге УО не трогает книгу мониторинга: это другой файл, и
    // Drive назвал не его. Раньше сброс шёл на любое уведомление, и правка в
    // одной книге стоила перечитывания одиннадцати чужих листов.
    expect(refreshMonitoringBook).not.toHaveBeenCalled();
  });

  it('перечитка требует чтения ПОСЛЕ уведомления, а не любого идущего цикла', async () => {
    vi.useFakeTimers();
    webhookConfig.secret = 'верный-секрет';
    await post(notification());
    await vi.advanceTimersByTimeAsync(15_000);

    expect(refreshAllSources).toHaveBeenCalledWith(
      expect.anything(),
      'webhook',
      expect.objectContaining({ fresh: true }),
    );
  });

  it('СТРАЖ адресности: правка книги УО перечитывает только её, без листа СВОД и чужих книг', async () => {
    vi.useFakeTimers();
    webhookConfig.secret = 'верный-секрет';
    await post(notification());
    await vi.advanceTimersByTimeAsync(15_000);

    expect(refreshAllSources).toHaveBeenCalledWith(
      expect.anything(),
      'webhook',
      // Формулы читаются по уведомлению (решение владельца §22 п.7): книгу
      // трогали рукой, а формулу перебивают именно рукой.
      { fresh: true, books: ['УО'], svod: false, withFormulas: true },
    );
  });

  it('СТРАЖ адресности: правки в двух книгах за одно окно склейки едут одним циклом обеими книгами', async () => {
    vi.useFakeTimers();
    webhookConfig.secret = 'верный-секрет';
    await post(notification({ 'x-goog-message-number': '20' }));
    await post(notification({
      'x-goog-channel-id': 'канал-2',
      'x-goog-message-number': '21',
      'x-goog-resource-uri': 'https://www.googleapis.com/drive/v3/files/file-uksimp?alt=json',
    }));
    await vi.advanceTimersByTimeAsync(15_000);

    expect(refreshAllSources).toHaveBeenCalledTimes(1);
    const call = refreshAllSources.mock.calls[0] as unknown[];
    const options = call[2] as { books?: string[] };
    expect(options.books?.slice().sort()).toEqual(['УКСиМП', 'УО']);
  });

  it('СТРАЖ адресности: правка книги мониторинга не гоняет цикл источников', async () => {
    vi.useFakeTimers();
    webhookConfig.secret = 'верный-секрет';
    await post(notification({
      'x-goog-message-number': '40',
      'x-goog-resource-uri': 'https://www.googleapis.com/drive/v3/files/file-monitoring?alt=json',
    }));
    await vi.advanceTimersByTimeAsync(15_000);

    expect(refreshMonitoringBook).toHaveBeenCalledTimes(1);
    // Книги ГРБС и лист СВОД к этой правке отношения не имеют — читать их
    // значит платить за чужое изменение.
    expect(refreshAllSources).not.toHaveBeenCalled();
  });

  it('СТРАЖ адресности: неизвестный файл читается полностью — пропустить правку хуже, чем прочитать лишнее', async () => {
    vi.useFakeTimers();
    webhookConfig.secret = 'верный-секрет';
    await post(notification({
      'x-goog-message-number': '30',
      'x-goog-resource-uri': 'https://www.googleapis.com/drive/v3/files/чужой-файл?alt=json',
    }));
    await vi.advanceTimersByTimeAsync(15_000);

    expect(refreshAllSources).toHaveBeenCalledWith(
      expect.anything(),
      'webhook',
      { fresh: true, books: undefined, svod: true, withFormulas: true },
    );
    expect(refreshMonitoringBook).toHaveBeenCalledTimes(1);
  });

  it('повтор доставки того же сообщения не заводит вторую перечитку', async () => {
    vi.useFakeTimers();
    webhookConfig.secret = 'верный-секрет';
    await post(notification({ 'x-goog-message-number': '10' }));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(refreshAllSources).toHaveBeenCalledTimes(1);

    // Google повторяет доставку, когда не дождался ответа; номер сообщения тот же.
    await post(notification({ 'x-goog-message-number': '10' }));
    await vi.advanceTimersByTimeAsync(15_000);

    expect(refreshAllSources).toHaveBeenCalledTimes(1);
    const s = await state();
    expect(s.notifications.duplicate).toBe(1);
    expect(s.notifications.lastDecision).toBe('duplicate');
  });

  it('опоздавшее сообщение (номер меньше уже виденного) не запускает перечитку', async () => {
    vi.useFakeTimers();
    webhookConfig.secret = 'верный-секрет';
    await post(notification({ 'x-goog-message-number': '20' }));
    await vi.advanceTimersByTimeAsync(15_000);
    refreshAllSources.mockClear();

    await post(notification({ 'x-goog-message-number': '7' }));
    await vi.advanceTimersByTimeAsync(15_000);

    expect(refreshAllSources).not.toHaveBeenCalled();
    expect((await state()).notifications.late).toBe(1);
  });

  it('удаление книги (trash) — тоже повод перечитать: источник обязан честно стать непрочитанным', async () => {
    vi.useFakeTimers();
    webhookConfig.secret = 'верный-секрет';
    await post(notification({ 'x-goog-resource-state': 'trash', 'x-goog-message-number': '11' }));
    await vi.advanceTimersByTimeAsync(15_000);

    expect(refreshAllSources).toHaveBeenCalledTimes(1);
    const s = await state();
    expect(s.notifications.gone).toBe(1);
    expect(s.channels.items.find((i) => i.book === 'УО')?.state).toBe('gone');
  });

  it('правка одних только прав доступа не поднимает девять книг', async () => {
    // X-Goog-Changed говорит, что менялось. Права и папка данных не трогают, а
    // перечитка стоит обращения к каждой книге — считаем и не читаем.
    vi.useFakeTimers();
    webhookConfig.secret = 'верный-секрет';
    const res = await post(notification({ 'x-goog-changed': 'permissions', 'x-goog-message-number': '13' }));
    await vi.advanceTimersByTimeAsync(15_000);

    expect(res.statusCode).toBe(200);
    expect(refreshAllSources).not.toHaveBeenCalled();
    const s = await state();
    expect(s.notifications.unrelated).toBe(1);
    expect(s.notifications.lastDecision).toBe('unrelated');
  });

  it('незнакомое состояние учитывается, но перечитку не запускает', async () => {
    vi.useFakeTimers();
    webhookConfig.secret = 'верный-секрет';
    const res = await post(notification({ 'x-goog-resource-state': 'нечто', 'x-goog-message-number': '12' }));
    await vi.advanceTimersByTimeAsync(15_000);

    expect(res.statusCode).toBe(200);
    expect(refreshAllSources).not.toHaveBeenCalled();
    expect((await state()).notifications.ignored).toBe(1);
  });
});

describe('GET /api/webhook/drive/state', () => {
  it('показывает книги под наблюдением, счётчики и последнее решение', async () => {
    webhookConfig.secret = 'верный-секрет';
    webhookConfig.publicUrl = 'https://dash-elizovo-uer.ru';
    await post(notification());

    const s = await state();
    expect(s.configured).toBe(true);
    expect(s.channels.items.map((i) => i.book).sort()).toEqual(
      ['Ежедневный мониторинг', 'Сводная книга', 'УКСиМП', 'УО'],
    );
    expect(s.notifications.received).toBe(1);
    expect(s.notifications.refresh).toBe(1);
    expect(s.notifications.byState.update).toBe(1);
    expect(s.refresh.debounceSeconds).toBe(15);
  });

  it('состояние не выдаёт наружу ни секрета, ни идентификаторов книг', async () => {
    webhookConfig.secret = 'верный-секрет';
    await post(notification());

    const raw = JSON.stringify(await state());
    expect(raw).not.toContain('верный-секрет');
    expect(raw).not.toContain('file-uo');
    expect(raw).not.toContain('канал-1');
  });

  it('невыключенные, но ни разу не заведённые каналы видны как «неизвестно», а не исчезают', async () => {
    webhookConfig.secret = 'верный-секрет';
    webhookConfig.publicUrl = 'https://dash-elizovo-uer.ru';
    const s = await state();
    expect(s.channels.state).toBe('unknown');
    expect(s.channels.items.every((i) => i.state === 'unknown')).toBe(true);
  });
});
