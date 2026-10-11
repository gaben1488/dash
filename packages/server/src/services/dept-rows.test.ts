import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDeptSheetValues: vi.fn(), getDeptCacheFilledAt: vi.fn(), getDeptLoadMeta: vi.fn(), getSnapshot: vi.fn(),
}));
vi.mock('./snapshot.js', () => mocks);
import { readDeptRows } from './dept-rows.js';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDeptLoadMeta.mockReturnValue({ УО: { loadedAt: '2026-10-10T12:00:00Z' } });
});

describe('readDeptRows source time', () => {
  it('reports cache read time rather than request time', async () => {
    mocks.getDeptSheetValues.mockReturnValue({ УО: [[], [], [], ['1']] });
    mocks.getDeptCacheFilledAt.mockReturnValue(Date.parse('2026-10-10T12:00:00Z'));
    expect((await readDeptRows()).asOf).toBe('2026-10-10T12:00:00.000Z');
    expect(mocks.getSnapshot).not.toHaveBeenCalled();
  });
  it('preserves historical snapshot time on fallback', async () => {
    mocks.getDeptSheetValues.mockReturnValue({});
    mocks.getSnapshot.mockResolvedValue({ rowsByDept: { УО: [['1']] }, createdAt: '2026-10-09T12:00:00Z' });
    expect((await readDeptRows()).asOf).toBe('2026-10-09T12:00:00Z');
  });
  it('does not label an undated cache as freshly read', async () => {
    mocks.getDeptSheetValues.mockReturnValue({ УО: [[], [], [], ['1']] });
    mocks.getDeptCacheFilledAt.mockReturnValue(0);
    mocks.getDeptLoadMeta.mockReturnValue({});
    mocks.getSnapshot.mockResolvedValue({ rowsByDept: { УО: [['2']] }, createdAt: '2026-10-09T12:00:00Z' });
    expect(await readDeptRows()).toEqual({
      rowsByDept: { УО: [['2']] }, asOf: '2026-10-09T12:00:00Z', source: 'snapshot',
    });
  });
  it('a partial or empty refresh does not make retained books fresh', async () => {
    mocks.getDeptSheetValues.mockReturnValue({ УО: [[], [], [], ['1']], УД: [[], [], [], ['2']] });
    mocks.getDeptCacheFilledAt.mockReturnValue(Date.parse('2026-10-12T12:00:00Z'));
    mocks.getDeptLoadMeta.mockReturnValue({
      УО: { loadedAt: '2026-10-10T12:00:00Z' }, УД: { loadedAt: '2026-10-11T12:00:00Z' },
    });
    expect((await readDeptRows()).asOf).toBe('2026-10-10T12:00:00.000Z');
  });
});
