import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Страж жизни push-каналов Drive и учёта уведомлений.
 *
 * Опирается на документацию Drive (developers.google.com/workspace/drive/api/
 * guides/push, взято через Context7): канал сам не продлевается, срок назначает
 * Google («whichever is more restrictive»), при перезаведении бывает период
 * перекрытия с двойными уведомлениями, сообщение sync всегда номер 1, дальше
 * номера растут, но не подряд.
 */

const webhookConfig: { publicUrl?: string; secret?: string } = {
  publicUrl: 'https://dash-elizovo-uer.ru',
  secret: 'секрет-канала',
};

vi.mock('../config.js', () => ({
  config: {
    webhook: webhookConfig,
    google: { spreadsheetId: 'file-svod', serviceAccountEmail: 'a@b', privateKey: 'k' },
  },
  DEPARTMENT_SPREADSHEETS: { 'УО': 'file-uo', 'УКСиМП': 'file-uksimp' },
  SHDYU_SPREADSHEET_ID: 'file-svod',
  webhookTuning: { debounceMs: 15_000, channelTtlMs: 86_400_000 },
}));

vi.mock('./monitoring.js', () => ({
  invalidateMonitoringCache: () => undefined,
  MONITORING_SPREADSHEET_ID: 'file-monitoring',
}));

vi.mock('googleapis', () => ({
  google: { drive: () => ({}), auth: { GoogleAuth: vi.fn() } },
}));

const log = { info: vi.fn(), warn: vi.fn() };

const HOUR = 60 * 60 * 1000;

/** Поддельный Drive: считает вызовы и отдаёт срок, назначенный «Google». */
function fakeApi(over: Partial<{ grantedMs: (fileId: string) => number | null; failOn: Set<string> }> = {}) {
  const watched: { fileId: string; channelId: string; address: string; token: string }[] = [];
  const stopped: { channelId: string; resourceId: string }[] = [];
  return {
    watched,
    stopped,
    api: {
      async watch(input: { fileId: string; channelId: string; address: string; token: string; expirationMs: number }) {
        if (over.failOn?.has(input.fileId)) throw new Error('нет доступа');
        watched.push({ fileId: input.fileId, channelId: input.channelId, address: input.address, token: input.token });
        return {
          channelId: input.channelId,
          resourceId: `ресурс-${input.fileId}`,
          expirationMs: over.grantedMs ? over.grantedMs(input.fileId) : input.expirationMs,
        };
      },
      async stop(input: { channelId: string; resourceId: string }) {
        stopped.push(input);
      },
    },
  };
}

function headers(over: Record<string, string> = {}): Record<string, unknown> {
  return {
    'x-goog-channel-id': 'канал-1',
    'x-goog-resource-id': 'ресурс-1',
    'x-goog-resource-state': 'update',
    'x-goog-resource-uri': 'https://www.googleapis.com/drive/v3/files/file-uo?alt=json',
    'x-goog-message-number': '10',
    'x-goog-changed': 'content,properties',
    'x-goog-channel-expiration': 'Tue, 19 Nov 2013 01:13:52 GMT',
    ...over,
  };
}

beforeEach(async () => {
  const { resetWebhookChannelState } = await import('./webhook-channel.js');
  resetWebhookChannelState();
  log.info.mockClear();
  log.warn.mockClear();
  webhookConfig.publicUrl = 'https://dash-elizovo-uer.ru';
  webhookConfig.secret = 'секрет-канала';
});

