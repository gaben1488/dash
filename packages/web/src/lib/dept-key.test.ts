import { describe, expect, it } from 'vitest';
import { bothDeptKeyForms, toCanonicalDeptId } from './dept-key';

describe('approved department names in filters', () => {
  it.each([
    ['УФ', 'УФБП', 'ufbp'],
    ['УДТХиБ', 'УДТХ', 'udtx'],
  ])('resolves %s to existing source keys', (label, canonical, latin) => {
    expect(toCanonicalDeptId(label)).toBe(canonical);
    expect([...bothDeptKeyForms([label])]).toEqual(expect.arrayContaining([label, canonical, latin]));
    expect(bothDeptKeyForms([canonical])).toEqual(bothDeptKeyForms([label]));
    expect(bothDeptKeyForms([latin])).toEqual(bothDeptKeyForms([label]));
  });
});


it('исторические алиасы не исключаются из отбора по действующему управлению', () => {
  expect(bothDeptKeyForms(['УФ']).has('УФБР')).toBe(true);
  expect(bothDeptKeyForms(['УДТХиБ']).has('УТХиРКИ')).toBe(true);
});
