/**
 * Страж штатного прощания при живом потоке событий — на НАСТОЯЩЕМ сокете.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ПРОГОН, ЕСЛИ В events.test.ts УЖЕ ЕСТЬ «остановка сервера
 * закрывает потоки». Затем, что тот прогон идёт через `app.inject()`, а это
 * подделка соединения: сервер при ней вообще не слушает порт, и `server.close()`
 * никого не ждёт. Именно поэтому он оставался зелёным, пока закрыватель потоков
 * висел на хуке `onClose` — на настоящем сокете это замкнутый круг:
 *
 *   `onClose` наступает ПОСЛЕ того, как все обращения в работе завершены
 *   (документация Fastify, Reference/Hooks.md) → открытый поток событий как раз
 *   и есть обращение, которое не завершается → `server.close()` ждёт поток →
 *   закрыватель потока ждёт `onClose` → не наступает ничего.
 *
 * Наружу это выглядело так: `docker compose down` при хотя бы одной открытой
 * вкладке продукта досиживал до принудительного выхода по сроку
 * (plugins/graceful-shutdown.ts, десять секунд), то есть штатного прощания не
 * происходило никогда. Лечение — хук `preClose`, который наступает ДО ожидания
 * (routes/events.ts).
 *
 * Проверить теорию можно руками: поменять в routes/events.ts `preClose` обратно
 * на `onClose` — этот прогон упадёт по сроку, а events.test.ts останется зелёным.
 */
import { once } from 'node:events';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { eventsRoutes } from './events.js';
import { liveSubscriberCount } from '../services/event-bus.js';

/**
 * Заведомо меньше срока принудительного выхода (десять секунд): прощание должно
 * быть штатным, а не «дождались и убили».
 */
const CLOSE_BUDGET_MS = 3000;

let app: FastifyInstance | undefined;
let response: IncomingMessage | undefined;

afterEach(async () => {
  response?.destroy();
  response = undefined;
  await app?.close().catch(() => undefined);
  app = undefined;
});

/** Настоящее соединение с настоящим слушающим сервером. */
async function openRealStream(instance: FastifyInstance): Promise<IncomingMessage> {
  const { port } = instance.server.address() as AddressInfo;
  const req = httpRequest({ host: '127.0.0.1', port, path: '/api/events', method: 'GET' });
  req.end();
  const [res] = (await once(req, 'response')) as [IncomingMessage];
  // Ждём первой записи: до неё подписка ещё не оформлена, и мерить нечего.
  await once(res, 'data');
  res.resume();
  return res;
}

describe('остановка сервера при живом потоке событий', () => {
  it('завершается штатно и быстро, а не досиживает до принудительного выхода', async () => {
    app = Fastify({ logger: false });
    eventsRoutes(app);
    await app.listen({ port: 0, host: '127.0.0.1' });

    response = await openRealStream(app);
    expect(liveSubscriberCount()).toBe(1);

    const startedAt = Date.now();
    await app.close();
    const elapsed = Date.now() - startedAt;

    console.log(`Прощание при одном живом потоке событий: ${elapsed} мс`);

    expect(elapsed).toBeLessThan(CLOSE_BUDGET_MS);
    // И хвостов не остаётся: подписка снята, поток закрыт.
    expect(liveSubscriberCount()).toBe(0);
    app = undefined;
  }, 30_000);

  it('несколько живых потоков закрытие тоже не держат', async () => {
    app = Fastify({ logger: false });
    eventsRoutes(app);
    await app.listen({ port: 0, host: '127.0.0.1' });

    const streams = [
      await openRealStream(app),
      await openRealStream(app),
      await openRealStream(app),
    ];
    expect(liveSubscriberCount()).toBe(3);

    const startedAt = Date.now();
    await app.close();
    const elapsed = Date.now() - startedAt;

    expect(elapsed).toBeLessThan(CLOSE_BUDGET_MS);
    expect(liveSubscriberCount()).toBe(0);
    for (const s of streams) s.destroy();
    app = undefined;
  }, 30_000);
});
