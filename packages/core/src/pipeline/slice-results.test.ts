/**
 * Фаза 0 оси времени (карта 2026-08-07-time-axis-map.md §4): харденинг
 * sliceResults — пререквизит мультипериодного среза.
 *
 * Три инварианта спеки:
 *   1) слитые производные ПЕРЕСЧИТЫВАЮТСЯ из базовых аккумуляторов,
 *      а не суммируются (q1+q2 → exec_count_pct = ΣE/ΣD, не сумма долей);
 *   2) сочетание осей без карты пересечения — честная ошибка,
 *      а не молчаливый сброс лишнего фильтра;
 *   3) явные 4 квартала + корзина '_orphan' = total по счётчикам.
 */
import { describe, expect, it } from 'vitest';
import { DEPT_COLUMNS } from '@aemr/shared';
import { CalcEngine, getValue, sliceResults, standardRowFilter } from './calc-engine.js';

const COL = DEPT_COLUMNS;

function makeRow(o: {
  id: string;
  quarter?: number | string;
  factDate?: string;
  planDate?: string;
  plan?: number;
  fb?: number;
  kb?: number;
  method?: string;
  sub?: string;
  activity?: string;
  economyFB?: number;
  approved?: boolean;
}): unknown[] {
  const row: unknown[] = new Array(32).fill('');
  const plan = o.plan ?? 100;
  const fb = o.fb ?? plan;
  const kb = o.kb ?? 0;
  row[COL.ID] = o.id;
  row[COL.SUBORDINATE] = o.sub ?? 'МБУ Альфа';
  row[COL.SUBJECT] = 'Закупка';
  row[COL.TYPE] = o.activity ?? 'Программное мероприятие';
  row[COL.TOTAL_PLAN] = plan;
  row[COL.FB_PLAN] = fb;
  row[COL.KB_PLAN] = kb;
  row[COL.METHOD] = o.method ?? 'ЭА';
  row[COL.PLAN_DATE] = o.planDate ?? '15.01.2026';
  row[COL.PLAN_QUARTER] = o.quarter ?? 1;
  row[COL.PLAN_YEAR] = 2026;
  row[COL.FACT_DATE] = o.factDate ?? '';
  if (o.factDate) {
    row[COL.TOTAL_FACT] = plan / 2;
    row[COL.FB_FACT] = fb / 2;
    row[COL.KB_FACT] = kb / 2;
  }
  row[COL.ECONOMY_FB] = o.economyFB ?? 0;
  row[COL.FLAG] = o.approved ? 'да' : '';
  return row;
}
/**
 * Фикстура: q1 — 2 плана / 1 факт (50%), q2 — 1 план / 0 фактов (0%),
 * плюс строка-орфан: факт есть, план-квартала нет.
 */
function computeFixture() {
  const rows = [
    makeRow({ id: '1', quarter: 1, factDate: '20.01.2026' }),
    makeRow({ id: '2', quarter: 1 }),
    makeRow({ id: '3', quarter: 2 }),
    makeRow({ id: '4', quarter: '', factDate: '01.02.2026' }),
  ];
  return new CalcEngine().compute(rows, standardRowFilter, 0, 2026);
}

describe('sliceResults — производные пересчитываются, не суммируются', () => {
  it('q1+q2: exec_count_pct = Σfact/Σplan, а не сумма квартальных долей', () => {
    const g = computeFixture();
    // По кварталам: q1 = 1/2 = 0.5, q2 = 0/1 = 0. Сумма долей дала бы 0.5.
    const sliced = sliceResults(g, { quarters: ['q1', 'q2'] });
    // Правильно: (1+0)/(2+1) = 1/3.
    expect(sliced.get('exec_count_pct')?.value).toBeCloseTo(1 / 3);
    // Деньги: fact_total = 50, plan_total = 300 → 1/6.
    expect(sliced.get('execution_pct')?.value).toBeCloseTo(50 / 300);
  });

  it('слитые базовые аккумуляторы — обычная сумма', () => {
    const g = computeFixture();
    const sliced = sliceResults(g, { quarters: ['q1', 'q2'] });
    expect(sliced.get('plan_count')?.value).toBe(3);
    expect(sliced.get('fact_count')?.value).toBe(1);
  });
});

