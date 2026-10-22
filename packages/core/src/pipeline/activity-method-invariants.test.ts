import { describe, expect, it } from 'vitest';
import { DEPT_COLUMNS } from '@aemr/shared';
import { CalcEngine, standardRowFilter } from './calc-engine.js';
import { adaptToRecalcMetrics } from './calc-engine-adapter.js';

const C = DEPT_COLUMNS;
function row(id: string, method: string, type: string, sub: string, month: number, quarter: number): unknown[] {
  const out: unknown[] = Array(34).fill('');
  out[C.ID] = id;
  out[C.SUBJECT] = 'Проверяемая закупка ' + id;
  out[C.SUBORDINATE] = sub;
  out[C.TYPE] = type;
  out[C.METHOD] = method;
  out[C.FB_PLAN] = 10;
  out[C.TOTAL_PLAN] = 10;
  out[C.PLAN_DATE] = `10.${String(month).padStart(2, '0')}.2026`;
  out[C.PLAN_QUARTER] = quarter;
  out[C.PLAN_YEAR] = 2026;
  return out;
}
const data = [
  row('1', 'ЭА', 'Программное мероприятие', 'Школа №1', 1, 1),
  row('2', 'ЕП', 'Программное мероприятие', 'Школа №1', 2, 1),
  row('3', 'ЕП', 'Программное мероприятие', 'Сад №2', 4, 2),
  row('4', 'ЭА', 'Текущая деятельность', 'Сад №2', 4, 2),
];

describe('расчёт ядра: год × квартал × месяц × вид деятельности × способ × подвед', () => {
  const grouped = new CalcEngine().compute(data, standardRowFilter, 0, 2026);
  const metrics = adaptToRecalcMetrics(grouped, 'uo');

  it('квартал ПМ показывает 1 КП и 1 ЕП, а не обе позиции как КП', () => {
    const p = metrics.byActivity.q1.program.byMethod;
    expect(p?.competitive.plan).toBe(1);
    expect(p?.ep.plan).toBe(1);
    expect(p?.competitive.planSum).toBe(10);
    expect(p?.ep.planSum).toBe(10);
  });
  it('квартал 2 и год сохраняют исходную методовую классификацию', () => {
    expect(metrics.byActivity.q2.program.byMethod?.ep.plan).toBe(1);
    expect(metrics.byActivity.q2.current_non_program.byMethod?.competitive.plan).toBe(1);
    expect(metrics.byActivity.year.program.byMethod?.competitive.plan).toBe(1);
    expect(metrics.byActivity.year.program.byMethod?.ep.plan).toBe(2);
  });
  it('помесячный разрез из квартала не подменяется полным кварталом', () => {
    expect(metrics.byActivity.m1.program.byMethod?.competitive.plan).toBe(1);
    expect(metrics.byActivity.m1.program.byMethod?.ep.plan).toBe(0);
    expect(metrics.byActivity.m2.program.byMethod?.competitive.plan).toBe(0);
    expect(metrics.byActivity.m2.program.byMethod?.ep.plan).toBe(1);
  });
  it('у двух подведов есть собственные пересечения, без строк соседнего', () => {
    const school = metrics.bySubordinate.find(s => s.name.includes('Школа'));
    const garden = metrics.bySubordinate.find(s => s.name.includes('Сад'));
    expect(school?.activityByPeriod?.q1.program.byMethod?.competitive.plan).toBe(1);
    expect(school?.activityByPeriod?.q1.program.byMethod?.ep.plan).toBe(1);
    expect(garden?.activityByPeriod?.q1.program.byMethod?.competitive.plan).toBe(0);
    expect(garden?.activityByPeriod?.q2.program.byMethod?.ep.plan).toBe(1);
  });
});
