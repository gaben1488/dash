import { describe, expect, it } from 'vitest';
import type { DeltaResult } from '@aemr/shared';
import { assessReconciliation, hasCompleteComparisonEvidence } from './reconciliation-assurance';

function delta(values: Partial<DeltaResult>): DeltaResult {
  return {
    metricKey: 'm', label: 'Показатель',
    officialValue: 10, calculatedValue: 10,
    delta: 0, deltaPercent: 0, withinTolerance: true, explanation: '',
    ...values,
  };
}

describe('assessReconciliation', () => {
  it('cannot declare agreement without any checked pair', () => {
    expect(assessReconciliation([])).toEqual({
      state: 'not_checked', comparable: 0, unavailable: 0,
      matched: 0, mismatched: 0, total: 0, coveragePct: null,
    });
    expect(assessReconciliation([delta({ calculatedValue: null, delta: null, deltaPercent: null })])).toMatchObject({
      state: 'not_checked', comparable: 0, unavailable: 1, coveragePct: 0,
    });
  });

  it('separates compared agreement from incomplete coverage', () => {
    expect(assessReconciliation([
      delta({}),
      delta({ metricKey: 'm2', officialValue: null }),
    ])).toEqual({
      state: 'incomplete', comparable: 1, unavailable: 1,
      matched: 1, mismatched: 0, total: 2, coveragePct: 50,
    });
  });

  it('keeps a failed comparison visible even if most pairs passed', () => {
    expect(assessReconciliation([
      delta({}),
      delta({ metricKey: 'm2', officialValue: 10, calculatedValue: 12,
        delta: -2, deltaPercent: 20, withinTolerance: false }),
    ])).toMatchObject({
      state: 'divergent', comparable: 2, mismatched: 1, matched: 1,
    });
  });

  it('reports consistent only for a fully compared set of passing pairs', () => {
    expect(assessReconciliation([delta({}), delta({ metricKey: 'm2' })])).toMatchObject({
      state: 'consistent', matched: 2, unavailable: 0, coveragePct: 100,
    });
  });

  it('does not interpret a non-finite operand as a valid comparison', () => {
    expect(assessReconciliation([delta({ calculatedValue: Number.NaN })])).toMatchObject({
      state: 'not_checked', unavailable: 1, comparable: 0,
    });
  });
  it('does not promote no comparison or partial comparison to a full reliability score', () => {
    expect(hasCompleteComparisonEvidence(assessReconciliation([]))).toBe(false);
    expect(hasCompleteComparisonEvidence(assessReconciliation([
      delta({}), delta({ metricKey: 'm2', calculatedValue: null }),
    ]))).toBe(false);
    expect(hasCompleteComparisonEvidence(assessReconciliation([
      delta({}), delta({ metricKey: 'm2', withinTolerance: false, calculatedValue: 12 }),
    ]))).toBe(true);
  });

});