describe('sliceResults — C03.01: exact multi-axis scope', () => {
  // The same atomic input underlies totals, scoped rows and budget breakdowns.
  const g = new CalcEngine().compute([
    makeRow({ id: 'A', quarter: 1, sub: 'МБУ Альфа', plan: 100, fb: 70, kb: 30,
      factDate: '20.01.2026', approved: true, economyFB: 12 }),
    makeRow({ id: 'B', quarter: 1, sub: 'МБУ Альфа', plan: 40, method: 'ЕП',
      planDate: '12.02.2026' }),
    makeRow({ id: 'C', quarter: 1, sub: 'МБУ Бета', plan: 250,
      activity: 'Текущая деятельность', planDate: '15.03.2026',
      factDate: '20.03.2026', approved: true, economyFB: -5 }),
    makeRow({ id: 'D', quarter: 2, sub: 'МБУ Альфа', plan: 150,
      planDate: '12.04.2026', factDate: '20.04.2026', economyFB: 777 }),
    makeRow({ id: 'E', quarter: 2, sub: 'МБУ Альфа', plan: 75, method: 'ЕП',
      activity: 'Текущая деятельность', planDate: '14.04.2026', factDate: '20.04.2026' }),
    makeRow({ id: 'F', quarter: '', sub: 'МБУ Альфа', plan: 15, method: 'ЕП',
      planDate: '15.04.2026', factDate: '20.04.2026', approved: true, economyFB: 3 }),
    makeRow({ id: 'G', quarter: 1, sub: 'МБУ Альфа', plan: 20,
      activity: '', planDate: '12.03.2026' }),
  ], standardRowFilter, 0, 2026);

  it('intersects quarter × subordinate × activity × method with exact source rows', () => {
    const slice = sliceResults(g, { quarters: ['q1'], subordinates: ['МБУ Альфа'],
      activities: ['program'], methods: ['competitive'] });
    expect(slice.get('plan_count')).toMatchObject({ value: 1, contributingRows: [0] });
    expect(slice.get('fact_count')?.value).toBe(1);
    expect(slice.get('plan_total')?.value).toBe(100);
    expect(slice.get('plan_fb')?.value).toBe(70);
    expect(slice.get('plan_kb')?.value).toBe(30);
    expect(slice.get('economy_fb')?.value).toBe(12);
    expect(slice.get('execution_pct')?.value).toBeCloseTo(0.5);
  });

  it('handles all-period three-way intersection without losing orphan positions', () => {
    const competitive = sliceResults(g, { subordinates: ['МБУ Альфа'],
      activities: ['program'], methods: ['competitive'] });
    expect(competitive.get('plan_count')?.value).toBe(2); // A + D
    expect(competitive.get('plan_total')?.value).toBe(250);
    expect(competitive.get('economy_fb')?.value).toBe(12); // D has no AD approval

    const ep = sliceResults(g, { subordinates: ['МБУ Альфа'],
      activities: ['program'], methods: ['ep'] });
    expect(ep.get('plan_count')?.value).toBe(2); // B + F (orphan)
    expect(ep.get('plan_total')?.value).toBe(55);
    expect(ep.get('economy_fb')?.value).toBe(3);
  });

  it('does not omit unclassified activity if activity was NOT filtered', () => {
    const slice = sliceResults(g, { quarters: ['q1'],
      subordinates: ['МБУ Альфа'], methods: ['competitive'] });
    expect(slice.get('plan_count')?.value).toBe(2); // A + G (unknown activity)
    expect(slice.get('plan_count')?.contributingRows).toEqual([0, 6]);
  });

  it('applies the same intersection for months, with no quarter-month double count', () => {
    const slice = sliceResults(g, { months: [1, 4], subordinates: ['МБУ Альфа'],
      activities: ['program'], methods: ['competitive'] });
    expect(slice.get('plan_count')?.value).toBe(2); // A + D
    expect(slice.get('plan_total')?.value).toBe(250);
    expect(() => sliceResults(g, { quarters: ['q1'], months: [1] }))
      .toThrow(/quarters\+months/);
  });

  it('keeps an explicitly selected orphan visible under EVERY axis', () => {
    const slice = sliceResults(g, { quarters: ['_orphan'], subordinates: ['МБУ Альфа'],
      activities: ['program'], methods: ['ep'] });
    expect(slice.get('plan_count')).toMatchObject({ value: 1, contributingRows: [5] });
    expect(slice.get('fact_count')?.value).toBe(1);
    expect(slice.get('economy_fb')?.value).toBe(3);
  });

  it('keeps signed AD-gated economy and recalculates totals from one scope', () => {
    const negative = sliceResults(g, { quarters: ['q1'], subordinates: ['МБУ Бета'],
      activities: ['current_non_program'], methods: ['competitive'] });
    expect(negative.get('economy_fb')?.value).toBe(-5);
    const full = sliceResults(g, { quarters: ['q1', 'q2', '_orphan'],
      subordinates: ['МБУ Альфа'], activities: ['program'] });
    expect(full.get('plan_count')?.value).toBe(4); // A,B,D,F
    expect(full.get('plan_total')?.value).toBe(305);
    expect(full.get('economy_fb')?.value).toBe(15);
    expect(full.get('exec_count_pct')?.value).toBeCloseTo(3 / 4);
  });

  it('deduplicates repeated choices instead of doubling money or contributing rows', () => {
    const slice = sliceResults(g, { quarters: ['q1', 'q1'],
      subordinates: ['МБУ Альфа', 'МБУ Альфа'],
      activities: ['program', 'program'], methods: ['competitive', 'competitive'] });
    expect(slice.get('plan_count')).toMatchObject({ value: 1, contributingRows: [0] });
    expect(slice.get('plan_total')?.value).toBe(100);
    expect(g.total.get('plan_count')?.value).toBe(7); // no source mutation
  });

  it('rejects invalid axes and preserves null rather than inventing a denominator', () => {
    expect(() => sliceResults(g, { quarters: ['q5'] })).toThrow(/invalid quarter/);
    expect(() => sliceResults(g, { months: [13] })).toThrow(/invalid month/);
    expect(() => sliceResults(g, { methods: ['single'] })).toThrow(/invalid method/);
    const absent = sliceResults(g, { quarters: ['q2'], subordinates: ['Неизвестное учреждение'],
      activities: ['program'], methods: ['competitive'] });
    expect(absent.get('execution_pct')?.value).toBeNull();
    expect(absent.get('plan_count')?.value ?? 0).toBe(0);
  });
});
describe('sliceResults — судьба _orphan при мультивыборе', () => {
  it('4 квартала БЕЗ корзины — орфанный факт теряется (задокументированное поведение)', () => {
    const g = computeFixture();
    const sliced = sliceResults(g, { quarters: ['q1', 'q2', 'q3', 'q4'] });
    expect(sliced.get('fact_count')?.value).toBe(1); // без орфана
  });

  it("явные ['q1'..'q4','_orphan'] = total по счётчикам", () => {
    const g = computeFixture();
    const sliced = sliceResults(g, { quarters: ['q1', 'q2', 'q3', 'q4', '_orphan'] });
    expect(sliced.get('fact_count')?.value).toBe(getValue(g, 'fact_count'));
    expect(sliced.get('plan_count')?.value).toBe(getValue(g, 'plan_count'));
    expect(sliced.get('fact_total')?.value).toBe(getValue(g, 'fact_total'));
  });
});
