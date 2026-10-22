/**
 * Single case-decision lifecycle for server and web. A status transition changes
 * the recorded human decision, not the immutable source observation. In particular,
 * resolved/wont_fix do not certify source repair; false_positive is the only status
 * excluded from current risk signals (history retains it).
 */
import type { IssueStatus } from './types.js';

export const ISSUE_STATUS_TRANSITIONS: Readonly<Record<IssueStatus, readonly IssueStatus[]>> = {
  open: ['acknowledged', 'in_progress', 'wont_fix', 'false_positive'],
  acknowledged: ['in_progress', 'wont_fix', 'false_positive'],
  in_progress: ['resolved', 'wont_fix', 'false_positive'],
  resolved: ['open'],
  wont_fix: ['open'],
  false_positive: ['open'],
};

/** Unknown and object-prototype keys must not produce a transition. */
export function allowedIssueTransitions(status: string): readonly IssueStatus[] {
  return Object.prototype.hasOwnProperty.call(ISSUE_STATUS_TRANSITIONS, status)
    ? ISSUE_STATUS_TRANSITIONS[status as IssueStatus]
    : [];
}

export function issueTransitionNeedsReason(target: string): boolean {
  return target === 'wont_fix' || target === 'false_positive';
}
