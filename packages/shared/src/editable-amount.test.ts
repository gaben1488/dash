import { describe, expect, it } from 'vitest';
import { parseEditableAmount } from './editable-amount.js';

describe('strict client/server editable amount parser', () => {
  it('keeps the whole Russian decimal and grouped thousands', () => {
    for (const s of ['1 234,50', '1\u00a0234,50', '1\u202f234,50']) {
      expect(parseEditableAmount(s)).toEqual({ ok: true, value: 1234.5 });
    }
    expect(parseEditableAmount('0,25')).toEqual({ ok: true, value: 0.25 });
    expect(parseEditableAmount('-10.5')).toEqual({ ok: true, value: -10.5 });
  });

  it('accepts clearing a cell and valid numeric values', () => {
    expect(parseEditableAmount(null)).toEqual({ ok: true, value: null });
    expect(parseEditableAmount('')).toEqual({ ok: true, value: null });
    expect(parseEditableAmount(' ')).toEqual({ ok: true, value: null });
    expect(parseEditableAmount(0)).toEqual({ ok: true, value: 0 });
  });

  it('never accepts partial values, Infinity, exponents or invalid groups', () => {
    for (const value of ['12abc', '1.2.3', '1e309', 'Infinity', '1 23', '1 23,45', '1,2,3', Number.POSITIVE_INFINITY, NaN, true]) {
      expect(parseEditableAmount(value)).toEqual({ ok: false });
    }
  });
});
