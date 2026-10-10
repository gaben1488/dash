import { describe, expect, it } from 'vitest';
import type { Issue } from './types.js';
import { buildControlCases, controlCaseCounters } from './control-cases.js';

function finding(patch: Partial<Issue> = {}): Issue {
  return {
    id: 'old-issue-1', severity: 'warning', origin: 'bi_heuristic',
    category: 'signal:planYearMissing', title: 'Отсутствует год плана',
    description: 'Плановая дата требует уточнения',
    signal: 'planYearMissing', sheet: 'ВСЕ', row: 173,
    rowSeq: '173/1', departmentId: 'uo', subordinateId: 'МКУ А',
    recommendation: 'Проверить исходную плановую дату.',
    status: 'open', detectedAt: '2026-10-10T00:00:00Z',
    detectedBy: 'test', ...patch,
  };
}

describe('canonical control-case projection', () => {
  it('merges only equivalent checks on the same observed row and keeps every original Issue ID', () => {
    const cases = buildControlCases([
      finding(),
      finding({
        id: 'old-issue-2', origin: 'spreadsheet_rule', category: 'rule:plan_year_missing',
        signal: undefined, checkId: 'plan_year_missing',
      }),
    ]);
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      checkId: 'plan_year_missing', observationCount: 2,
      identityScope: 'snapshot', issueIds: ['old-issue-1', 'old-issue-2'],
      workState: 'needs_review', provenFinancialEffect: null,
    });
    expect(controlCaseCounters(cases)).toMatchObject({ cases: 1, observations: 2 });
  });

  it('does not merge distinct causes found on the same row', () => {
    expect(buildControlCases([
      finding(), finding({ id: 'x2', checkId: 'fact_quarter_missing',
        signal: 'factQuarterMissing', category: 'signal:factQuarterMissing' }),
    ])).toHaveLength(2);
  });

  it('does not mistake 173, 173/1 and 173/2 for the same procurement object', () => {
    const result = buildControlCases([
      finding({ rowSeq: '173', id: 'a' }),
      finding({ rowSeq: '173/1', id: 'b' }),
      finding({ rowSeq: '173/2', id: 'c' }),
    ]);
    expect(result).toHaveLength(3);
  });

  it('avoids grouping across institutions and departments even if row and check match', () => {
    expect(buildControlCases([
      finding(),
      finding({ id: 'another-sub', subordinateId: 'МКУ Б' }),
      finding({ id: 'another-dept', departmentId: 'ud' }),
    ])).toHaveLength(3);
  });

  it('unknown/unaddressed checks are separate until their identity is established', () => {
    expect(buildControlCases([
      finding({ id: 'u1', row: undefined, checkId: undefined, signal: undefined, category: 'unknown' }),
      finding({ id: 'u2', row: undefined, checkId: undefined, signal: undefined, category: 'unknown' }),
    ])).toHaveLength(2);
  });

  it('a human acknowledgement is not independent verification of an actual correction', () => {
    expect(buildControlCases([finding({ status: 'resolved' })])[0].workState).toBe('needs_reverification');
    expect(buildControlCases([finding({ status: 'in_progress' })])[0].workState).toBe('in_progress');
    expect(buildControlCases([finding({ status: 'false_positive' })])[0].workState).toBe('false_positive');
  });

  it('mixed human decisions remain visible rather than converting into automatic closure', () => {
    const cases = buildControlCases([
      finding({ status: 'resolved' }),
      finding({ id: 'old-issue-2', status: 'open', checkId: 'plan_year_missing', signal: undefined }),
    ]);
    expect(cases[0].workState).toBe('mixed');
  });

  it('cannot invent a recommendation when source checks disagree', () => {
    const [c] = buildControlCases([
      finding({ recommendation: 'Проверить дату.' }),
      finding({ id: 'b', recommendation: 'Удалить закупку.', checkId: 'plan_year_missing', signal: undefined }),
    ]);
    expect(c.recommendationConflict).toBe(true);
    expect(c.recommendation).toBeNull();
  });

  it('declares actual financial consequences unknown until independently verified', () => {
    const [c] = buildControlCases([
      finding({ severity: 'critical', checkId: 'formula_mutant', signal: undefined,
        category: 'signal:formula_mutant' }),
    ]);
    expect(c.impact).toBe('calculation_possible');
    expect(c.verifiedImpact).toBe(false);
    expect(c.provenFinancialEffect).toBeNull();
  });

  it('recognizes directly observed mismatches without claiming which side is wrong', () => {
    const [c] = buildControlCases([finding({
      origin: 'delta_mismatch', signal: undefined, category: 'delta_mismatch',
      checkId: undefined, metricKey: 'official.2026.plan',
    })]);
    expect(c.impact).toBe('observed_discrepancy');
    expect(c.verifiedImpact).toBe(true);
    expect(c.affectedMetricKeys).toEqual(['official.2026.plan']);
  });

  it('preserves all cases and observations without mutating the provided snapshot', () => {
    const source = [finding(), finding({ id: 'b', checkId: 'plan_year_missing', signal: undefined })];
    const previous = JSON.stringify(source);
    const result = buildControlCases(source);
    expect(JSON.stringify(source)).toBe(previous);
    expect(result[0].evidence[0]).toBe(source[0]);
  });
});
