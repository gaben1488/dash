/**
 * Quality of source-book data, not a judgement of an employee.
 *
 * CHECK_REGISTRY and ISSUE_GROUP_META use group IDs such as "completeness" and
 * "data_integrity". "data_quality" is a *trust component*, not an issue group.
 * Keep that distinction here, otherwise every row looks clean.
 *
 * Technical/runtime failures have their own owner and must not be attributed to
 * an operator merely because they happened while reading their book.
 */
import { CHECK_REGISTRY, TRUST_COMPONENT_CONFIG } from '@aemr/shared';
import type { Issue } from '@aemr/shared';

type QualityIssue = Pick<Issue, 'departmentId' | 'checkId' | 'group' | 'category' | 'origin' | 'row'>;

const qualityGroups: ReadonlySet<string> =
  new Set(TRUST_COMPONENT_CONFIG.data_quality.issueGroups);

const qualityChecks = new Map<string, boolean>();
for (const check of CHECK_REGISTRY) {
  qualityChecks.set(check.id, check.trustComponent === 'data_quality');
  if (check.legacyId) qualityChecks.set(check.legacyId, check.trustComponent === 'data_quality');
}

function isQualityFinding(issue: QualityIssue): boolean {
  if (issue.origin === 'runtime_error') return false;

  // Exact check semantics take precedence over generic group fallbacks.
  if (issue.checkId && qualityChecks.has(issue.checkId)) {
    return qualityChecks.get(issue.checkId) === true;
  }
  if (issue.group && qualityGroups.has(issue.group)) return true;

  // Pre-unified historical snapshots lack group/checkId.
  return issue.category === 'signal:dataQuality' ||
    issue.category === 'signal:dateWithoutFact';
}

/**
 * Return the proportion of distinct source rows without data-quality findings.
 * Multiple independent checks on one row count as one affected row.
 *
 * No rows -> legacy neutral result (the scorecard route separately issues noData).
 * This is a provisional measure; the next model uses verifiable coverage and
 * attributed, action-oriented cases rather than treating it as an employee KPI.
 */
export function dataQualityScore(
  issues: readonly QualityIssue[],
  grbsId: string,
  grbsShort: string,
  rowCount: number,
): number {
  if (rowCount <= 0) return 1;

  const affected = new Set<number>();
  for (const issue of issues) {
    if (issue.departmentId !== grbsId && issue.departmentId !== grbsShort) continue;
    if (!isQualityFinding(issue)) continue;
    // Sheet-level finding: one affected unit, never all its rows by fiat.
    affected.add(issue.row ?? -1);
  }

  return Math.min(1, Math.max(0, 1 - affected.size / rowCount));
}
