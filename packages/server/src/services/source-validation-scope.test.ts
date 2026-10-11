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
import { departmentSheetNameCandidates } from './sheet-name-candidates.js';

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


describe('approved sheet-title cutover without new department identities', () => {
  it('recognizes both old source tabs and the new directory working names', () => {
    expect(departmentSheetNameCandidates('УФБП', 'УФБП')).toEqual(['УФБП', 'УФ']);
    expect(departmentSheetNameCandidates('УДТХ', 'УДТХ')).toEqual(['УДТХ', 'УДТХиБ']);
    expect(departmentSheetNameCandidates('ВСЕ', 'УО')).toEqual(['ВСЕ', 'Все', 'УО']);
  });

  it('does not extend arbitrary sources using an unverified fuzzy rename', () => {
    expect(departmentSheetNameCandidates('МКУ «ЦЭР»', 'УЭР')).toEqual(['МКУ «ЦЭР»', 'УЭР']);
    expect(departmentSheetNameCandidates('Неизвестный', 'УФБП')).toEqual(['Неизвестный', 'УФБП']);
  });
});
