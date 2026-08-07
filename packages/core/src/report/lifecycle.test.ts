/** Этапность: доли собираются по колонкам листа, суммы сходятся. */
import { describe, expect, it } from 'vitest';
import { buildReport } from './build-report.js';
import type { RawRow } from '../pipeline/calc-engine.js';

const W = 34;
function row(o: Partial<Record<string, unknown>>): RawRow {
  const r: unknown[] = new Array(W).fill(null);
  r[0] = 1; r[2] = 'МБУ'; r[6] = String(o.subject ?? 'Закупка');
  r[5] = o.type ?? 'Текущая деятельность';
  r[10] = o.plan ?? 100; r[11] = o.method ?? 'ЭА';
  r[13] = o.planDate ?? '01.02.2026';
  r[14] = 1; r[15] = 2026; r[16] = o.fact ?? 'Х';
  return r as RawRow;
}

describe('этапность года', () => {
  const noYear = row({ type: 'Текущая деятельность', fact: 'Х', planDate: '' });
  noYear[15] = ''; // года плана нет — деньги вбиты «примерно», финансирование не подтверждено
  noYear[14] = '';
  const rows = [
    row({ type: 'Текущая деятельность', fact: '15.02.2026' }),
    row({ type: 'Программное мероприятие', fact: 'Х', planDate: '01.01.2026' }),
    row({ type: 'Программное мероприятие', fact: 'Х', planDate: '31.12.2026' }),
    row({ type: '', fact: 'Х', plan: 0, planDate: '31.12.2026' }),
    noYear,
  ];
  const r = buildReport({ rowsByDept: { 'УЭР': rows } }, { year: 2026, quarter: 1, asOfDay: 20500 });
  const lc = r.grbsBlocks[0].lifecycle;

  it('вид деятельности: текущая, программное, без вида', () => {
    expect(lc.byType.map((b) => [b.metricKey, b.count])).toEqual([
      ['lifecycle_type_current', 2], ['lifecycle_type_program', 2], ['lifecycle_type_unknown', 1],
    ]);
  });

  it('стадии: заключено, в работе, просрочено, без финансирования, без денег', () => {
    const m = Object.fromEntries(lc.byStage.map((b) => [b.metricKey, b.count]));
    expect(m['lifecycle_stage_concluded']).toBe(1);
    expect(m['lifecycle_stage_overdue']).toBe(1);
    expect(m['lifecycle_stage_in_work']).toBe(1);
    expect(m['lifecycle_stage_no_funding']).toBe(1);
    expect(m['lifecycle_stage_unfunded']).toBe(1);
  });

  it('«без финансирования» — отдельная доля этапности, но ВНЕ счёта года', () => {
    // Консолидация 07.08: строка без года видна в этапности и не входит
    // в счётчики (движок гоняется по fundedRows) — числа те же, что и
    // вовсе без неё.
    const base = buildReport(
      { rowsByDept: { 'УЭР': rows.filter((x) => x !== noYear) } },
      { year: 2026, quarter: 1, asOfDay: 20500 },
    ).grbsBlocks[0];
    const cur = r.grbsBlocks[0];
    expect(cur.quarter.execution.planCount).toBe(base.quarter.execution.planCount);
    expect(cur.year.counts).toEqual(base.year.counts);
    expect(cur.money.plan.total).toBe(base.money.plan.total);
    expect(cur.noYearRows).toEqual({ count: 1, total: 100 });
    expect(base.noYearRows).toBeUndefined();
  });

  it('суммы долей равны числу строк периметра в обеих разрезках', () => {
    const t = (bs: typeof lc.byType) => bs.reduce((s, b) => s + b.count, 0);
    expect(t(lc.byType)).toBe(5);
    expect(t(lc.byStage)).toBe(5);
  });
});
