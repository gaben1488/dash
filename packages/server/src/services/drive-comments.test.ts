/**
 * Страж чтения комментариев-облачков (решение §17.2).
 *
 * Через подставной перечень Диска (без сети) проверяется: страницы склеиваются,
 * записи оседают в базе, повторное чтение обновляет по паре книга+идентификатор
 * и не плодит дубли, удалённые честно видны отдельным признаком, отказ одной
 * книги не валит остальные, расписание ночного обхода — чистой функцией.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

let comments: typeof import('./drive-comments.js');

beforeAll(async () => {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV, NODE_ENV: 'test', SQLITE_PATH: ':memory:' };
  comments = await import('./drive-comments.js');
}, 60_000);

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

beforeEach(() => {
  comments.resetStoredComments();
});

type Item = import('./drive-comments.js').DriveCommentItem;

function item(over: Partial<Item> = {}): Item {
  return {
    id: 'c1',
    author: 'Мария Соколова',
    content: 'НМЦК изменена ввиду изменения объёмов',
    quoted: '292,67',
    createdTime: '2026-08-20T01:00:00.000Z',
    modifiedTime: '2026-08-21T01:00:00.000Z',
    resolved: false,
    deleted: false,
    replies: 2,
    ...over,
  };
}

describe('чтение комментариев одной книги', () => {
  it('страницы перечня склеиваются, записи оседают в базе с цитатой и статусом', async () => {
    const api = {
      list: vi.fn(async (_fileId: string, pageToken: string | null) =>
        pageToken === null
          ? { items: [item()], nextPageToken: 'стр-2' }
          : {
              items: [
                item({ id: 'c2', resolved: true }),
                item({ id: 'c3', deleted: true, author: null, content: null }),
              ],
              nextPageToken: null,
            },
      ),
    };

    const r = await comments.refreshBookComments('УО', 'файл-уо', api);

    expect(api.list).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ book: 'УО', read: true, total: 3, open: 1, resolvedCount: 1, deletedCount: 1 });

    const stored = comments.listStoredComments('УО');
    expect(stored).toHaveLength(3);
    const first = stored.find((c) => c.commentId === 'c1');
    expect(first).toMatchObject({
      author: 'Мария Соколова',
      quoted: '292,67',
      resolved: false,
      replies: 2,
    });
    // Удалённый комментарий — «здесь был комментарий, удалён»: без автора и текста.
    const gone = stored.find((c) => c.commentId === 'c3');
    expect(gone).toMatchObject({ deleted: true, author: null, content: null });
  });

  it('повторное чтение обновляет запись, а не плодит дубли', async () => {
    const api1 = { list: vi.fn(async () => ({ items: [item()], nextPageToken: null })) };
    await comments.refreshBookComments('УО', 'файл-уо', api1);

    const api2 = {
      list: vi.fn(async () => ({
        items: [item({ resolved: true, modifiedTime: '2026-08-22T01:00:00.000Z' })],
        nextPageToken: null,
      })),
    };
    await comments.refreshBookComments('УО', 'файл-уо', api2);

    const stored = comments.listStoredComments('УО');
    expect(stored).toHaveLength(1);
    expect(stored[0].resolved).toBe(true);
    expect(stored[0].modifiedAtMs).toBe(Date.parse('2026-08-22T01:00:00.000Z'));
  });

  it('без служебной учётной записи — честное «не читали», а не пустой успех', async () => {
    const r = await comments.refreshBookComments('УО', 'файл-уо', null);
    expect(r.read).toBe(false);
    expect(r.skippedBecause).toContain('учётной записи');
  });

  it('чтение состоялось, а база не далась — read:true с признаком persisted:false', async () => {
    // Находка 29.08: запись в базу шла вне страховки, и отказ базы превращал
    // состоявшееся чтение в исключение — итог выглядел «не читали». Теперь
    // итог честный: прочитано, но не осело; следующая перечитка доложит.
    const { db } = await import('../db/index.js');
    const { sql } = await import('drizzle-orm');
    const api = { list: vi.fn(async () => ({ items: [item()], nextPageToken: null })) };

    // База «ломается» переименованием таблицы; индексы уезжают вместе с ней
    // и возвращаются обратным переименованием — соседние стражи не страдают.
    db.run(sql`ALTER TABLE drive_comments RENAME TO drive_comments_сломана`);
    try {
      const r = await comments.refreshBookComments('УО', 'файл-уо', api);
      expect(r.read).toBe(true);
      expect(r.persisted).toBe(false);
      expect(r.total).toBe(1);
    } finally {
      db.run(sql`ALTER TABLE drive_comments_сломана RENAME TO drive_comments`);
    }

    // Здоровая база — persisted:true, запись оседает.
    const ok = await comments.refreshBookComments('УО', 'файл-уо', api);
    expect(ok.persisted).toBe(true);
    expect(comments.listStoredComments('УО')).toHaveLength(1);
  });
});

describe('счёт осевших комментариев', () => {
  it('total считает база по фильтру, а не длина ограниченной выборки', async () => {
    const api = {
      list: vi.fn(async () => ({
        items: [item({ id: 'к1' }), item({ id: 'к2' }), item({ id: 'к3' })],
        nextPageToken: null,
      })),
    };
    await comments.refreshBookComments('УО', 'файл-уо', api);

    // Выборка ограничена одной строкой — счёт всё равно отвечает «три».
    expect(comments.listStoredComments('УО', 1)).toHaveLength(1);
    expect(comments.countStoredComments('УО')).toBe(3);
    expect(comments.countStoredComments()).toBe(3);
    expect(comments.countStoredComments('УЭР')).toBe(0);
  });
});

describe('обход нескольких книг', () => {
  it('отказ одной книги не валит остальные — итог честно называет неудачу', async () => {
    // Наблюдаемые книги берутся из живой настройки; первая пусть упадёт.
    const { watchedBooks } = await import('./webhook-channel.js');
    const books = watchedBooks().slice(0, 2).map((w) => w.book);
    const failing = {
      list: vi.fn(async (fileId: string) => {
        const first = watchedBooks()[0]?.fileId;
        if (fileId === first) throw new Error('нет доступа');
        return { items: [item({ id: `c-${fileId.slice(0, 4)}` })], nextPageToken: null };
      }),
    };

    const results = await comments.refreshCommentsForBooks(books, undefined, failing);
    expect(results).toHaveLength(2);
    expect(results.filter((r) => r.read)).toHaveLength(1);
    expect(results.find((r) => !r.read)?.skippedBecause).toBe('нет доступа');
  });
});

describe('расписание ночного обхода', () => {
  it('обход назначается в три часа ночи продуктового пояса и один раз в сутки', () => {
    // Камчатка UTC+12: 15:00 UTC накануне = 03:00 продуктового дня.
    const at3 = new Date('2026-08-28T15:00:00.000Z');
    const first = comments.sweepDueNow(at3, 12, null);
    expect(first.due).toBe(true);

    // Тот же час, но день уже пройден — второго обхода нет.
    expect(comments.sweepDueNow(at3, 12, first.day).due).toBe(false);

    // Днём обход не идёт.
    expect(comments.sweepDueNow(new Date('2026-08-29T00:00:00.000Z'), 12, null).due).toBe(false);
  });

  it('старт в самом окне обхода запускает его сразу, а не через час', async () => {
    // Находка 29.08: первый тик setInterval — через час после старта. Сервер,
    // поднятый в 03:10, дождался бы тика в 04:10 — окно 03:00–04:00 молча
    // пропущено, обход отложен на сутки. Теперь проверка идёт и при старте.
    const { config } = await import('../config.js');
    const off = config.weeklySnapshot.utcOffsetHours;
    const utcHourAt3 = ((3 - off) % 24 + 24) % 24;
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(Date.UTC(2026, 7, 28, utcHourAt3, 30)));
      const sweep = vi.fn(async () => []);
      const log = { info: () => {}, warn: () => {} };

      const stop = comments.startNightlyCommentsSweep(log, sweep);
      expect(sweep).toHaveBeenCalledTimes(1);

      // Тик через час — уже 04:30, и день пройден: второго обхода нет.
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
      expect(sweep).toHaveBeenCalledTimes(1);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('старт вне окна не запускает обход немедленно', async () => {
    const { config } = await import('../config.js');
    const off = config.weeklySnapshot.utcOffsetHours;
    const utcHourAtNoon = ((12 - off) % 24 + 24) % 24;
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(Date.UTC(2026, 7, 28, utcHourAtNoon, 30)));
      const sweep = vi.fn(async () => []);
      const stop = comments.startNightlyCommentsSweep({ info: () => {}, warn: () => {} }, sweep);
      expect(sweep).not.toHaveBeenCalled();
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ночной обход вычищает выполненные записи очереди вебхука старше срока хранения', async () => {
    // Единственное регулярное место уборки очереди — ночь (webhook-queue.ts,
    // pruneProcessedNotifications): без неё done-записи росли бы вечно.
    const queue = await import('./webhook-queue.js');
    queue.resetWebhookQueue();
    const id = queue.enqueueNotification({
      book: 'УО',
      fileId: 'файл-уо',
      messageNumber: 1,
      channelId: 'канал',
      resourceState: 'update',
    });
    expect(id).not.toBeNull();
    // Выполнена давным-давно — старше срока хранения.
    queue.markProcessed([id as number], new Date('2026-08-01T00:00:00.000Z'));
    expect(queue.queueStats().processed).toBe(1);

    const { config } = await import('../config.js');
    const off = config.weeklySnapshot.utcOffsetHours;
    const utcHourAt3 = ((3 - off) % 24 + 24) % 24;
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(Date.UTC(2026, 7, 28, utcHourAt3, 30)));
      const stop = comments.startNightlyCommentsSweep({ info: () => {}, warn: () => {} }, vi.fn(async () => []));
      expect(queue.queueStats().processed).toBe(0);
      stop();
    } finally {
      vi.useRealTimers();
      queue.resetWebhookQueue();
    }
  });
});
