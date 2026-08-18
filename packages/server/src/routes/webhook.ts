/**
 * Приёмник push-уведомлений Google Drive (канон п.66 «прямой эфир», решение
 * владельца п.69а: домен dash-elizovo-uer.ru — реализуем вебхук-режим).
 *
 * Google шлёт POST без тела с заголовками X-Goog-*: состояние `sync` при
 * создании канала, `update`/`change` при правке книги. Аутентификация Google
 * здесь невозможна (ни basic auth, ни Bearer) — канал защищён собственным
 * секретом: при регистрации мы кладём его в token канала, Google возвращает
 * его в X-Goog-Channel-Token с каждым уведомлением. Чужой POST без секрета
 * получает 403 и ничего не запускает.
 *
 * Обработка нарочно дешёвая: уведомление лишь взводит отложенную перечитку
 * источников (debounce): серия правок подряд — один цикл чтения, а не десять.
 */
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { refreshAllSources } from '../services/source-refresh.js';
import { invalidateMonitoringCache } from '../services/monitoring.js';

/** Задержка склейки серии уведомлений в одну перечитку. */
const DEBOUNCE_MS = 15_000;

let pending: ReturnType<typeof setTimeout> | null = null;

/** Взводит (или перевзводит) отложенную перечитку источников. */
function scheduleRefresh(log: { info: (m: string) => void; warn: (m: string) => void }): void {
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    // Книга мониторинга под тем же наблюдением Drive (drive-watch), но в цикл
    // refreshAllSources не входит — её кэш сбрасывается здесь, и следующий
    // запрос /api/monitoring перечитает книгу, а не отдаст правку с опозданием
    // до TTL (п.66 «прямой эфир»).
    invalidateMonitoringCache();
    void refreshAllSources(log)
      .then((r) => log.info(
        `Вебхук: источники перечитаны (книг ${r.loaded.length}${r.failed.length ? `, не прочитано: ${r.failed.join(', ')}` : ''})`,
      ))
      .catch((err: unknown) => log.warn(`Вебхук: перечитка не удалась: ${(err as Error).message}`));
  }, DEBOUNCE_MS);
  pending.unref?.();
}

/** Для тестов: сбросить взведённый таймер. */
export function cancelPendingWebhookRefresh(): void {
  if (pending) clearTimeout(pending);
  pending = null;
}

export function webhookRoutes(app: FastifyInstance): void {
  app.post('/api/webhook/drive', async (request, reply) => {
    const secret = config.webhook.secret;
    if (!secret) {
      // Вебхук не настроен — маршрут закрыт наглухо, а не «открыт по умолчанию».
      return reply.status(404).send();
    }
    const token = request.headers['x-goog-channel-token'];
    if (token !== secret) {
      request.log.warn('Вебхук: уведомление с неверным токеном канала отклонено');
      return reply.status(403).send();
    }

    const state = String(request.headers['x-goog-resource-state'] ?? '');
    const channel = String(request.headers['x-goog-channel-id'] ?? '');
    if (state === 'sync') {
      // Подтверждение создания канала — данных ещё нет, читать нечего.
      request.log.info(`Вебхук: канал ${channel} подтверждён`);
      return reply.status(200).send();
    }

    request.log.info(`Вебхук: изменение источника (канал ${channel}, состояние «${state}») — перечитка через ${DEBOUNCE_MS / 1000} с`);
    scheduleRefresh({ info: (m) => request.log.info(m), warn: (m) => request.log.warn(m) });
    return reply.status(200).send();
  });
}
