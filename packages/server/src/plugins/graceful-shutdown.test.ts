/**
 * Страж прощания сервера.
 *
 * ЗАЧЕМ. `docker compose down`, перезапуск связки и выкатка новой версии шлют
 * SIGTERM. Есть несколько секунд, когда сервер уже прощается, а балансировщик
 * ещё шлёт сюда трафик. Раньше эти обращения молча упирались в закрывающийся
 * сокет: для клиента это оборванное соединение, то есть поломка. Теперь они
 * получают честный отказ 503 с названным сроком повтора — такое клиент
 * переживает.
 *
 * Охраняются обещания:
 *   1. Пока прощания нет — ничего не меняется, все обращения проходят.
 *   2. С началом прощания новые обращения получают 503 общей формы, с
 *      `Retry-After` и с указанием закрыть соединение.
 *   3. Проверка живости продолжает отвечать: оркестратору полезно видеть, что
 *      процесс отвечает и именно прощается, а не завис.
 *   4. Прощание объявляется один раз — второй сигнал ничего не переигрывает.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { registerShutdownGuard } from './graceful-shutdown.js';

let app: FastifyInstance | undefined;

async function makeApp(): Promise<{ app: FastifyInstance; guard: ReturnType<typeof registerShutdownGuard> }> {
  const instance = Fastify({ logger: false });
  const guard = registerShutdownGuard(instance);
  instance.get('/api/dashboard', async () => ({ ok: true }));
  instance.get('/health/live', async () => ({ status: 'ok' }));
  await instance.ready();
  app = instance;
  return { app: instance, guard };
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('пока прощания нет', () => {
  it('обращения проходят как обычно', async () => {
    const { app: instance, guard } = await makeApp();

    expect(guard.isClosing()).toBe(false);
    const res = await instance.inject({ method: 'GET', url: '/api/dashboard' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});

describe('во время прощания', () => {
  it('новое обращение получает 503 с названным сроком повтора, а не оборванное соединение', async () => {
    const { app: instance, guard } = await makeApp();
    guard.begin();

    const res = await instance.inject({ method: 'GET', url: '/api/dashboard' });
    const body = res.json<Record<string, unknown>>();

    expect(res.statusCode).toBe(503);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(res.headers.connection).toBe('close');
    // Форма — общая для всех отказов сервера (plugins/error-shape.ts).
    expect(body.code).toBe('SERVICE_UNAVAILABLE');
    expect(body.statusCode).toBe(503);
    expect(String(body.message)).toContain('останавливается');
    expect(typeof body.requestId).toBe('string');
  });

  it('проверка живости продолжает отвечать', async () => {
    const { app: instance, guard } = await makeApp();
    guard.begin();

    const res = await instance.inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('прощание объявляется один раз', async () => {
    const { guard } = await makeApp();

    expect(guard.begin()).toBe(true);
    expect(guard.begin()).toBe(false);
    expect(guard.isClosing()).toBe(true);
  });
});
