/**
 * Raw rows must come from the department cache or its configured primary book.
 * A nonempty legacy mirror does not prove freshness or source completeness.
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

beforeEach(() => {
  vi.resetAllMocks();
  getDeptSheetCache.mockReturnValue({});
});

describe('readDeptRows — каскад чтения', () => {
  it('ступень 1: непустой кэш отдела возвращается без обращений к API', async () => {
    getDeptSheetCache.mockReturnValue({ УО: { providerId: 'ss-uo', values } });

    expect(await readDeptRows(dept)).toEqual({ ok: true, values });
    expect(getSheetData).not.toHaveBeenCalled();
    expect(readDeptSheet).not.toHaveBeenCalled();
  });

  it('does not reuse rows after a configured source switch', async () => {
    getDeptSheetCache.mockReturnValue({ УО: { providerId: 'old-master', values } });
    const fresh = [['new'], ['new'], ['new'], ['NEW']];
    readDeptSheet.mockResolvedValue({ values: fresh });
    expect(await readDeptRows(dept)).toEqual({ ok: true, values: fresh });
    expect(readDeptSheet).toHaveBeenCalledWith('УО', 'ss-uo');
  });

  it('does not assume a grid without provider provenance belongs to the configured master', async () => {
    getDeptSheetCache.mockReturnValue({ УО: { values } });
    readDeptSheet.mockResolvedValue({ values });
    expect(await readDeptRows(dept)).toEqual({ ok: true, values });
    expect(readDeptSheet).toHaveBeenCalledWith('УО', 'ss-uo');
  });

  it('does not fall back to old cached rows when the new master fails', async () => {
    getDeptSheetCache.mockReturnValue({ УО: { providerId: 'old-master', values } });
    readDeptSheet.mockRejectedValue(new Error('403'));
    expect(await readDeptRows(dept)).toMatchObject({ ok: false, reason: 'read-error' });
  });

  it('при пустом кэше читает master, даже когда зеркало непустое и отличается', async () => {
    getSheetData.mockResolvedValue([['stale mirror']]);
    readDeptSheet.mockResolvedValue({ values });

    expect(await readDeptRows(dept)).toEqual({ ok: true, values });
    expect(readDeptSheet).toHaveBeenCalledWith('УО', 'ss-uo');
    expect(getSheetData).not.toHaveBeenCalled();
  });

  it('пустой кэш ([]) не считается данными — каскад идёт дальше', async () => {
    getDeptSheetCache.mockReturnValue({ УО: { providerId: 'ss-uo', values: [] } });
    getSheetData.mockResolvedValue([['stale mirror']]);
    readDeptSheet.mockResolvedValue({ values });

    expect(await readDeptRows(dept)).toEqual({ ok: true, values });
  });

  it('пустое зеркало не является условием чтения основной книги', async () => {
    getSheetData.mockResolvedValue([]);
    readDeptSheet.mockResolvedValue({ values });

    expect(await readDeptRows(dept)).toEqual({ ok: true, values });
    expect(readDeptSheet).toHaveBeenCalledWith('УО', 'ss-uo');
  });

  it('не запрашивает зеркало и не зависит от его доступности', async () => {
    getSheetData.mockRejectedValue(new Error('нет листа СВОД'));
    readDeptSheet.mockResolvedValue({ values });

    expect(await readDeptRows(dept)).toEqual({ ok: true, values });
    expect(getSheetData).not.toHaveBeenCalled();
  });

  it('no-source: отсутствие master не маскируется непустым зеркалом', async () => {
    getSheetData.mockResolvedValue([['unverified mirror']]);

    expect(await readDeptRows({ nameShort: 'БЕЗКНИГИ', sheetName: 'X' }))
      .toEqual({ ok: false, reason: 'no-source' });
    expect(readDeptSheet).not.toHaveBeenCalled();
    expect(getSheetData).not.toHaveBeenCalled();
  });

  it('read-error: живое чтение упало — ошибка отдаётся роуту для лога', async () => {
    getSheetData.mockResolvedValue([['unverified mirror']]);
    const boom = new Error('quota 429');
    readDeptSheet.mockRejectedValue(boom);

    expect(await readDeptRows(dept)).toEqual({ ok: false, reason: 'read-error', error: boom });
    expect(getSheetData).not.toHaveBeenCalled();
  });

  it('основная книга с шапкой без закупок не подменяется строками зеркала', async () => {
    const headers = [['шапка 1'], ['шапка 2'], ['шапка 3']];
    getSheetData.mockResolvedValue([['removed purchase']]);
    readDeptSheet.mockResolvedValue({ values: headers });
    expect(await readDeptRows(dept)).toEqual({ ok: true, values: headers });
    expect(getSheetData).not.toHaveBeenCalled();
  });
  it('обрыв чтения master не выдаётся за успешный пустой реестр', async () => {
    readDeptSheet.mockResolvedValue({ values: [['#REF!']] });
    expect(await readDeptRows(dept)).toMatchObject({ ok: false, reason: 'read-error' });
  });
  it('обрывочный кэш не подменяет пригодное чтение master', async () => {
    getDeptSheetCache.mockReturnValue({ УО: { providerId: 'ss-uo', values: [['#REF!']] } });
    readDeptSheet.mockResolvedValue({ values });
    expect(await readDeptRows(dept)).toEqual({ ok: true, values });
    expect(readDeptSheet).toHaveBeenCalled();
  });
});
