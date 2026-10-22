import { describe, expect, it } from 'vitest';
import { isCompositePurchaseId, isPurchaseId, purchaseIdText } from './purchase-id.js';

describe('procurement IDs — textual identity is not a number', () => {
  it('recognises both original integer and composite 12/1 formats', () => {
    expect(isPurchaseId(12)).toBe(true);
    expect(isPurchaseId('12')).toBe(true);
    expect(isPurchaseId('12/1')).toBe(true);
    expect(isPurchaseId('12/01')).toBe(true);
    expect(isCompositePurchaseId('12/1')).toBe(true);
    expect(isCompositePurchaseId('12')).toBe(false);
  });

  it('preserves each identifier instead of applying parseFloat or stripping zeroes', () => {
    expect(purchaseIdText('12/1')).toBe('12/1');
    expect(purchaseIdText('12/01')).toBe('12/01');
    expect(new Set(['12', '12/1', '12/01'].map(purchaseIdText)).size).toBe(3);
  });

  it('rejects malformed identifiers without guessing their meaning', () => {
    for (const value of ['', ' ', '12abc', '12/1/2', '12/', '0', '-1', null, 0]) {
      expect(isPurchaseId(value)).toBe(false);
    }
  });
});
