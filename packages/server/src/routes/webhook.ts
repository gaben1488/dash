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
import { refreshMonitoringBook } from '../services/monitoring.js';
import { publishLiveEvent } from '../services/event-bus.js';
import {
  readDriveNotification,
  isWellFormed,
  noteNotification,
  noteRefusal,
  noteRefreshRun,
  webhookChannelState,
  bookByFileId,
  SVOD_BOOK_NAME,
  type DriveNotification,
  type NotificationDecision,
} from '../services/webhook-channel.js';
import {
  EMPTY_PLAN,
  describePlan,
  mergePlans,
  planForFile,
  type RefreshPlan,
} from '../services/refresh-targets.js';
import {
  enqueueNotification,
  noteAttemptFailed,
  pendingNotifications,
  queueStats,
  settleAfterRefresh,
  settleMonitoring,
  type QueueEntry,
} from '../services/webhook-queue.js';
import { refreshCommentsForBooks } from '../services/drive-comments.js';

interface RouteLog {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}

let pending: ReturnType<typeof setTimeout> | null = null;
/**
 * Что накопила текущая серия уведомлений. Раньше здесь был только факт
 * «перечитка взведена», и склеенная серия всегда означала одно и то же —
 * прочитать ВСЁ. Теперь серия помнит цели: правка в книге УО не тащит за собой
 * ещё семь книг, лист СВОД и одиннадцать листов мониторинга.
 */
let pendingPlan: RefreshPlan = EMPTY_PLAN;

/**
 * Перечитать книгу мониторинга и объявить результат в эфир.
 *
 * Отдельной функцией, а не строкой в теле таймера: у неё три разных исхода, и
 * каждый обязан быть назван в журнале своим словом. «Не читали» — не ошибка и
 * не тишина, а самый дешёвый и самый частый успех.
 */
function refreshMonitoring(log: RouteLog, claimed: readonly QueueEntry[] = []): void {
  void refreshMonitoringBook()
    .then((r) => {
      // «Не читали, потому что не менялась» — успех, а не отказ: цель записи
      // очереди достигнута тем, что состояние сверено с Drive.
      settleMonitoring(claimed, true);
      if (!r.read) {
        log.info(`Вебхук: книга мониторинга не перечитана — ${r.skippedBecause ?? 'изменений нет'}`);
        return;
      }
      if (r.changed.length === 0) {
        log.info('Вебхук: книга мониторинга перечитана, содержимое прежнее — эфир молчит');
        return;
      }
      publishLiveEvent({
        kind: 'monitoring-updated',
        sheets: r.changed,
        version: r.version,
        origin: 'webhook',
      });
      log.info(`Вебхук: книга мониторинга перечитана, изменились листы: ${r.changed.join(', ')}`);
    })
    .catch((err: unknown) => {
      // Упавшее чтение НЕ помечается выполненным: запись остаётся в очереди
      // и будет повторена (проект службы §2.3).
      settleMonitoring(claimed, false, (err as Error).message);
      scheduleQueueRetry(log);
      log.warn(`Вебхук: книга мониторинга не прочитана: ${(err as Error).message}`);
    });
}

/** Взведена ли отложенная перечитка прямо сейчас. */
export function isRefreshArmed(): boolean {
  return pending !== null;
}

/** Что перечитает взведённая серия — для журнала и тестов. */
export function armedPlan(): RefreshPlan {
  return pendingPlan;
}

/**
 * Добавить цель к взведённой серии.
 *
 * Отдельно от `scheduleRefresh`, потому что цель копится и у тех уведомлений,
 * которые уже схлопнулись с идущей серией: две правки в разных книгах за одно
 * окно склейки — это две книги в одном цикле, а не одна книга и потерянная
 * вторая правка.
 */
function noteTarget(fileId: string | null): void {
  pendingPlan = mergePlans([pendingPlan, planForFile(fileId)]);
}

/**
 * Через сколько повторить чтение по записям, оставшимся в очереди. Отдельно от
 * окна склейки: склейка бережёт квоту при шквале правок, повтор — отвечает за
 * то, что упавшее чтение не потеряется (проект службы §2.3).
 */
export const QUEUE_RETRY_MS = 60_000;

let retryTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Назначить повтор по невыполненным записям очереди. Один таймер на все:
 * пять упавших книг — один повторный цикл, а не пять. Повтор строит цель
 * заново из самих записей — им, а не памяти процесса, ведётся счёт.
 */
