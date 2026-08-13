/**
 * strictYear (задача #5, находка 16.07): для СВЕРКИ год-срез обязан быть строгим.
 *
 * Канон по умолчанию («пустой год проходит») правилен для дашборда — строки без
 * заполненного P не теряются из базового вида. Но в сверке год-среза он даёт
 * мусор: официал-январь-2025 сравнивался с расчётом из строк-без-года →
 * 981 псевдо-«high» на живых данных (в книгах строк P=2025 нет вообще).
 */
import { describe, it, expect } from 'vitest';
import { DEPT_COLUMNS } from '@aemr/shared';
import { CalcEngine, standardRowFilter } from './calc-engine.js';

const COL = DEPT_COLUMNS;

function makeRow(planYear: number | string, id: string): unknown[] {
  const row: unknown[] = new Array(32).fill('');
  row[COL.ID] = id;
  row[COL.SUBJECT] = 'Закупка';
  row[COL.TOTAL_PLAN] = 100;
  row[COL.METHOD] = 'ЭА';
  row[COL.PLAN_DATE] = '15.01.2026';
  row[COL.PLAN_QUARTER] = 1;
  row[COL.PLAN_YEAR] = planYear;
  return row;
}

const rows = [
  makeRow(2026, '1'),
  makeRow('', '2'),   // год не заполнен
  makeRow(2025, '3'),
];

describe('CalcEngine.compute — strictYear', () => {
  it('дефолт: пустой год в срез не идёт, но остаётся адресуемой корзиной', () => {
    const engine = new CalcEngine();
    const g2025 = engine.compute(rows, standardRowFilter, 0, 2025);
    // Дефолт с 08.08 — корзина вместо прежнего «проходит в любой срез».
    // Тот прежний канон и был корнем расхождения лимита с листом у каждого
    // управления: лист адресует строку парой «квартал × год», строке без
    // года лечь некуда, и в официальные числа она не входит.
    expect(g2025.rowCount).toBe(1); // только строка с годом 2025
    // Немоту листа при этом не копируем: строка не исчезла, она названа.
    expect(g2025.noYear.get('plan_count')?.value).toBe(1);
  });

  it('strictYear: в срез входит ТОЛЬКО явный P === году (сверка)', () => {
    const engine = new CalcEngine();
    const g2025 = engine.compute(rows, standardRowFilter, 0, 2025, { strictYear: true });
    expect(g2025.rowCount).toBe(1); // только строка с P=2025
    const g2026 = engine.compute(rows, standardRowFilter, 0, 2026, { strictYear: true });
    expect(g2026.rowCount).toBe(1); // только P=2026, пустой год — вон
  });

  it('strictYear без targetYear ничего не меняет', () => {
    const engine = new CalcEngine();
    const g = engine.compute(rows, standardRowFilter, 0, undefined, { strictYear: true });
    expect(g.rowCount).toBe(3);
  });
});
