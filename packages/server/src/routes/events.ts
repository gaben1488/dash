/**
 * GET /api/events — поток живых событий (Server-Sent Events).
 *
 * Почему поток однонаправленный, а не веб-сокет: экрану нужно только СЛЫШАТЬ
 * сервер, отвечать ему нечем. Односторонний поток — обычный HTTP-ответ, который
 * не заканчивается: он проходит через обратный прокси без отдельной настройки
 * обновления протокола, переживает перезапуск сервера (браузер сам подключается
 * заново) и не требует ни библиотеки на сервере, ни библиотеки в браузере.
 *
 * ВАЖНО ДЛЯ ПРОКСИ (deploy/Caddyfile). Caddy отдаёт `text/event-stream` без
 * накопления в буфере сам — специальной директивы `flush_interval -1` в
 * reverse_proxy не требуется, он определяет поток по типу содержимого. Заголовок
 * `X-Accel-Buffering: no` мы шлём всё равно: он ничего не стоит и снимает
 * накопление, если однажды перед сервером окажется nginx. Сжатие (`encode gzip`
 * в Caddy) поток не ломает — Caddy не сжимает event-stream.
 *
 * Что поток обещает и чего не обещает:
 *   • тишина — нормальное состояние. Событий нет — идут только служебные
 *     «пульсы» комментарием, которые браузер даже не показывает обработчику;
 *   • число одновременных потоков ограничено: каждый занимает соединение, и
 *     забытая вкладка не должна съедать их бесконечно;
 *   • после обрыва браузер подключается сам и присылает номер последнего
 *     полученного события (Last-Event-ID) — пропущенное досылается из кольца
 *     шины, а не теряется.
 */
import type { FastifyInstance } from 'fastify';
import {
  liveEventsAfter,
  liveSubscriberCount,
  subscribeLiveEvents,
  type LiveEventEnvelope,
} from '../services/event-bus.js';

/**
 * Потолок одновременных потоков. Читателей у продукта единицы; запас взят на
 * несколько открытых вкладок у каждого. Упершийся в потолок получает честный
 * отказ с объяснением, а не молча висящее соединение.
 */
export const MAX_EVENT_STREAMS = 24;

/**
 * Период служебного «пульса». Двадцать секунд — заметно меньше обычного
 * тайм-аута простоя у прокси (одна-две минуты), поэтому соединение не рвётся,
 * и заметно больше, чтобы не создавать трафик на ровном месте.
 */
export const HEARTBEAT_MS = 20_000;

/**
 * Через сколько браузеру пробовать переподключиться после обрыва. Значение
 * уходит в поток строкой `retry:` — переподключением занимается сам браузер.
 */
const RETRY_MS = 5_000;

/** Одна запись потока: `id`, имя события и полезная нагрузка одной строкой. */
function formatEvent(envelope: LiveEventEnvelope): string {
  const payload = JSON.stringify({ id: envelope.id, at: envelope.at, ...envelope.event });
  return `id: ${envelope.id}\nevent: ${envelope.event.kind}\ndata: ${payload}\n\n`;
}

/** Номер последнего доставленного события: заголовок браузера или ?since=. */
function readLastEventId(header: unknown, since: unknown): number | null {
  const raw = header ?? since;
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function eventsRoutes(app: FastifyInstance): void {
  /**
   * Закрыватели живых потоков. Нужны, чтобы остановка сервера не висела на
   * соединениях, которые по своей природе не заканчиваются. Хук закрытия
   * регистрируется ОДИН раз на маршрут, а не на каждый запрос: иначе список
   * хуков рос бы с каждым подключением.
   *
   * ПОЧЕМУ preClose, А НЕ onClose. Раньше закрыватели висели на `onClose` — и
   * это был замкнутый круг. Документация Fastify (Reference/Hooks.md) описывает
   * порядок прощания прямо: к моменту `onClose` сервер уже перестал слушать И
   * ВСЕ ОБРАЩЕНИЯ В РАБОТЕ ЗАВЕРШЕНЫ. Открытый поток событий — это обращение в
   * работе, которое не завершается никогда; значит, `server.close()` ждал его,
   * `onClose` не наступал, а закрыватель, который единственный мог поток
   * оборвать, ждал `onClose`. Каждый выключатель сервера при хотя бы одной
   * открытой вкладке продукта досиживал до принудительного выхода по сроку
   * (plugins/graceful-shutdown.ts) — то есть штатного прощания не было вовсе.
   *
   * `preClose` наступает РАНЬШЕ: сервер ещё слушает, обращения ещё в работе, и
   * потоки можно оборвать до того, как их начнут ждать. Та же документация
   * называет этот хук ровно для этого случая — «открытые веб-сокеты или потоки
   * событий, которые нужно закрыть явно, иначе `server.close()` не завершится».
   */
  const openStreams = new Set<() => void>();
  app.addHook('preClose', async () => {
    for (const closeStream of [...openStreams]) closeStream();
  });

  app.get('/api/events', (request, reply) => {
    if (liveSubscriberCount() >= MAX_EVENT_STREAMS) {
      return reply.status(503).send({
        error: 'ServiceUnavailable',
        message:
          `Живой поток сейчас держат ${MAX_EVENT_STREAMS} подключений — это потолок. ` +
          'Закройте лишние вкладки продукта и откройте эту заново: числа на экране остаются верными, ' +
          'обновляться сами они пока не будут.',
        statusCode: 503,
      });
    }

    // Дальше отвечаем в сырое соединение: обычный жизненный цикл ответа Fastify
    // рассчитан на ответ, который заканчивается, а этот — не заканчивается.
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Снимает накопление ответа в буфере у прокси-посредников (nginx).
      'X-Accel-Buffering': 'no',
    });

    let closed = false;
    const write = (chunk: string): void => {
      if (closed) return;
      try {
        reply.raw.write(chunk);
      } catch {
        // Соединение оборвалось между проверкой и записью — закрываемся тихо.
        close();
      }
    };

    // Первая запись объявляет период переподключения и подтверждает, что поток
    // жив: без неё браузер узнал бы об этом только с первым событием.
    write(`retry: ${RETRY_MS}\n: поток открыт\n\n`);

    // Догон после обрыва: события, случившиеся, пока связи не было.
    const lastId = readLastEventId(request.headers['last-event-id'], (request.query as Record<string, unknown>)?.since);
    for (const missed of liveEventsAfter(lastId)) write(formatEvent(missed));

    const unsubscribe = subscribeLiveEvents((envelope) => write(formatEvent(envelope)));

    // Пульс — комментарий, а не событие: он держит соединение открытым и при
    // этом не доходит до обработчиков на экране, то есть ничего не мигает.
    const heartbeat = setInterval(() => write(`: пульс ${new Date().toISOString()}\n\n`), HEARTBEAT_MS);
    heartbeat.unref?.();

    function close(): void {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      openStreams.delete(close);
      try {
        reply.raw.end();
      } catch {
        // Сокет уже закрыт другой стороной — закрывать нечего.
      }
    }

    openStreams.add(close);
    request.raw.on('close', close);
    request.raw.on('error', close);
    reply.raw.on('error', close);
  });
}