function scheduleQueueRetry(log: RouteLog): void {
  if (retryTimer || pending) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    try {
      const entries = pendingNotifications();
      if (entries.length === 0) return;
      for (const entry of entries) noteTarget(entry.fileId);
      log.info(`Вебхук: повтор по очереди — невыполненных записей ${entries.length}`);
      scheduleRefresh(log);
    } catch (err) {
      log.warn(`Вебхук: повтор по очереди не назначен: ${(err as Error).message}`);
    }
  }, QUEUE_RETRY_MS);
  retryTimer.unref?.();
}

/**
 * Поднять невыполненные записи очереди после рестарта: уведомление, принятое
 * прежней жизнью процесса и не дочитанное, обязано дочитаться, а не ждать
 * планового опроса. Вызывается при старте сервера (app.ts).
 */
export function recoverWebhookQueue(log: RouteLog): number {
  const entries = pendingNotifications();
  if (entries.length === 0) return 0;
  for (const entry of entries) noteTarget(entry.fileId);
  log.info(`Вебхук: в очереди ${entries.length} недочитанных уведомлений прежней жизни — перечитка взведена`);
  scheduleRefresh(log);
  return entries.length;
}

/**
 * Прочитать комментарии-облачка книг, задетых этим циклом (решение §17.2):
 * уведомление о книге — повод забрать и её комментарии. Отказ не валит ничего:
 * комментарии — причинный слой, ночной обход и ручная перечитка их доберут.
 */
function refreshCommentsForPlan(plan: RefreshPlan, log: RouteLog): void {
  const targets = plan.full
    ? ('all' as const)
    : [...plan.books, ...(plan.svod ? [SVOD_BOOK_NAME] : [])];
  if (targets !== 'all' && targets.length === 0) return;
  void refreshCommentsForBooks(targets, log).catch((err: unknown) => {
    log.warn(`Вебхук: комментарии книг не прочитаны: ${(err as Error).message}`);
  });
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
    const plan = pendingPlan;
    pendingPlan = EMPTY_PLAN;
    // Записи очереди, судьбу которых решает ЭТОТ цикл. Снимок берётся на
    // старте: уведомление, пришедшее во время цикла, взведёт свой таймер и
    // будет решено своим циклом — чужой результат ему не ответ.
    const claimed = pendingNotifications();
    // Тело таймера обёрнуто целиком: исключение, вылетевшее ЗДЕСЬ, некому
    // поймать — обработчик запроса давно ответил, и необработанный отказ в
    // колбэке таймера уносит весь процесс. Одна не перечитанная книга не имеет
    // права стоить сервера.
    try {
      // Книга мониторинга под тем же наблюдением Drive, но в цикл
      // refreshAllSources не входит — её перечитка живёт здесь (п.66 «прямой
      // эфир»). Три отличия от прежнего «сбросить кэш и ждать запроса»:
      //   • книга читается СРАЗУ, а не при следующем открытии вкладки —
      //     читателю не приходится обновлять страницу, чтобы увидеть правку;
      //   • перед чтением спрашивается отметка версии файла у Drive: файл не
      //     менялся — не читаем вовсе (запрос вместо мегабайтов грида);
      //   • изменившиеся листы уходят в эфир поимённо, а не молча.
      // Перечитка идёт ТОЛЬКО когда правка была в этой книге: раньше правка в
      // книге УО стоила ещё и полного перечитывания одиннадцати листов.
      if (plan.full || plan.monitoring) refreshMonitoring(log, claimed);

      // Цель без единой книги и без листа СВОД (правили только мониторинг) —
      // это законный повод не трогать цикл источников вовсе.
      if (!plan.full && plan.books.length === 0 && !plan.svod) {
        noteRefreshRun(true);
        log.info(`Вебхук: перечитано адресно — ${describePlan(plan)}`);
        return;
      }

      // Происхождение перечитки едет в живые события: читателю на экране важно
      // отличать «правку заметили сразу» от планового цикла опроса. Отказ Google
      // не роняет цикл — следующее уведомление взведёт перечитку заново.
      // `fresh` — чтение ПОСЛЕ уведомления: присоединиться к уже идущему циклу
      // значит принять его результат за ответ на правку, о которой он не знал.
      void refreshAllSources(log, 'webhook', {
        fresh: true,
        books: plan.full ? undefined : plan.books,
        svod: plan.full ? true : plan.svod,
      })
        .then((r) => {
          noteRefreshRun(r.failed.length === 0);
          // Судьба записей очереди: чья цель прочитана — выполнены, чья
          // упала — остаются и повторяются (проект службы §2.3).
          const settled = settleAfterRefresh(claimed, { failed: r.failed, svodOk: r.svodOk });
          if (settled.kept.length > 0) scheduleQueueRetry(log);
          // Комментарии-облачка задетых книг — вместе с перечиткой (§17.2).
          refreshCommentsForPlan(plan, log);
          const moved = [...r.changedBooks, ...(r.svodChanged ? ['лист СВОД'] : [])];
          log.info(
            `Вебхук: перечитано ${describePlan(plan)} — книг ${r.booksRead}`
            + (r.failed.length ? `, не прочитано: ${r.failed.join(', ')}` : '')
            + (moved.length ? `, изменилось: ${moved.join(', ')}` : ', изменений нет')
            + (settled.kept.length ? `, в очереди осталось ${settled.kept.length}` : ''),
          );
        })
        .catch((err: unknown) => {
          noteRefreshRun(false);
          // Цикл упал целиком — все взятые записи (кроме мониторинговых, у
          // них свой путь) остаются в очереди со счётом попытки.
          noteAttemptFailed(
            claimed
              .filter((e) => {
                const p = planForFile(e.fileId);
                return p.full || !p.monitoring;
              })
              .map((e) => e.id),
            (err as Error).message,
          );
          scheduleQueueRetry(log);
          log.warn(`Вебхук: перечитка не удалась: ${(err as Error).message}`);
        });
    } catch (err) {
      noteRefreshRun(false);
      scheduleQueueRetry(log);
      log.warn(`Вебхук: перечитку не удалось запустить: ${(err as Error).message}`);
    }
  }, webhookTuning.debounceMs);
  pending.unref?.();
}

