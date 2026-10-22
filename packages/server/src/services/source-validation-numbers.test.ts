import { describe, expect, it } from 'vitest';
import { DEPT_COLUMNS } from '@aemr/shared';
import { validateRows } from './source-validation.js';

const row = (patch: Partial<Record<keyof typeof DEPT_COLUMNS, unknown>>): unknown[] => {
  const cells: unknown[] = new Array(34).fill('');
  for (const [column, value] of Object.entries(patch)) cells[DEPT_COLUMNS[column as keyof typeof DEPT_COLUMNS]] = value;
  return cells;
};
const sheet = (rows: unknown[][]): unknown[][] => [[], [], [], ...rows];

describe('Проверка источников: та же числовая семантика, что у метрик', () => {
  it('понимает пробелы тысяч и десятичную запятую, не выдумывает ошибку типа', () => {
    const result = validateRows(sheet([row({
      ID: '1', SUBJECT: 'Услуги', METHOD: 'ЭА', TOTAL_PLAN: '1 234,56',
      TOTAL_FACT: '1 100,00', FB_PLAN: '-12,5',
    })]));
    expect(result.rowsChecked).toBe(1);
    expect(result.issues.filter(i => i.type === 'data_type')).toHaveLength(0);
    expect(result.issues.filter(i => i.type === 'negative_money' && i.field === 'H')).toHaveLength(1);
  });

  it('строку с планом в локальном формате не теряет при пустом предмете', () => {
    const result = validateRows(sheet([row({ ID: '2', TOTAL_PLAN: '1 234,56', METHOD: 'ЕП' })]));
    expect(result.rowsChecked).toBe(1);
  });

  it('реально нечисловая сумма по-прежнему даёт замечание о типе', () => {
    const result = validateRows(sheet([row({ ID: '3', SUBJECT: 'Материалы', METHOD: 'ЭА', TOTAL_PLAN: 'ошибка' })]));
    expect(result.issues.some(i => i.type === 'data_type' && i.field === 'K')).toBe(true);
  });
});
