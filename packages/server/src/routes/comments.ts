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
import { findDept, COL_LETTER_INDEX } from '@aemr/shared';
import { DEPARTMENT_SPREADSHEETS } from '../config.js';
import { getDeptSheetCache } from '../services/snapshot.js';
import { rowRevision } from '../services/row-revision.js';
import { countCommentWitnesses, listCommentReadings, listCommentWitnesses, listDiscussionWitnesses, listCellNoteMetadata } from '../services/comment-witness-store.js';
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
  app.get('/api/comments', async (request, reply) => {
    const query = request.query as { book?: string; limit?: string; view?: string; row?: string; column?: string; rowRevision?: string };
    if (query.view === 'cell-notes') {
      const dept = findDept(query.book ?? '');
      const physicalRow = Number(query.row);
      if (!dept || !Number.isSafeInteger(physicalRow) || physicalRow <= 3 ||
          (query.column !== undefined && !Object.hasOwn(COL_LETTER_INDEX, query.column))) {
        return reply.status(400).send({ error: 'Для заметок нужен адрес рабочего листа: управление, строка и допустимый столбец.' });
      }
      const fileId = DEPARTMENT_SPREADSHEETS[dept.id];
      const cache = getDeptSheetCache()[dept.id];
      if (!fileId || !cache?.sheetName) return { status: 'unavailable', reason: 'Текущий источник и рабочий лист не установлены.', notes: [], total: null, shown: 0, truncated: false, readAt: null, identity: 'physical-address-only' };
      const current = cache.values[physicalRow - 1];
      const revisionMismatch = query.rowRevision && current && rowRevision(current) !== query.rowRevision;
      return { ...listCellNoteMetadata(fileId, cache.sheetName, physicalRow, query.column),
        book: dept.id, sheet: cache.sheetName, row: physicalRow, column: query.column ?? null,
        warning: !current ? 'В текущем чтении строки по этому адресу нет. Сохранённые заметки описывают прежний физический адрес, не выбранную закупку.' : revisionMismatch ? 'Строка в текущем чтении изменилась. Заметки относятся к физическому адресу, их связь с выбранной закупкой не подтверждена.' :
          'Заметки относятся к физическому адресу. Их связь с закупкой после перемещения строки не подтверждена.' };
    }
    const limit = Math.min(Math.max(Number(query.limit) || 200, 1), 1000);
    const comments = listStoredComments(query.book || undefined, limit);
    const discussion = query.view === 'discussions' ? listDiscussionWitnesses(query.book || undefined, limit) : null;
    const witnesses = discussion?.witnesses ?? listCommentWitnesses(query.book || undefined, limit, true);
    return {
      // «Всего» считает база по фильтру, а не длина ограниченной выборки:
      // при limit=50 из двухсот осевших total обязан отвечать 200. Сколько
      // строк реально отдано в этом ответе — отдельное поле shown.
      total: countStoredComments(query.book || undefined),
      shown: comments.length,
      book: query.book || null,
      comments,
      // Append-only history of notes and native threads, not inferred edit events.
      witnesses,
      ...(discussion ? { view: 'discussions', discussionCounts: discussion.counts } : {}),
      witnessHistoryTotal: countCommentWitnesses(query.book || undefined),
      witnessHistoryShown: witnesses.length,
      readings: listCommentReadings(query.book || undefined),
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
