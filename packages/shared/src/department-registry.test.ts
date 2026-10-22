import { describe, expect, it } from 'vitest';
import {
  ALL_DEPT_IDS,
  ALL_LATIN_IDS,
  CYRILLIC_TO_LATIN,
  DEPARTMENT_REGISTRY,
  LATIN_TO_CYRILLIC,
  findDept,
  getDept,
  getDeptByLatin,
} from './department-registry.js';

describe('canonical department identity contract', () => {
  it('has one-to-one Cyrillic and Latin identities', () => {
    const ids = DEPARTMENT_REGISTRY.map((entry) => entry.id);
    const latin = DEPARTMENT_REGISTRY.map((entry) => entry.latinId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(latin).size).toBe(latin.length);
    expect(ALL_DEPT_IDS).toEqual(ids);
    expect(ALL_LATIN_IDS).toEqual(latin);
  });

  it('resolves every department through both identifiers without drift', () => {
    for (const entry of DEPARTMENT_REGISTRY) {
      expect(entry.shortName).toBe(entry.id);
      expect(getDept(entry.id)).toBe(entry);
      expect(getDeptByLatin(entry.latinId)).toBe(entry);
      expect(findDept(entry.id)).toBe(entry);
      expect(findDept(entry.latinId)).toBe(entry);
      expect(LATIN_TO_CYRILLIC[entry.latinId]).toBe(entry.id);
      expect(CYRILLIC_TO_LATIN[entry.id]).toBe(entry.latinId);
    }
  });

  it('does not invent a department for unknown identities', () => {
    expect(findDept('nonexistent')).toBeUndefined();
  });
});
