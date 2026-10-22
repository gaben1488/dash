import { describe, expect, it, vi } from 'vitest';
import { buildCellDict } from '@aemr/shared';
import type { DataSnapshot, Issue } from '@aemr/shared';
import { issueIdentity, ruleIssueIdentityParts } from '@aemr/core';

vi.mock('../db/index.js', () => ({ db: {}, schema: {} }));

import { collectHistoricalRuleDecisions, reconnectRuleDecisions } from './issue-decisions.js';

type Historical = Pick<DataSnapshot, 'issues' | 'rowsByDept'>;
const record = (snapshot: Historical): { data: string } => ({ data: JSON.stringify(snapshot) });
const candidate = (id: string) => ({ id, status: 'false_positive' });

function ruleSnapshot(organization = 'Учреждение', legacy = false): Historical {
  const row = new Array(34).fill('');
  row[0] = '173/18';
  row[1] = '42';
  row[2] = organization;
  row[6] = 'Поставка';
  const id = issueIdentity([...ruleIssueIdentityParts('budget_sum_plan', 'УКСиМП', 'K4', buildCellDict(row), legacy), 0]);
  const issue = {
    id, sheet: 'УКСиМП', row: 4, cell: 'K4', checkId: 'budget_sum_plan',
    detectedBy: 'rule:budget_sum_plan', status: 'open',
  } as Issue;
  return { rowsByDept: { УКСиМП: [row] }, issues: [issue] };
}

describe('C05.11: one-pass historical decision evidence', () => {
  it('streams snapshots exactly once for multiple independent candidates, without partial-ID matches', () => {
    const cases = [candidate('a.b[1]+'), candidate('173/18'), candidate('unknown')];
    let traversed = 0;
    function* historical() {
      for (const data of [
        JSON.stringify({ issues: [{ id: 'a.b[1]+' }, { id: '173/18' }], rowsByDept: {} }),
        JSON.stringify({ issues: [{ id: '173/180' }], note: 'a.b[1]+' }),
        JSON.stringify({ issues: [{ id: 'else' }] }),
      ]) { traversed++; yield { data }; }
    }
    const found = collectHistoricalRuleDecisions(cases, historical());
    expect(traversed).toBe(3);
    expect(found.map(x => x.id)).toEqual(['a.b[1]+', '173/18']);
    expect(found.every(x => x.status === 'false_positive')).toBe(true);
  });

  it('rejects every version of one case when a matching historical payload is malformed', () => {
    const id = 'case[1]';
    const records = [
      { data: JSON.stringify({ issues: [{ id }] }) },
      { data: '{"issues":[{"id":"case[1]"}' },
      { data: JSON.stringify({ issues: [{ id: 'safe' }] }) },
    ];
    const found = collectHistoricalRuleDecisions([candidate(id), candidate('safe')], records);
    expect(found.map(x => x.id)).toEqual(['safe']);
  });

  it('rejects malformed issue arrays without poisoning unrelated cases', () => {
    const records = [
      { data: JSON.stringify({ issues: { id: 'bad' } }) },
      { data: JSON.stringify({ issues: [{ id: 'good' }] }) },
    ];
    expect(collectHistoricalRuleDecisions([candidate('bad'), candidate('good')], records).map(x => x.id))
      .toEqual(['good']);
  });

  it('does not translate a past decision if two historical versions disagree on organization', () => {
    const old = ruleSnapshot('Учреждение', true);
    const conflicting = ruleSnapshot('Другое учреждение', true);
    const current = ruleSnapshot('Учреждение');
    // Legacy ID omitted organization C; it can be identical for two different owners.
    expect(conflicting.issues[0].id).toBe(old.issues[0].id);
    const cases = collectHistoricalRuleDecisions(
      [candidate(old.issues[0].id)], [record(old), record(conflicting)],
    );
    expect(cases).toHaveLength(2);
    expect(reconnectRuleDecisions(current, cases)[0].status).toBe('open');
    expect(reconnectRuleDecisions(current, collectHistoricalRuleDecisions(
      [candidate(old.issues[0].id)], [record(old)],
    ))[0]).toMatchObject({ id: old.issues[0].id, status: 'false_positive' });
  });

  it('does not read a cursor when there is no historical candidate', () => {
    let reads = 0;
    function* history() { reads++; yield { data: JSON.stringify({ issues: [] }) }; }
    expect(collectHistoricalRuleDecisions([], history())).toEqual([]);
    expect(reads).toBe(0);
  });
});
