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

import { validateSource, validateRows } from './source-validation.js';
import { DEPT_COLUMNS } from '@aemr/shared';
import { departmentSheetNameCandidates } from './sheet-name-candidates.js';

describe('source validation coverage is explicit', () => {
  it('keeps an annual contract series under review without claiming a single oversized contract', () => {
    const row: unknown[] = new Array(34).fill('');
    row[DEPT_COLUMNS.PLAN_YEAR] = 2026; row[DEPT_COLUMNS.ID] = '3';
    row[DEPT_COLUMNS.SUBJECT] = 'Окорока (куриные)';
    row[DEPT_COLUMNS.METHOD] = 'ЕП';
    row[DEPT_COLUMNS.TOTAL_PLAN] = 1200;
    row[DEPT_COLUMNS.TOTAL_FACT] = 800;
    row[DEPT_COLUMNS.FACT_DATE] = 'Х';
    const risk = validateRows([[], [], [], row], 'УКСиМП').issues.find(x => x.message.includes('Годовой объём ЕП:'));
    expect(risk).toMatchObject({ severity: 'info' });
    row[DEPT_COLUMNS.FACT_DATE] = '10.10.2026';
    expect(validateRows([[], [], [], row], 'УКСиМП').issues.find(x => x.message.includes('Недостаточно данных для проверки сумм отдельных договоров')))
      .toMatchObject({ severity: 'warning' });
  });
  it('uses the same annual-series scope for historical comma-formatted amounts', () => {
    const row: unknown[] = new Array(34).fill('');
    row[DEPT_COLUMNS.PLAN_YEAR] = 2026; row[DEPT_COLUMNS.ID] = '3'; row[DEPT_COLUMNS.SUBJECT] = 'Окорока (куриные)';
    row[DEPT_COLUMNS.METHOD] = 'ЕП'; row[DEPT_COLUMNS.TOTAL_PLAN] = '1 200,00';
    row[DEPT_COLUMNS.TOTAL_FACT] = '800,00'; row[DEPT_COLUMNS.FACT_DATE] = 'Х';
    expect(validateRows([[], [], [], row], 'УКСиМП').issues.find(x => x.message.includes('Годовой объём ЕП:')))
      .toMatchObject({ severity: 'info' });
  });
  it('uses canonical number coercion for type, negative amount and row coverage', () => {
    const row: unknown[] = new Array(34).fill('');
    row[DEPT_COLUMNS.ID] = '6'; row[DEPT_COLUMNS.SUBJECT] = 'Услуги';
    row[DEPT_COLUMNS.METHOD] = 'ЭА'; row[DEPT_COLUMNS.TOTAL_PLAN] = '1 234,56';
    row[DEPT_COLUMNS.TOTAL_FACT] = '1 100,00'; row[DEPT_COLUMNS.FB_PLAN] = '-12,5';
    const result = validateRows([[], [], [], row], 'УО');
    expect(result.rowsChecked).toBe(1);
    expect(result.issues.filter(issue => issue.type === 'data_type')).toHaveLength(0);
    expect(result.issues.filter(issue => issue.type === 'negative_money' && issue.field === 'H')).toHaveLength(1);

    row[DEPT_COLUMNS.SUBJECT] = '';
    expect(validateRows([[], [], [], row], 'УО').rowsChecked).toBe(1);
    row[DEPT_COLUMNS.TOTAL_PLAN] = 'сломано';
    row[DEPT_COLUMNS.SUBJECT] = 'Услуги';
    expect(validateRows([[], [], [], row], 'УО').issues.some(issue =>
      issue.type === 'data_type' && issue.field === 'K')).toBe(true);
  });
  it('a recognized reason stays an actionable warning in source validation', () => {
    const row: unknown[] = new Array(34).fill('');
    row[DEPT_COLUMNS.ID] = '4'; row[DEPT_COLUMNS.SUBJECT] = 'Разовая закупка';
    row[DEPT_COLUMNS.METHOD] = 'ЕП'; row[DEPT_COLUMNS.TOTAL_PLAN] = 1200;
    row[DEPT_COLUMNS.EP_REASON] = 'Проведение аукциона нецелесообразно';
    const risk = validateRows([[], [], [], row], 'УКСиМП').issues.find(x => x.message.includes('Недостаточно данных для проверки сумм отдельных договоров'));
    expect(risk).toMatchObject({ severity: 'warning' });
  });
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
