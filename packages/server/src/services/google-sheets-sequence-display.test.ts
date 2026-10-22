import { beforeEach, describe, expect, it, vi } from 'vitest';

const valuesGet = vi.fn();
const gridGet = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    sheets: vi.fn(() => ({
      spreadsheets: {
        values: { get: valuesGet, batchGet: vi.fn(), update: vi.fn() },
        get: gridGet,
      },
    })),
    auth: { GoogleAuth: vi.fn(function GoogleAuth() { return {}; }) },
  },
}));

const dateCell = (serial: number, displayed: string) => ({
  formattedValue: displayed,
  effectiveValue: { numberValue: serial },
  effectiveFormat: { numberFormat: { type: 'DATE', pattern: 'd/m' } },
});

const procurement = (a: unknown) =>
  [a, 'Управление делами', 'Х', '', '', '', 'Поставка воды', 0, 0, 30, 30, 'ЕП'];

beforeEach(() => {
  valuesGet.mockReset();
  gridGet.mockReset();
});

describe('source-bound procurement ordinal: raw/date-typed A versus displayed label', () => {
  it('restores displayed slash numbers only in A while preserving money and original row positions', async () => {
    valuesGet.mockResolvedValue({
      data: { values: [['header'], [], [], procurement(46045), procurement('173/18'), procurement(175)] },
    });
    gridGet.mockResolvedValue({
      data: { sheets: [{ data: [{ startRow: 3, startColumn: 0, rowData: [{ values: [dateCell(46045, '23/1')] }] }] }] },
    });
    const { getSheetDataFromSpreadsheet } = await import('./google-sheets.js');
    const rows = await getSheetDataFromSpreadsheet('ud-book', 'ВСЕ');
    expect(rows[3][0]).toBe('23/1');
    expect(rows[3][10]).toBe(30);
    expect(rows[4][0]).toBe('173/18');
    expect(rows[5][0]).toBe(175);
    expect(gridGet).toHaveBeenCalledOnce();
    expect(gridGet.mock.calls[0][0].ranges).toEqual(["'ВСЕ'!A4:A4"]);
  });

  it('uses the same source display contract for read-before-write identity guard', async () => {
    valuesGet.mockResolvedValue({ data: { values: [procurement(46045)] } });
    gridGet.mockResolvedValue({
      data: { sheets: [{ data: [{ startRow: 227, startColumn: 0, rowData: [{ values: [dateCell(46045, '23/1')] }] }] }] },
    });
    const { readCurrentDeptRow } = await import('./google-sheets.js');
    const row = await readCurrentDeptRow('ud-book', 'ВСЕ', 228);
    expect(row[0]).toBe('23/1');
    expect(gridGet.mock.calls[0][0].ranges).toEqual(["'ВСЕ'!A228:A228"]);
  });

  it('a concurrent source change fails closed, never binds a stale address to another row', async () => {
    valuesGet.mockResolvedValue({ data: { values: [['header'], [], [], procurement(46045)] } });
    gridGet.mockResolvedValue({
      data: { sheets: [{ data: [{ startRow: 3, startColumn: 0, rowData: [{ values: [dateCell(46046, '24/1')] }] }] }] },
    });
    const { getSheetDataFromSpreadsheet } = await import('./google-sheets.js');
    await expect(getSheetDataFromSpreadsheet('ud-book', 'ВСЕ'))
      .rejects.toThrow('SOURCE_SEQUENCE_CHANGED_DURING_READ');
  });

  it('healthy source ordinals cause no extra grid/API request', async () => {
    valuesGet.mockResolvedValue({ data: { values: [['header'], [], [], procurement('173/18'), procurement(175)] } });
    const { getSheetDataFromSpreadsheet } = await import('./google-sheets.js');
    const rows = await getSheetDataFromSpreadsheet('ud-book', 'ВСЕ');
    expect(rows[3][0]).toBe('173/18');
    expect(rows[4][0]).toBe(175);
    expect(gridGet).not.toHaveBeenCalled();
  });
});
