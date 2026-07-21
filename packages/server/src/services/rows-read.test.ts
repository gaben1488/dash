/**
 * Характеризация rows-read.ts (E11-2 rethink, 2026-07-21).
 * Каскад cache-first: кэш отдела → лист СВОД (DEPRECATED-зеркало, D1) →
 * собственная книга управления (readDeptSheet). Ошибки не глотаются в HTTP —
 * наружу дискриминированный DeptRowsResult, решает роут.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSheetData, readDeptSheet, getDeptSheetValues } = vi.hoisted(() => ({
  getSheetData: vi.fn(),
  readDeptSheet: vi.fn(),
  getDeptSheetValues: vi.fn(),
}));

vi.mock('./google-sheets.js', () => ({ getSheetData, readDeptSheet }));
vi.mock('./snapshot.js', () => ({ getDeptSheetValues }));
vi.mock('../config.js', () => ({ DEPARTMENT_SPREADSHEETS: { УО: 'ss-uo' } }));

import { readDeptRows } from './rows-read.js';

const dept = { nameShort: 'УО', sheetName: 'УО-лист' };
const values = [['шапка'], ['1', 'РН-1']];

beforeEach(() => {
  vi.clearAllMocks();
  getDeptSheetValues.mockReturnValue({});
});

describe('readDeptRows — каскад чтения', () => {
  it('ступень 1: непустой кэш отдела возвращается без обращений к API', async () => {
    getDeptSheetValues.mockReturnValue({ УО: values });

    expect(await readDeptRows(dept)).toEqual({ ok: true, values });
    expect(getSheetData).not.toHaveBeenCalled();
    expect(readDeptSheet).not.toHaveBeenCalled();
  });

  it('ступень 2 (DEPRECATED-зеркало СВОД): кэша нет → непустой getSheetData(sheetName)', async () => {
    getSheetData.mockResolvedValue(values);

    expect(await readDeptRows(dept)).toEqual({ ok: true, values });
    expect(getSheetData).toHaveBeenCalledWith('УО-лист');
    expect(readDeptSheet).not.toHaveBeenCalled();
  });

  it('пустой кэш ([]) не считается данными — каскад идёт дальше', async () => {
    getDeptSheetValues.mockReturnValue({ УО: [] });
    getSheetData.mockResolvedValue(values);

    expect(await readDeptRows(dept)).toEqual({ ok: true, values });
  });

  it('ступень 3: СВОД пуст → живое чтение книги управления readDeptSheet', async () => {
    getSheetData.mockResolvedValue([]);
    readDeptSheet.mockResolvedValue({ values });

    expect(await readDeptRows(dept)).toEqual({ ok: true, values });
    expect(readDeptSheet).toHaveBeenCalledWith('УО', 'ss-uo');
  });

  it('ошибка СВОД тоже ведёт к ступени 3, а не наружу', async () => {
    getSheetData.mockRejectedValue(new Error('нет листа СВОД'));
    readDeptSheet.mockResolvedValue({ values });

    expect(await readDeptRows(dept)).toEqual({ ok: true, values });
  });

  it('no-source: СВОД пуст и книга отдела не сконфигурирована', async () => {
    getSheetData.mockResolvedValue([]);

    expect(await readDeptRows({ nameShort: 'БЕЗКНИГИ', sheetName: 'X' }))
      .toEqual({ ok: false, reason: 'no-source' });
    expect(readDeptSheet).not.toHaveBeenCalled();
  });

  it('read-error: живое чтение упало — ошибка отдаётся роуту для лога', async () => {
    getSheetData.mockResolvedValue([]);
    const boom = new Error('quota 429');
    readDeptSheet.mockRejectedValue(boom);

    expect(await readDeptRows(dept)).toEqual({ ok: false, reason: 'read-error', error: boom });
  });
});
