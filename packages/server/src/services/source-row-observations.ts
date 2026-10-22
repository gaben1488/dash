import { createHash } from 'node:crypto';
import { sourceRowObservationDetails, findDept } from '@aemr/shared';
import type { ChangeEntry } from '@aemr/core';
import { db } from '../db/index.js';
import { diffBook, type SheetReading } from './live-diff.js';

const ACTION = 'source_row_observation';

/** Caller owns the acceptance transaction; persistence failure must reject the reading. */
export function saveSourceRowObservations(book: string, before: SheetReading | undefined,
  after: SheetReading, beforePrint: string | undefined, afterPrint: string, observedAt: string): void {
  if (!before || !beforePrint || beforePrint === afterPrint) return;
  for (const entry of diffBook(book, before, after).structuralChanges ?? []) {
    const id = createHash('sha256').update(JSON.stringify([book, beforePrint, afterPrint, entry.id])).digest('hex');
    if (db.$client.prepare('SELECT id FROM audit_log WHERE action = ? AND entity_id = ? LIMIT 1').get(ACTION, id)) continue;
    const saved: ChangeEntry = { ...entry, id: `source-observation:${id}`,
      sheet: findDept(book)?.sheetName ?? entry.sheet, observedAt };
    db.$client.prepare(`INSERT INTO audit_log (action, entity, entity_id, department_id, row_index,
      old_value, details, timestamp, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      ACTION, 'row-observation', id, book, entry.sheetRow, JSON.stringify(saved),
      sourceRowObservationDetails(entry), observedAt, null);
  }
}

/** Same durable observations supply the detailed journal after reload/restart. */
export function readSourceRowObservations(sinceMs: number): ChangeEntry[] {
  const rows = db.$client.prepare(`SELECT old_value FROM audit_log
    WHERE action = ? AND timestamp >= ? ORDER BY timestamp DESC`).all(ACTION, new Date(sinceMs).toISOString()) as Array<{ old_value: string }>;
  return rows.map(row => {
    const entry = JSON.parse(row.old_value) as ChangeEntry;
    if (entry.origin !== 'snapshot-diff' || !entry.observedAt || !entry.id.startsWith('source-observation:')) {
      throw new Error('INVALID_SOURCE_ROW_OBSERVATION');
    }
    return entry;
  });
}
