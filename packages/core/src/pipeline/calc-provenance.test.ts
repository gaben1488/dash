import { describe, expect, it } from 'vitest';
import { DEPT_COLUMNS as C } from '@aemr/shared';
import { CalcEngine, explainMetric, slicePeriods, sliceResults, standardRowFilter } from './calc-engine.js';

function row(id: string, quarter: number, fact: boolean, approved: boolean) {
  const r: unknown[] = Array(34).fill('');
  r[C.ID] = id; r[C.SUBJECT] = 'Поставка'; r[C.METHOD] = 'ЭА';
  r[C.PLAN_YEAR] = 2026; r[C.PLAN_QUARTER] = quarter;
  r[C.PLAN_DATE] = quarter === 1 ? '15.01.2026' : '15.04.2026';
  r[C.TOTAL_PLAN] = 100;
  r[C.FACT_DATE] = fact ? '20.01.2026' : '';
  r[C.TOTAL_FACT] = fact ? 80 : 0;
  r[C.FLAG] = approved ? 'да' : '';
  r[C.ECONOMY_FB] = 2; r[C.ECONOMY_KB] = 3; r[C.ECONOMY_MB] = 5;
  return r;
}

describe('derived metric source rows', () => {
  const grouped = new CalcEngine().compute([
    [], [], [], row('1', 1, true, true), row('2', 1, false, false), row('3', 2, true, false),
  ], standardRowFilter, 3, 2026, { asOfDay: 20747 });

  it('keeps denominator rows and deduplicates three economy components', () => {
    expect(grouped.total.get('execution_pct')).toEqual({ value: 160 / 300, contributingRows: [3, 4, 5] });
    expect(grouped.total.get('economy_total')).toEqual({ value: 10, contributingRows: [3] });
  });

  it('keeps exactly the selected quarter rows in both slicing paths', () => {
    for (const result of [sliceResults(grouped, { quarters: ['q1'] }),
      slicePeriods(grouped, [{ kind: 'quarter', year: 2026, quarter: 1 }])]) {
      expect(result.get('exec_count_pct')).toEqual({ value: 0.5, contributingRows: [3, 4] });
      expect(result.get('economy_total')).toEqual({ value: 10, contributingRows: [3] });
    }
  });

  it('retains empty evidence and unknown ratio for an empty period', () => {
    const empty = sliceResults(grouped, { quarters: ['q4'] });
    expect(empty.get('execution_pct'))
      .toEqual({ value: null, contributingRows: [] });
    expect(explainMetric('plan_count', empty)?.value).toBe(0);
    expect(explainMetric('execution_pct', empty)?.operands.map(operand => operand.value)).toEqual([0, 0]);
  });
});
