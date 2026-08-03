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
  const rows = [
    row({ type: 'Текущая деятельность', fact: '15.02.2026' }),
    row({ type: 'Программное мероприятие', fact: 'Х', planDate: '01.01.2026' }),
    row({ type: 'Программное мероприятие', fact: 'Х', planDate: '31.12.2026' }),
    row({ type: '', fact: 'Х', plan: 0, planDate: '31.12.2026' }),
  ];
  const r = buildReport({ rowsByDept: { 'УЭР': rows } }, { year: 2026, quarter: 1, asOfDay: 20500 });
  const lc = r.grbsBlocks[0].lifecycle;

  it('вид деятельности: текущая, программное, без вида', () => {
    expect(lc.byType.map((b) => [b.metricKey, b.count])).toEqual([
      ['lifecycle_type_current', 1], ['lifecycle_type_program', 2], ['lifecycle_type_unknown', 1],
    ]);
  });

  it('стадии: заключено, в работе, просрочено, без денег', () => {
    const m = Object.fromEntries(lc.byStage.map((b) => [b.metricKey, b.count]));
    expect(m['lifecycle_stage_concluded']).toBe(1);
    expect(m['lifecycle_stage_overdue']).toBe(1);
    expect(m['lifecycle_stage_in_work']).toBe(1);
    expect(m['lifecycle_stage_unfunded']).toBe(1);
  });

  it('суммы долей равны числу строк периметра в обеих разрезках', () => {
    const t = (bs: typeof lc.byType) => bs.reduce((s, b) => s + b.count, 0);
    expect(t(lc.byType)).toBe(4);
    expect(t(lc.byStage)).toBe(4);
  });
});
