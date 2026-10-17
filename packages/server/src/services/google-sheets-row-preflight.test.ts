import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
vi.mock('googleapis', () => ({
  google: {
    sheets: () => ({ spreadsheets: { values: { get } } }),
    auth: { GoogleAuth: function GoogleAuth() {} },
  },
}));
vi.mock('../config.js', () => ({
  config: { google: { spreadsheetId: 'main', apiKey: '', serviceAccountEmail: '', privateKey: '' } },
}));

import { readCurrentDeptRow, readCurrentDeptRowFormulas } from './google-sheets.js';

beforeEach(() => get.mockReset());

describe('bounded live row preflight', () => {
  it('reads actual formulas in the exact escaped row without fetching the workbook', async () => {
    const row = ['173/1', '', '', '', '', '', 'Закупка', '=SUM(H8:H10)'];
    get.mockResolvedValueOnce({ data: { values: [row] } });
    expect(await readCurrentDeptRowFormulas('book', "У'О", 4)).toEqual(row);
    expect(get).toHaveBeenCalledExactlyOnceWith({
      spreadsheetId: 'book', range: "'У''О'!A4:AH4", valueRenderOption: 'FORMULA',
      dateTimeRenderOption: 'FORMATTED_STRING', majorDimension: 'ROWS',
    }, expect.objectContaining({ timeout: expect.any(Number) }));
  });

  it('preserves value and calendar rendering for existing revision/readback readers', async () => {
    const row = ['173/1', '', '', '', '', '', 'Закупка', 123.5];
    get.mockResolvedValueOnce({ data: { values: [row] } });
    expect(await readCurrentDeptRow('book', 'ВСЕ', 5)).toEqual(row);
    expect(get).toHaveBeenCalledExactlyOnceWith({
      spreadsheetId: 'book', range: "'ВСЕ'!A5:AH5", valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING', majorDimension: 'ROWS',
    }, expect.objectContaining({ timeout: expect.any(Number) }));
  });

  it.each([0, 3, 4.5, NaN, Infinity])('refuses invalid row %s before any Google call', async (row) => {
    await expect(readCurrentDeptRowFormulas('book', 'ВСЕ', row)).rejects.toThrow('ROW_ADDRESS_INVALID');
    expect(get).not.toHaveBeenCalled();
  });

  it('keeps a deleted row distinct from a successfully read row without formulas', async () => {
    get.mockResolvedValueOnce({ data: {} });
    expect(await readCurrentDeptRowFormulas('book', 'ВСЕ', 4)).toEqual([]);
  });

  it('propagates an unavailable source instead of returning empty formula evidence', async () => {
    get.mockRejectedValueOnce(Object.assign(new Error('source denied'), { status: 403 }));
    await expect(readCurrentDeptRowFormulas('book', 'ВСЕ', 4)).rejects.toThrow('source denied');
  });
});
