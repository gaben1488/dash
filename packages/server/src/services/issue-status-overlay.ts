/**
 * Durable human decisions about findings.
 *
 * A fresh pipeline snapshot describes detection evidence, not the human
 * review state. The read model overlays SQLite decisions without changing
 * the immutable source snapshot. Reuse this projection in every API surface.
 */
import type { Issue } from '@aemr/shared';
import { db, schema } from '../db/index.js';

export function overlayPersistedIssueStatus(issues: readonly Issue[]): Issue[] {
  if (issues.length === 0) return [];
  const saved = db.select({ id: schema.issues.id, status: schema.issues.status })
    .from(schema.issues)
    .all();

  if (saved.length === 0) return [...issues];
  const statusById = new Map(saved.map((row) => [row.id, row.status]));

  return issues.map((issue) => {
    const status = statusById.get(issue.id);
    return status ? { ...issue, status: status as Issue['status'] } : issue;
  });
}
