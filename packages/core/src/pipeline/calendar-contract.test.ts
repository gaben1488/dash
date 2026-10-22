import { expect, it } from 'vitest';
import { getMonthFromDate } from './recalculate.js';

it('does not assign a quarter from a date that cannot exist', () => {
  for (const value of ['31.02.2026', '2026-13-01', '2026-02-29', '2026-01-01TNOT_A_TIME']) {
    expect(getMonthFromDate(value), value).toBeNull();
  }
});
it('uses the same month for date text and a fractional spreadsheet serial', () => {
  expect(getMonthFromDate('01.01.2026')).toBe(1);
  expect(getMonthFromDate(46023.75)).toBe(1);
  expect(getMonthFromDate('15/03/2026')).toBe(3);
});
