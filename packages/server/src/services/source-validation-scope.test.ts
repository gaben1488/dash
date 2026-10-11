import { describe, expect, it, vi } from 'vitest';

vi.mock('./google-sheets.js', () => ({
  getSheetData: vi.fn(async () => [[], []]),
  readDeptSheet: vi.fn(async () => ({ values: [], sheetName: 'ВСЕ' })),
}));
vi.mock('../config.js', () => ({
  config: { google: { spreadsheetId: 'test-svod' } },
  DEPARTMENT_SPREADSHEETS: { 'УО': 'test-uo' },
  SHDYU_SPREADSHEET_ID: 'test-monthly',
}));

import { validateSource } from './source-validation.js';

describe('source validation coverage is explicit', () => {
  it('readability of a year SVOD is not declared content validation', async () => {
    await expect(validateSource('СВОД ТД-ПМ')).resolves.toMatchObject({
      success: true, rowsRead: 2, rowsChecked: 0,
      validationPerformed: false, summary: { total: 0 },
    });
  });

  it('readability of a monthly SVOD is not declared content validation', async () => {
    await expect(validateSource('СВОД с месяцами')).resolves.toMatchObject({
      success: true, rowsRead: 2, rowsChecked: 0,
      validationPerformed: false, summary: { total: 0 },
    });
  });
});
