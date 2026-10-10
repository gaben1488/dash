/**
 * Canonical READ MODEL for control cases.
 *
 * Producer rules, row signals, reconciliation findings and reviews remain
 * evidence. A case is a user's single reviewable question, not another
 * producer, DB truth or a new field in procurement books.
 *
 * Migration guarantee: source Issue.id values are retained unchanged. Until
 * source-object identity is verified across snapshots, caseKey is explicitly
 * snapshot-scoped and NEVER used to persist workflow history. Consequence
 * labels are hypotheses unless a real independent check has established them.
 */
import type { Issue, IssueSeverity, IssueStatus } from './types.js';
import { CHECK_REGISTRY } from './check-registry.js';
import { LEGACY_SIGNAL_TO_CHECK } from './issue-conversion.js';

export type ControlImpact =
  | 'source_unavailable'
  | 'observed_discrepancy'
  | 'calculation_possible'
  | 'legal_review'
  | 'source_data'
  | 'process_review'
  | 'unclassified';

export type ControlWorkState =
  | 'needs_review'
  | 'acknowledged'
  | 'in_progress'
  | 'needs_reverification'
  | 'exception_recorded'
  | 'false_positive'
  | 'mixed';

export interface ControlCase {
  /** Stable only inside the same snapshot; NOT a durable business identifier. */
  caseKey: string;
  identityScope: 'snapshot';
  checkId: string | null;
  label: string;
  impact: ControlImpact;
  /** Verification is independent of magnitude and severity. */
  verifiedImpact: boolean;
  severity: IssueSeverity;
  workState: ControlWorkState;
  /** Provenance: no source Issue is lost or converted into an anonymous count. */
  evidence: Issue[];
  issueIds: string[];
  observationCount: number;
  departmentId: string | null;
  subordinateId: string | null;
  sheet: string | null;
  row: number | null;
  rowSeq: string | null;
  cell: string | null;
  recommendation: string | null;
  recommendationConflict: boolean;
  affectedMetricKeys: string[];
  /** Never infer damage in rubles from the planned procurement amount. */
  provenFinancialEffect: null;
}

const checks = new Map(CHECK_REGISTRY.map(c => [c.id, c]));
for (const c of CHECK_REGISTRY) {
  if (c.legacyId && !checks.has(c.legacyId)) checks.set(c.legacyId, c);
}

const rank: Record<IssueSeverity, number> = {
  info: 0, warning: 1, significant: 2, error: 3, critical: 4,
};

function canonicalCheck(issue: Issue): string | null {
  if (issue.checkId && checks.has(issue.checkId)) return checks.get(issue.checkId)!.id;
  const signal = issue.signal || (issue.category.startsWith('signal:') ? issue.category.slice(7) : '');
  if (signal) {
    const mapped = LEGACY_SIGNAL_TO_CHECK[signal];
    if (mapped && checks.has(mapped)) return mapped;
  }
  return null;
}

/** A shared location alone does not prove a shared root cause.
 * Only equivalent known check IDs in the SAME source row may be grouped. */
function issueLocationKey(issue: Issue, checkId: string | null): string {
  if (checkId === null || !issue.sheet || issue.row == null || !issue.departmentId) {
    return JSON.stringify(['unidentified', issue.id]);
  }
  return JSON.stringify([
    'rule-and-observed-row', checkId,
    issue.departmentId, issue.sheet, issue.subordinateId ?? '',
    issue.row, issue.rowSeq ?? '', issue.cell ?? '',
  ]);
}

function impactOf(issue: Issue, canonical: string | null): ControlImpact {
  if (issue.origin === 'runtime_error') return 'source_unavailable';
  if (issue.origin === 'delta_mismatch') return 'observed_discrepancy';
  const check = canonical ? checks.get(canonical) : undefined;
  if (check?.article44fz) return 'legal_review';
  if (check?.group === 'formula_consistency' ||
      canonical === 'plan_year_missing' || canonical === 'fact_quarter_missing' ||
      issue.origin === 'mapping_error') return 'calculation_possible';
  if (check?.group === 'data_integrity' || check?.group === 'completeness' ||
      check?.group === 'field_validation' || issue.origin === 'language_defect') return 'source_data';
  if (check?.group === 'temporal' || check?.group === 'financial' ||
      check?.group === 'economy_control') return 'process_review';
  return 'unclassified';
}

