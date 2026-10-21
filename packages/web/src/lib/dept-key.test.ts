import { describe, expect, it } from 'vitest';
import { bothDeptKeyForms, toCanonicalDeptId } from './dept-key';

describe('approved department names in filters', () => {
  it.each([
    ['УФ', 'УФБП', 'ufbp'],
    ['УДТХиБ', 'УДТХ', 'udtx'],
  ])('resolves %s to existing source keys', (label, canonical, latin) => {
    expect(toCanonicalDeptId(label)).toBe(canonical);
    expect(bothDeptKeyForms([label])).toEqual(new Set([label, canonical, latin]));
    expect(bothDeptKeyForms([canonical])).toEqual(new Set([label, canonical, latin]));
    expect(bothDeptKeyForms([latin])).toEqual(new Set([label, canonical, latin]));
  });
});
