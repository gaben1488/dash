import { describe, expect, it } from 'vitest';
import { controlConsequenceOf } from './control-consequence';
import type { Issue } from '@aemr/shared';

function finding(overrides: Partial<Issue>): Pick<Issue, 'checkId' | 'category' | 'origin' | 'severity'> {
  return { checkId: undefined, category: 'other', severity: 'warning', origin: 'bi_heuristic', ...overrides };
}

describe('controlConsequenceOf: impact is not equivalent to severity', () => {
  it('does not promote a potential formula defect to proven financial damage', () => {
    const result = controlConsequenceOf(finding({ checkId: 'formula_mutant', severity: 'error' }));
    expect(result.kind).toBe('possible_calculation_impact');
    expect(result.stateObserved).toBe(false);
    expect(result.explanation).toContain('повторным независимым пересчётом');
  });

  it('shows a failed rule/system check as incomplete verification', () => {
    const result = controlConsequenceOf(finding({ origin: 'runtime_error', category: 'ingest_error', severity: 'info' }));
    expect(result).toMatchObject({ kind: 'control_not_completed', stateObserved: true });
  });

  it('labels direct official-versus-calculated divergence without guessing the guilty source', () => {
    const result = controlConsequenceOf(finding({ origin: 'delta_mismatch', severity: 'warning' }));
    expect(result).toMatchObject({ kind: 'observed_discrepancy', stateObserved: true });
    expect(result.explanation).toContain('какая сторона');
  });

  it('treats an Article 93 alert as a qualification request, not a proven offence', () => {
    const result = controlConsequenceOf(finding({ checkId: 'ep_risk', severity: 'critical' }));
    expect(result).toMatchObject({ kind: 'legal_qualification', stateObserved: false });
  });

  it('does not assume missing planned year means no financing', () => {
    const result = controlConsequenceOf(finding({ checkId: 'plan_year_missing' }));
    expect(result).toMatchObject({ kind: 'possible_calculation_impact', stateObserved: false });
  });

  it('does not award any positive impact or quality grade for unknown classes', () => {
    expect(controlConsequenceOf(finding({}))).toMatchObject({ kind: 'unclassified', stateObserved: false });
  });
});
