import { db } from '../db/index.js';
import { config } from '../config.js';
import { pruneSnapshotsInDb } from './snapshot-storage.js';
export { retentionKeepIds } from './snapshot-storage.js';

/** Existing synchronous maintenance API; the materializer uses its worker. */
export function pruneSnapshotsByRetention(now: Date = new Date()): number {
  return pruneSnapshotsInDb(db, config.weeklySnapshot.utcOffsetHours, now);
}
