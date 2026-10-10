import { describe, expect, it, vi } from 'vitest';
import { DEPT_COLUMNS } from '@aemr/shared';
import { DEFAULT_EXTRACTORS, type RawRow } from './calc-engine.js';

function planDate(value: unknown): RawRow {
  const row: RawRow = [];
  row[DEPT_COLUMNS.PLAN_DATE] = value;
  return row;
}

describe('CalcEngine plan month uses calendar day, not server timezone', () => {
  it('keeps late-day Sheets serial within January even in Kamchatka timezone', () => {
    vi.stubEnv('TZ', 'Asia/Kamchatka');
    try {
      // 31.01.2026 at 18:00 in Google serial; old local getMonth() gave February.
      expect(DEFAULT_EXTRACTORS.month(planDate(46053.75))).toBe(1);
      expect(DEFAULT_EXTRACTORS.month(planDate(46054))).toBe(2);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('accepts real dates in source formats and rejects rolled-over days', () => {
    expect(DEFAULT_EXTRACTORS.month(planDate('29.02.2024'))).toBe(2);
    expect(DEFAULT_EXTRACTORS.month(planDate('01/03/2026'))).toBe(3);
    expect(DEFAULT_EXTRACTORS.month(planDate('2026-03-01'))).toBe(3);
    expect(DEFAULT_EXTRACTORS.month(planDate('31.02.2026'))).toBeNull();
    expect(DEFAULT_EXTRACTORS.month(planDate('2026-02-31'))).toBeNull();
    expect(DEFAULT_EXTRACTORS.month(planDate('2026-01-14garbage'))).toBeNull();
  });
});
