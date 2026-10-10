import { describe, expect, it } from 'vitest';
import { parseEditorNumber } from './editor-number';

describe('editor numeric input is not truncated by parseFloat', () => {
  it('accepts a full decimal or grouped Russian amount', () => {
    expect(parseEditorNumber('1 234,50')).toBe(1234.5);
    expect(parseEditorNumber('12,5')).toBe(12.5);
    expect(parseEditorNumber('0')).toBe(0);
    expect(parseEditorNumber('')).toBeNull();
  });
  it('preserves invalid text for field validation rather than turning it into a valid amount', () => {
    for (const v of ['12abc', '1.2.3', '1e309', 'Infinity', '1 2']) {
      expect(parseEditorNumber(v)).toBe(v);
    }
    expect(parseEditorNumber(Number.POSITIVE_INFINITY)).toBe('Infinity');
  });
});