/** Для тестов: сбросить взведённый таймер. */
export function cancelPendingWebhookRefresh(): void {
  if (pending) clearTimeout(pending);
  pending = null;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  pendingPlan = EMPTY_PLAN;
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
      // Цель копится и у схлопнувшегося уведомления: «схлопнуто» означает «не
      // назначай второй цикл», а не «забудь, какую книгу правили». Раньше
      // разницы не было — цикл всё равно читал всё.
      if (decision === 'refresh' || decision === 'coalesced') {
        noteTarget(notification.fileId);
        // Очередь — до ответа Google: запись переживает падение процесса, и
        // выполненной её пометит только состоявшееся чтение (проект §2.3).
        // Отказ базы очередь ловит сама и отвечает null — уведомление всё
        // равно принято, сетью безопасности остаётся опрос по расписанию.
        enqueueNotification({
          book,
          fileId: notification.fileId,
          messageNumber: notification.messageNumber,
          channelId: notification.channelId,
          resourceState: notification.resourceState,
        });
      }
      if (decision === 'refresh') scheduleRefresh(log);
      logNotification(request, notification, book, decision);
    } catch (err) {
      // Сбой собственного учёта не имеет права стоить правки. Пятисотка
      // заставила бы Google повторять доставку (документация Drive), но
      // повторять нечего — перечитка асинхронна. Поэтому: честная запись в
      // журнал, перечитка на всякий случай и «принято».
      request.log.warn(`Вебхук: учёт уведомления не удался: ${(err as Error).message}`);
      // Собственный учёт сломался — цель уведомления доверия не заслуживает.
      // Читаем всё: пропустить правку хуже, чем прочитать лишнее. Запись в
      // очередь — тоже, чтобы правка пережила и падение процесса.
      enqueueNotification({
        book,
        fileId: notification.fileId,
        messageNumber: notification.messageNumber,
        channelId: notification.channelId,
        resourceState: notification.resourceState,
      });
      pendingPlan = mergePlans([pendingPlan, planForFile(null)]);
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
  app.get('/api/webhook/drive/state', async () => ({
    ...webhookChannelState(),
    // Очередь уведомлений (проект §2.3): сколько ждёт чтения, с какого
    // момента и сколько попыток упало. Идентификаторов файлов здесь нет.
    queue: queueStats(),
  }));
}
