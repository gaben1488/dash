/**
 * webhook-channel.ts — жизнь push-каналов Google Drive и учёт уведомлений.
 *
 * Разделение обязанностей: маршрут `routes/webhook.ts` принимает POST и решает,
 * отвечать ли 200; здесь живёт ВСЁ, что должно пережить отдельное уведомление, —
 * какие каналы заведены, до какого часа они действуют, какие сообщения уже
 * приходили и чем закончились.
 *
 * Что говорит документация Drive (developers.google.com/workspace/drive/api/
 * guides/push, взято через Context7):
 *
 *  • Уведомление приходит заголовками X-Goog-*: Channel-ID, Message-Number,
 *    Resource-ID, Resource-State, Resource-URI, Channel-Expiration, Channel-Token,
 *    Changed. Тела у файлового уведомления нет.
 *  • Состояния ресурса: `sync` (подтверждение канала), `add`, `remove`,
 *    `update`, `trash`, `untrash`, `change`.
 *  • «There is no automatic renewal process for notification channels» — канал
 *    не продлевается сам. Чтобы наблюдение не прервалось, надо ЗАРАНЕЕ завести
 *    новый канал с новым идентификатором, и тогда «there may be an overlap
 *    period where both the old and new channels are active for the same
 *    resource» — то есть на одну правку прилетят ДВА уведомления. Отсюда две
 *    обязанности этого модуля: гасить прежний канал через channels.stop и
 *    дедуплицировать сообщения.
 *  • Срок канала Google назначает сам, «whichever is more restrictive» — наш
 *    запрос или внутренний предел. Поэтому срок берётся из ОТВЕТА watch
 *    (поле `expiration`, миллисекунды эпохи), а не из того, что мы попросили;
 *    вера в свои 24 часа — это молчаливо умерший канал в тот день, когда Google
 *    выдаст меньше.
 *  • channels.stop принимает `id` и `resourceId` канала.
 *  • При 429/5xx документация требует экспоненциальную задержку со случайной
 *    добавкой; готовый такой повтор уже есть в services/sheets-retry.ts, свой
 *    второй не заводим.
 *
 * Чего здесь НЕТ намеренно: ни секретов, ни идентификаторов книг наружу. Снимок
 * состояния (`webhookChannelState`) отдаётся маршрутом, который в режиме
 * AEMR_PUBLIC_READONLY открыт на чтение всем, поэтому в нём только человеческие
 * названия книг, времена и счётчики — то же, что уже видно в /api/health.
 */
import { google } from 'googleapis';
import { randomUUID } from 'node:crypto';
import { config, DEPARTMENT_SPREADSHEETS, SHDYU_SPREADSHEET_ID, webhookTuning } from '../config.js';
import { MONITORING_SPREADSHEET_ID } from './monitoring.js';
import { withSheetsRetry } from './sheets-retry.js';

// ---------------------------------------------------------------------------
// Наблюдаемые книги
// ---------------------------------------------------------------------------

/** Имя сводной книги для человека: идентификатор наружу не выходит. */
const SVOD_BOOK_NAME = 'Сводная книга';
/** Имя книги ежедневного мониторинга (п.69в). */
const MONITORING_BOOK_NAME = 'Ежедневный мониторинг';

export interface WatchedBook {
  /** Человеческое название — то же, что читатель видит в состоянии источников. */
  book: string;
  /** Идентификатор файла Drive. Наружу не отдаётся никогда. */
  fileId: string;
}

/**
 * Книги под наблюдением: восемь книг управлений (живой список из config —
 * с учётом подмен из data/sources.json, а не статический список констант),
 * сводная книга и книга мониторинга. Один файл — одна запись: сводная и ШДЮ
 * делят идентификатор, и второй канал на тот же файл означал бы удвоение
 * уведомлений на ровном месте.
 */
export function watchedBooks(): WatchedBook[] {
  const byFile = new Map<string, string>();
  for (const [book, fileId] of Object.entries(DEPARTMENT_SPREADSHEETS)) {
    if (fileId) byFile.set(fileId, book);
  }
  const svod = config.google.spreadsheetId;
  if (svod && !byFile.has(svod)) byFile.set(svod, SVOD_BOOK_NAME);
  if (SHDYU_SPREADSHEET_ID && !byFile.has(SHDYU_SPREADSHEET_ID)) {
    byFile.set(SHDYU_SPREADSHEET_ID, SVOD_BOOK_NAME);
  }
  if (MONITORING_SPREADSHEET_ID && !byFile.has(MONITORING_SPREADSHEET_ID)) {
    byFile.set(MONITORING_SPREADSHEET_ID, MONITORING_BOOK_NAME);
  }
  return [...byFile].map(([fileId, book]) => ({ book, fileId }));
}