describe('разбор уведомления Drive', () => {
  it('заголовки разбираются в осмысленные поля, состояние — в нижнем регистре', async () => {
    const { readDriveNotification } = await import('./webhook-channel.js');
    const n = readDriveNotification(headers({ 'x-goog-resource-state': 'Update' }));

    expect(n.channelId).toBe('канал-1');
    expect(n.messageNumber).toBe(10);
    expect(n.resourceState).toBe('update');
    expect(n.fileId).toBe('file-uo');
    expect(n.changed).toEqual(['content', 'properties']);
    expect(n.expiresAt).toBe(new Date('Tue, 19 Nov 2013 01:13:52 GMT').toISOString());
  });

  it('заголовок, пришедший дважды (список), не склеивается в правдоподобное значение', async () => {
    // Fastify отдаёт массив, когда заголовок повторён. «Возьмём первый» — это
    // догадка о намерении отправителя; честнее считать уведомление неполным.
    const { readDriveNotification, isWellFormed } = await import('./webhook-channel.js');
    expect(isWellFormed(readDriveNotification(headers()))).toBe(true);

    const doubled = readDriveNotification({ ...headers(), 'x-goog-channel-id': ['a', 'b'] });
    expect(doubled.channelId).toBe('');
    expect(isWellFormed(doubled)).toBe(false);
  });

  it('уведомление без канала или без состояния считается неполным', async () => {
    const { readDriveNotification, isWellFormed } = await import('./webhook-channel.js');
    expect(isWellFormed(readDriveNotification({ 'x-goog-resource-state': 'update' }))).toBe(false);
    expect(isWellFormed(readDriveNotification({ 'x-goog-channel-id': 'канал-1' }))).toBe(false);
  });

  it('идентификатор файла достаётся из адреса ресурса, мусор — не достаётся', async () => {
    const { fileIdFromResourceUri } = await import('./webhook-channel.js');
    expect(fileIdFromResourceUri('https://www.googleapis.com/drive/v3/files/abc_123-XY?alt=json')).toBe('abc_123-XY');
    expect(fileIdFromResourceUri('https://example.com/notifications')).toBeNull();
  });
});

