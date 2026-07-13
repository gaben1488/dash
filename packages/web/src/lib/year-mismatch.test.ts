import { describe, expect, it } from 'vitest';
import { shouldShowYearMismatch } from './year-mismatch';

describe('shouldShowYearMismatch (T8)', () => {
  it('одинаковый год → не показывать', () => {
    expect(shouldShowYearMismatch(2026, 2026, false)).toBe(false);
  });
  it('во время загрузки → не показывать', () => {
    expect(shouldShowYearMismatch(2025, 2026, true)).toBe(false);
  });
  it('year="all" → не показывать', () => {
    expect(shouldShowYearMismatch('all', 2026, false)).toBe(false);
  });
  it('нет года данных → не показывать', () => {
    expect(shouldShowYearMismatch(2025, undefined, false)).toBe(false);
  });
  it('реальное несовпадение и не загрузка → показать', () => {
    expect(shouldShowYearMismatch(2025, 2026, false)).toBe(true);
  });
});