/** Название книги по идентификатору файла; `null` — файл не наш. */
export function bookByFileId(fileId: string | null): string | null {
  if (!fileId) return null;
  return watchedBooks().find((w) => w.fileId === fileId)?.book ?? null;
}

// ---------------------------------------------------------------------------
// Разбор уведомления
// ---------------------------------------------------------------------------

/**
 * Значение заголовка одной строкой. Список (заголовок пришёл дважды) — это не
 * «возьмём первый», а неполные данные: склеенная строка не совпадёт ни с чем и
 * уведомление честно уйдёт в отвергнутые.
 */
function single(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  return '';
}

export interface DriveNotification {
  channelId: string;
  /** Номер сообщения в канале; `null` — заголовка нет или он не число. */
  messageNumber: number | null;
  resourceId: string;
  /** sync | add | update | change | trash | untrash | remove | иное. */
  resourceState: string;
  /** Идентификатор файла из X-Goog-Resource-URI; наружу не отдаётся. */
  fileId: string | null;
  /** Что именно изменилось (content, properties, parents, …). */
  changed: string[];
  /** Срок канала из X-Goog-Channel-Expiration, ISO; `null` — заголовка нет. */
  expiresAt: string | null;
}

/** Идентификатор файла из адреса ресурса: .../drive/v3/files/<id>[?...]. */
export function fileIdFromResourceUri(uri: string): string | null {
  const match = /\/files\/([A-Za-z0-9_-]+)/.exec(uri);
  return match ? match[1] : null;
}

export function readDriveNotification(headers: Record<string, unknown>): DriveNotification {
  const rawNumber = single(headers['x-goog-message-number']);
  const parsedNumber = Number(rawNumber);
  const rawExpiration = single(headers['x-goog-channel-expiration']);
  const expirationMs = rawExpiration ? Date.parse(rawExpiration) : Number.NaN;
  return {
    channelId: single(headers['x-goog-channel-id']),
    messageNumber: rawNumber && Number.isFinite(parsedNumber) ? parsedNumber : null,
    resourceId: single(headers['x-goog-resource-id']),
    resourceState: single(headers['x-goog-resource-state']).toLowerCase(),
    fileId: fileIdFromResourceUri(single(headers['x-goog-resource-uri'])),
    changed: single(headers['x-goog-changed']).split(',').map((s) => s.trim()).filter(Boolean),
    expiresAt: Number.isFinite(expirationMs) ? new Date(expirationMs).toISOString() : null,
  };
}

/**
 * Уведомление годно к разбору? Google всегда шлёт канал и состояние; POST без
 * них — либо не от Google, либо испорчен по дороге. Такой отвергается без
 * подробностей: подсказывать, какого заголовка не хватило, значит помогать
 * подбирать форму запроса.
 */
export function isWellFormed(n: DriveNotification): boolean {
  return Boolean(n.channelId) && Boolean(n.resourceState);
}

// ---------------------------------------------------------------------------
// Словарь состояний
// ---------------------------------------------------------------------------

/**
 * Состояния, после которых книгу надо перечитать. `change` и `changed` — одно
 * и то же событие в двух написаниях: справочник заголовков перечисляет `change`,
 * а пример уведомления по ресурсу changes показывает `changed`. Держим оба:
 * пропущенное написание — это молчание там, где книгу правили.
 */
const REFRESHING_STATES = new Set(['update', 'add', 'change', 'changed', 'untrash']);
/** Состояния «ресурс ушёл»: книгу удалили или отобрали доступ. */
const GONE_STATES = new Set(['trash', 'remove']);

/**
 * Грани правки (X-Goog-Changed), которые к данным книги отношения не имеют:
 * поделились ссылкой, перенесли в другую папку, положили внутрь что-то ещё.
 * Строки от этого не меняются, а перечитка стоит девяти обращений к Google.
 *
 * Правило намеренно осторожное: пропускаем уведомление, только если Google
 * НАЗВАЛ грани и все они из этого списка. Нет заголовка, есть `content`, есть
 * незнакомое слово — перечитываем. Ошибиться в сторону лишнего чтения дёшево,
 * в сторону пропущенной правки — нет.
 */
