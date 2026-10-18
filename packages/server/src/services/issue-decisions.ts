import type { Issue, DataSnapshot } from '@aemr/shared';
import { computeTrustScore, issueIdentity, ruleIssueIdentityParts } from '@aemr/core';
import { buildCellDict, DEPT_HEADER_ROWS, classifySheet, formulaDiagnosticInapplicableReason } from '@aemr/shared';
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
  const resolveAnchor = createRuleRowAnchorResolver();
  const current = issues.map((issue) => {
    const persisted = statusById.get(issue.id);
    // Both unique and duplicate rows keep an already open persisted status.
    // Every other status still requires the full identity check below.
    if (persisted === 'open') return { ...issue, status: 'open' as const };
    // Occurrence numbers distinguish duplicates for transport, not ownership.
    // Inserting an identical row can hand occurrence zero to a different row.
    if (snapshot && (resolveAnchor(snapshot, issue)?.occurrences ?? 0) > 1) return { ...issue, status: 'open' as const };
    return persisted ? { ...issue, status: persisted as Issue['status'] } : issue;
  });
  if (!snapshot?.rowsByDept) return current;
  const decisionIds = new Set(db.select({ id: schema.issueHistory.issueId }).from(schema.issueHistory).all().map(r => r.id));
  for (const event of db.select({ id: schema.auditLog.entityId }).from(schema.auditLog).where(eq(schema.auditLog.action, 'issue_comment')).all()) if (event.id) decisionIds.add(event.id);
  const saved = db.select().from(schema.issues).all().filter(r => decisionIds.has(r.id) || r.status !== 'open' || !!r.comment?.trim());
  for (const savedIssue of saved) decisionIds.add(savedIssue.id);
  const cases: SavedRuleDecision[] = [];
  for (const savedIssue of saved) {
    // Pipeline diagnostics/signals cannot enter the rule-only rebind below.
    // Missing or unknown producer metadata still requires the full legacy proof.
    if (issues.some(issue => issue.id === savedIssue.id) || !savedIssue.snapshotId
      || savedIssue.detectedBy?.startsWith('pipeline:')) continue;
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
  const proved = reconnectRuleDecisionsUsing({ ...snapshot, issues: current }, cases, resolveAnchor);
  return proved.map((issue, index) => decisionIds.has(issues[index].id) ? current[index] : issue);
}

/** Request-time decision view; the stored/cached source snapshot stays immutable. */
export function withPersistedDecisions<T extends DataSnapshot>(snapshot: T): T {
  const issues = overlayPersistedStatus(snapshot.issues ?? [], snapshot);
  const changed = issues.some((issue, index) => issue.status !== snapshot.issues[index].status
    || formulaDiagnosticInapplicableReason(issue));
  return { ...snapshot, issues, trust: changed
    ? computeTrustScore(new Map(Object.entries(snapshot.officialMetrics)), issues, snapshot.deltas ?? [], snapshot.id)
    : snapshot.trust };
}

type IdentitySnapshot = Pick<DataSnapshot, 'issues' | 'rowsByDept'>;
type SavedRuleDecision = { id: string; status: string; snapshot: IdentitySnapshot };

/** Request-local exact indices; status views share source arrays. Nothing is
 * retained across requests, source changes, or historical snapshot versions. */
function createRuleRowAnchorResolver() {
  const cells = new WeakMap<unknown[], ReturnType<typeof buildCellDict>>();
  const indices = new WeakMap<unknown[][], Map<string, Map<string, number>>>();
  const rowCells = (raw: unknown[]) => {
    let value = cells.get(raw);
    if (!value) { value = buildCellDict(raw); cells.set(raw, value); }
    return value;
  };
  return (snapshot: IdentitySnapshot, issue: Issue) => {
    if (!issue.detectedBy?.startsWith('rule:') || !issue.sheet || !issue.checkId || !issue.row) return undefined;
    const column = /^([A-Z]+)\d+$/.exec(issue.cell ?? '')?.[1];
    if (!column) return undefined;
    const kind = classifySheet(issue.sheet).kind;
    if (kind !== 'department' && kind !== 'subordinates_agg') return undefined;
    const rows = snapshot.rowsByDept?.[issue.sheet];
    const raw = rows?.[issue.row - DEPT_HEADER_ROWS - 1];
    if (!raw || !rows) return undefined;
    const parts = ruleIssueIdentityParts(issue.checkId, issue.sheet, issue.cell!, rowCells(raw));
    const key = issueIdentity(parts);
    let byRule = indices.get(rows);
    if (!byRule) { byRule = new Map(); indices.set(rows, byRule); }
    const scope = JSON.stringify([issue.checkId, issue.sheet, column]);
    let counts = byRule.get(scope);
    if (!counts) {
      counts = new Map();
      for (const row of rows) {
        const candidate = issueIdentity(ruleIssueIdentityParts(issue.checkId, issue.sheet, issue.cell!, rowCells(row)));
        counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
      }
      byRule.set(scope, counts);
    }
    return { raw, parts, key, occurrences: counts.get(key) ?? 0 };
  };
}

type RuleRowAnchorResolver = ReturnType<typeof createRuleRowAnchorResolver>;

function ruleAnchor(snapshot: IdentitySnapshot, issue: Issue, resolveAnchor: RuleRowAnchorResolver): string | undefined {
  const anchor = resolveAnchor(snapshot, issue);
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
  return reconnectRuleDecisionsUsing(snapshot, cases, createRuleRowAnchorResolver());
}

function reconnectRuleDecisionsUsing(snapshot: IdentitySnapshot, cases: SavedRuleDecision[], resolveAnchor: RuleRowAnchorResolver): Issue[] {
  if (cases.length === 0) return snapshot.issues.slice();
  const anchors = snapshot.issues.map(issue => ruleAnchor(snapshot, issue, resolveAnchor));
  const occurrences = new Map<string, number>();
  for (const anchor of anchors) if (anchor) occurrences.set(anchor, (occurrences.get(anchor) ?? 0) + 1);
  const groups = new Map<string, SavedRuleDecision[]>();
  for (const saved of cases) {
    const versions = groups.get(saved.id);
    if (versions) versions.push(saved); else groups.set(saved.id, [saved]);
  }
  const candidates = new Map<string, SavedRuleDecision[]>();
  for (const versions of groups.values()) {
    let common: string | undefined;
    let proved = true;
    for (const saved of versions) {
      const previous = saved.snapshot.issues?.find(candidate => candidate.id === saved.id);
      const anchor = previous && ruleAnchor(saved.snapshot, previous, resolveAnchor);
      if (!anchor || (common !== undefined && anchor !== common)) { proved = false; break; }
      common = anchor;
    }
    if (!proved || !common) continue;
    const matches = candidates.get(common);
    if (matches) matches.push(versions[0]); else candidates.set(common, [versions[0]]);
  }
  return snapshot.issues.map((issue, index) => {
    const anchor = anchors[index];
    if (!anchor || occurrences.get(anchor) !== 1) return issue;
    const matches = candidates.get(anchor);
    if (matches?.length !== 1) return issue;
    return { ...issue, id: matches[0].id, status: matches[0].status as Issue['status'] };
  });
}
