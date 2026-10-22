import { describe, expect, it, vi } from 'vitest';
import type { DataSnapshot, Issue } from '@aemr/shared';
import { buildCellDict } from '@aemr/shared';
import { issueIdentity, ruleIssueIdentityParts } from '@aemr/core';
vi.mock('../db/index.js', () => ({ db: {}, schema: {} }));
import { reconnectRuleDecisions } from './issue-decisions.js';

function row(org = 'Учреждение', subject = 'Поставка'): unknown[] { const value = new Array(34).fill(''); value[0] = '173/18'; value[1] = '42'; value[2] = org; value[6] = subject; return value; }
function snapshot(rows: unknown[][], physical = 4, legacy = false): Pick<DataSnapshot, 'issues' | 'rowsByDept'> {
  const cells = buildCellDict(rows[physical - 4]);
  const issue: Issue = { id: issueIdentity([...ruleIssueIdentityParts('budget_sum_plan', 'УКСиМП', `K${physical}`, cells, legacy), 0]), checkId: 'budget_sum_plan', category: 'budget_sum_plan', detectedBy: 'rule:budget_sum_plan', sheet: 'УКСиМП', cell: `K${physical}`, row: physical, status: 'open', severity: 'critical', origin: 'spreadsheet_rule', title: 'Budget', description: 'Budget', detectedAt: '2026-10-12T00:00:00Z' };
  return { rowsByDept: { 'УКСиМП': rows }, issues: [issue] };
}
describe('rule decision identity compatibility', () => {
  it('reconnects a proved unique old case while keeping its new physical address', () => {
    const old = snapshot([row()], 4, true);
    const current = snapshot([row('Другой', 'Другой'), row()], 5);
    const result = reconnectRuleDecisions(current, [{ id: old.issues[0].id, status: 'false_positive', snapshot: old }]);
    expect(result[0]).toMatchObject({ id: old.issues[0].id, status: 'false_positive', row: 5, cell: 'K5' });
    expect(current.issues[0].id).not.toBe(old.issues[0].id);
    expect(old.issues[0].cell).toBe('K4');
  });
  it.each(['old', 'current'])('does not reconnect duplicated anchors in %s snapshot', which => {
    const old = snapshot(which === 'old' ? [row(), row()] : [row()], 4, true);
    const current = snapshot(which === 'current' ? [row(), row()] : [row()]);
    expect(reconnectRuleDecisions(current, [{ id: old.issues[0].id, status: 'false_positive', snapshot: old }])[0].status).toBe('open');
  });
  it.each(['org', 'subject', 'number'])('does not reconnect changed %s', changed => {
    const old = snapshot([row()], 4, true);
    const value = row(changed === 'org' ? 'Иной' : 'Учреждение', changed === 'subject' ? 'Иной' : 'Поставка');
    if (changed === 'number') value[1] = 'other';
    const current = snapshot([value]);
    expect(reconnectRuleDecisions(current, [{ id: old.issues[0].id, status: 'false_positive', snapshot: old }])[0].status).toBe('open');
  });
  it('requires historical raw rows and verified legacy hash', () => {
    const old = snapshot([row()], 4, true); const current = snapshot([row()]);
    for (const historical of [{ ...old, rowsByDept: undefined }, { ...old, issues: [{ ...old.issues[0], id: 'invented' }] }]) {
      expect(reconnectRuleDecisions(current, [{ id: historical.issues[0].id, status: 'false_positive', snapshot: historical }])[0].status).toBe('open');
    }
  });
  it('does not choose between conflicting historical decisions', () => {
    const old = snapshot([row()], 4, true); const another = snapshot([row('Different', 'Else'), row()], 5, true); const current = snapshot([row()]);
    expect(reconnectRuleDecisions(current, [old, another].map(s => ({ id: s.issues[0].id, status: 'false_positive', snapshot: s })))[0].status).toBe('open');
  });
  it('accepts repeated versions of the same case only when every version proves the same anchor', () => {
    const old = snapshot([row()], 4, true); const current = snapshot([row()]);
    const saved = { id: old.issues[0].id, status: 'false_positive', snapshot: old };
    expect(reconnectRuleDecisions(current, [saved, saved])[0].status).toBe('false_positive');
    const changed = snapshot([row('Different organization')], 4, true);
    expect(changed.issues[0].id).toBe(old.issues[0].id); // old hash omitted C
    expect(reconnectRuleDecisions(current, [saved, { ...saved, snapshot: changed }])[0].status).toBe('open');
  });

  it('recomputes identity when the same source arrays change between requests', () => {
    const old = snapshot([row()], 4, true);
    const current = snapshot([row()]);
    const saved = [{ id: old.issues[0].id, status: 'false_positive', snapshot: old }];
    expect(reconnectRuleDecisions(current, saved)[0].status).toBe('false_positive');
    current.rowsByDept!['УКСиМП'][0][2] = 'Changed organization';
    expect(reconnectRuleDecisions(current, saved)[0].status).toBe('open');
    current.rowsByDept!['УКСиМП'][0][2] = 'Учреждение';
    current.rowsByDept!['УКСиМП'].push(row());
    expect(reconnectRuleDecisions(current, saved)[0].status).toBe('open');
  });
  it('keeps rule and column scopes separate even when rows are shared', () => {
    const old = snapshot([row()], 4, true);
    const current = snapshot([row()]);
    const scoped = (checkId: string, column: string, legacy: boolean): Issue => {
      const source = legacy ? old : current;
      return { ...source.issues[0], checkId, detectedBy: `rule:${checkId}`, cell: `${column}4`,
        id: issueIdentity([...ruleIssueIdentityParts(checkId, 'УКСиМП', `${column}4`, buildCellDict(source.rowsByDept!['УКСиМП'][0]), legacy), 0]) };
    };
    old.issues.push(scoped('other_rule', 'K', true), scoped('budget_sum_plan', 'N', true));
    current.issues.push(scoped('other_rule', 'K', false), scoped('budget_sum_plan', 'N', false));
    const saved = old.issues.map(issue => ({ id: issue.id, status: 'false_positive', snapshot: old }));
    expect(reconnectRuleDecisions(current, saved).map(issue => issue.id)).toEqual(old.issues.map(issue => issue.id));
    expect(reconnectRuleDecisions(current, saved).every(issue => issue.status === 'false_positive')).toBe(true);
  });
  it('refuses a saved decision when two current issues prove the same anchor', () => {
    const old = snapshot([row()], 4, true);
    const current = snapshot([row()]);
    current.issues.push({ ...current.issues[0] });
    expect(reconnectRuleDecisions(current, [{ id: old.issues[0].id, status: 'false_positive', snapshot: old }]).every(issue => issue.status === 'open')).toBe(true);
  });

});

it('projects current Trust rules without rewriting a stored historical score', async () => {
  const { withPersistedDecisions } = await import('./issue-decisions.js');
  const saved = {
    id: 'old', issues: [], officialMetrics: {}, deltas: [],
    trust: { overall: 73, grade: 'C', components: [], computedAt: 'old', basedOnSnapshot: 'old' },
  } as unknown as DataSnapshot;
  const view = withPersistedDecisions(saved);
  expect(view.trust.overall).toBeNull();
  expect(saved.trust.overall).toBe(73);
});
