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
  plan?: number;
  method?: string;
  sub?: string;
}): unknown[] {
  const row: unknown[] = new Array(32).fill('');
  row[COL.ID] = o.id;
  row[COL.SUBORDINATE] = o.sub ?? 'МБУ Альфа';
  row[COL.SUBJECT] = 'Закупка';
  row[COL.TOTAL_PLAN] = o.plan ?? 100;
  row[COL.METHOD] = o.method ?? 'ЭА';
  row[COL.PLAN_DATE] = '15.01.2026';
  row[COL.PLAN_QUARTER] = o.quarter ?? 1;
  row[COL.PLAN_YEAR] = 2026;
  row[COL.FACT_DATE] = o.factDate ?? '';
  if (o.factDate) row[COL.TOTAL_FACT] = (o.plan ?? 100) / 2;
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

describe('sliceResults — неподдерживаемое сочетание осей это ошибка', () => {
  it('quarters + subordinates → бросает, а не возвращает весь квартал', () => {
    const g = computeFixture();
    expect(() => sliceResults(g, { quarters: ['q1'], subordinates: ['МБУ Альфа'] }))
      .toThrow(/неподдерживаемое сочетание осей/);
  });

  it('quarters + methods + activities → тоже ошибка (третья ось не сбрасывается молча)', () => {
    const g = computeFixture();
    expect(() =>
      sliceResults(g, { quarters: ['q1'], methods: ['competitive'], activities: ['program'] }),
    ).toThrow(/неподдерживаемое сочетание осей/);
  });

  it('поддержанные сочетания работают: quarters×methods', () => {
    const g = computeFixture();
    const sliced = sliceResults(g, { quarters: ['q1'], methods: ['competitive'] });
    expect(sliced.get('plan_count')?.value).toBe(2);
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
