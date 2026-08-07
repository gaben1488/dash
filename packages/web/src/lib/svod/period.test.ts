import { describe, expect, it } from 'vitest';
import { activePeriodButton, resolveSvodPeriod, svodKeyLabel } from './period';

const YEAR = 2026;

function resolve(months: number[], period: 'year' | 'q1' | 'q2' | 'q3' | 'q4' = 'year', explicit = true) {
  return resolveSvodPeriod({ year: YEAR, period, months, explicit });
}

describe('период «Свода» из глобального выбора', () => {
  it('режим недели не считается выбором пользователя — показан весь год', () => {
    // store в week-режиме держит в activeMonths месяцы текущей недели; принять
    // их за фильтр значит молча сузить страницу до одного месяца.
    const r = resolveSvodPeriod({ year: YEAR, period: 'year', months: [8], explicit: false });
    expect(r.keys).toEqual(['year']);
    expect(r.single).toBe('year');
  });

  it('квартал без месяцев берётся из legacy-оси period', () => {
    expect(resolve([], 'q3').keys).toEqual(['q3']);
  });

  it('полная тройка месяцев схлопывается в квартал, а не остаётся тремя ячейками', () => {
    expect(resolve([4, 5, 6]).keys).toEqual(['q2']);
  });

  it('все двенадцать месяцев — это год', () => {
    expect(resolve([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]).keys).toEqual(['year']);
  });

  it('один месяц адресуется месячной ячейкой, а не своим кварталом', () => {
    // Иначе выбор января показал бы числа всего первого квартала.
    const r = resolve([1]);
    expect(r.keys).toEqual(['m1']);
    expect(r.single).toBe('m1');
  });

  it('разрозненные месяцы дают дизъюнктный набор ключей и нет одной кнопки', () => {
    const r = resolve([1, 3]);
    expect(r.keys).toEqual(['m1', 'm3']);
    expect(r.single).toBeNull();
    expect(activePeriodButton(r)).toBeNull();
    expect(r.shortLabel).toBe('январь + март');
  });

  it('мусорные номера месяцев отбрасываются, а не ломают срез', () => {
    expect(resolve([0, 13, 7]).keys).toEqual(['m7']);
  });

  it('подписи ключей по-русски и без латиницы', () => {
    expect(svodKeyLabel('year')).toBe('год');
    expect(svodKeyLabel('q1')).toBe('1 кв');
    expect(svodKeyLabel('m12')).toBe('декабрь');
  });

  it('кнопка подсвечивается ровно тогда, когда выбор сводится к одной', () => {
    expect(activePeriodButton(resolve([], 'year'))).toEqual({ kind: 'year' });
    expect(activePeriodButton(resolve([7, 8, 9]))).toEqual({ kind: 'quarter', quarter: 3 });
    expect(activePeriodButton(resolve([2]))).toEqual({ kind: 'month', month: 2 });
  });
});
