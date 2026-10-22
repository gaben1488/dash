import { describe, expect, it } from 'vitest';
import { rowRevision, writtenRowMatches } from './row-revision.js';

describe('source-row revision', () => {
  const base = () => {
    const row: unknown[] = Array(34).fill('');
    row[0] = '173/1'; row[2] = 'МКУ'; row[6] = 'Поставка';
    row[7] = 100; row[11] = 'ЕП'; row[13] = '2026-10-10';
    return row;
  };

  it.each(['173', '173/18'])('keeps 173/1 distinct from %s', (number) => {
    const a = base(), b = base(); b[0] = number;
    expect(rowRevision(a)).not.toBe(rowRevision(b));
  });
  it('keeps compound IDs distinct', () => {
    const a = base(), b = base(); b[0] = '173/2';
    expect(rowRevision(a)).not.toBe(rowRevision(b));
  });
  it('is unaffected by recalculated formula totals', () => {
    const a = base(), b = base(); b[10] = 200; b[24] = 90; b[25] = 10;
    expect(rowRevision(a)).toBe(rowRevision(b));
  });
  it('detects reordering, actual edits and changes in non-formula fields', () => {
    const a = base(), b = base(); b[6] = 'Другая закупка';
    expect(rowRevision(a)).not.toBe(rowRevision(b));
    const c = base(); c[30] = 'Новое пояснение';
    expect(rowRevision(a)).not.toBe(rowRevision(c));
  });
  it('normalizes missing trailing cells and empty strings equally', () => {
    const a = base(), b = base(); b[32] = undefined;
    expect(rowRevision(a)).toBe(rowRevision(b));
  });
});


describe('authoritative write readback', () => {
  it('accepts only the intended row and values while ignoring computed totals', () => {
    const intended = Array<unknown>(34).fill(''); intended[0] = '173/18'; intended[6] = 'Поставка'; intended[7] = 12;
    const confirmed = [...intended]; confirmed[10] = 99;
    expect(writtenRowMatches(intended, confirmed, [7])).toBe(true);
    for (const index of [0, 1, 2, 6, 7]) {
      const other = [...confirmed]; other[index] = 'другая строка';
      expect(writtenRowMatches(intended, other, [7])).toBe(false);
    }
  });
  it('allows an edited date to be rendered in the sheet calendar format', () => {
    const intended = Array<unknown>(34).fill(''); intended[13] = '2026-10-12';
    const confirmed = [...intended]; confirmed[13] = '12.10.2026';
    expect(writtenRowMatches(intended, confirmed, [13])).toBe(true);
    confirmed[13] = '13.10.2026';
    expect(writtenRowMatches(intended, confirmed, [13])).toBe(false);
  });
});
