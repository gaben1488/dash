import type { FastifyInstance } from 'fastify';
import type { Issue } from '@aemr/shared';
import { getSnapshot } from '../services/snapshot.js';

/**
 * Ответ, когда снимок данных не собрался.
 *
 * Снимок строится из живых книг: если они недоступны, getSnapshot бросает, и
 * без перехвата Fastify отдавал англоязычный «Internal Server Error» со
 * стектрейсом. Пользователю нужен код 503 (источник недоступен) и действие.
 */
const SNAPSHOT_UNAVAILABLE =
  'Данные не собраны — книги закупок не прочитаны. Проверьте доступ к таблицам и обновите данные';

export async function auditRoutes(app: FastifyInstance): Promise<void> {

  /* GET /api/issues moved to routes/issues.ts */
  /* GET /api/history удалён: дубль /api/history/snapshots (routes/history.ts),
     0 потребителей в вебе; поддержка ?limit перенесена туда. */

  /** GET /api/trust — скоринг доверия */
  app.get('/api/trust', async (_request, reply) => {
    let snapshot;
    try {
      snapshot = await getSnapshot();
    } catch (err) {
      app.log.error({ err }, 'trust: snapshot unavailable');
      return reply.status(503).send({ error: SNAPSHOT_UNAVAILABLE });
    }
    return reply.send(snapshot.trust);
  });

  /** GET /api/export/audit — экспорт аудит-пакета (JSON) */
  app.get('/api/export/audit', async (_request, reply) => {
    let snapshot;
    try {
      snapshot = await getSnapshot();
    } catch (err) {
      app.log.error({ err }, 'export/audit: snapshot unavailable');
      return reply.status(503).send({ error: SNAPSHOT_UNAVAILABLE });
    }
    return reply
      .header('Content-Disposition', `attachment; filename="aemr-audit-${snapshot.id}.json"`)
      .header('Content-Type', 'application/json')
      .send(JSON.stringify({
        exportedAt: new Date().toISOString(),
        snapshot: {
          id: snapshot.id,
          createdAt: snapshot.createdAt,
          trust: snapshot.trust,
          issuesSummary: {
            total: snapshot.issues.length,
            critical: snapshot.issues.filter((i: Issue) => i.severity === 'critical').length,
            significant: snapshot.issues.filter((i: Issue) => i.severity === 'significant').length,
          },
        },
        issues: snapshot.issues,
        deltas: snapshot.deltas,
        metadata: snapshot.metadata,
      }, null, 2));
  });
}
