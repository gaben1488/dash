import type { FastifyInstance } from 'fastify';
import { diffMetrics } from '@aemr/core';
import { getSnapshotHistory, getSnapshotMetrics } from '../services/snapshot.js';

/**
 * Роуты истории изменений (слой 1 — дрейф метрик между снимками).
 * Чистая логика diff живёт в @aemr/core; здесь — тонкая обвязка над сервисом.
 */
export async function historyRoutes(app: FastifyInstance): Promise<void> {
  /** GET /api/history/snapshots — таймлайн снимков (id, дата, trust, issues). */
  app.get('/api/history/snapshots', async (_request, reply) => {
    return reply.send(getSnapshotHistory());
  });

  /** GET /api/history/diff?from=<id>&to=<id> — дрейф метрик между двумя снимками. */
  app.get('/api/history/diff', async (request, reply) => {
    const { from, to } = request.query as { from?: string; to?: string };
    if (!from || !to) {
      return reply.status(400).send({ error: 'Нужны параметры from и to (id снимков)' });
    }
    const fromRows = getSnapshotMetrics(from);
    const toRows = getSnapshotMetrics(to);
    if (fromRows.length === 0 || toRows.length === 0) {
      return reply.status(404).send({ error: 'Снимок не найден или без метрик' });
    }
    return reply.send(diffMetrics(fromRows, toRows));
  });
}
