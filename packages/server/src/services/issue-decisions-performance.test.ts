import { describe, expect, it, vi } from 'vitest';
import type { DataSnapshot, Issue } from '@aemr/shared';
import { buildCellDict } from '@aemr/shared';
import { issueIdentity, ruleIssueIdentityParts } from '@aemr/core';

vi.mock('../db/index.js', () => ({ db: {}, schema: {} }));
vi.mock('@aemr/core', async importOriginal => {
  const actual = await importOriginal<typeof import('@aemr/core')>();
  return { ...actual, issueIdentity: vi.fn(actual.issueIdentity) };
});
import { reconnectRuleDecisions } from './issue-decisions.js';

describe('decision readback work on one book', () => {
  it('bounds identity hashing by source rows while preserving the legacy decision', () => {
    const raw = Array.from({ length: 80 }, (_, index) => {
      const row: unknown[] = new Array(34).fill('');
      row[0] = `173/${index + 1}`;
      row[1] = String(index + 1);
      row[2] = 'Fixture institution';
      row[6] = `Fixture procurement subject ${index + 1}`;
      return row;
    });
    const makeIssue = (index: number, legacy = false): Issue => ({
      id: issueIdentity([...ruleIssueIdentityParts('budget_sum_plan', 'УКСиМП', `K${index + 4}`, buildCellDict(raw[index]), legacy), 0]),
      checkId: 'budget_sum_plan', category: 'budget_sum_plan', detectedBy: 'rule:budget_sum_plan',
      sheet: 'УКСиМП', cell: `K${index + 4}`, row: index + 4, status: 'open',
      severity: 'critical', origin: 'spreadsheet_rule', title: 'Fixture', description: 'Fixture', detectedAt: '2026-10-15T00:00:00Z',
    });
    const current: Pick<DataSnapshot, 'issues' | 'rowsByDept'> = {
      issues: raw.map((_, index) => makeIssue(index)), rowsByDept: { УКСиМП: raw },
    };
    const old = { ...current, issues: [makeIssue(0, true)] };
    vi.mocked(issueIdentity).mockClear();
    const result = reconnectRuleDecisions(current, [{ id: old.issues[0].id, status: 'false_positive', snapshot: old }]);
    expect(result[0]).toMatchObject({ id: old.issues[0].id, status: 'false_positive', row: 4 });
    expect(result.slice(1).every(issue => issue.status === 'open')).toBe(true);
    expect(vi.mocked(issueIdentity).mock.calls.length).toBeLessThanOrEqual(raw.length * 8);
    expect(current.issues.every(issue => issue.status === 'open')).toBe(true);
  });
});