const DATALESS_FACETS = new Set(['permissions', 'parents', 'children']);

function touchesData(changed: readonly string[]): boolean {
  if (changed.length === 0) return true;
  return changed.some((facet) => !DATALESS_FACETS.has(facet));
}

export type NotificationDecision =
  /** Взвели отложенную перечитку. */
  | 'refresh'
  /** Склеили с уже взведённой перечиткой (серия правок — один цикл). */
  | 'coalesced'
  /** Подтверждение создания канала: читать нечего. */
  | 'sync'
  /** Тот же номер сообщения того же канала — повтор доставки. */
  | 'duplicate'
  /** Номер меньше уже виденного — уведомление опоздало, его цикл давно прошёл. */
  | 'late'
  /** Правка не тронула данные (права, папка) — читать нечего. */
  | 'unrelated'
  /** Состояние вне словаря Drive — ничего не делаем, но считаем. */
  | 'ignored';

/** Отказы, до разбора уведомления. */
export type NotificationRefusal =
  /** Секрет канала не совпал. */
  | 'rejected'
  /** Заголовков не хватает. */
  | 'malformed'
  /** Вебхук не настроен — маршрут закрыт. */
  | 'unconfigured';

// ---------------------------------------------------------------------------
// Память о сообщениях и каналах
// ---------------------------------------------------------------------------

/**
 * Сколько ключей сообщений помним. Дедупликация нужна на минуты (повтор
 * доставки и перекрытие каналов при перезаведении), а не на сутки, поэтому
 * память ограничена и старые ключи вытесняются по очереди прихода.
 */
const SEEN_LIMIT = 500;

/** Ключи `канал#номер`, уже обработанные. Map хранит порядок вставки. */
const seenMessages = new Map<string, true>();
/** Наибольший номер сообщения, виденный в канале, — им ловим опоздавшие. */
const maxMessageByChannel = new Map<string, number>();

export interface ChannelRecord {
  book: string;
  /** Срок действия канала (ISO); `null` — неизвестен. */
  expiresAt: string | null;
  /**
   * Откуда узнали срок: `registration` — Google назвал его в ответе на watch,
   * `assumed` — не назвал, и мы держимся запрошенного, `notification` — узнали
   * из заголовка уведомления (канал пережил перезапуск сервера).
   */
  knownFrom: 'registration' | 'assumed' | 'notification';
  registeredAt: string | null;
  lastMessageAt: string | null;
  lastState: string | null;
  messages: number;
  /** Ресурс помечен удалённым (trash/remove) — наблюдение теряется. */
  gone: boolean;
}

/** Канал на книгу: ключ — идентификатор канала. */
const channels = new Map<string, ChannelRecord & { fileId: string | null; resourceId: string | null }>();

export interface WebhookCounters {
  /** Прошли проверку секрета. */
  received: number;
  rejected: number;
  malformed: number;
  unconfigured: number;
  sync: number;
  refresh: number;
  coalesced: number;
  duplicate: number;
  late: number;
  unrelated: number;
  ignored: number;
  gone: number;
  /** Сколько раз перечитка действительно запускалась. */
  refreshRuns: number;
  refreshFailures: number;
  /** Сколько уведомлений пришло по каждому состоянию. */
  byState: Record<string, number>;
}

function emptyCounters(): WebhookCounters {
  return {
    received: 0,
    rejected: 0,
    malformed: 0,
    unconfigured: 0,
    sync: 0,
    refresh: 0,
    coalesced: 0,
    duplicate: 0,
    late: 0,
    unrelated: 0,
    ignored: 0,
    gone: 0,
    refreshRuns: 0,
    refreshFailures: 0,
    byState: {},
  };
}

/**
 * Учёт подходов к каналам: сколько заведено впервые, сколько перезаведено к
 * сроку, сколько книг не далось и когда был последний подход. Без этих чисел
 * вопрос «почему книга молчит вторые сутки» решается чтением журнала за двое
 * суток, а с ними — одним взглядом на маршрут состояния: подход был вчера,
 * продлений ноль, отказов восемь.
 */
export interface RegistrationStats {
  created: number;
  renewed: number;
  failed: number;
  lastAt: string | null;
}

function emptyRegistrations(): RegistrationStats {
  return { created: 0, renewed: 0, failed: 0, lastAt: null };
}

