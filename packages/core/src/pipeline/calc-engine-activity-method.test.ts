import { describe, expect, it } from 'vitest';
import { DEPT_COLUMNS as C } from '@aemr/shared';
import { CalcEngine, standardRowFilter } from './calc-engine.js';
import { adaptToRecalcMetrics } from './calc-engine-adapter.js';

function row(id: string, sub: string, activity: string, method: string,
  planFB: number, planKB: number, planMB: number): unknown[] {
  const r: unknown[] = new Array(34).fill('');
  r[C.ID] = id;
  r[C.SUBORDINATE] = sub;
  r[C.TYPE] = activity;
  r[C.SUBJECT] = 'Контрольная закупка';
  r[C.FB_PLAN] = planFB;
  r[C.KB_PLAN] = planKB;
  r[C.MB_PLAN] = planMB;
  r[C.TOTAL_PLAN] = planFB + planKB + planMB;
  r[C.METHOD] = method;
  r[C.PLAN_DATE] = '15.01.2026';
  r[C.PLAN_QUARTER] = 1;
  r[C.PLAN_YEAR] = 2026;
  return r;
}

const source = [
  row('1', 'МКУ А', 'Программное мероприятие', 'ЕП', 100, 0, 0),
  row('2', 'МКУ А', 'Программное мероприятие', 'ЭА', 0, 200, 0),
  row('3', 'МКУ Б', 'Программное мероприятие', 'ЕП', 300, 0, 0),
  row('4', 'МКУ Б', 'Текущая деятельность', 'ЭА', 0, 0, 400),
];

describe('CalcEngine exact activity × method × period × subordinate', () => {
  const engine = new CalcEngine();
  const grouped = engine.compute(source, standardRowFilter, 0, 2026, { strictYear: true });
  const recalc = adaptToRecalcMetrics(grouped, 'УО');

  it('does not assign EP rows to competitive just because activity is selected', () => {
    const a = recalc.byActivity.q1.program;
    expect(a.byMethod?.ep.plan).toBe(2);
    expect(a.byMethod?.competitive.plan).toBe(1);
    expect(a.byMethod?.ep.planSum).toBe(400);
    expect(a.byMethod?.competitive.planSum).toBe(200);
    expect(a.byMethod?.ep.planFB).toBe(400);
    expect(a.byMethod?.competitive.planKB).toBe(200);
  });

  it('quarter and year carry the same eligible planned rows', () => {
    expect(recalc.byActivity.year.program.byMethod?.ep.plan).toBe(2);
    expect(recalc.byActivity.year.program.byMethod?.competitive.plan).toBe(1);
    expect(recalc.byActivity.year.program.byMethod?.ep.planSum).toBe(400);
  });

  it('month one also keeps the exact procurement method split', () => {
    expect(recalc.byActivity.m1.program.byMethod?.ep.plan).toBe(2);
    expect(recalc.byActivity.m1.program.byMethod?.competitive.plan).toBe(1);
  });

  it('choosing subordinate A does not inherit B activity or B money', () => {
    const a = recalc.bySubordinate.find(s => s.name === 'МКУ А');
    expect(a).toBeDefined();
    const program = a!.byActivityPeriod!.q1.program;
    expect(program.byMethod?.ep.plan).toBe(1);
    expect(program.byMethod?.competitive.plan).toBe(1);
    expect(program.byMethod?.ep.planSum).toBe(100);
    expect(program.byMethod?.competitive.planSum).toBe(200);
  });

  it('does not collapse distinct activity kinds on the same method', () => {
    expect(recalc.byActivity.q1.current_non_program.byMethod?.competitive.plan).toBe(1);
    expect(recalc.byActivity.q1.program.byMethod?.competitive.plan).toBe(1);
  });
});
