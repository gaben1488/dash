import { describe, expect, it } from 'vitest';
import { withReviewedIssueStatus } from './control-status-readmodel';

describe('withReviewedIssueStatus', () => {
  it('does not create a snapshot when there is no data', () => {
    expect(withReviewedIssueStatus(null, 'some', 'acknowledged')).toBeNull();
  });
  it('keeps observations immutable while showing a saved decision on every consumer', () => {
    const i = { id: 'a', status: 'open' };
    const other = { id: 'b', status: 'open' };
    const current = {
      snapshot: { id: 'snap-1', issues: [i, other] },
      recentIssues: [i],
      year: 2026,
    } as any;
    const next = withReviewedIssueStatus(current, 'a', 'false_positive')!;
    expect(next.snapshot.issues.map((x) => x.status)).toEqual(['false_positive', 'open']);
    expect(next.recentIssues.map((x) => x.status)).toEqual(['false_positive']);
    expect(current.snapshot.issues[0].status).toBe('open');
    expect(next.snapshot.id).toBe('snap-1');
    expect(next.year).toBe(2026);
  });
});
