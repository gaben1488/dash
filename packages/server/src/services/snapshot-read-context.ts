import { AsyncLocalStorage } from 'node:async_hooks';
import type { DataSnapshot } from '@aemr/shared';

type ReadState = 'ready' | 'refreshing' | 'stale';
type ReadContext = { state?: ReadState; capturedAt?: string };
export const snapshotReadContext = new AsyncLocalStorage<ReadContext>();
const rank = { ready: 0, refreshing: 1, stale: 2 };

/** Preserve freshness even when a route projects the snapshot into a list or metric. */
export function recordSnapshotRead<T extends Pick<DataSnapshot, 'createdAt'> & { metadata: { readModel?: { state: 'refreshing' | 'stale' } } }>(snapshot: T): T {
  const context = snapshotReadContext.getStore();
  if (context) {
    const state = snapshot.metadata.readModel?.state ?? 'ready';
    if (!context.state || rank[state] > rank[context.state]) context.state = state;
    if (!context.capturedAt || snapshot.createdAt < context.capturedAt) context.capturedAt = snapshot.createdAt;
  }
  return snapshot;
}
