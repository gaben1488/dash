import type { Issue, DataSnapshot } from '@aemr/shared';
import { computeTrustScore, issueIdentity, ruleIssueIdentityParts } from '@aemr/core';
import { buildCellDict, DEPT_HEADER_ROWS, classifySheet } from '@aemr/shared';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

/**
 * Overlays the DB-persisted status on top of issues that are freshly rebuilt
 * from the snapshot on every call (the pipeline always assigns status:'open' —
 * see packages/core/src/pipeline/orchestrator.ts:479,621 — and so does the
 * demo generator). Without this merge, PUT /api/issues/:id/status never
 * changes what any GET/export caller sees. The DB is the source of truth for
 * status; every other field still comes from the snapshot as before.
 */
export function overlayPersistedStatus(issues: Issue[], snapshot?: DataSnapshot): Issue[] {
  if (issues.length === 0) return issues;
  const rows = db.select({ id: schema.issues.id, status: schema.issues.status }).from(schema.issues).all();
  if (rows.length === 0) return issues;
  const statusById = new Map(rows.map((r) => [r.id, r.status]));
  const current = issues.map((issue) => {
    // Occurrence numbers distinguish duplicates for transport, not ownership.
    // Inserting an identical row can hand occurrence zero to a different row.
    if (snapshot && ambiguousRuleAnchor(snapshot, issue)) return { ...issue, status: 'open' as const };
    const persisted = statusById.get(issue.id);
    return persisted ? { ...issue, status: persisted as Issue['status'] } : issue;
  });
  if (!snapshot?.rowsByDept) return current;
  const decisionIds = new Set(db.select({ id: schema.issueHistory.issueId }).from(schema.issueHistory).all().map(r => r.id));
  for (const event of db.select({ id: schema.auditLog.entityId }).from(schema.auditLog).where(eq(schema.auditLog.action, 'issue_comment')).all()) if (event.id) decisionIds.add(event.id);
  const saved = db.select().from(schema.issues).all().filter(r => decisionIds.has(r.id) || r.status !== 'open' || !!r.comment?.trim());
  for (const savedIssue of saved) decisionIds.add(savedIssue.id);
  const cases: SavedRuleDecision[] = [];
  for (const savedIssue of saved) {
    if (issues.some(issue => issue.id === savedIssue.id) || !savedIssue.snapshotId) continue;
    // The pre-fix hash omitted organization C. Latest snapshotId alone could
    // therefore attach an old decision to a later organization using that hash.
    // Check every available version of this case, one JSON blob at a time.
    const versions = db.select({ id: schema.snapshots.id }).from(schema.snapshots)
      .where(sql`instr(${schema.snapshots.data}, ${JSON.stringify(savedIssue.id)}) > 0`).all();
    const provenVersions: SavedRuleDecision[] = [];
    let unreadable = false;
    for (const version of versions) {
      const stored = db.select({ data: schema.snapshots.data }).from(schema.snapshots).where(eq(schema.snapshots.id, version.id)).get();
      if (!stored?.data) { unreadable = true; break; }
      try {
        const historical = JSON.parse(stored.data) as DataSnapshot;
        if (historical.issues?.some(issue => issue.id === savedIssue.id)) provenVersions.push({ id: savedIssue.id, status: savedIssue.status, snapshot: historical });
      } catch { unreadable = true; break; }
    }
    if (!unreadable) cases.push(...provenVersions);
  }
  // An explicit decision on the new ID wins; an undecided new open row does not
  // erase the previously saved case simply because the pipeline saved it first.
  const proved = reconnectRuleDecisions({ ...snapshot, issues: current }, cases);
  return proved.map((issue, index) => decisionIds.has(issues[index].id) ? current[index] : issue);
}

/** Request-time decision view; the stored/cached source snapshot stays immutable. */
export function withPersistedDecisions<T extends DataSnapshot>(snapshot: T): T {
  const issues = overlayPersistedStatus(snapshot.issues ?? [], snapshot);
  const changed = issues.some((issue, index) => issue.status !== snapshot.issues[index].status);
  return { ...snapshot, issues, trust: changed
    ? computeTrustScore(new Map(Object.entries(snapshot.officialMetrics)), issues, snapshot.deltas ?? [], snapshot.id)
    : snapshot.trust };
}

type IdentitySnapshot = Pick<DataSnapshot, 'issues' | 'rowsByDept'>;
type SavedRuleDecision = { id: string; status: string; snapshot: IdentitySnapshot };

function ruleRowAnchor(snapshot: IdentitySnapshot, issue: Issue) {
  if (!issue.detectedBy?.startsWith('rule:') || !issue.sheet || !issue.checkId || !issue.row || !/^([A-Z]+)\d+$/.test(issue.cell ?? '')) return undefined;
  const kind = classifySheet(issue.sheet).kind;
  if (kind !== 'department' && kind !== 'subordinates_agg') return undefined;
  const rows = snapshot.rowsByDept?.[issue.sheet];
  const raw = rows?.[issue.row - DEPT_HEADER_ROWS - 1];
  if (!raw || !rows) return undefined;
  const parts = ruleIssueIdentityParts(issue.checkId, issue.sheet, issue.cell!, buildCellDict(raw));
  const key = issueIdentity(parts);
  const occurrences = rows.filter(row => issueIdentity(ruleIssueIdentityParts(issue.checkId!, issue.sheet!, issue.cell!, buildCellDict(row))) === key).length;
  return { raw, parts, key, occurrences };
}

function ambiguousRuleAnchor(snapshot: IdentitySnapshot, issue: Issue): boolean {
  return (ruleRowAnchor(snapshot, issue)?.occurrences ?? 0) > 1;
}

function ruleAnchor(snapshot: IdentitySnapshot, issue: Issue): string | undefined {
  const anchor = ruleRowAnchor(snapshot, issue);
  if (!anchor || anchor.occurrences !== 1) return undefined;
  const { raw, parts, key } = anchor;
  const old = issueIdentity([...ruleIssueIdentityParts(issue.checkId!, issue.sheet!, issue.cell!, buildCellDict(raw), true), 0]);
  const stable = issueIdentity([...parts, 0]);
  if (issue.id !== old && issue.id !== stable) return undefined;
  return key;
}

/** Exact 1↔1 proof only. Return the old case ID for existing PUT/history links,
 * while all observed fields (including physical cell/row) remain current. */
export function reconnectRuleDecisions(snapshot: IdentitySnapshot, cases: SavedRuleDecision[]): Issue[] {
  const anchors = snapshot.issues.map(issue => ruleAnchor(snapshot, issue));
  return snapshot.issues.map((issue, index) => {
    const anchor = anchors[index];
    if (!anchor || anchors.filter(key => key === anchor).length !== 1) return issue;
    const groups = new Map<string, SavedRuleDecision[]>();
    for (const saved of cases) groups.set(saved.id, [...(groups.get(saved.id) ?? []), saved]);
    const candidates = [...groups.values()].filter(versions => versions.every(saved => {
      const previous = saved.snapshot.issues?.find(candidate => candidate.id === saved.id);
      return previous && ruleAnchor(saved.snapshot, previous) === anchor;
    })).map(versions => versions[0]);
    if (candidates.length !== 1) return issue;
    return { ...issue, id: candidates[0].id, status: candidates[0].status as Issue['status'] };
  });
}
