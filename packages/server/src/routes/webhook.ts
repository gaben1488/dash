/**
 * Приёмник push-уведомлений Google Drive (канон п.66 «прямой эфир», решение
 * владельца п.69а: домен dash-elizovo-uer.ru — реализуем вебхук-режим).
 *
 * Google шлёт POST без тела с заголовками X-Goog-*: состояние `sync` при
 * создании канала, `update`/`add`/`change` при правке книги, `trash`/`remove`
 * когда книга ушла из-под наблюдения. Аутентификация Google здесь невозможна
 * (ни basic auth, ни Bearer) — канал защищён собственным секретом: при
 * регистрации мы кладём его в token канала, Google возвращает его в
 * X-Goog-Channel-Token с каждым уведомлением. Чужой POST без секрета получает
 * 403 и ничего не запускает.
 *
 * Разделение обязанностей: здесь — только приём, решение об ответе и взвод
 * отложенной перечитки; вся память (какие каналы живы, до какого часа, какие
 * сообщения уже приходили) живёт в services/webhook-channel.ts.
 *
 * Коды ответов выбраны по документации Drive (developers.google.com/workspace/
 * drive/api/guides/push, раздел «Respond to notifications», взято через
 * Context7): 200/201/202/204/102 — «принято», 500/502/503/504 — «повтори с
 * растущей задержкой», любой другой код — «сообщение не доставлено». Поэтому
 * отказ по секрету отвечает 403 (Google не должен ломиться повторно), а
 * внутренний сбой НЕ отвечает пятисоткой: повторять нечего — перечитка
 * асинхронна, — и вместо повтора мы просто взводим её сами.
 */
import type { FastifyInstance } from 'fastify';
import { config, webhookTuning } from '../config.js';
import { safeCompare } from '../middleware/auth.js';
import { refreshAllSources } from '../services/source-refresh.js';
import { invalidateMonitoringCache } from '../services/monitoring.js';
import {
  readDriveNotification,
  isWellFormed,
  noteNotification,
  noteRefusal,
  noteRefreshRun,
  webhookChannelState,
  bookByFileId,
  type DriveNotification,
  type NotificationDecision,
} from '../services/webhook-channel.js';

interface RouteLog {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}

let pending: ReturnType<typeof setTimeout> | null = null;

/** Взведена ли отложенная перечитка прямо сейчас. */
export function isRefreshArmed(): boolean {
  return pending !== null;
}

/**
 * Взводит отложенную перечитку источников.
 *
 * Таймер НЕ перевзводится на каждом уведомлении: при непрерывной правке книги
 * скользящее окно откладывало бы чтение бесконечно, и «прямой эфир» молчал бы
 * ровно тогда, когда данные меняются активнее всего. Первое уведомление серии
 * назначает срок, остальные схлопываются в него.
 */
function scheduleRefresh(log: RouteLog): void {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    // Тело таймера обёрнуто целиком: исключение, вылетевшее ЗДЕСЬ, некому
    // поймать — обработчик запроса давно ответил, и необработанный отказ в
    // колбэке таймера уносит весь процесс. Одна не перечитанная книга не имеет
    // права стоить сервера.
    try {
      // Книга мониторинга под тем же наблюдением Drive, но в цикл
      // refreshAllSources не входит — её кэш сбрасывается здесь, и следующий
      // запрос /api/monitoring перечитает книгу, а не отдаст правку с опозданием
      // до TTL (п.66 «прямой эфир»).
      invalidateMonitoringCache();
      // Происхождение перечитки едет в живые события: читателю на экране важно
      // отличать «правку заметили сразу» от планового цикла опроса. Отказ Google
      // не роняет цикл — следующее уведомление взведёт перечитку заново.
      // `fresh` — чтение ПОСЛЕ уведомления: присоединиться к уже идущему циклу
      // значит принять его результат за ответ на правку, о которой он не знал.
      void refreshAllSources(log, 'webhook', { fresh: true })
        .then((r) => {
          noteRefreshRun(r.failed.length === 0);
          log.info(
            `Вебхук: источники перечитаны (книг ${r.loaded.length}${r.failed.length ? `, не прочитано: ${r.failed.join(', ')}` : ''})`,
          );
        })
        .catch((err: unknown) => {
          noteRefreshRun(false);
          log.warn(`Вебхук: перечитка не удалась: ${(err as Error).message}`);
        });
    } catch (err) {
      noteRefreshRun(false);
      log.warn(`Вебхук: перечитку не удалось запустить: ${(err as Error).message}`);
    }
  }, webhookTuning.debounceMs);
  pending.unref?.();
}

/** Для тестов: сбросить взведённый таймер. */
export function cancelPendingWebhookRefresh(): void {
  if (pending) clearTimeout(pending);
  pending = null;
}

/** Человеческое объяснение решения — для журнала сервера. */
const DECISION_WORDS: Record<NotificationDecision, string> = {
  refresh: 'перечитка взведена',
  coalesced: 'схлопнуто с уже взведённой перечиткой',
  sync: 'подтверждение канала',
  duplicate: 'повтор доставки — пропущено',
  late: 'опоздавшее сообщение — пропущено',
  unrelated: 'правка не тронула данные — пропущено',
  ignored: 'состояние вне словаря — пропущено',
};

