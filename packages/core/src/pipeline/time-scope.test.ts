/**
 * Фаза 2 оси времени: год как измерение движка.
 *
 * Инварианты спеки (карта §4, Фаза 2):
 *  - характеризационный: один год через opts.years = старое поведение
 *    targetYear (lenient);
 *  - год-квалифицированные карты byYearQuarter/byYearMonth живут РЯДОМ со
 *    старыми q1..q4/m1..m12, не заменяя их;
 *  - канон «год = Σ 4 плановых кварталов» (прецедент 396, не 475);
 *  - slicePeriods сшивает ключи резолвера без двойного счёта, производные
 *    пересчитываются.
 */
import { describe, expect, it } from 'vitest';
import { DEPT_COLUMNS, resolveTimeSelection } from '@aemr/shared';
import { CalcEngine, getValue, slicePeriods, standardRowFilter } from './calc-engine.js';

const COL = DEPT_COLUMNS;

function makeRow(o: {
  id: string;
  year?: number | string;
  quarter?: number | string;
  factDate?: string;
  plan?: number;
}): unknown[] {
  const row: unknown[] = new Array(32).fill('');
  row[COL.ID] = o.id;
  row[COL.SUBJECT] = 'Закупка';
  row[COL.TOTAL_PLAN] = o.plan ?? 100;
  row[COL.METHOD] = 'ЭА';
  row[COL.PLAN_DATE] = '15.01.2026';
  row[COL.PLAN_QUARTER] = o.quarter ?? 1;
  row[COL.PLAN_YEAR] = o.year ?? 2026;
  row[COL.FACT_DATE] = o.factDate ?? '';
  if (o.factDate) row[COL.TOTAL_FACT] = (o.plan ?? 100) / 2;
  return row;
}

/** 2025: q1×1; 2026: q1×2 (1 факт), q2×1, орфан-факт×1; без года: q1×1. */
const ROWS = [
  makeRow({ id: 'a', year: 2025, quarter: 1, plan: 10 }),
  makeRow({ id: 'b', year: 2026, quarter: 1, factDate: '20.01.2026' }),
  makeRow({ id: 'c', year: 2026, quarter: 1 }),
  makeRow({ id: 'd', year: 2026, quarter: 2 }),
  makeRow({ id: 'e', year: 2026, quarter: '', factDate: '01.02.2026' }),
  makeRow({ id: 'f', year: '', quarter: 1, plan: 7 }),
];

describe('TimeScope — years[] и emptyYearPolicy', () => {
  it('характеризационный: years=[2026] lenient = targetYear 2026 (старое поведение)', () => {
    const engine = new CalcEngine();
    const viaTarget = engine.compute(ROWS, standardRowFilter, 0, 2026);
    const viaYears = engine.compute(ROWS, standardRowFilter, 0, undefined, { years: [2026] });
    expect(viaYears.rowCount).toBe(viaTarget.rowCount);
    expect(getValue(viaYears, 'plan_count')).toBe(getValue(viaTarget, 'plan_count'));
    expect(getValue(viaYears, 'plan_total')).toBe(getValue(viaTarget, 'plan_total'));
  });

  it('мультигод: years=[2025,2026] складывает оба года (+lenient пустой год)', () => {
    const g = new CalcEngine().compute(ROWS, standardRowFilter, 0, undefined, { years: [2025, 2026] });
    // 2025(1) + 2026(4) + пустой год lenient(1) = 6.
    expect(g.rowCount).toBe(6);
  });

  it("emptyYearPolicy: 'strict' режет пустой год, 'bucket' пропускает", () => {
    const engine = new CalcEngine();
    const strict = engine.compute(ROWS, standardRowFilter, 0, undefined, {
      years: [2025, 2026], emptyYearPolicy: 'strict',
    });
    expect(strict.rowCount).toBe(5);
    const bucket = engine.compute(ROWS, standardRowFilter, 0, undefined, {
      years: [2025, 2026], emptyYearPolicy: 'bucket',
    });
    expect(bucket.rowCount).toBe(6);
    // Пустой год в год-картах — честная корзина _noyear.
    expect(bucket.byYearQuarter.get('_noyear.q1')?.get('plan_count')?.value).toBe(1);
  });

  it('год-карты живут рядом со старыми: q1 = Σ по годам q1', () => {
    const g = new CalcEngine().compute(ROWS, standardRowFilter, 0);
    const oldQ1 = g.byQuarter.get('q1')?.get('plan_count')?.value ?? 0;
    const sumYears = ['2025.q1', '2026.q1', '_noyear.q1']
      .map((k) => g.byYearQuarter.get(k)?.get('plan_count')?.value ?? 0)
      .reduce((a, b) => a + b, 0);
    expect(oldQ1).toBe(4);
    expect(sumYears).toBe(oldQ1);
  });
});

describe('slicePeriods — срез по ключам резолвера', () => {
  const g = new CalcEngine().compute(ROWS, standardRowFilter, 0);

  it('квартал одного года: {2026 q1} — только два атома 2026', () => {
    const s = slicePeriods(g, [{ kind: 'quarter', year: 2026, quarter: 1 }]);
    expect(s.get('plan_count')?.value).toBe(2);
    expect(s.get('fact_count')?.value).toBe(1);
    expect(s.get('exec_count_pct')?.value).toBeCloseTo(0.5);
  });

  it('год-ключ: печатный канон = Σ кварталов БЕЗ орфана; includeOrphan добирает', () => {
    const printed = slicePeriods(g, [{ kind: 'year', year: 2026 }]);
    expect(printed.get('plan_count')?.value).toBe(3); // b, c, d
    expect(printed.get('fact_count')?.value).toBe(1); // орфан e не в печатном году
    const live = slicePeriods(g, [{ kind: 'year', year: 2026 }], { includeOrphan: true });
    expect(live.get('fact_count')?.value).toBe(2); // + орфан e
  });

  it('мультигодовой набор ключей из резолвера — без двойного счёта', () => {
    const resolved = resolveTimeSelection({
      years: new Set([2025]),
      byYear: new Map([[2026, { quarters: new Set([1, 2] as const), months: new Set([1, 2, 3] as const) }]]),
      weekStart: null,
    });
    // Канонизация: месяцы 1-3 поглощены q1 → ключи: 2025 год, 2026 q1, q2.
    const s = slicePeriods(g, resolved.keys);
    // 2025 год (1) + 2026 q1 (2) + q2 (1) = 4 атома, дублей нет.
    expect(s.get('plan_count')?.value).toBe(4);
  });

  it('производные пересчитаны из слитых баз: 2026 q1+q2 exec = 1/3', () => {
    const s = slicePeriods(g, [
      { kind: 'quarter', year: 2026, quarter: 1 },
      { kind: 'quarter', year: 2026, quarter: 2 },
    ]);
    expect(s.get('exec_count_pct')?.value).toBeCloseTo(1 / 3);
  });
});
