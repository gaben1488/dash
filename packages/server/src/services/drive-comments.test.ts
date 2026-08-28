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
});
