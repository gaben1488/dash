import { describe, expect, it } from 'vitest';
import { calculateCompetitiveForecast, validateEconomyMeasure } from './economy-semantic-contract.js';

const base = {
  sourceId: 'monitoring',
  snapshotId: 'snapshot-2026-10-22',
  asOf: '2026-10-22',
  modelId: 'competitive-weighted',
  modelVersion: '1',
};

describe('A12 economy semantic boundaries', () => {
  it('keeps a forecast modelled, not approved', () => {
    const result = calculateCompetitiveForecast({
      ...base,
      competitiveUncommittedRub: 1000,
      weightedReductionRate: 0.08,
    });
    expect(result.amountRub).toBe(80);
    expect(result.meaning).toBe('projected_competitive_savings');
    expect(result.evidence.kind).toBe('modelled');
  });

  it('never invents zero for an unknown rate or base', () => {
    expect(calculateCompetitiveForecast({ ...base, competitiveUncommittedRub: 1000, weightedReductionRate: null }).amountRub).toBeNull();
    expect(calculateCompetitiveForecast({ ...base, competitiveUncommittedRub: null, weightedReductionRate: 0.08 }).amountRub).toBeNull();
  });

  it('rejects invalid rates, negative bases and missing model version', () => {
    expect(() => calculateCompetitiveForecast({ ...base, competitiveUncommittedRub: 100, weightedReductionRate: 1.01 })).toThrow();
    expect(() => calculateCompetitiveForecast({ ...base, competitiveUncommittedRub: -1, weightedReductionRate: 0.1 })).toThrow();
    expect(() => calculateCompetitiveForecast({ ...base, modelVersion: '', competitiveUncommittedRub: 100, weightedReductionRate: 0.1 })).toThrow();
  });

  it('does not allow a modelled result to masquerade as approved savings', () => {
    expect(() => validateEconomyMeasure({
      meaning: 'approved_savings',
      amountRub: 80,
      evidence: { kind: 'modelled', ...base },
    })).toThrow('ECONOMY_FORECAST_MUST_NOT_BE_ACTUAL');
  });
});
