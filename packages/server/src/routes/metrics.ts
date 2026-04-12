import type { FastifyInstance } from 'fastify';
import type { DeltaResult, Issue } from '@aemr/shared';
import { getSnapshot } from '../services/snapshot.js';
import { getMetricTrend } from '../services/snapshot.js';
import { REPORT_MAP } from '@aemr/shared';

export async function metricsRoutes(app: FastifyInstance): Promise<void> {

  /** GET /api/metrics — все метрики текущего снимка */
  app.get('/api/metrics', async (_request, reply) => {
    const snapshot = await getSnapshot();
    return reply.send({
      official: snapshot.officialMetrics,
      calculated: snapshot.calculatedMetrics,
      deltas: snapshot.deltas,
    });
  });

  /** GET /api/metrics/:key — конкретная метрика с историей */
  app.get('/api/metrics/:key', async (request, reply) => {
    const { key } = request.params as { key: string };
    const snapshot = await getSnapshot();
    const metric = snapshot.officialMetrics[key];
    const mapEntry = REPORT_MAP.find((e) => e.metricKey === key);
    const trend = getMetricTrend(key);

    if (!metric && !mapEntry) {
      return reply.status(404).send({ error: `Метрика "${key}" не найдена` });
    }

    return reply.send({
      metric,
      mapEntry,
      trend,
      delta: snapshot.deltas.find((d: DeltaResult) => d.metricKey === key),
      issues: snapshot.issues.filter((i: Issue) => i.metricKey === key),
    });
  });

  /** GET /api/report-map — полная карта метрик */
  app.get('/api/report-map', async (_request, reply) => {
    return reply.send(REPORT_MAP);
  });
}
