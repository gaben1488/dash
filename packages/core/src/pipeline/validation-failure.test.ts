import { describe, expect, it } from 'vitest';
import type { ClassifiedRow, ValidationRule } from '@aemr/shared';
import { validateData } from './validate.js';

const row: ClassifiedRow = {
  rowIndex: 4, sheet: 'УО', classification: 'procurement', classificationConfidence: 1,
  classificationReasons: [], cells: { A: '1', G: 'Поставка бумаги', L: 'ЭА', K: 10 },
};
const brokenRule: ValidationRule = {
  id: 'test_failure', name: 'Тестовая проверка', description: 'Искусственная неисправность',
  origin: 'bi_heuristic', severity: 'warning', scope: 'department', params: {},
  check() { throw new Error('private source details must not escape'); },
};
describe('покрытие проверки без ложного успеха', () => {
  it('одна неисправная проверка даёт явное замечание', () => {
    const issues = validateData(new Map(), [row], [brokenRule], []);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ category: 'validation_error', origin: 'runtime_error', severity: 'error', sheet: 'УО', row: 4 });
    expect(issues[0].description).not.toContain('private source details');
  });
  it('многократная неисправность не создаёт тысячу одинаковых технических замечаний', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ ...row, rowIndex: i + 4 }));
    const issues = validateData(new Map(), rows, [brokenRule], []);
    expect(issues.filter(i => i.category === 'validation_error')).toHaveLength(1);
  });
});
