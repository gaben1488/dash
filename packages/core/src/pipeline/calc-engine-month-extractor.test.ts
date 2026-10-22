import { describe, expect, it } from 'vitest';
import { DEPT_COLUMNS, dayNumberOf } from '@aemr/shared';
import { DEFAULT_EXTRACTORS } from './calc-engine.js';

function rowWithDate(raw: unknown): unknown[] {
  const row: unknown[] = Array(34).fill('');
  row[DEPT_COLUMNS.PLAN_DATE] = raw;
  return row;
}

describe('CalcEngine month extractor — same calendar day in all time zones', () => {
  it('handles real Google serials, including fractional time just before midnight', () => {
    const jan1 = dayNumberOf('2026-01-01')! + 25569;
    const feb1 = dayNumberOf('2026-02-01')! + 25569;
    expect(DEFAULT_EXTRACTORS.month(rowWithDate(jan1))).toBe(1);
    expect(DEFAULT_EXTRACTORS.month(rowWithDate(feb1 - 0.00001))).toBe(1);
    expect(DEFAULT_EXTRACTORS.month(rowWithDate(feb1))).toBe(2);
    expect(DEFAULT_EXTRACTORS.month(rowWithDate(feb1 + 0.98))).toBe(2);
  });

  it('accepts actual calendar days, not a date-looking substring', () => {
    expect(DEFAULT_EXTRACTORS.month(rowWithDate('31.01.2026'))).toBe(1);
    expect(DEFAULT_EXTRACTORS.month(rowWithDate('15/03/2026'))).toBe(3);
    expect(DEFAULT_EXTRACTORS.month(rowWithDate('2026-02-01T11:00:00+12:00'))).toBe(2);
    for (const invalid of ['31.02.2026', '2026-13-01', '2026-01-01garbage', '18/15/2026', 'х', '', null]) {
      expect(DEFAULT_EXTRACTORS.month(rowWithDate(invalid)), String(invalid)).toBeNull();
    }
    expect(DEFAULT_EXTRACTORS.month(rowWithDate('29.02.2024'))).toBe(2);
  });
});
