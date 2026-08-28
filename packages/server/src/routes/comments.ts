/**
 * /api/comments — комментарии-облачка книг, осевшие в базе.
 *
 * Решение §17.2 (проект «служба, а не снимок»): комментарии читаются при
 * уведомлении вебхука о книге, ночью полным обходом, а здесь — руками.
 * POST-перечитка сделана по образцу существующих обновляющих маршрутов
 * (POST /api/refresh): маршрут не публичный, требует ключ доступа.
 *
 * Идентификаторы файлов в ответы не попадают — только человеческие названия
 * книг, счётчики и сами комментарии (тот же принцип, что у состояния каналов).
 */
import type { FastifyInstance } from 'fastify';
import {
  countStoredComments,
  listStoredComments,
  refreshCommentsForBooks,
} from '../services/drive-comments.js';

export async function commentsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/comments — что уже прочитано и осело в базе.
   * ?book=УО — по одной книге; ?limit=50 — сколько отдать (свежие сверху).
   */
  app.get('/api/comments', async (request) => {
    const query = request.query as { book?: string; limit?: string };
    const limit = Math.min(Math.max(Number(query.limit) || 200, 1), 1000);
    const comments = listStoredComments(query.book || undefined, limit);
    return {
      // «Всего» считает база по фильтру, а не длина ограниченной выборки:
      // при limit=50 из двухсот осевших total обязан отвечать 200. Сколько
      // строк реально отдано в этом ответе — отдельное поле shown.
      total: countStoredComments(query.book || undefined),
      shown: comments.length,
      book: query.book || null,
      comments,
    };
  });

  /**
   * POST /api/comments/refresh — ручная перечитка перечня комментариев.
   * Без тела — полный обход всех наблюдаемых книг; ?book=УО — одна книга.
   */
  app.post('/api/comments/refresh', async (request, reply) => {
    const query = request.query as { book?: string };
    const log = {
      info: (m: string) => request.log.info(m),
      warn: (m: string) => request.log.warn(m),
    };
    const results = await refreshCommentsForBooks(query.book ? [query.book] : 'all', log);
    if (query.book && results.length === 0) {
      return reply.status(404).send({
        error: 'NotFound',
        message: `Книга «${query.book}» не под наблюдением — комментарии читать не по чему.`,
        statusCode: 404,
      });
    }
    const read = results.filter((r) => r.read);
    return reply.send({
      refreshedAt: new Date().toISOString(),
      booksRead: read.length,
      booksTotal: results.length,
      results,
    });
  });
}
