/**
 * R05.03: a cache hit needs an exact master binding; failed primary reads
 * never silently fall back to a mirror or to a differently bound cached grid.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSheetData, readDeptSheet, getDeptSheetCache } = vi.hoisted(() => ({
  getSheetData: vi.fn(),
  readDeptSheet: vi.fn(),
  getDeptSheetCache: vi.fn(),
}));
vi.mock('./google-sheets.js', () => ({ getSheetData, readDeptSheet }));
vi.mock('./snapshot.js', () => ({ getDeptSheetCache }));
vi.mock('../config.js', () => ({ DEPARTMENT_SPREADSHEETS: { УО: 'ss-uo' } }));
import { readDeptRows } from './rows-read.js';

const dept = { nameShort: 'УО', sheetName: 'УО-лист' };
const values = [['шапка 1'], ['шапка 2'], ['шапка 3'], ['1', 'РН-1']];
const observedAt = '2026-10-22T02:03:04.000Z';
const source = (kind: 'accepted-cache' | 'live-primary') => ({
  kind, providerId: 'ss-uo', sheetName: 'ВСЕ', readAt: observedAt,
  sourceVersion: null, sourceRevision: null,
});
const reading = (rows = values) => ({ providerId: 'ss-uo', sheetName: 'ВСЕ', values: rows,
  readAt: observedAt, formulas: [] });

beforeEach(() => {
  vi.resetAllMocks();
  getDeptSheetCache.mockReturnValue({});
  readDeptSheet.mockResolvedValue(reading());
});

describe('readDeptRows — one primary-source decision', () => {
  it('returns the accepted cache only when its provider binding matches', async () => {
    getDeptSheetCache.mockReturnValue({ УО: reading() });
    expect(await readDeptRows(dept)).toEqual({ ok: true, values, source: source('accepted-cache') });
    expect(readDeptSheet).not.toHaveBeenCalled();
    expect(getSheetData).not.toHaveBeenCalled();
  });

  it('rejects a cached workbook from an old binding, reads the configured primary', async () => {
    getDeptSheetCache.mockReturnValue({ УО: { ...reading([['old'],['old'],['old']]), providerId: 'old-master' } });
    expect(await readDeptRows(dept)).toEqual({ ok: true, values, source: source('live-primary') });
    expect(readDeptSheet).toHaveBeenCalledWith('УО', 'ss-uo');
    expect(getSheetData).not.toHaveBeenCalled();
  });

  it('does not accept a legacy cached grid with no provider identity', async () => {
    getDeptSheetCache.mockReturnValue({ УО: { values, sheetName: 'ВСЕ' } });
    expect(await readDeptRows(dept)).toMatchObject({ ok: true, source: { kind: 'live-primary' } });
    expect(readDeptSheet).toHaveBeenCalledOnce();
  });

  it('reads the verified primary even if a legacy mirror would have values', async () => {
    getSheetData.mockResolvedValue([['outdated mirror']]);
    expect(await readDeptRows(dept)).toEqual({ ok: true, values, source: source('live-primary') });
    expect(getSheetData).not.toHaveBeenCalled();
  });

  it('preserves a known-empty primary with three header rows', async () => {
    const headers = values.slice(0, 3);
    readDeptSheet.mockResolvedValue(reading(headers));
    expect(await readDeptRows(dept)).toEqual({ ok: true, values: headers, source: source('live-primary') });
  });

  it('does not fabricate a timestamp when an accepted reading has none', async () => {
    readDeptSheet.mockResolvedValue({ ...reading(), readAt: undefined });
    expect(await readDeptRows(dept)).toMatchObject({ ok: true, source: { readAt: null } });
  });

  it('reports no-source even when an old cached grid exists', async () => {
    getDeptSheetCache.mockReturnValue({ БЕЗКНИГИ: reading() });
    expect(await readDeptRows({ nameShort: 'БЕЗКНИГИ', sheetName: 'Х' }))
      .toEqual({ ok: false, reason: 'no-source' });
    expect(readDeptSheet).not.toHaveBeenCalled();
  });

  it('never substitutes a mirror or stale binding after a primary error', async () => {
    const boom = new Error('429 quota');
    getDeptSheetCache.mockReturnValue({ УО: { ...reading(), providerId: 'old-master' } });
    readDeptSheet.mockRejectedValue(boom);
    expect(await readDeptRows(dept)).toEqual({ ok: false, reason: 'read-error', error: boom });
    expect(getSheetData).not.toHaveBeenCalled();
  });

  it('refuses an incomplete primary, including a #REF! sheet', async () => {
    readDeptSheet.mockResolvedValue(reading([['#REF!']]));
    expect(await readDeptRows(dept)).toMatchObject({ ok: false, reason: 'read-error' });
  });

  it('refuses a primary reader that returned an unexpected provider', async () => {
    readDeptSheet.mockResolvedValue({ ...reading(), providerId: 'wrong-id' });
    expect(await readDeptRows(dept)).toMatchObject({ ok: false, reason: 'read-error' });
  });

  it('preserves a sealed source revision instead of treating it as request time', async () => {
    getDeptSheetCache.mockReturnValue({ УО: { ...reading(), sourceVersion: 'drive-v2',
      sourceRevision: 'SRC-' + 'a'.repeat(64) } });
    expect(await readDeptRows(dept)).toMatchObject({ ok: true, source: {
      kind: 'accepted-cache', sourceVersion: 'drive-v2', sourceRevision: 'SRC-' + 'a'.repeat(64),
    } });
  });
});