function stateOf(statuses: readonly IssueStatus[]): ControlWorkState {
  const distinct = [...new Set(statuses)];
  if (distinct.length !== 1) return 'mixed';
  switch (distinct[0]) {
    case 'acknowledged': return 'acknowledged';
    case 'in_progress': return 'in_progress';
    case 'resolved': return 'needs_reverification'; // A click is not a source replay.
    case 'wont_fix': return 'exception_recorded';
    case 'false_positive': return 'false_positive';
    default: return 'needs_review';
  }
}

const impactOrder: Record<ControlImpact, number> = {
  observed_discrepancy: 0,
  source_unavailable: 1,
  calculation_possible: 2,
  legal_review: 3,
  source_data: 4,
  process_review: 5,
  unclassified: 6,
};

/**
 * Build once and reuse for "Замечания", "Рекомендации", action planning and
 * the server read-only API. The model does not conflate informational stages
 * with confirmed defects and does not make legal or employee judgements.
 */
export function buildControlCases(issues: readonly Issue[]): ControlCase[] {
  const groups = new Map<string, Issue[]>();
  for (const issue of issues) {
    const key = issueLocationKey(issue, canonicalCheck(issue));
    const existing = groups.get(key);
    if (existing) {
      if (!existing.some(i => i.id === issue.id)) existing.push(issue);
    } else {
      groups.set(key, [issue]);
    }
  }

  const cases: ControlCase[] = [];
  for (const [caseKey, evidence] of groups) {
    const first = evidence[0];
    const checkId = canonicalCheck(first);
    const check = checkId ? checks.get(checkId) : undefined;
    const actions = [...new Set(evidence.map(i => (i.recommendation || '').trim()).filter(Boolean))];
    const recommendation = actions.length === 1 ? actions[0] : actions.length === 0
      ? (check?.recommendation?.trim() || null) : null;
    const maximum = evidence.reduce(
      (current, i) => rank[i.severity] > rank[current] ? i.severity : current,
      first.severity,
    );
    const impact = impactOf(first, checkId);
    cases.push({
      caseKey,
      identityScope: 'snapshot',
      checkId,
      label: check?.name ?? first.title,
      impact,
      verifiedImpact: impact === 'observed_discrepancy' || impact === 'source_unavailable',
      severity: maximum,
      workState: stateOf(evidence.map(i => i.status)),
      evidence: [...evidence],
      issueIds: evidence.map(i => i.id),
      observationCount: evidence.length,
      departmentId: first.departmentId ?? null,
      subordinateId: first.subordinateId ?? null,
      sheet: first.sheet ?? null,
      row: first.row ?? null,
      rowSeq: first.rowSeq ?? null,
      cell: first.cell ?? null,
      recommendation,
      recommendationConflict: actions.length > 1,
      affectedMetricKeys: [...new Set(evidence.map(i => i.metricKey).filter((x): x is string => Boolean(x)))],
      provenFinancialEffect: null,
    });
  }
  return cases.sort((a, b) =>
    impactOrder[a.impact] - impactOrder[b.impact] ||
    rank[b.severity] - rank[a.severity] ||
    (a.departmentId ?? '').localeCompare(b.departmentId ?? '', 'ru') ||
    a.caseKey.localeCompare(b.caseKey)
  );
}

/**
 * A page-level filter selects whole reviewable cases, not fragments of them.
 *
 * Build the canonical cases from ALL observations already in the global data
 * perimeter, then use the currently visible Issue IDs only to choose which
 * cases to display. Otherwise a status/search filter can hide an acknowledged
 * companion observation and falsely change a mixed case into "new".
 *
 * Source issues, status decisions and snapshot-scoped case keys stay intact.
 */
export function selectControlCasesWithVisibleEvidence(
  cases: readonly ControlCase[],
  visibleIssueIds: ReadonlySet<string>,
): ControlCase[] {
  if (visibleIssueIds.size === 0) return [];
  return cases.filter(c => c.issueIds.some(id => visibleIssueIds.has(id)));
}

export function controlCaseCounters(cases: readonly ControlCase[]) {
  return {
    cases: cases.length,
    observations: cases.reduce((n, c) => n + c.observationCount, 0),
    openForReview: cases.filter(c => c.workState === 'needs_review' || c.workState === 'mixed').length,
    awaitingIndependentRecheck: cases.filter(c => c.workState === 'needs_reverification').length,
    validatedAsFalsePositive: cases.filter(c => c.workState === 'false_positive').length,
  };
}
