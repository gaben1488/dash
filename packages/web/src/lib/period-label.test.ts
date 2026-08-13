// ── Одна формулировка периода на весь продукт.
//
// Проверяется не текст ради текста: подпись периода стоит рядом с числами
// и объясняет, за что они посчитаны. Пока «Свод» писал «3 кв 2026», а круг
// на «Обзоре» — «3 квартал 2026», читатель не мог быть уверен, что перед
// ним один и тот же отрезок времени.

import { describe, expect, it } from 'vitest';
import { quarterLabel } from '@aemr/shared';
import { periodDataLabel, periodScopePhrase } from './period-label';

const noMonths = new Set<number>();

describe('подпись периода данных', () => {
  it('год целиком назван словами, а не одним числом', () => {
    expect(periodDataLabel({ year: 2026, period: 'year', activeMonths: noMonths }))
      .toBe('весь год 2026');
  });

  it('квартал подписан домом продукта — «3 кв», не «3 квартал»', () => {
    expect(periodDataLabel({ year: 2026, period: 'q3', activeMonths: noMonths }))
      .toBe(`${quarterLabel(3)} 2026`);
    expect(periodDataLabel({ year: 2026, period: 'q3', activeMonths: noMonths }))
      .toBe('3 кв 2026');
  });

  it('месяц назван полностью, как в фильтре шапки', () => {
    expect(periodDataLabel({ year: 2026, period: 'year', activeMonths: new Set([5]) }))
      .toBe('май 2026');
    // Сдвиг на месяц (месяцы 1-базные, массив 0-базный) — прежний дефект Д19.
    expect(periodDataLabel({ year: 2026, period: 'year', activeMonths: new Set([1]) }))
      .toBe('январь 2026');
    expect(periodDataLabel({ year: 2026, period: 'year', activeMonths: new Set([12]) }))
      .toBe('декабрь 2026');
  });

  it('несколько месяцев вне квартала считаются штуками', () => {
    expect(periodDataLabel({ year: 2026, period: 'year', activeMonths: new Set([1, 5, 9]) }))
      .toBe('3 мес. 2026');
  });

  it('квартал важнее счёта месяцев, когда выбран квартал', () => {
    expect(periodDataLabel({ year: 2026, period: 'q2', activeMonths: new Set([4, 5, 6]) }))
      .toBe('3 кв 2026'.replace('3 кв', quarterLabel(2)));
  });

  it('порядок слов один во всех ветках: период, затем год', () => {
    const cases = [
      periodDataLabel({ year: 2026, period: 'year', activeMonths: noMonths }),
      periodDataLabel({ year: 2026, period: 'q1', activeMonths: noMonths }),
      periodDataLabel({ year: 2026, period: 'year', activeMonths: new Set([7]) }),
      periodDataLabel({ year: 2026, period: 'year', activeMonths: new Set([1, 2]) }),
    ];
    for (const label of cases) {
      expect(label.endsWith(' 2026')).toBe(true);
      expect(label.startsWith('2026')).toBe(false);
    }
  });

  it('снятый фильтр года не даёт бессмыслицы «весь год все годы»', () => {
    expect(periodDataLabel({ year: 'all', period: 'year', activeMonths: noMonths }))
      .toBe('все годы целиком');
    expect(periodDataLabel({ year: 'all', period: 'q4', activeMonths: noMonths }))
      .toBe('4 кв, все годы');
  });

  it('все двенадцать месяцев — это весь год, а не «12 мес.»', () => {
    const all = new Set(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(periodDataLabel({ year: 2026, period: 'year', activeMonths: all }))
      .toBe('весь год 2026');
  });
});

describe('название периода без года', () => {
  it('собирается из тех же слов, что и полная подпись', () => {
    for (const [period, months] of [
      ['year', noMonths],
      ['q2', noMonths],
      ['year', new Set([3])],
      ['year', new Set([3, 8])],
    ] as const) {
      const scope = periodScopePhrase(period, months as Set<number>);
      expect(periodDataLabel({ year: 2026, period, activeMonths: months as Set<number> }))
        .toBe(`${scope} 2026`);
    }
  });
});
