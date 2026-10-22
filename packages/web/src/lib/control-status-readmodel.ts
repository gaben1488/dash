import type { DashboardData, IssueStatus } from '@aemr/shared';

/**
 * One visible decision across the current Issues/Recommendations/Trust screens.
 * The server remains authoritative and this runs ONLY after a successful PUT.
 * Source snapshots stored in SQL/Google Sheets are unaffected.
 */
export function withReviewedIssueStatus(
  current: DashboardData | null,
  issueId: string,
  status: IssueStatus,
): DashboardData | null {
  if (!current) return null;
  const apply = <T extends { id: string; status: IssueStatus }>(issues: readonly T[]): T[] =>
    issues.map(i => i.id === issueId ? { ...i, status } : i);
  return {
    ...current,
    snapshot: { ...current.snapshot, issues: apply(current.snapshot.issues) },
    recentIssues: apply(current.recentIssues),
  };
}
