import { describe, expect, it } from 'vitest';
import { formulaDiagnosticInapplicableReason } from './issue-conversion.js';

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