let registrations = emptyRegistrations();
let counters = emptyCounters();
let lastNotificationAt: string | null = null;
let lastDecision: NotificationDecision | NotificationRefusal | null = null;
let lastRefreshAt: string | null = null;

/** Сбросить всю память модуля — для стражей. */
export function resetWebhookChannelState(): void {
  seenMessages.clear();
  maxMessageByChannel.clear();
  channels.clear();
  counters = emptyCounters();
  registrations = emptyRegistrations();
  lastNotificationAt = null;
  lastDecision = null;
  lastRefreshAt = null;
}

function remember(key: string): void {
  seenMessages.set(key, true);
  if (seenMessages.size > SEEN_LIMIT) {
    const oldest = seenMessages.keys().next();
    if (!oldest.done) seenMessages.delete(oldest.value);
  }
}

function touchChannel(n: DriveNotification, now: string): void {
  const existing = channels.get(n.channelId);
  const book = bookByFileId(n.fileId) ?? existing?.book ?? 'книга вне списка наблюдения';
  const record = existing ?? {
    book,
    fileId: n.fileId,
    resourceId: n.resourceId || null,
    expiresAt: null,
    knownFrom: 'notification' as const,
    registeredAt: null,
    lastMessageAt: null,
    lastState: null,
    messages: 0,
    gone: false,
  };
  record.book = book;
  record.fileId ??= n.fileId;
  record.resourceId ??= n.resourceId || null;
  record.lastMessageAt = now;
  record.lastState = n.resourceState;
  record.messages += 1;
  // Срок из заголовка — единственный источник правды о канале, заведённом в
  // прошлой жизни процесса: после перезапуска сервера реестр пуст, а канал в
  // Drive жив и продолжает слать уведомления. Он же исправляет наше допущение,
  // когда Google не назвал срок в ответе на watch: первое же сообщение канала
  // (подтверждение sync приходит сразу) приносит настоящий срок.
  if (n.expiresAt && (!record.expiresAt || record.knownFrom !== 'registration')) {
    record.expiresAt = n.expiresAt;
    if (record.knownFrom === 'assumed') record.knownFrom = 'notification';
  }
  if (GONE_STATES.has(n.resourceState)) record.gone = true;
  if (n.resourceState === 'untrash') record.gone = false;
  channels.set(n.channelId, record);
}

/**
 * Учесть уведомление и сказать, что с ним делать.
 *
 * `alreadyArmed` — взведена ли уже отложенная перечитка: от этого зависит,
 * «перечитали» или «схлопнули». Дедупликация идёт по паре канал+номер
 * сообщения: одно и то же сообщение Google повторяет при неудачной доставке, а
 * при перезаведении канала одну правку объявляют сразу два канала.
 */
export function noteNotification(
  n: DriveNotification,
  alreadyArmed: boolean,
  now: Date = new Date(),
): NotificationDecision {
  const at = now.toISOString();
  counters.received += 1;
  counters.byState[n.resourceState] = (counters.byState[n.resourceState] ?? 0) + 1;
  lastNotificationAt = at;
  touchChannel(n, at);

  const decide = (): NotificationDecision => {
    if (n.messageNumber !== null) {
      const key = `${n.channelId}#${n.messageNumber}`;
      if (seenMessages.has(key)) return 'duplicate';
      const seenMax = maxMessageByChannel.get(n.channelId);
      remember(key);
      if (seenMax !== undefined && n.messageNumber < seenMax) return 'late';
      maxMessageByChannel.set(n.channelId, Math.max(seenMax ?? 0, n.messageNumber));
    }

    if (n.resourceState === 'sync') return 'sync';
    if (GONE_STATES.has(n.resourceState)) {
      counters.gone += 1;
      // Книга ушла из-под наблюдения — перечитать всё равно надо: продукт обязан
      // честно показать источник непрочитанным, а не держать вчерашние строки.
      return alreadyArmed ? 'coalesced' : 'refresh';
    }
    if (REFRESHING_STATES.has(n.resourceState)) {
      if (!touchesData(n.changed)) return 'unrelated';
      return alreadyArmed ? 'coalesced' : 'refresh';
    }
    return 'ignored';
  };

  const decision = decide();
  counters[decision] += 1;
  lastDecision = decision;
  return decision;
}

/** Учесть отказ, случившийся до разбора уведомления. */
export function noteRefusal(kind: NotificationRefusal): void {
  counters[kind] += 1;
  lastDecision = kind;
}

