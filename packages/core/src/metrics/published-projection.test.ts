import { describe, expect, it } from 'vitest';
import { DEPT_COLUMNS as C, productCalendarDay, PRODUCT_UTC_OFFSET_HOURS } from '@aemr/shared';
import { CalcEngine, combineMetricSlices, standardRowFilter } from '../pipeline/calc-engine.js';
import { runPipeline } from '../pipeline/orchestrator.js';
import { projectDepartmentMetrics, projectDistrictMetrics } from './published-projection.js';

const asOf = new Date('2026-10-21T08:00:00Z');
const day = productCalendarDay(asOf, PRODUCT_UTC_OFFSET_HOURS);

function row(id: string, method: 'ЕП' | 'ЭА', quarter: number | null,
  planDay: string, plan: number, fact: number, approved: boolean, economy: number) {
  const cells: unknown[] = Array(34).fill('');
  cells[C.ID] = id; cells[C.SUBJECT] = 'Поставка'; cells[C.METHOD] = method;
  cells[C.PLAN_YEAR] = 2026; cells[C.PLAN_QUARTER] = quarter ?? '';
  cells[C.PLAN_DATE] = planDay; cells[C.TOTAL_PLAN] = plan;
  cells[C.FACT_DATE] = fact ? '20.02.2026' : '';
  cells[C.TOTAL_FACT] = fact;
  cells[C.FLAG] = approved ? 'да' : 'нет';
  cells[C.ECONOMY_FB] = economy;
  return cells;
}

function setup() {
  const books = {
    УО: [[], [], [], row('1', 'ЕП', 1, '15.01.2026', 100, 80, true, 3),
      row('2', 'ЭА', 1, '15.02.2026', 200, 160, false, 10),
      row('3', 'ЭА', 2, '15.04.2026', 300, 0, false, 0),
      row('4', 'ЭА', null, '16.05.2026', 70, 60, true, 50)],
    УЭР: [[], [], [], row('5', 'ЕП', 2, '15.04.2026', 50, 40, true, 2),
      row('6', 'ЭА', 1, '15.01.2026', 100, 60, false, 20)],
  };
  const engine = new CalcEngine();
  const departments = [
    { departmentId: 'uo', grouped: engine.compute(books.УО, standardRowFilter, 3, 2026, { asOfDay: day }), rowOffset: 0 },
    { departmentId: 'uer', grouped: engine.compute(books.УЭР, standardRowFilter, 3, 2026, { asOfDay: day }), rowOffset: books.УО.length },
  ];
  const fresh = new Map();
  for (const d of departments) projectDepartmentMetrics(fresh, d, asOf.toISOString());
  projectDistrictMetrics(fresh, departments, asOf.toISOString());
  return { books, departments, fresh };
}

describe('one product metric projection over the executable CalcEngine', () => {
  it('preserves every previously published key and value without a second arithmetic path', () => {
    const { books, fresh } = setup();
    const old = runPipeline({
      sheetRows: books, batchGetData: [], reportMap: [], rules: [],
      spreadsheetId: 'test', targetYear: 2026, asOf,
    });
    const previousKeys = Object.keys(old.calculatedMetrics).sort();
    const nextKeys = [...fresh.keys()].sort();
    expect(nextKeys).toEqual(previousKeys);
    for (const key of nextKeys) {
      const newValue = fresh.get(key)?.numericValue;
      const oldValue = old.calculatedMetrics[key]?.numericValue;
      expect(newValue, key).toBeCloseTo(oldValue, 8);
    }
  });

  it('does not average rates, conflate economy with fact-plan, or count orphan rows in a year', () => {
    const { fresh } = setup();
    const get = (key: string) => fresh.get(key)?.numericValue ?? null;
    expect(get('competitive.year.count')).toBe(3);
    expect(get('competitive.year.fact_count')).toBe(2);
    expect(get('competitive.year.percent')).toBeCloseTo(2 / 3);
    expect(get('competitive.year.total_plan')).toBe(600);
    expect(get('competitive.year.total_fact')).toBe(220);
    expect(get('competitive.year.amount_dev')).toBe(-380);
    expect(get('competitive.year.savings_pct')).toBeCloseTo(220 / 600);
    expect(get('competitive.year.economy_total')).toBe(0);
    expect(get('sole.year.count')).toBe(2);
    expect(get('sole.year.total_fact')).toBe(120);
    expect(get('sole.year.economy_total')).toBe(5);
    expect(get('grbs.uo.ep.percent')).toBeCloseTo(80 / (80 + 160));
    expect(get('grbs.uo.year.data_row_count')).toBe(4);
    expect(get('grbs.uo.year.plan_count')).toBe(3);
    expect(get('grbs.uo.year.economy_total')).toBe(3);
    // Honest no-denominator result is absent, not persisted as false 0%.
    expect(fresh.has('grbs.uo.kp.q4.percent')).toBe(false);
  });

  it('combines independent source row coordinates while deriving one rate from bases', () => {
    const { departments } = setup();
    const a = departments[0]!.grouped.byQuarterMethod.get('q1.competitive')!;
    const b = departments[1]!.grouped.byQuarterMethod.get('q1.competitive')!;
    const merged = combineMetricSlices([
      { values: a, rowOffset: 0 },
      { values: b, rowOffset: departments[1]!.rowOffset },
    ]);
    expect(merged.get('plan_count')?.value).toBe(2);
    expect(merged.get('plan_count')?.contributingRows).toEqual([4, 11]);
    expect(merged.get('exec_count_pct')?.value).toBe(1);
  });
});
