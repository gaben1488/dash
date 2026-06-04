import { describe, expect, it } from 'vitest';
import {
  ALL_DEPT_IDS,
  DEPARTMENT_REGISTRY,
  DEPARTMENT_SPREADSHEET_IDS,
  SHDYU_SHEET_NAME,
  SHDYU_SHEET_NAME_CANDIDATES,
  SVOD_SPREADSHEET_ID,
} from '@aemr/shared';

describe('production source inventory contract', () => {
  it('uses СВОД_ДЛЯ_GOOGLE as the only default main workbook', () => {
    expect(SVOD_SPREADSHEET_ID).toBe('1i692JdP-FqWMSfVgBjTmDCoUakacbJpZMq9tJhQlRhg');
  });

  it('keeps SHDYU in the main workbook and tolerates the current production tab name', () => {
    expect(SHDYU_SHEET_NAME).toBe('ШДЮ');
    expect(SHDYU_SHEET_NAME_CANDIDATES).toEqual(['ШДЮ', 'ШДЮ старый']);
  });

  it('declares exactly the eight production department workbooks', () => {
    expect(Object.keys(DEPARTMENT_SPREADSHEET_IDS).sort()).toEqual([...ALL_DEPT_IDS].sort());

    for (const dept of ALL_DEPT_IDS) {
      expect(DEPARTMENT_SPREADSHEET_IDS[dept], `${dept} spreadsheet id`).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    }
  });

  it('uses the aggregate ВСЕ sheet only for subordinate-heavy department workbooks', () => {
    const sheetByDept = Object.fromEntries(DEPARTMENT_REGISTRY.map(d => [d.id, d.sheetName]));

    expect(sheetByDept).toMatchObject({
      'УЭР': 'УЭР',
      'УИО': 'УИО',
      'УАГЗО': 'ВСЕ',
      'УФБП': 'УФБП',
      'УД': 'ВСЕ',
      'УДТХ': 'УДТХ',
      'УКСиМП': 'ВСЕ',
      'УО': 'ВСЕ',
    });
  });
});
