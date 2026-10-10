import { describe, expect, it } from 'vitest';
import { hasRowWriteIdentity, rowIdentityMatches } from './row-write-identity.js';

const original = { A: '173/1', B: 'УО', C: 'МБОУ «Школа № 3»', G: 'Поставка книг' };

describe('optimistic precondition for mutable Google Sheets row positions', () => {
  it('rejects missing or partial identity, never guessing from a row number', () => {
    expect(hasRowWriteIdentity(undefined)).toBe(false);
    expect(hasRowWriteIdentity({ A: '173/1' })).toBe(false);
    expect(hasRowWriteIdentity(original)).toBe(true);
  });
  it('the unchanged record is writable (null and empty source cell are equivalent)', () => {
    expect(rowIdentityMatches({ ...original, B: '' }, { ...original, B: null })).toBe(true);
  });
  it('sorting or inserting rows makes the wrong procurement unwriteable', () => {
    expect(rowIdentityMatches(original, { ...original, A: '173/2' })).toBe(false);
    expect(rowIdentityMatches(original, { ...original, C: 'МКУ ЕДДС' })).toBe(false);
    expect(rowIdentityMatches(original, { ...original, G: 'Ремонт кровли' })).toBe(false);
  });
  it('compound № 173/1 differs from the parent № 173', () => {
    expect(rowIdentityMatches(original, { ...original, A: 173 })).toBe(false);
  });
  it('blank formula tail cannot be addressed as a purchase', () => {
    expect(rowIdentityMatches({ A: '', B: '', C: '', G: '' }, { A: '', B: '', C: '', G: '' })).toBe(false);
  });
});