describe('решение по уведомлению', () => {
  it('состояния различаются: правка — перечитка, sync — подтверждение, мусор — учёт без действия', async () => {
    const { readDriveNotification, noteNotification } = await import('./webhook-channel.js');
    const decide = (state: string, number: number, armed = false) =>
      noteNotification(readDriveNotification(headers({ 'x-goog-resource-state': state, 'x-goog-message-number': String(number) })), armed);

    expect(decide('sync', 1)).toBe('sync');
    expect(decide('update', 2)).toBe('refresh');
    expect(decide('add', 3)).toBe('refresh');
    expect(decide('untrash', 4)).toBe('refresh');
    expect(decide('trash', 5)).toBe('refresh');
    expect(decide('remove', 6)).toBe('refresh');
    expect(decide('нечто', 7)).toBe('ignored');
    // Справочник заголовков называет состояние `change`, а пример уведомления по
    // ресурсу changes — `changed`. Понимаем оба написания: пропущенное значило бы
    // молчание там, где книгу правили.
    expect(decide('changed', 8)).toBe('refresh');
  });

  it('правка одних только прав или папки данных не трогает — читать нечего', async () => {
    const { readDriveNotification, noteNotification, webhookChannelState } = await import('./webhook-channel.js');
    const decide = (changed: string, number: number) =>
      noteNotification(readDriveNotification(headers({ 'x-goog-changed': changed, 'x-goog-message-number': String(number) })), false);

    expect(decide('permissions', 2)).toBe('unrelated');
    expect(decide('parents,children', 3)).toBe('unrelated');
    // Осторожность важнее экономии: есть содержимое — читаем; заголовка нет или
    // слово незнакомое — тоже читаем.
    expect(decide('permissions,content', 4)).toBe('refresh');
    expect(decide('', 5)).toBe('refresh');
    expect(decide('нечто-новое', 6)).toBe('refresh');
    expect(webhookChannelState().notifications.unrelated).toBe(2);
  });

  it('при взведённой перечитке правка схлопывается, а не заводит вторую', async () => {
    const { readDriveNotification, noteNotification } = await import('./webhook-channel.js');
    const first = noteNotification(readDriveNotification(headers({ 'x-goog-message-number': '2' })), false);
    const second = noteNotification(readDriveNotification(headers({ 'x-goog-message-number': '3' })), true);

    expect([first, second]).toEqual(['refresh', 'coalesced']);
  });

  it('повтор доставки ловится по паре канал+номер сообщения', async () => {
    const { readDriveNotification, noteNotification } = await import('./webhook-channel.js');
    noteNotification(readDriveNotification(headers({ 'x-goog-message-number': '9' })), false);
    const again = noteNotification(readDriveNotification(headers({ 'x-goog-message-number': '9' })), false);

    expect(again).toBe('duplicate');
  });

  it('номер меньше уже виденного — опоздавшее сообщение, его цикл давно прошёл', async () => {
    const { readDriveNotification, noteNotification } = await import('./webhook-channel.js');
    noteNotification(readDriveNotification(headers({ 'x-goog-message-number': '40' })), false);
    const late = noteNotification(readDriveNotification(headers({ 'x-goog-message-number': '12' })), false);

    expect(late).toBe('late');
  });

  it('два канала на одну книгу (перекрытие при перезаведении) не удваивают перечитку', async () => {
    // Документация Drive: «there may be an overlap period where both the old and
    // new channels are active for the same resource». Номера у каналов свои,
    // поэтому от удвоения спасает не дедупликация ключей, а склейка по времени.
    const { readDriveNotification, noteNotification } = await import('./webhook-channel.js');
    const first = noteNotification(readDriveNotification(headers({ 'x-goog-channel-id': 'старый' })), false);
    const second = noteNotification(readDriveNotification(headers({ 'x-goog-channel-id': 'новый' })), true);

    expect([first, second]).toEqual(['refresh', 'coalesced']);
  });

  it('уведомление о книге вне списка наблюдения обрабатывается, но названо честно', async () => {
    const { readDriveNotification, noteNotification, webhookChannelState } = await import('./webhook-channel.js');
    noteNotification(readDriveNotification(headers({
      'x-goog-resource-uri': 'https://www.googleapis.com/drive/v3/files/file-strange',
      'x-goog-channel-id': 'канал-чужой',
    })), false);

    const s = webhookChannelState();
    expect(s.channels.items.some((i) => i.book === 'книга вне списка наблюдения')).toBe(true);
  });
});

describe('состояние наблюдения', () => {
  it('срок канала берётся из заголовка уведомления, если канал заведён в прошлой жизни процесса', async () => {
    const { readDriveNotification, noteNotification, webhookChannelState } = await import('./webhook-channel.js');
    const now = new Date('2026-08-20T00:00:00.000Z');
    const expires = new Date(now.getTime() + 10 * HOUR).toUTCString();
    noteNotification(readDriveNotification(headers({ 'x-goog-channel-expiration': expires })), false, now);

    const item = webhookChannelState(now).channels.items.find((i) => i.book === 'УО');
    expect(item?.state).toBe('active');
    expect(item?.secondsLeft).toBe(10 * 60 * 60);
  });

  it('канал ближе часа к истечению — «скоро продлевать», истёкший — «без наблюдения»', async () => {
    const { readDriveNotification, noteNotification, webhookChannelState } = await import('./webhook-channel.js');
    const now = new Date('2026-08-20T00:00:00.000Z');
    noteNotification(
      readDriveNotification(headers({ 'x-goog-channel-expiration': new Date(now.getTime() + HOUR).toUTCString() })),
      false,
      now,
    );
    expect(webhookChannelState(now).channels.items.find((i) => i.book === 'УО')?.state).toBe('expiring');

    const later = new Date(now.getTime() + 2 * HOUR);
    expect(webhookChannelState(later).channels.items.find((i) => i.book === 'УО')?.state).toBe('expired');
    expect(webhookChannelState(later).channels.state).toBe('degraded');
  });

  it('книга без канала не исчезает из списка, а честно значится неизвестной', async () => {
    const { webhookChannelState } = await import('./webhook-channel.js');
    const s = webhookChannelState();
    expect(s.channels.watched).toBe(4);
    expect(s.channels.items.every((i) => i.state === 'unknown')).toBe(true);
    expect(s.channels.state).toBe('unknown');
  });

  it('без адреса и секрета состояние прямо говорит, что работает опрос', async () => {
    const { webhookChannelState } = await import('./webhook-channel.js');
    delete webhookConfig.secret;
    const s = webhookChannelState();
    expect(s.configured).toBe(false);
    expect(s.channels.summary).toContain('опрос');
  });
});

