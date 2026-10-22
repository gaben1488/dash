import { describe, expect, it } from 'vitest';
import { formulaDiagnosticInapplicableReason, isDepartmentRiskIssue } from './issue-conversion.js';

const header = { checkId: 'formula_overwritten', sheet: 'УЭР', row: 1, cell: 'AA1' };
describe('historical numbering-header diagnostics', () => {
  it.each(['K', 'O', 'P', 'R', 'S', 'T', 'Y', 'Z', 'AA', 'AB', 'AC'])
    ('recognizes a proven header address %s1 without changing its record', column => {
      const issue = { ...header, cell: `${column}1` };
      const before = structuredClone(issue);
      expect(formulaDiagnosticInapplicableReason(issue)).toContain('шапки');
      expect(issue).toEqual(before);
    });
  it.each([
    { row: 4, cell: 'AA4' }, { cell: 'AA4' }, { row: 2 },
    { row: undefined }, { row: '1' }, { row: 1.5 },
    { cell: undefined }, { cell: 'AA1:AA4' }, { cell: 'A1' },
    { sheet: 'СВОД ТД-ПМ' }, { sheet: undefined }, { checkId: 'budget_sum_plan' },
  ])('does not absolve missing, conflicting or unrelated evidence %j', override => {
    expect(formulaDiagnosticInapplicableReason({ ...header, ...override })).toBeUndefined();
  });
  it('accepts absolute lower-case cell coordinates', () => {
    expect(formulaDiagnosticInapplicableReason({ ...header, cell: '$aa$1' })).toContain('шапки');
  });
});


describe('C06.01: identical risk classification for dashboard, compliance and metrics', () => {
  const base = { status: 'open', origin: 'bi_heuristic', category: 'signal:overdue', checkId: 'overdue' };
  it('keeps actionable source findings until reread but not false positives', () => {
    expect(isDepartmentRiskIssue(base)).toBe(true);
    expect(isDepartmentRiskIssue({ ...base, status: 'resolved' })).toBe(true);
    expect(isDepartmentRiskIssue({ ...base, status: 'wont_fix' })).toBe(true);
    expect(isDepartmentRiskIssue({ ...base, status: 'false_positive' })).toBe(false);
  });
  it('separates normal annual stages, future reminders and funding from fault', () => {
    for (const checkId of ['plan_year_missing', 'fact_without_date',
      'foreign_year_execution', 'fact_date_before_plan', 'future_economy_decision']) {
      expect(isDepartmentRiskIssue({ ...base, checkId })).toBe(false);
    }
    expect(isDepartmentRiskIssue({ ...base, checkId: undefined, category: 'signal:planYearMissing' })).toBe(false);
  });
  it('system failures block proof but never penalize a GRBS employee', () => {
    expect(isDepartmentRiskIssue({ ...base, origin: 'runtime_error' })).toBe(false);
    expect(isDepartmentRiskIssue({ ...base, category: 'signal_detection_failed' })).toBe(false);
    expect(isDepartmentRiskIssue({ ...base, checkId: 'formula_overwritten',
      sheet: 'УЭР', row: 1, cell: 'AA1' })).toBe(false);
  });
});
