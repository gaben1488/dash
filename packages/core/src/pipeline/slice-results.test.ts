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
import { adaptToRecalcMetrics } from './calc-engine-adapter.js';

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

  it('projects the same exact scope into the legacy dashboard adapter, not just the core map', () => {
    const adapter = adaptToRecalcMetrics(g, 'УО');
    const allPlannedQuarters = sliceResults(g, { quarters: ['q1', 'q2'] });
    expect(adapter.year.planTotal).toBe(635); // same six quarter-qualified raw atoms
    expect(adapter.year.planTotal).toBe(allPlannedQuarters.get('plan_total')?.value);
    expect(adapter.year.factTotal).toBe(allPlannedQuarters.get('fact_total')?.value);
    expect(adapter.year.economyTotal).toBe(allPlannedQuarters.get('economy_total')?.value);
    // Only explicitly requested diagnostics include the orphan; year is not widened.
    expect(adapter.orphanFact.factTotal).toBe(7.5);
    expect(adapter.orphanFact.economyTotal).toBe(3);

    const alpha = adapter.bySubordinate.find(sub => sub.name === 'МБУ Альфа');
    expect(alpha).toBeDefined();
    const q1CompetitivePM = alpha!.activityByPeriod.q1.program.byMethod!.competitive!;
    const same = sliceResults(g, { quarters: ['q1'], subordinates: ['МБУ Альфа'],
      activities: ['program'], methods: ['competitive'] });
    expect(q1CompetitivePM.plan).toBe(same.get('plan_count')?.value);
    expect(q1CompetitivePM.fact).toBe(same.get('fact_count')?.value);
    expect(q1CompetitivePM.planSum).toBe(same.get('plan_total')?.value);
    expect(q1CompetitivePM.planFB).toBe(same.get('plan_fb')?.value);
    expect(q1CompetitivePM.planKB).toBe(same.get('plan_kb')?.value);
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
  it('legacy current_program and current_non_program both mean entire TD, without double counting', () => {
    const fresh = sliceResults(g, { activities: ['current_non_program'] });
    const oldUrl = sliceResults(g, { activities: ['current_program'] });
    const both = sliceResults(g, { activities: ['current_program', 'current_non_program'] });
    expect(fresh.get('plan_count')?.value).toBe(2); // C + E
    expect(fresh.get('plan_total')?.value).toBe(325);
    expect(oldUrl.get('plan_total')?.value).toBe(325);
    expect(both.get('plan_count')?.value).toBe(2);
    expect(sliceResults(g, { quarters: ['q1'], subordinates: ['МБУ Бета'],
      activities: ['current_program'], methods: ['competitive'] })
      .get('plan_count')?.contributingRows).toEqual([2]);
  });
  it('independent row oracle: the full period × subordinate × activity × method matrix reconciles', () => {
    // Expected values are handwritten from seven raw atoms, not built from
    // CalcEngine group maps. The matrix detects accidental broadening.
    const atoms = [
      { sub: 'МБУ Альфа', q: 'q1', month: 1, act: 'program', method: 'competitive', plan: 100, fb: 70, kb: 30, fact: 50, economy: 12 },
      { sub: 'МБУ Альфа', q: 'q1', month: 2, act: 'program', method: 'ep', plan: 40, fb: 40, kb: 0, fact: 0, economy: 0 },
      { sub: 'МБУ Бета', q: 'q1', month: 3, act: 'current_non_program', method: 'competitive', plan: 250, fb: 250, kb: 0, fact: 125, economy: -5 },
      { sub: 'МБУ Альфа', q: 'q2', month: 4, act: 'program', method: 'competitive', plan: 150, fb: 150, kb: 0, fact: 75, economy: 0 },
      { sub: 'МБУ Альфа', q: 'q2', month: 4, act: 'current_non_program', method: 'ep', plan: 75, fb: 75, kb: 0, fact: 37.5, economy: 0 },
      { sub: 'МБУ Альфа', q: '_orphan', month: 4, act: 'program', method: 'ep', plan: 15, fb: 15, kb: 0, fact: 7.5, economy: 3 },
      { sub: 'МБУ Альфа', q: 'q1', month: 3, act: 'unknown', method: 'competitive', plan: 20, fb: 20, kb: 0, fact: 0, economy: 0 },
    ];
    const periods: Array<{ quarters?: string[]; months?: number[] }> = [
      {}, { quarters: ['q1'] }, { quarters: ['q2'] },
      { quarters: ['_orphan'] }, { months: [4] },
    ];
    const subChoices: Array<string[] | undefined> = [undefined, ['МБУ Альфа'], ['МБУ Бета']];
    const actChoices: Array<string[] | undefined> = [undefined, ['program'], ['current_non_program'], ['unknown']];
    const methodChoices: Array<string[] | undefined> = [undefined, ['competitive'], ['ep']];
    for (const period of periods) for (const subordinates of subChoices)
      for (const activities of actChoices) for (const methods of methodChoices) {
        const filter = { ...period, subordinates, activities, methods };
        const label = JSON.stringify(filter);
        const selected = atoms.flatMap((atom, index) => {
          const keep = (!period.quarters || period.quarters.includes(atom.q))
            && (!period.months || period.months.includes(atom.month))
            && (!subordinates || subordinates.includes(atom.sub))
            && (!activities || activities.includes(atom.act))
            && (!methods || methods.includes(atom.method));
          return keep ? [{ ...atom, index }] : [];
        });
        const sum = (key: 'plan' | 'fb' | 'kb' | 'fact' | 'economy') =>
          selected.reduce((total, atom) => total + atom[key], 0);
        const actual = sliceResults(g, filter);
        const expectedPlan = sum('plan');
        const expectedFact = sum('fact');
        expect(actual.get('plan_count')?.value ?? 0, label).toBe(selected.length);
        expect(actual.get('fact_count')?.value ?? 0, label)
          .toBe(selected.filter(atom => atom.fact > 0).length);
        expect(actual.get('plan_total')?.value ?? 0, label).toBeCloseTo(expectedPlan, 8);
        expect(actual.get('fact_total')?.value ?? 0, label).toBeCloseTo(expectedFact, 8);
        expect(actual.get('plan_fb')?.value ?? 0, label).toBeCloseTo(sum('fb'), 8);
        expect(actual.get('plan_kb')?.value ?? 0, label).toBeCloseTo(sum('kb'), 8);
        expect(actual.get('economy_fb')?.value ?? 0, label).toBeCloseTo(sum('economy'), 8);
        expect([...(actual.get('plan_count')?.contributingRows ?? [])].sort((a, b) => a - b), label)
          .toEqual(selected.map(atom => atom.index));
        if (expectedPlan > 0) {
          expect(actual.get('execution_pct')?.value, label)
            .toBeCloseTo(expectedFact / expectedPlan, 8);
        } else {
          expect(actual.get('execution_pct')?.value, label).toBeNull();
        }
      }
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