describe('заведение и продление каналов', () => {
  it('канал заводится на каждую наблюдаемую книгу, адрес и секрет — наши', async () => {
    const { registerWatchChannels, watchedBooks } = await import('./webhook-channel.js');
    const { watched, api } = fakeApi();
    const outcome = await registerWatchChannels(log, api);

    expect(outcome.registered.length).toBe(watchedBooks().length);
    expect(watched.every((w) => w.address === 'https://dash-elizovo-uer.ru/api/webhook/drive')).toBe(true);
    expect(watched.every((w) => w.token === 'секрет-канала')).toBe(true);
  });

  it('срок канала берётся НАЗНАЧЕННЫЙ Google, а не запрошенный нами', async () => {
    // Документация: срок определяется запросом или внутренним пределом API,
    // «whichever is more restrictive». Вера в свои 24 часа — это молча умерший
    // канал в тот день, когда Google выдаст меньше.
    const { registerWatchChannels, webhookChannelState } = await import('./webhook-channel.js');
    const now = new Date('2026-08-20T00:00:00.000Z');
    const { api } = fakeApi({ grantedMs: () => now.getTime() + 6 * HOUR });
    await registerWatchChannels(log, api, now);

    const item = webhookChannelState(now).channels.items.find((i) => i.book === 'УО');
    expect(item?.expiresAt).toBe(new Date(now.getTime() + 6 * HOUR).toISOString());
    expect(item?.secondsLeft).toBe(6 * 60 * 60);
  });

  it('действующий канал не перезаводится, а доживающий — перезаводится и прежний гасится', async () => {
    const { registerWatchChannels } = await import('./webhook-channel.js');
    const now = new Date('2026-08-20T00:00:00.000Z');
    const { watched, stopped, api } = fakeApi({ grantedMs: () => now.getTime() + 24 * HOUR });
    await registerWatchChannels(log, api, now);
    const afterFirst = watched.length;

    // Через час канал ещё жив с запасом — ничего не трогаем.
    const kept = await registerWatchChannels(log, api, new Date(now.getTime() + HOUR));
    expect(watched.length).toBe(afterFirst);
    expect(kept.kept.length).toBe(afterFirst);
    expect(stopped).toEqual([]);

    // За полчаса до истечения — перезаводим и гасим прежний канал: иначе на
    // одну правку прилетают два уведомления (период перекрытия из документации).
    const renewed = await registerWatchChannels(log, api, new Date(now.getTime() + 23.5 * HOUR));
    expect(renewed.registered.length).toBe(afterFirst);
    expect(watched.length).toBe(afterFirst * 2);
    expect(stopped.length).toBe(afterFirst);
    expect(stopped[0].resourceId).toMatch(/^ресурс-/);
  });

  it('молчание Google о сроке не превращается в вечное перезаведение канала', async () => {
    // Если срок неизвестен, наш же расчёт следующего подхода читает это как
    // «продлевать сейчас»: канал заводился бы каждые десять минут, сжигая квоту.
    // Поэтому при молчании держимся запрошенного срока и помечаем допущением.
    const { registerWatchChannels, webhookChannelState, nextWakeMs } = await import('./webhook-channel.js');
    const now = new Date('2026-08-20T00:00:00.000Z');
    const { watched, api } = fakeApi({ grantedMs: () => null });
    const first = await registerWatchChannels(log, api, now);
    const afterFirst = watched.length;

    const item = webhookChannelState(now).channels.items.find((i) => i.book === 'УО');
    expect(item?.secondsLeft).toBe(24 * 60 * 60);
    // Срок помечен допущением: такому сроку веры меньше, и это видно снаружи.
    expect(item?.knownFrom).toBe('assumed');
    expect(nextWakeMs(first.expirations, false, now.getTime())).toBe(23 * HOUR);

    // Через час подход повторяется — и ничего не заводит заново.
    const kept = await registerWatchChannels(log, api, new Date(now.getTime() + HOUR));
    expect(watched.length).toBe(afterFirst);
    expect(kept.kept.length).toBe(afterFirst);
  });

  it('допущение о сроке исправляется первым же сообщением канала', async () => {
    // Подтверждение sync приходит сразу после заведения и несёт настоящий срок
    // заголовком X-Goog-Channel-Expiration.
    const { registerWatchChannels, readDriveNotification, noteNotification, webhookChannelState } =
      await import('./webhook-channel.js');
    const now = new Date('2026-08-20T00:00:00.000Z');
    const { watched, api } = fakeApi({ grantedMs: () => null });
    await registerWatchChannels(log, api, now);
    const channelId = watched.find((w) => w.fileId === 'file-uo')!.channelId;

    noteNotification(
      readDriveNotification(headers({
        'x-goog-channel-id': channelId,
        'x-goog-resource-state': 'sync',
        'x-goog-message-number': '1',
        'x-goog-channel-expiration': new Date(now.getTime() + 6 * HOUR).toUTCString(),
      })),
      false,
      now,
    );

    expect(webhookChannelState(now).channels.items.find((i) => i.book === 'УО')?.secondsLeft).toBe(6 * 60 * 60);
  });

  it('запись об ушедшей книге не прячет живой канал на неё', async () => {
    // Книгу положили в корзину и вернули: на неё заведён новый канал, а старая
    // запись «ушла» ещё жива по сроку. Показывать «без наблюдения» было бы
    // неправдой — наблюдение восстановлено.
    const { readDriveNotification, noteNotification, registerWatchChannels, webhookChannelState } =
      await import('./webhook-channel.js');
    const now = new Date('2026-08-20T00:00:00.000Z');
    noteNotification(
      readDriveNotification(headers({
        'x-goog-channel-id': 'канал-старый',
        'x-goog-resource-state': 'trash',
        'x-goog-channel-expiration': new Date(now.getTime() + 40 * HOUR).toUTCString(),
      })),
      false,
      now,
    );
    expect(webhookChannelState(now).channels.items.find((i) => i.book === 'УО')?.state).toBe('gone');

    const { api } = fakeApi({ grantedMs: () => now.getTime() + 10 * HOUR });
    await registerWatchChannels(log, api, now);

    expect(webhookChannelState(now).channels.items.find((i) => i.book === 'УО')?.state).toBe('active');
  });

  it('подходы к каналам считаются: заведено, перезаведено, не далось, когда', async () => {
    const { registerWatchChannels, webhookChannelState } = await import('./webhook-channel.js');
    const now = new Date('2026-08-20T00:00:00.000Z');
    const { api } = fakeApi({ grantedMs: () => now.getTime() + 24 * HOUR, failOn: new Set(['file-uo']) });
    await registerWatchChannels(log, api, now);

    const first = webhookChannelState(now).channels.registrations;
    expect(first).toEqual({ created: 3, renewed: 0, failed: 1, lastAt: now.toISOString() });

    const later = new Date(now.getTime() + 23.5 * HOUR);
    await registerWatchChannels(log, api, later);
    const second = webhookChannelState(later).channels.registrations;
    expect(second.renewed).toBe(3);
    expect(second.failed).toBe(2);
    expect(second.lastAt).toBe(later.toISOString());
  });

  it('отказ по одной книге не отменяет остальные', async () => {
    const { registerWatchChannels } = await import('./webhook-channel.js');
    const { api } = fakeApi({ failOn: new Set(['file-uo']) });
    const outcome = await registerWatchChannels(log, api);

    expect(outcome.failed).toEqual(['УО']);
    expect(outcome.registered.length).toBe(3);
    // В журнале — человеческое название книги, а не идентификатор файла.
    expect(log.warn.mock.calls.flat().join(' ')).toContain('«УО»');
    expect(log.warn.mock.calls.flat().join(' ')).not.toContain('file-uo');
  });

  it('«слишком часто» от Google повторяется с растущей задержкой, а не роняет книгу', async () => {
    const { registerWatchChannels } = await import('./webhook-channel.js');
    const base = fakeApi();
    let first = true;
    const api = {
      ...base.api,
      async watch(input: Parameters<typeof base.api.watch>[0]) {
        if (first && input.fileId === 'file-uo') {
          first = false;
          throw Object.assign(new Error('Quota exceeded'), { status: 429 });
        }
        return base.api.watch(input);
      },
    };

    const outcome = await registerWatchChannels(log, api);
    expect(outcome.failed).toEqual([]);
    expect(outcome.registered).toContain('УО');
  }, 20_000);

  it('без адреса или секрета не заводится ничего — продукт живёт опросом', async () => {
    const { registerWatchChannels } = await import('./webhook-channel.js');
    delete webhookConfig.secret;
    const { watched, api } = fakeApi();
    const outcome = await registerWatchChannels(log, api);

    expect(watched).toEqual([]);
    expect(outcome.registered).toEqual([]);
  });
});

