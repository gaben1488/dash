import { describe, expect, it } from 'vitest';
import { ISSUE_STATUS_LABELS } from './product-dictionary.js';
import { ISSUE_STATUS_TRANSITIONS, allowedIssueTransitions, issueTransitionNeedsReason } from './issue-status-transitions.js';

describe('case decision lifecycle (shared contract)', () => {
  it('covers every product status; open cannot claim resolved without work', () => {
    expect(Object.keys(ISSUE_STATUS_TRANSITIONS).sort()).toEqual(Object.keys(ISSUE_STATUS_LABELS).sort());
    expect(allowedIssueTransitions('open')).not.toContain('resolved');
    expect(allowedIssueTransitions('in_progress')).toContain('resolved');
  });
  it('terminal decisions reopen, without erasing their historical event', () => {
    for (const status of ['resolved', 'wont_fix', 'false_positive']) {
      expect(allowedIssueTransitions(status)).toEqual(['open']);
    }
  });
  it('unknown and object prototype status keys never grant transitions', () => {
    for (const key of ['unknown', '__proto__', 'constructor', 'toString']) {
      expect(allowedIssueTransitions(key)).toEqual([]);
    }
  });
  it('requires human reason for exclusion or refusal, but not an ordinary progress update', () => {
    expect(issueTransitionNeedsReason('false_positive')).toBe(true);
    expect(issueTransitionNeedsReason('wont_fix')).toBe(true);
    expect(issueTransitionNeedsReason('resolved')).toBe(false);
    expect(issueTransitionNeedsReason('open')).toBe(false);
  });
});
