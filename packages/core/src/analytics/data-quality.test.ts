import { describe, expect, it } from 'vitest';
import { dataQualityScore } from './data-quality.js';
import type { Issue } from '@aemr/shared';

function issue(overrides: Partial<Issue>): Issue {
  return {
    id: 'one',
    title: 'Проверка заполнения',
    description: '',
    severity: 'warning',
    category: 'signal:dataQuality',
    origin: 'bi_heuristic',
    status: 'open',
    detectedAt: '2026-10-10T00:00:00.000Z',
    detectedBy: 'test',
    departmentId: 'uo',
    row: 10,
    ...overrides,
  };
}

describe('data-quality component of the existing scorecard', () => {
  it('counts checks by their real group/trust-component rather than nonexistent group data_quality', () => {
    const findings = [
      issue({ checkId: 'data_quality', group: 'completeness' }),
      issue({ id: 'two', category: 'signal:planYearMissing', checkId: 'plan_year_missing', group: 'data_integrity', row: 11 }),
    ];
    expect(dataQualityScore(findings, 'uo', 'УО', 10)).toBe(0.8);
  });

  it('counts a row once, even when two data-quality rules fire there', () => {
    const findings = [
      issue({ checkId: 'data_quality', group: 'completeness', row: 8 }),
      issue({ id: 'two', category: 'signal:planYearMissing', checkId: 'plan_year_missing', group: 'data_integrity', row: 8 }),
    ];
    expect(dataQualityScore(findings, 'uo', 'УО', 10)).toBe(0.9);
  });

  it('does not count runtime faults, formulas or issues of another GRBS against book data quality', () => {
    const findings = [
      issue({ origin: 'runtime_error', category: 'ingest_error', checkId: undefined, group: 'data_integrity' }),
      issue({ id: 'formula', checkId: 'formula_mutant', group: 'formula_consistency' }),
      issue({ id: 'other', departmentId: 'ud', checkId: 'data_quality', group: 'completeness' }),
    ];
    expect(dataQualityScore(findings, 'uo', 'УО', 10)).toBe(1);
  });

  it('keeps legacy snapshots with no group or checkId observable', () => {
    expect(dataQualityScore([issue({ checkId: undefined, group: undefined })], 'uo', 'УО', 10)).toBe(0.9);
  });

  it('does not infer wrongdoing when there are no source rows to assess', () => {
    expect(dataQualityScore([issue({})], 'uo', 'УО', 0)).toBe(1);
  });
});
