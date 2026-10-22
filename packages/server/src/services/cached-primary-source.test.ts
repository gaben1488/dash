import { describe, expect, it } from 'vitest';
import { hasVerifiedPrimaryRows } from './cached-primary-source.js';

const headers = [[], [], []] as unknown[][];
const rows = [...headers, ['1', 'предмет закупки']];

describe('primary master cache source admission (R05.03)', () => {
  it('keeps an explicitly read empty master distinct from an unavailable book', () => {
    expect(hasVerifiedPrimaryRows(headers, { loadedAt: '2026-10-22T05:00:00Z', rowCount: 3 })).toBe(true);
    expect(hasVerifiedPrimaryRows(undefined, { loadedAt: '2026-10-22T05:00:00Z', rowCount: 3 })).toBe(false);
  });
  it('requires a per-book successful reading, not a global cache refresh', () => {
    expect(hasVerifiedPrimaryRows(rows, undefined)).toBe(false);
    expect(hasVerifiedPrimaryRows(rows, { loadedAt: '' })).toBe(false);
    expect(hasVerifiedPrimaryRows(rows, { loadedAt: 'not-a-date' })).toBe(false);
    expect(hasVerifiedPrimaryRows(rows, { loadedAt: '1970-01-01T00:00:00Z' })).toBe(false);
  });
  it('does not resurrect retained rows after a failed refresh', () => {
    expect(hasVerifiedPrimaryRows(rows, {
      loadedAt: '2026-10-22T05:00:00Z', rowCount: 4, error: 'Google 403',
    })).toBe(false);
  });
  it('rejects a mismatched or malformed per-book row count', () => {
    expect(hasVerifiedPrimaryRows(rows, { loadedAt: '2026-10-22T05:00:00Z', rowCount: 3 })).toBe(false);
    expect(hasVerifiedPrimaryRows(rows, { loadedAt: '2026-10-22T05:00:00Z', rowCount: -1 })).toBe(false);
    expect(hasVerifiedPrimaryRows(rows, { loadedAt: '2026-10-22T05:00:00Z', rowCount: 4 })).toBe(true);
  });
  it('does not accept an incomplete read or invalid cache geometry', () => {
    expect(hasVerifiedPrimaryRows([['#REF!']], { loadedAt: '2026-10-22T05:00:00Z', rowCount: 1 })).toBe(false);
    expect(hasVerifiedPrimaryRows([] as unknown[][], { loadedAt: '2026-10-22T05:00:00Z' })).toBe(false);
  });
});
