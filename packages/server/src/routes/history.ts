import type { FastifyInstance } from 'fastify';
import { diffMetrics } from '@aemr/core';
import { getSnapshotHistory, getSnapshotMetrics } from '../services/snapshot.js';

/**
 * Роуты истории изменений (слой 1 — дрейф метрик между снимками).
 * Чистая логика diff живёт в @aemr/core; здесь — тонкая обвязка над сервисом.
 */
export async function historyRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/history/snapshots?limit=N — таймлайн снимков (id, дата, trust, issues).
   * Параметр limit пришёл сюда вместе с удалённым дублем /api/history: у роутов
   * была одна работа и разные возможности, теперь дом один.
   */
  app.get('/api/history/snapshots', async (request, reply) => {
    const rawLimit = parseInt((request.query as Record<string, string>).limit ?? '50', 10);
    // Guard: ?limit=abc -> NaN в drizzle; ?limit=1e9 -> выборка без границы.
    const limit = Number.isFinite(rawLimit) ? Math.min(500, Math.max(1, rawLimit)) : 50;
    return reply.send(getSnapshotHistory(limit));
  });

  /** GET /api/history/diff?from=<id>&to=<id> — дрейф метрик между двумя снимками. */
  app.get('/api/history/diff', async (request, reply) => {
    const { from, to } = request.query as { from?: string; to?: string };
    if (!from || !to) {
      return reply.status(400).send({
        error: 'Не выбраны снимки для сравнения — укажите начальный и конечный',
        details: 'параметры from и to (идентификаторы снимков)',
      });
    }
    const fromRows = getSnapshotMetrics(from);
    const toRows = getSnapshotMetrics(to);
    // Какой именно снимок пуст — половина ответа: без этого пользователь не
    // знает, менять ему левую границу сравнения или правую.
    const missing = [
      fromRows.length === 0 ? 'начальный' : null,
      toRows.length === 0 ? 'конечный' : null,
    ].filter(Boolean);
    if (missing.length > 0) {
      return reply.status(404).send({
        error: missing.length === 2
          ? 'Ни один из выбранных снимков не найден или в нём нет метрик — выберите другие'
          : `Снимок (${missing[0]}) не найден или в нём нет метрик — выберите другой`,
      });
    }
    return reply.send(diffMetrics(fromRows, toRows));
  });
}
