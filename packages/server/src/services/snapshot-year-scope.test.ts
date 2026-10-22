import { describe, expect, it } from 'vitest';
import { sameSnapshotYearScope } from './snapshot-year-scope.js';

describe('аварийный снимок сохраняет годовой смысл ответа', () => {
  it('разрешает только тот же год', () => {
    expect(sameSnapshotYearScope({ metadata: { targetYear: 2027 } }, 2027)).toBe(true);
    expect(sameSnapshotYearScope({ metadata: { targetYear: 2026 } }, 2027)).toBe(false);
    expect(sameSnapshotYearScope({ metadata: { targetYear: null } }, 2027)).toBe(false);
  });
  it('для всех лет допускает только явную отметку all-years', () => {
    expect(sameSnapshotYearScope({ metadata: { targetYear: null } })).toBe(true);
    expect(sameSnapshotYearScope({ metadata: { targetYear: 2026 } })).toBe(false);
    expect(sameSnapshotYearScope({ metadata: {} })).toBe(false);
    expect(sameSnapshotYearScope({})).toBe(false);
  });
});
