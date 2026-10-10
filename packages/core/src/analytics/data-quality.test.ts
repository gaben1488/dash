import { describe, expect, it } from 'vitest';
import { dataQualityScore, countAssessedBookRows } from './data-quality.js';
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

  it('does not punish a confirmed human false-positive disposition', () => {
    const findings = [
      issue({ id: 'false-positive', status: 'false_positive', checkId: 'data_quality', group: 'completeness', row: 5 }),
      issue({ id: 'open', status: 'open', checkId: 'data_quality', group: 'completeness', row: 6 }),
    ];
    expect(dataQualityScore(findings, 'uo', 'УО', 10)).toBe(0.9);
  });

  it('does not treat unverified resolved and in-progress statuses as automatically corrected rows', () => {
    const findings = [
      issue({ id: 'resolved', status: 'resolved', checkId: 'data_quality', group: 'completeness', row: 5 }),
      issue({ id: 'in-progress', status: 'in_progress', checkId: 'data_quality', group: 'completeness', row: 6 }),
    ];
    expect(dataQualityScore(findings, 'uo', 'УО', 10)).toBe(0.8);
  });

  it('keeps legacy snapshots with no group or checkId observable', () => {
    expect(dataQualityScore([issue({ checkId: undefined, group: undefined })], 'uo', 'УО', 10)).toBe(0.9);
  });

  it('measures eligible procurement rows, not padded Google Sheets grid height', () => {
    const countable = Array.from({ length: 34 }, () => null) as unknown[];
    countable[0] = '173/1';
    countable[5] = 'Текущая деятельность';
    countable[6] = 'Поставка оборудования';
    countable[7] = 150;
    countable[10] = 150;
    countable[11] = 'ЕП';

    // Empty formula tails may span hundreds of rows; they are not workload.
    const formulaTail = Array.from({ length: 100 }, () => Array.from({ length: 34 }, () => 0));
    const rows = [countable, ...formulaTail, [], Array.from({ length: 34 }, () => null)];
    expect(countAssessedBookRows(rows)).toBe(1);
    expect(dataQualityScore([issue({ row: 4 })], 'uo', 'УО', countAssessedBookRows(rows))).toBe(0);
  });

  it('includes a substantive incomplete record when the calculator can classify it', () => {
    const missingMethod = Array.from({ length: 34 }, () => null) as unknown[];
    missingMethod[0] = '2';
    missingMethod[5] = 'Текущая деятельность';
    missingMethod[6] = 'Ремонт';
    missingMethod[7] = 200;
    missingMethod[10] = 200;
    // Missing L is a data quality issue, not a reason to erase the denominator.
    expect(countAssessedBookRows([missingMethod])).toBe(1);
  });

  it('does not infer wrongdoing when there are no source rows to assess', () => {
    expect(dataQualityScore([issue({})], 'uo', 'УО', 0)).toBe(1);
  });
});