/** Учесть итог запущенной перечитки. */
export function noteRefreshRun(ok: boolean, now: Date = new Date()): void {
  counters.refreshRuns += 1;
  if (!ok) counters.refreshFailures += 1;
  lastRefreshAt = now.toISOString();
}

// ---------------------------------------------------------------------------
// Снимок состояния для маршрута
// ---------------------------------------------------------------------------

/** За сколько до истечения канал считается «доживающим». */
export const EXPIRING_SOON_MS = 2 * 60 * 60 * 1000;

export type ChannelHealthState = 'active' | 'expiring' | 'expired' | 'gone' | 'unknown';

export interface ChannelHealthItem {
  book: string;
  state: ChannelHealthState;
  expiresAt: string | null;
  /**
   * Откуда известен срок. Различие не косметическое: `assumed` значит, что
   * Google срока не назвал и мы держимся запрошенного — такому сроку веры
   * меньше, и молчащая книга при нём объясняется иначе.
   */
  knownFrom: ChannelRecord['knownFrom'] | null;
  /** Сколько секунд каналу осталось; `null` — срок неизвестен. */
  secondsLeft: number | null;
  lastMessageAt: string | null;
  lastState: string | null;
  messages: number;
}

export interface WebhookChannelState {
  /** Настроены ли адрес и секрет: без них push выключен и работает опрос. */
  configured: boolean;
  channels: {
    state: 'ok' | 'degraded' | 'unknown';
    summary: string;
    watched: number;
    active: number;
    expiring: number;
    expired: number;
    items: ChannelHealthItem[];
    /** Подходы к продлению: заведено, перезаведено, не далось, когда. */
    registrations: RegistrationStats;
  };
  notifications: WebhookCounters & {
    lastAt: string | null;
    lastDecision: NotificationDecision | NotificationRefusal | null;
  };
  refresh: {
    debounceSeconds: number;
    lastRunAt: string | null;
  };
}

function healthOf(record: ChannelRecord, nowMs: number): ChannelHealthItem {
  const expiresMs = record.expiresAt ? Date.parse(record.expiresAt) : Number.NaN;
  const secondsLeft = Number.isFinite(expiresMs) ? Math.round((expiresMs - nowMs) / 1000) : null;
  let state: ChannelHealthState;
  if (record.gone) state = 'gone';
  else if (secondsLeft === null) state = 'unknown';
  else if (secondsLeft <= 0) state = 'expired';
  else if (secondsLeft * 1000 <= EXPIRING_SOON_MS) state = 'expiring';
  else state = 'active';
  return {
    book: record.book,
    state,
    expiresAt: record.expiresAt,
    knownFrom: record.expiresAt ? record.knownFrom : null,
    secondsLeft,
    lastMessageAt: record.lastMessageAt,
    lastState: record.lastState,
    messages: record.messages,
  };
}

/**
 * Кто из записей на одну книгу «главнее». Живой канал (любой, кроме ушедшего
 * ресурса) всегда важнее записи о корзине; между живыми побеждает тот, чей срок
 * дальше, — он и наблюдает.
 */
function rank(item: ChannelHealthItem): number {
  const alive = item.state === 'gone' ? 0 : 1;
  return alive * 1e15 + (item.secondsLeft ?? -1);
}

/**
 * Состояние каналов на сейчас. Книга без канала попадает сюда со состоянием
 * `unknown` — молчащее наблюдение обязано быть видно, а не исчезнуть из списка
 * и тем самым улучшить картину (тот же принцип, что в /api/health).
 */