/**
 * Структурный след уведомления. Поля вынесены объектом, а не склеены в строку:
 * вопрос «почему книга молчала во вторник» решается выборкой по книге и
 * решению, а не чтением абзацев. Идентификатор файла и секрет в журнал не
 * попадают — только человеческое название книги.
 */
function logNotification(
  request: { log: { info: (obj: object, msg: string) => void } },
  n: DriveNotification,
  book: string,
  decision: NotificationDecision,
): void {
  request.log.info(
    {
      event: 'drive-notification',
      book,
      state: n.resourceState,
      messageNumber: n.messageNumber,
      changed: n.changed,
      decision,
      channelExpiresAt: n.expiresAt,
    },
    `Вебхук: книга «${book}», состояние «${n.resourceState}», сообщение ${n.messageNumber ?? '—'} — ${DECISION_WORDS[decision]}`,
  );
}

export function webhookRoutes(app: FastifyInstance): void {
  /**
   * Тело уведомления нам не нужно — вся правда в заголовках X-Goog-*. Но
   * разбирать его приходится, потому что Google шлёт POST с заголовком
   * `Content-Type: application/json; utf-8` и `Content-Length: 0`, а разборщик
   * JSON по умолчанию на пустое тело отвечает 400 (FST_ERR_CTP_EMPTY_JSON_BODY)
   * ДО того, как обработчик получит управление. Замер 21.08.2026: настоящая
   * форма уведомления Drive получала 400 на всех трёх написаниях типа
   * содержимого — то есть push-контур не работал ни разу, а 400 по документации
   * Drive означает «сообщение не доставлено», и Google даже не повторяет.
   *
   * Разборщик объявлен ЗДЕСЬ, внутри плагина: по документации Fastify
   * (ContentTypeParser, «encapsulated within the scope where it is declared»)
   * он действует только на маршруты вебхука и не меняет разбор тел на всём
   * остальном API. Тело в обоих случаях отбрасывается: маршрут читает
   * заголовки, и притворяться, что нам важно содержимое, незачем.
   */
  const ignoreBody = (_request: unknown, _body: unknown, done: (err: null, body: unknown) => void): void => {
    done(null, {});
  };
  app.addContentTypeParser('application/json', { parseAs: 'string' }, ignoreBody);
  app.addContentTypeParser('*', { parseAs: 'string' }, ignoreBody);

  app.post('/api/webhook/drive', async (request, reply) => {
    const secret = config.webhook.secret;
    if (!secret) {
      // Вебхук не настроен — маршрут закрыт наглухо, а не «открыт по умолчанию».
      noteRefusal('unconfigured');
      return reply.status(404).send();
    }
    // Секрет канала сверяется за постоянное время — тем же сравнением, что и
    // ключ доступа (реестр безопасности 05.06.2026, LOW-1). Маршрут открыт без
    // ключа, значит подбирать секрет по времени ответа можно было снаружи: при
    // прямом `!==` строки расходятся на первом несовпавшем знаке. Заголовок
    // приводится к строке — Fastify отдаёт список, если заголовок пришёл
    // дважды, и такой список никогда не совпал бы с секретом.
    const token = String(request.headers['x-goog-channel-token'] ?? '');
    if (!safeCompare(token, secret)) {
      noteRefusal('rejected');
      // Подробностей в ответе нет и в журнале нет: чем именно не подошёл
      // заголовок — подсказка подбирающему, а не сведения для эксплуатации.
      request.log.warn('Вебхук: уведомление с неверным токеном канала отклонено');
      return reply.status(403).send();
    }

    const notification = readDriveNotification(request.headers as Record<string, unknown>);
    if (!isWellFormed(notification)) {
      noteRefusal('malformed');
      request.log.warn('Вебхук: уведомление без обязательных заголовков отклонено');
      return reply.status(400).send();
    }

    const book = bookByFileId(notification.fileId) ?? 'книга вне списка наблюдения';
    const log: RouteLog = { info: (m) => request.log.info(m), warn: (m) => request.log.warn(m) };

    try {
      const decision = noteNotification(notification, isRefreshArmed());
      if (decision === 'refresh') scheduleRefresh(log);
      logNotification(request, notification, book, decision);
    } catch (err) {
      // Сбой собственного учёта не имеет права стоить правки. Пятисотка
      // заставила бы Google повторять доставку (документация Drive), но
      // повторять нечего — перечитка асинхронна. Поэтому: честная запись в
      // журнал, перечитка на всякий случай и «принято».
      request.log.warn(`Вебхук: учёт уведомления не удался: ${(err as Error).message}`);
      scheduleRefresh(log);
    }
    return reply.status(200).send();
  });

  /**
   * Состояние наблюдения: живы ли каналы, когда истекают, что приходило и чем
   * закончилось. Отдельный маршрут, а не поле в /api/health, потому что здесь
   * счётчики и список книг — это диагностика push-режима, а не признак
   * работоспособности продукта: молчащий канал не делает продукт больным,
   * данные всё равно доедут периодическим опросом.
   *
   * Маршрут не входит в список публичных (middleware/auth.ts), поэтому требует
   * ключ доступа; в публичном режиме только для чтения он открыт как обычный
   * GET — и потому не содержит ни секрета, ни идентификаторов книг.
   */
  app.get('/api/webhook/drive/state', async () => webhookChannelState());
}
