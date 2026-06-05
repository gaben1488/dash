import { describe, it, expect } from 'vitest';
import { DEPT_COLUMNS } from './column-map';

/**
 * Замок канона колонок dept-листа (0-based). Ловит регресс мислейбла
 * «графа программы»: индекс 3 (D) = PROGRAM_NAME, индекс 4 (E) = SUBPROGRAM.
 * Раньше метки были перепутаны (DESCRIPTION=3 / PROGRAM_NAME=4), из-за чего
 * calc-engine/recalculate читали подпрограмму вместо программы.
 */
describe('column-map canon (DEPT_COLUMNS)', () => {
  it('графа программы D=3 = PROGRAM_NAME, подпрограмма E=4 = SUBPROGRAM', () => {
    expect(DEPT_COLUMNS.PROGRAM_NAME).toBe(3);
    expect(DEPT_COLUMNS.SUBPROGRAM).toBe(4);
    expect(DEPT_COLUMNS.TYPE).toBe(5);
  });

  it('мислейбл DESCRIPTION удалён (был индекс 3)', () => {
    expect(Object.keys(DEPT_COLUMNS)).not.toContain('DESCRIPTION');
  });

  it('ключевые столбцы расчёта совпадают с каноном листа', () => {
    expect(DEPT_COLUMNS.METHOD).toBe(11);
    expect(DEPT_COLUMNS.PLAN_DATE).toBe(13);
    expect(DEPT_COLUMNS.PLAN_QUARTER).toBe(14);
    expect(DEPT_COLUMNS.PLAN_YEAR).toBe(15);
    expect(DEPT_COLUMNS.FACT_DATE).toBe(16);
  });

  it('план / факт / экономия ФБ-КБ-МБ + гейт экономии', () => {
    expect([DEPT_COLUMNS.FB_PLAN, DEPT_COLUMNS.KB_PLAN, DEPT_COLUMNS.MB_PLAN]).toEqual([7, 8, 9]);
    expect([DEPT_COLUMNS.FB_FACT, DEPT_COLUMNS.KB_FACT, DEPT_COLUMNS.MB_FACT]).toEqual([21, 22, 23]);
    expect([DEPT_COLUMNS.ECONOMY_FB, DEPT_COLUMNS.ECONOMY_KB, DEPT_COLUMNS.ECONOMY_MB]).toEqual([25, 26, 27]);
    expect(DEPT_COLUMNS.FLAG).toBe(29);
  });
});