export function webhookChannelState(now: Date = new Date()): WebhookChannelState {
  const nowMs = now.getTime();
  const books = watchedBooks();
  const byBook = new Map<string, ChannelHealthItem>();

  for (const record of channels.values()) {
    const item = healthOf(record, nowMs);
    const previous = byBook.get(item.book);
    // На книгу может быть жив не один канал (перекрытие при перезаведении):
    // показываем тот, что действует дольше, — именно он и наблюдает. Но запись
    // об ушедшем ресурсе (trash/remove) не вытесняет живой канал, даже если её
    // срок формально длиннее: книгу вернули из корзины и завели новый канал —
    // значит наблюдение живо, и показывать «без наблюдения» было бы неправдой.
    if (!previous || rank(item) > rank(previous)) byBook.set(item.book, item);
  }
  for (const { book } of books) {
    if (!byBook.has(book)) {
      byBook.set(book, {
        book,
        state: 'unknown',
        expiresAt: null,
        knownFrom: null,
        secondsLeft: null,
        lastMessageAt: null,
        lastState: null,
        messages: 0,
      });
    }
  }

  const items = [...byBook.values()].sort((a, b) => a.book.localeCompare(b.book, 'ru'));
  const active = items.filter((i) => i.state === 'active').length;
  const expiring = items.filter((i) => i.state === 'expiring').length;
  const expired = items.filter((i) => i.state === 'expired' || i.state === 'gone').length;
  const unknown = items.filter((i) => i.state === 'unknown').length;
  const configured = Boolean(config.webhook.publicUrl && config.webhook.secret);

  let state: 'ok' | 'degraded' | 'unknown';
  let summary: string;
  if (!configured) {
    state = 'unknown';
    summary = 'Push-каналы выключены — правки доезжают периодическим опросом';
  } else if (unknown === items.length) {
    state = 'unknown';
    summary = 'Каналы ещё не заводились с запуска сервера';
  } else if (expired === 0 && unknown === 0) {
    state = 'ok';
    summary = expiring > 0
      ? `Наблюдение живо: ${active} из ${items.length}, скоро продлевать ${expiring}`
      : `Наблюдение живо: все ${items.length}`;
  } else {
    state = 'degraded';
    const silent = items
      .filter((i) => i.state === 'expired' || i.state === 'gone' || i.state === 'unknown')
      .map((i) => i.book)
      .join(', ');
    summary = `Наблюдают ${active + expiring} из ${items.length}. Без наблюдения: ${silent}`;
  }

  return {
    configured,
    channels: {
      state,
      summary,
      watched: items.length,
      active,
      expiring,
      expired,
      items,
      registrations: { ...registrations },
    },
    notifications: { ...counters, byState: { ...counters.byState }, lastAt: lastNotificationAt, lastDecision },
    refresh: { debounceSeconds: Math.round(webhookTuning.debounceMs / 1000), lastRunAt: lastRefreshAt },
  };
}

// ---------------------------------------------------------------------------
// Регистрация и продление каналов
// ---------------------------------------------------------------------------

export interface WatchLog {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}

export interface WatchResult {
  channelId: string;
  resourceId: string;
  /** Срок, назначенный Google (мс эпохи); `null` — не назвал. */
  expirationMs: number | null;
}

/** Тонкая обёртка над Drive: подменяется в стражах, чтобы не ходить в сеть. */
export interface WatchApi {
  watch(input: { fileId: string; channelId: string; address: string; token: string; expirationMs: number }): Promise<WatchResult>;
  stop(input: { channelId: string; resourceId: string }): Promise<void>;
}

function googleWatchApi(): WatchApi {
  const drive = google.drive({
    version: 'v3',
    auth: new google.auth.GoogleAuth({
      credentials: {
        client_email: config.google.serviceAccountEmail,
        private_key: config.google.privateKey,
      },
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets.readonly',
        'https://www.googleapis.com/auth/drive.readonly',
      ],
    }),
  });
  return {
    async watch({ fileId, channelId, address, token, expirationMs }) {
      const res = await drive.files.watch({
        fileId,
        requestBody: {
          id: channelId,
          type: 'web_hook',
          address,
          token,
          expiration: String(expirationMs),
        },
      });
      const granted = Number(res.data.expiration);
      return {
        channelId: res.data.id ?? channelId,
        resourceId: res.data.resourceId ?? '',
        expirationMs: Number.isFinite(granted) && granted > 0 ? granted : null,
      };
    },
    async stop({ channelId, resourceId }) {
      await drive.channels.stop({ requestBody: { id: channelId, resourceId } });
    },
  };
}

/** За сколько до истечения канал перезаводится. */
export const RENEW_SKEW_MS = 60 * 60 * 1000;
/** Раньше этого срока следующий подход не назначается — защита от частого цикла. */
const MIN_SLEEP_MS = 5 * 60 * 1000;
/** Через сколько повторить подход, если какая-то книга не далась. */
const RETRY_AFTER_FAILURE_MS = 10 * 60 * 1000;

/**
 * Когда просыпаться в следующий раз: за `RENEW_SKEW_MS` до самого раннего
 * истечения. Если что-то не далось — раньше, но не чаще `MIN_SLEEP_MS`;
 * если сроков не знаем вовсе — через срок повтора.
 */
