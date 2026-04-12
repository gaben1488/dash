import type { FastifyInstance } from 'fastify';
import type { Issue } from '@aemr/shared';
import { getSnapshot, getSnapshotHistory } from '../services/snapshot.js';

export async function auditRoutes(app: FastifyInstance): Promise<void> {

  /* GET /api/issues moved to routes/issues.ts */

  /** GET /api/trust — скоринг доверия */
  app.get('/api/trust', async (_request, reply) => {
    const snapshot = await getSnapshot();
    return reply.send(snapshot.trust);
  });

  /** GET /api/history — история снимков */
  app.get('/api/history', async (request, reply) => {
    const limit = parseInt((request.query as Record<string, string>).limit ?? '50', 10);
    const history = getSnapshotHistory(limit);
    return reply.send(history);
  });

  /** GET /api/export/audit — экспорт аудит-пакета (JSON) */
  app.get('/api/export/audit', async (_request, reply) => {
    const snapshot = await getSnapshot();
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
