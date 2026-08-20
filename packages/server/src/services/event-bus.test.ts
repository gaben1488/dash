import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  publishLiveEvent,
  subscribeLiveEvents,
  liveSubscriberCount,
  liveEventsAfter,
  resetLiveEventBus,
  LIVE_EVENT_BUFFER,
} from './event-bus.js';

/**
 * Страж шины живых событий (канон п.66 «прямой эфир»).
 *
 * Проверяется ровно то, ради чего шина заведена: подписка слышит публикацию,
 * отписка перестаёт слышать, упавший слушатель не валит перечитку источников,
 * а переподключившийся догоняет пропущенное по номеру события.
 */

const bookUpdated = {
  kind: 'book-updated',
  book: 'УО',
  changedRows: 3,
  addedRows: 0,
  removedRows: 0,
  rowsTotal: 512,
  origin: 'webhook',
} as const;

beforeEach(() => {
  resetLiveEventBus();
});

describe('шина живых событий', () => {
  it('подписчик слышит публикацию, конверт несёт номер и момент', () => {
    const heard: unknown[] = [];
    subscribeLiveEvents((e) => heard.push(e));

    const envelope = publishLiveEvent({ ...bookUpdated });

    expect(heard).toHaveLength(1);
    expect(envelope.id).toBe(1);
    expect(envelope.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(envelope.event).toMatchObject({ kind: 'book-updated', book: 'УО', changedRows: 3 });
  });

  it('отписка снимает слушателя, счётчик подписчиков это видит', () => {
    const heard: unknown[] = [];
    const unsubscribe = subscribeLiveEvents((e) => heard.push(e));
    expect(liveSubscriberCount()).toBe(1);

    unsubscribe();
    expect(liveSubscriberCount()).toBe(0);

    publishLiveEvent({ ...bookUpdated });
    expect(heard).toHaveLength(0);
  });

  it('упавший подписчик не валит публикацию и не глушит соседа', () => {
    const heard: unknown[] = [];
    subscribeLiveEvents(() => {
      throw new Error('соединение оборвано');
    });
    subscribeLiveEvents((e) => heard.push(e));

    expect(() => publishLiveEvent({ ...bookUpdated })).not.toThrow();
    expect(heard).toHaveLength(1);
  });

  it('подписчик вправе отписаться прямо в обработчике — сосед всё равно слышит', () => {
    const heard: string[] = [];
    const off = subscribeLiveEvents(() => {
      heard.push('первый');
      off();
    });
    subscribeLiveEvents(() => heard.push('второй'));

    publishLiveEvent({ ...bookUpdated });

    expect(heard).toEqual(['первый', 'второй']);
    expect(liveSubscriberCount()).toBe(1);
  });

  it('догон после обрыва отдаёт только события ПОСЛЕ названного номера', () => {
    publishLiveEvent({ ...bookUpdated });
    publishLiveEvent({ kind: 'snapshot-rebuilt', rows: 3854, issues: 214, year: null });
    publishLiveEvent({ kind: 'issues-appeared', added: 2, total: 216, bySeverity: { critical: 4 } });

    const missed = liveEventsAfter(1);
    expect(missed.map((e) => e.event.kind)).toEqual(['snapshot-rebuilt', 'issues-appeared']);
  });

  it('первое подключение (номера нет) прошлое не пересказывает — тишина, а не спам', () => {
    publishLiveEvent({ ...bookUpdated });
    expect(liveEventsAfter(null)).toEqual([]);
  });

  it('кольцо не растёт бесконечно: держится последняя сотня событий', () => {
    for (let i = 0; i < LIVE_EVENT_BUFFER + 20; i++) {
      publishLiveEvent({ kind: 'snapshot-rebuilt', rows: i, issues: 0, year: null });
    }
    expect(liveEventsAfter(0)).toHaveLength(LIVE_EVENT_BUFFER);
  });

  it('момент события можно задать явно (п.58: у каждого числа момент чтения)', () => {
    const listener = vi.fn();
    subscribeLiveEvents(listener);
    publishLiveEvent({ ...bookUpdated }, '2026-08-18T04:20:00.000Z');
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ at: '2026-08-18T04:20:00.000Z' }),
    );
  });
});