export function nextWakeMs(
  expirations: readonly (number | null)[],
  hadFailures: boolean,
  nowMs: number,
): number {
  const known = expirations.filter((e): e is number => typeof e === 'number' && e > nowMs);
  const byExpiry = known.length > 0 ? Math.min(...known) - RENEW_SKEW_MS - nowMs : RETRY_AFTER_FAILURE_MS;
  const wanted = hadFailures ? Math.min(byExpiry, RETRY_AFTER_FAILURE_MS) : byExpiry;
  return Math.max(wanted, MIN_SLEEP_MS);
}

/** Нужно ли перезаводить канал на книгу прямо сейчас. */
function needsRenewal(record: { expiresAt: string | null } | undefined, nowMs: number): boolean {
  if (!record?.expiresAt) return true;
  const expiresMs = Date.parse(record.expiresAt);
  if (!Number.isFinite(expiresMs)) return true;
  return expiresMs - nowMs <= RENEW_SKEW_MS;
}

function channelForFile(fileId: string): { channelId: string; record: ChannelRecord & { resourceId: string | null } } | undefined {
  for (const [channelId, record] of channels) {
    if (record.fileId === fileId && !record.gone) return { channelId, record };
  }
  return undefined;
}

export interface RegisterOutcome {
  registered: string[];
  kept: string[];
  failed: string[];
  /** Сроки всех живых каналов — по ним назначается следующий подход. */
  expirations: (number | null)[];
}

/**
 * Завести или продлить каналы на все наблюдаемые книги.
 *
 * Отказ одной книги не отменяет остальные: каждая обрабатывается своим
 * try/catch, а внутри — повтор с растущей задержкой при 429/5xx (документация
 * Drive о квотах; готовый повтор из sheets-retry). Прежний канал гасится ПОСЛЕ
 * успешного заведения нового: сначала преемник, потом отставка, иначе между
 * двумя вызовами образуется дыра, в которую правка провалится молча.
 */
export async function registerWatchChannels(
  log: WatchLog,
  api: WatchApi = googleWatchApi(),
  now: Date = new Date(),
): Promise<RegisterOutcome> {
  const { publicUrl, secret } = config.webhook;
  const outcome: RegisterOutcome = { registered: [], kept: [], failed: [], expirations: [] };
  if (!publicUrl || !secret) return outcome;

  const address = `${publicUrl.replace(/\/$/, '')}/api/webhook/drive`;
  const nowMs = now.getTime();

  for (const { book, fileId } of watchedBooks()) {
    const current = channelForFile(fileId);
    if (current && !needsRenewal(current.record, nowMs)) {
      outcome.kept.push(book);
      outcome.expirations.push(current.record.expiresAt ? Date.parse(current.record.expiresAt) : null);
      continue;
    }

    const channelId = randomUUID();
    try {
      const result = await withSheetsRetry(
        `заведение канала на книгу «${book}»`,
        () => api.watch({
          fileId,
          channelId,
          address,
          token: secret,
          expirationMs: nowMs + webhookTuning.channelTtlMs,
        }),
        { onRetry: ({ attempt, delayMs }) => log.warn(`Канал на книгу «${book}»: повтор ${attempt} через ${delayMs} мс`) },
      );

      // Срок берём назначенный Google, а не запрошенный: он вправе выдать меньше.
      // Если срока в ответе нет, держимся запрошенного и помечаем допущением.
      // Оставить `null` значило бы «срок неизвестен» — а неизвестный срок наш же
      // расчёт следующего подхода читает как «продлевать прямо сейчас», и канал
      // перезаводился бы каждые десять минут, сжигая квоту на ровном месте.
      // Допущение живёт недолго: подтверждение sync приносит настоящий срок
      // заголовком X-Goog-Channel-Expiration.
      const grantedMs = result.expirationMs ?? nowMs + webhookTuning.channelTtlMs;
      const expiresAt = new Date(grantedMs).toISOString();
      channels.set(result.channelId, {
        book,
        fileId,
        resourceId: result.resourceId || null,
        expiresAt,
        knownFrom: result.expirationMs ? 'registration' : 'assumed',
        registeredAt: now.toISOString(),
        lastMessageAt: null,
        lastState: null,
        messages: 0,
        gone: false,
      });
      outcome.registered.push(book);
      outcome.expirations.push(grantedMs);
      if (current) registrations.renewed += 1;
      else registrations.created += 1;

      if (current && current.channelId !== result.channelId) {
        await retireChannel(current.channelId, api, log, book);
      }
    } catch (err) {
      // Идентификатор книги в текст не попадает — только человеческое название.
      log.warn(`Канал на книгу «${book}» не заведён: ${(err as Error).message}`);
      outcome.failed.push(book);
      registrations.failed += 1;
    }
  }
  registrations.lastAt = now.toISOString();

  const total = outcome.registered.length + outcome.kept.length;
  log.info(
    `Push-каналы Drive: наблюдают ${total} из ${watchedBooks().length}`
    + ` (заведено ${outcome.registered.length}, действуют ${outcome.kept.length}`
    + (outcome.failed.length > 0 ? `, не удалось: ${outcome.failed.join(', ')}` : '')
    + ')',
  );
  return outcome;
}