describe('смена источника на ходу', () => {
  it('подставленная книга берётся под наблюдение сразу, а не к следующему сроку', async () => {
    // Управлению подставили другую книгу через настройку источников. Расписание
    // идёт от срока истечения — без немедленного подхода новая книга молчала бы
    // часами, и продукт считал бы её данные свежими.
    const { startWebhookChannels, rescheduleWebhookChannels, stopWebhookChannels } =
      await import('./webhook-channel.js');
    const config = await import('../config.js');
    const { watched, api } = fakeApi();

    startWebhookChannels(log, api);
    await vi.waitFor(() => expect(watched.length).toBe(4));

    config.DEPARTMENT_SPREADSHEETS['УО'] = 'file-uo-новая';
    rescheduleWebhookChannels(log, api);
    await vi.waitFor(() => expect(watched.some((w) => w.fileId === 'file-uo-новая')).toBe(true));

    stopWebhookChannels();
    config.DEPARTMENT_SPREADSHEETS['УО'] = 'file-uo';
  });
});

describe('расписание продления', () => {
  it('следующий подход назначается к САМОМУ РАННЕМУ сроку, с запасом на час', async () => {
    const { nextWakeMs, RENEW_SKEW_MS } = await import('./webhook-channel.js');
    const now = Date.now();
    const wake = nextWakeMs([now + 20 * HOUR, now + 8 * HOUR, null], false, now);
    expect(wake).toBe(8 * HOUR - RENEW_SKEW_MS);
  });

  it('чаще, чем раз в пять минут, к каналам не подходим', async () => {
    const { nextWakeMs } = await import('./webhook-channel.js');
    const now = Date.now();
    expect(nextWakeMs([now + 10 * 60_000], false, now)).toBe(5 * 60_000);
  });

  it('если какая-то книга не далась — подход раньше, но не бесконечный цикл', async () => {
    const { nextWakeMs } = await import('./webhook-channel.js');
    const now = Date.now();
    expect(nextWakeMs([now + 20 * HOUR], true, now)).toBe(10 * 60_000);
    // Сроков не знаем вовсе — тоже подход через срок повтора, а не молчание.
    expect(nextWakeMs([null], false, now)).toBe(10 * 60_000);
  });
});
