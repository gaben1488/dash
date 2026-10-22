import Fastify from 'fastify';
import { expect, it } from 'vitest';
import { registerSnapshotReadState } from './snapshot-read-state.js';
import { recordSnapshotRead, snapshotReadContext } from '../services/snapshot-read-context.js';

it('keeps freshness on projected responses, isolates concurrent requests and ignores background imports', async () => {
  const app = Fastify();
  registerSnapshotReadState(app);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const snapshot = (state?: 'refreshing' | 'stale') => ({ createdAt: '2026-10-16T01:00:00.000Z', metadata: { readModel: state ? { state } : undefined } });
  app.get('/slow', async () => {
    recordSnapshotRead(snapshot('stale'));
    await pending;
    return { official: {} }; // Projection intentionally omits metadata.
  });
  app.get('/ready', async () => {
    recordSnapshotRead(snapshot());
    snapshotReadContext.exit(() => recordSnapshotRead(snapshot('stale')));
    release();
    return { official: {} };
  });
  app.get('/health', async () => ({ status: 'ok' }));
  try {
    const slow = app.inject('/slow');
    const ready = app.inject('/ready');
    const [a, b] = await Promise.all([slow, ready]);
    expect(a.headers['x-aemr-data-state']).toBe('stale');
    expect(a.headers['x-aemr-data-captured-at']).toBe('2026-10-16T01:00:00.000Z');
    expect(a.json()).toEqual({ official: {} });
    expect(b.headers['x-aemr-data-state']).toBe('ready');
    expect((await app.inject('/health')).headers['x-aemr-data-state']).toBeUndefined();
  } finally { release(); await app.close(); }
});
