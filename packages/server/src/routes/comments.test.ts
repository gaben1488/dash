/**
 * comments.test.ts — inject-стражи /api/comments (решение §17.2).
 *
 * POST /api/comments/refresh — ручная перечитка перечня комментариев по
 * образцу существующих обновляющих маршрутов; GET /api/comments — то, что
 * уже осело в базе. Сам разбор перечня проверяет services/drive-comments.test.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const refreshCommentsForBooks = vi.fn(async (books: unknown) =>
  books === 'all'
    ? [
        { book: 'УО', read: true, total: 191, open: 39, resolvedCount: 152, deletedCount: 0 },
        { book: 'УЭР', read: false, skippedBecause: 'нет доступа', total: 0, open: 0, resolvedCount: 0, deletedCount: 0 },
      ]
    : (books as string[]).map((book) => ({
        book,
        read: true,
        total: 5,
        open: 2,
        resolvedCount: 3,
        deletedCount: 0,
      })),
);
const listStoredComments = vi.fn(() => [
  {
    book: 'УО',
    commentId: 'c1',
    author: 'Мария Соколова',
    content: 'ЭА внесён ошибочно',
    quoted: 'ЭА',
    createdAtMs: 1,
    modifiedAtMs: 2,
    resolved: false,
    deleted: false,
    replies: 1,
    recordedAt: 'x',
  },
]);

vi.mock('../services/drive-comments.js', () => ({
  refreshCommentsForBooks: (...a: unknown[]) => refreshCommentsForBooks(...(a as [unknown])),
  listStoredComments: (...a: unknown[]) => listStoredComments(...(a as [])),
}));

let app: FastifyInstance;

beforeAll(async () => {
  const { commentsRoutes } = await import('./comments.js');
  app = Fastify({ logger: false });
  await app.register(commentsRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

afterEach(() => {
  refreshCommentsForBooks.mockClear();
  listStoredComments.mockClear();
});

describe('POST /api/comments/refresh', () => {
  it('без параметров идёт полный обход всех наблюдаемых книг', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/comments/refresh' });

    expect(res.statusCode).toBe(200);
    expect(refreshCommentsForBooks).toHaveBeenCalledWith('all', expect.anything());
    const body = res.json();
    expect(body.booksTotal).toBe(2);
    // Неудача одной книги видна в итоге, а не замалчивается.
    expect(body.booksRead).toBe(1);
    expect(body.results.find((r: { book: string }) => r.book === 'УЭР').skippedBecause).toBe('нет доступа');
  });

  it('?book=УО перечитывает одну книгу', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/comments/refresh?book=УО' });

    expect(res.statusCode).toBe(200);
    expect(refreshCommentsForBooks).toHaveBeenCalledWith(['УО'], expect.anything());
    expect(res.json().booksRead).toBe(1);
  });

  it('книга вне наблюдения — честный 404, а не пустой успех', async () => {
    refreshCommentsForBooks.mockResolvedValueOnce([]);
    const res = await app.inject({ method: 'POST', url: '/api/comments/refresh?book=Чужая' });

    expect(res.statusCode).toBe(404);
    expect(res.json().message).toContain('не под наблюдением');
  });
});

describe('GET /api/comments', () => {
  it('отдаёт осевшие комментарии с цитатой, статусом и автором', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/comments?book=УО&limit=50' });

    expect(res.statusCode).toBe(200);
    expect(listStoredComments).toHaveBeenCalledWith('УО', 50);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.comments[0]).toMatchObject({ book: 'УО', quoted: 'ЭА', resolved: false });
  });
});