/**
 * Погасить прежний канал. Документация Drive прямо предупреждает о периоде
 * перекрытия, когда на одну правку отвечают два канала; без остановки каждое
 * продление удваивало бы поток уведомлений, и через неделю на правку прилетало
 * бы семь POST вместо одного. Неудача остановки не валит продление: канал всё
 * равно умрёт по сроку, а дубли ловит дедупликация.
 */
async function retireChannel(channelId: string, api: WatchApi, log: WatchLog, book: string): Promise<void> {
  const record = channels.get(channelId);
  channels.delete(channelId);
  maxMessageByChannel.delete(channelId);
  if (!record?.resourceId) return;
  try {
    await api.stop({ channelId, resourceId: record.resourceId });
  } catch (err) {
    log.warn(`Прежний канал книги «${book}» не остановлен: ${(err as Error).message}`);
  }
}

let lifecycleTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;

/**
 * Включить push-режим: завести каналы и просыпаться к сроку их истечения.
 *
 * Расписание идёт ОТ СРОКА, а не от постоянного интервала: Google назначает
 * срок сам и вправе выдать меньше запрошенного, и жёсткие «раз в 20 часов»
 * означают день молчания в тот раз, когда он выдаст двенадцать. Без адреса и
 * секрета не делает ничего — работает опрос: push ускорение, а не единственный
 * путь.
 */
export function startWebhookChannels(log: WatchLog, api?: WatchApi): void {
  const { publicUrl, secret } = config.webhook;
  if (!publicUrl || !secret) {
    log.info('Push-каналы Drive выключены (нет WEBHOOK_PUBLIC_URL/WEBHOOK_SECRET) — работает периодический опрос');
    return;
  }
  if (!publicUrl.startsWith('https://')) {
    log.warn('Push-каналы Drive не включены: Google принимает только HTTPS-адрес');
    return;
  }
  if (running) return;
  running = true;
  void lifecycleTick(log, api);
}

async function lifecycleTick(log: WatchLog, api?: WatchApi): Promise<void> {
  if (!running) return;
  let sleepMs = RETRY_AFTER_FAILURE_MS;
  try {
    const outcome = await registerWatchChannels(log, api ?? googleWatchApi());
    sleepMs = nextWakeMs(outcome.expirations, outcome.failed.length > 0, Date.now());
  } catch (err) {
    // Отказ Google не роняет цикл: следующий подход уже назначен.
    log.warn(`Подход к каналам Drive не удался: ${(err as Error).message}`);
  }
  if (!running) return;
  lifecycleTimer = setTimeout(() => { void lifecycleTick(log, api); }, sleepMs);
  lifecycleTimer.unref?.();
}

/**
 * Подойти к каналам немедленно, не дожидаясь срока.
 *
 * Нужно ровно в одном случае: список наблюдаемых книг сменился на ходу —
 * управлению подставили другую книгу через настройку источников. Расписание
 * идёт от срока истечения, то есть новая книга осталась бы без наблюдения до
 * следующего подхода, а это часы. Ручка вызывается тем, кто меняет источник;
 * пока push выключен, она молчит.
 */
export function rescheduleWebhookChannels(log: WatchLog, api?: WatchApi): void {
  if (!running) return;
  if (lifecycleTimer) {
    clearTimeout(lifecycleTimer);
    lifecycleTimer = null;
  }
  void lifecycleTick(log, api);
}

/** Остановить расписание. Сами каналы умрут по сроку — это штатно. */
export function stopWebhookChannels(): void {
  running = false;
  if (lifecycleTimer) {
    clearTimeout(lifecycleTimer);
    lifecycleTimer = null;
  }
}
