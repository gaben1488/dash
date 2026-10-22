import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDeptSheetValues: vi.fn(), getDeptCacheFilledAt: vi.fn(), getDeptLoadMeta: vi.fn(), getSnapshot: vi.fn(),
}));
vi.mock('./snapshot.js', () => mocks);
import { readDeptRows, readDeptRowsById } from './dept-rows.js';
import { DEPARTMENTS, departmentCoverage } from '@aemr/shared';

const savedCoverage = () => departmentCoverage(DEPARTMENTS.map(d => d.nameShort), ['УО']);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDeptLoadMeta.mockReturnValue({ УО: { loadedAt: '2026-10-10T12:00:00Z' } });
});

describe('readDeptRows source time', () => {
  it('keeps canonical Cyrillic registry IDs for consumers keyed by organization', async () => {
    mocks.getDeptSheetValues.mockReturnValue({ УО: [[], [], [], ['1']] });
    expect((await readDeptRowsById()).rows).toEqual({ УО: [['1']] });
  });
  it('reports cache read time rather than request time', async () => {
    mocks.getDeptSheetValues.mockReturnValue({ УО: [[], [], [], ['1']] });
    mocks.getDeptCacheFilledAt.mockReturnValue(Date.parse('2026-10-10T12:00:00Z'));
    expect((await readDeptRows()).asOf).toBe('2026-10-10T12:00:00.000Z');
    expect(mocks.getSnapshot).not.toHaveBeenCalled();
  });
  it('preserves historical snapshot time on fallback', async () => {
    mocks.getDeptSheetValues.mockReturnValue({});
    mocks.getSnapshot.mockResolvedValue({ rowsByDept: { УО: [['1']] }, createdAt: '2026-10-09T12:00:00Z',
      metadata: { sourceCoverage: savedCoverage() } });
    expect((await readDeptRows()).asOf).toBe('2026-10-09T12:00:00Z');
  });
  it('a missing book is explicit coverage rather than a complete zero', async () => {
    mocks.getDeptSheetValues.mockReturnValue({ УО: [[], [], [], ['1']] });
    const reading = await readDeptRows();
    expect(reading.coverage.complete).toBe(false);
    expect(reading.coverage.readDepartments).toEqual(['УО']);
    expect(reading.coverage.unreadDepartments.map(d => d.department).sort()).toEqual(
      DEPARTMENTS.map(d => d.nameShort).filter(name => name !== 'УО').sort(),
    );
  });
  it('retains an explicitly read empty master and excludes a failed retained book', async () => {
    mocks.getDeptSheetValues.mockReturnValue({ УО: [[], [], []], УД: [[], [], [], ['stale']] });
    mocks.getDeptLoadMeta.mockReturnValue({
      УО: { loadedAt: '2026-10-10T12:00:00Z' },
      УД: { loadedAt: '2026-10-11T12:00:00Z', error: 'unavailable' },
    });
    const reading = await readDeptRows();
    expect(reading.rowsByDept).toEqual({ УО: [] });
    expect(reading.coverage.readDepartments).toEqual(['УО']);
    expect(mocks.getSnapshot).not.toHaveBeenCalled();
  });
  it('a snapshot without an observation time is unavailable, not freshly read', async () => {
    mocks.getDeptSheetValues.mockReturnValue({});
    mocks.getSnapshot.mockResolvedValue({ rowsByDept: { УО: [['1']] } });
    const reading = await readDeptRows();
    expect(reading.rowsByDept).toEqual({});
    expect(reading.asOf).toBeNull();
    expect(reading.coverage.complete).toBe(false);
  });
  it('does not label an undated cache as freshly read', async () => {
    mocks.getDeptSheetValues.mockReturnValue({ УО: [[], [], [], ['1']] });
    mocks.getDeptCacheFilledAt.mockReturnValue(0);
    mocks.getDeptLoadMeta.mockReturnValue({});
    mocks.getSnapshot.mockResolvedValue({ rowsByDept: { УО: [['2']] }, createdAt: '2026-10-09T12:00:00Z',
      metadata: { sourceCoverage: savedCoverage() } });
    expect(await readDeptRows()).toMatchObject({
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

it('never promotes raw arrays from a legacy snapshot without accepted source coverage', async () => {
  mocks.getDeptSheetValues.mockReturnValue({});
  mocks.getSnapshot.mockResolvedValue({ rowsByDept: { УО: [['old unverified']] },
    createdAt: '2026-10-09T12:00:00Z', metadata: {} });
  const reading = await readDeptRows();
  expect(reading.rowsByDept).toEqual({});
  expect(reading.coverage.complete).toBe(false);
});

it('rejects forged full coverage on a partial saved snapshot', async () => {
  mocks.getDeptSheetValues.mockReturnValue({});
  const partial = savedCoverage();
  mocks.getSnapshot.mockResolvedValue({ rowsByDept: { УО: [['old unverified']] },
    createdAt: '2026-10-09T12:00:00Z', metadata: { sourceCoverage: { ...partial, complete: true } } });
  const reading = await readDeptRows();
  expect(reading.rowsByDept).toEqual({});
  expect(reading.coverage.readDepartments).toEqual([]);
});

it('cannot elevate an unread book merely because it has a stored row array', async () => {
  mocks.getDeptSheetValues.mockReturnValue({});
  mocks.getSnapshot.mockResolvedValue({ rowsByDept: { УО: [['confirmed']], УД: [['legacy']] },
    createdAt: '2026-10-09T12:00:00Z', metadata: { sourceCoverage: savedCoverage() } });
  const reading = await readDeptRows();
  expect(reading.rowsByDept).toEqual({ УО: [['confirmed']] });
  expect(reading.coverage.readDepartments).toEqual(['УО']);
});
