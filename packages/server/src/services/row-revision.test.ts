import { describe, expect, it } from 'vitest';
import { rowRevision } from './row-revision.js';

describe('source-row revision', () => {
  const base = () => {
    const row: unknown[] = Array(34).fill('');
    row[0] = '173/1'; row[2] = 'МКУ'; row[6] = 'Поставка';
    row[7] = 100; row[11] = 'ЕП'; row[13] = '2026-10-10';
    return row;
  };

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
