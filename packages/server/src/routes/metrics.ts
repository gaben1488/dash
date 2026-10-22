import type { FastifyInstance } from 'fastify';
import type { DeltaResult, Issue } from '@aemr/shared';
import { getSnapshot } from '../services/snapshot.js';
import { getMetricTrend } from '../services/snapshot.js';
import { overlayPersistedStatus } from '../services/issue-decisions.js';
import { REPORT_MAP } from '@aemr/shared';
import { parseYearFilterParam } from '../services/period-params.js';
import { metricExplanation } from '../services/metric-explanation.js';

export async function metricsRoutes(app: FastifyInstance): Promise<void> {

  /** GET /api/metrics — все метрики текущего снимка */
  app.get('/api/metrics', async (_request, reply) => {
    try {
      const snapshot = await getSnapshot();
      return reply.send({
        official: snapshot.officialMetrics,
        calculated: snapshot.calculatedMetrics,
        deltas: snapshot.deltas,
      });
    } catch (err) {
      app.log.error({ err }, 'Metrics unavailable');
      return reply.status(503).send({ error: 'Metrics unavailable - data source error' });
    }
  });

  /** GET /api/metrics/:key — конкретная метрика с историей */
  app.get('/api/metrics/:key', async (request, reply) => {
    const query = request.query as { year?: unknown; snapshotId?: unknown };
    const year = parseYearFilterParam(query.year);
    if (query.snapshotId !== undefined && typeof query.snapshotId !== 'string') {
      return reply.status(400).send({ code: 'INVALID_SCOPE' });
    }
    try {
      const { key } = request.params as { key: string };
      const snapshot = await getSnapshot(false, year);
      if (query.snapshotId !== undefined && query.snapshotId !== snapshot.id) {
        return reply.status(409).send({ code: 'SNAPSHOT_CHANGED' });
      }
      const metric = snapshot.officialMetrics[key];
      const calculated = snapshot.calculatedMetrics[key];
      const mapEntry = REPORT_MAP.find((e) => e.metricKey === key);
      const trend = getMetricTrend(key);

      if (!metric && !calculated && !mapEntry) {
        return reply.status(404).send({ error: `Метрика "${key}" не найдена` });
      }

      return reply.send({
        metric,
        calculated,
        explanation: calculated ? metricExplanation(snapshot, key) : null,
        mapEntry,
        trend,
        delta: snapshot.deltas.find((d: DeltaResult) => d.metricKey === key),
        // Detail retains closed cases with their true status so the decision is auditable.
        issues: overlayPersistedStatus(snapshot.issues ?? [], snapshot).filter((i: Issue) => i.metricKey === key),
      });
    } catch (err) {
      app.log.error({ err }, 'Metric detail unavailable');
      return reply.status(503).send({ error: 'Metrics unavailable - data source error' });
    }
  });

  /** GET /api/report-map — полная карта метрик */
  app.get('/api/report-map', async (_request, reply) => {
    return reply.send(REPORT_MAP);
  });
}
