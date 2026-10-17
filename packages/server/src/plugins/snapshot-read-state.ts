import type { FastifyInstance } from 'fastify';
import { snapshotReadContext } from '../services/snapshot-read-context.js';

export function registerSnapshotReadState(app: FastifyInstance): void {
  app.addHook('onRequest', (_request, _reply, done) => snapshotReadContext.run({}, done));
  app.addHook('onSend', async (_request, reply, payload) => {
    const context = snapshotReadContext.getStore();
    if (context?.state && context.capturedAt) {
      reply.header('x-aemr-data-state', context.state);
      reply.header('x-aemr-data-captured-at', context.capturedAt);
    }
    return payload;
  });
}
