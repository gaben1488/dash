import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Readable } from 'node:stream';
import { eventsRoutes, MAX_EVENT_STREAMS, HEARTBEAT_MS } from './events.js';
import { publishLiveEvent, resetLiveEventBus, liveSubscriberCount } from '../services/event-bus.js';

/**
 * Страж живого потока GET /api/events (канон п.66 «прямой эфир»).
 *
 * Что обязано быть верным: поток открывается с правильным типом содержимого и
 * не заканчивается; опубликованное событие доезжает до открытого потока;
 * служебный «пульс» держит соединение и при этом НЕ является событием; после
 * обрыва догоняются пропущенные события по номеру; потолок соединений даёт
 * честный отказ, а не молча висящий сокет.
 */

let app: FastifyInstance;

/** Собиратель кусков потока: чтение идёт по мере записи, ответ не заканчивается. */
function collect(stream: Readable): { text: () => string } {
  let text = '';
  stream.on('data', (chunk: Buffer | string) => {
    text += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
  });
  return { text: () => text };
}

/** Дать циклу событий провернуться — записи в поток асинхронны. */
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function openStream(headers: Record<string, string> = {}) {
  const res = await app.inject({ method: 'GET', url: '/api/events', headers, payloadAsStream: true });
  const sink = collect(res.stream());
  await tick();
  return { res, sink };
}

beforeEach(async () => {
  resetLiveEventBus();
  app = Fastify({ logger: false });
  eventsRoutes(app);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  vi.useRealTimers();
  resetLiveEventBus();
});

describe('GET /api/events — живой поток', () => {
  it('поток открывается: тип содержимого event-stream, накопление у прокси снято', async () => {
    const { res } = await openStream();

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/event-stream; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-cache, no-transform');
    expect(res.headers['x-accel-buffering']).toBe('no');
  });

  it('первой строкой объявлен срок переподключения — обрыв лечит сам браузер', async () => {
    const { sink } = await openStream();
    expect(sink.text()).toMatch(/^retry: \d+\n/);
  });

  it('опубликованное событие доезжает до открытого потока целиком', async () => {
    const { sink } = await openStream();

    publishLiveEvent({
      kind: 'book-updated',
      book: 'УО',
      changedRows: 3,
      addedRows: 0,
      removedRows: 0,
      rowsTotal: 512,
      origin: 'webhook',
    });
    await tick();

    const text = sink.text();
    expect(text).toContain('event: book-updated');
    const data = text.split('\n').find((l) => l.startsWith('data: '));
    expect(data).toBeDefined();
    expect(JSON.parse(data!.slice(6))).toMatchObject({
      kind: 'book-updated',
      book: 'УО',
      changedRows: 3,
      origin: 'webhook',
    });
  });

  it('пульс приходит комментарием: соединение живёт, обработчик на экране молчит', async () => {
    // Подменяем ТОЛЬКО периодический таймер: setImmediate нужен настоящий,
    // иначе не провернётся сама запись в поток и тест зависнет на пустом месте.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { sink } = await openStream();
    const before = sink.text();

    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS + 10);

    const added = sink.text().slice(before.length);
    expect(added).toMatch(/^: пульс /);
    // Комментарий — не событие: строки event:/data: в пульсе нет,
    // поэтому на экране ничего не мигает.
    expect(added).not.toContain('event: ');
    expect(added).not.toContain('data: ');
  });

  it('после обрыва досылаются пропущенные события по номеру', async () => {
    const first = publishLiveEvent({ kind: 'snapshot-rebuilt', rows: 3854, issues: 214, year: null });
    publishLiveEvent({ kind: 'issues-appeared', added: 2, total: 216, bySeverity: { critical: 4 } });

    const { sink } = await openStream({ 'last-event-id': String(first.id) });

    const text = sink.text();
    expect(text).toContain('event: issues-appeared');
    expect(text).not.toContain('event: snapshot-rebuilt');
  });

  it('первое подключение прошлое не пересказывает — тишина, а не лента новостей', async () => {
    publishLiveEvent({ kind: 'snapshot-rebuilt', rows: 3854, issues: 214, year: null });

    const { sink } = await openStream();

    expect(sink.text()).not.toContain('event: ');
  });

  it('остановка сервера закрывает потоки и снимает подписки — хвостов не остаётся', async () => {
    await openStream();
    await openStream();
    expect(liveSubscriberCount()).toBe(2);

    // Поток по своей природе не заканчивается, поэтому закрытие сервера обязано
    // закрыть его само — иначе `docker compose down` висел бы на живых вкладках.
    await app.close();
    await tick();

    expect(liveSubscriberCount()).toBe(0);
  });

  it('на потолке соединений отказ честный и по-русски, а не висящий сокет', async () => {
    const streams: Readable[] = [];
    for (let i = 0; i < MAX_EVENT_STREAMS; i++) {
      const res = await app.inject({ method: 'GET', url: '/api/events', payloadAsStream: true });
      const stream = res.stream();
      stream.resume();
      streams.push(stream);
    }
    await tick();
    expect(liveSubscriberCount()).toBe(MAX_EVENT_STREAMS);

    const refused = await app.inject({ method: 'GET', url: '/api/events' });
    expect(refused.statusCode).toBe(503);
    expect(refused.json().message).toContain('потолок');

    for (const s of streams) s.destroy();
    await tick();
  });
});
