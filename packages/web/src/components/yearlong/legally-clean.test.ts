/**
 * Стража вычета тумблера п.82: «без выплат и платежей» исключает ровно
 * подклассы выплат физлицам и платежей без договора (п.81) в периметре
 * управлений и периода, тем же правилом смешанной агрегации, что sumEpKp.
 */
import { describe, it, expect } from 'vitest';
import { yearlongKey, type YearlongKindId } from '@aemr/shared';
import { excludedEpTotals, excludedEpTotalsQuarter } from './legally-clean';
import type { PeriodSel } from '../competition/primitives';

const ALL_DEPTS = ['УЭР', 'УИО', 'УАГЗО', 'УФБП', 'УД', 'УДТХ', 'УКСиМП', 'УО'];

const yearSel: PeriodSel = {
  periodKey: 'year',
  hasActiveMonths: false,
  coveredQuarters: [],
  fullQuarters: [],
  partialMonths: [],
  useMonthLevel: false,
};

describe('excludedEpTotals (тумблер п.82)', () => {
  it('весь год, все управления: 10 строк на ~2 144 тыс. (7 выплат + 3 платежа)', () => {
    const ex = excludedEpTotals(ALL_DEPTS, yearSel);
    expect(ex.count).toBe(10);
    expect(ex.plan).toBeCloseTo(1824.6 + 319.4, 0);
  });

  it('латинская форма ключа управления работает так же (обе формы канона)', () => {
    const ex = excludedEpTotals(['uksimp'], yearSel);
    expect(ex.count).toBe(10); // все 10 исключаемых строк — книга УКСиМП
  });

  it('периметр управлений сужает вычет: у УДТХ исключаемых строк нет', () => {
    expect(excludedEpTotals(['УДТХ'], yearSel).count).toBe(0);
    expect(excludedEpTotals(['УФБП'], yearSel).count).toBe(0);
  });

  it('квартал 3: одна выплата (200 тыс.), платежей нет', () => {
    const ex = excludedEpTotalsQuarter(ALL_DEPTS, 'q3');
    expect(ex.count).toBe(1);
    expect(ex.plan).toBeCloseTo(200, 5);
  });

  it('квартал 4: остальные девять строк', () => {
    const ex = excludedEpTotalsQuarter(ALL_DEPTS, 'q4');
    expect(ex.count).toBe(9);
    const year = excludedEpTotals(ALL_DEPTS, yearSel);
    expect(ex.plan + 200).toBeCloseTo(year.plan, 5);
  });

  it('месячный периметр: полный кв.3 + ноябрь → выплата кв.3 и две ноябрьские', () => {
    const sel: PeriodSel = {
      periodKey: 'q3',
      hasActiveMonths: true,
      coveredQuarters: ['q3', 'q4'],
      fullQuarters: ['q3'],
      partialMonths: [11],
      useMonthLevel: true,
    };
    const ex = excludedEpTotals(ALL_DEPTS, sel);
    // кв.3: компенсация выездов (200); ноябрь: найм жилья (480) и выезды Ратибор (100)
    expect(ex.count).toBe(3);
    expect(ex.plan).toBeCloseTo(780, 5);
  });

  it('переразметка владельцем выводит строку из вычета (оверрайд побеждает)', () => {
    const overrides = new Map<string, YearlongKindId>([
      // Владелец счёл фонд капремонта (УКСиМП №201) серией договоров.
      [yearlongKey('УКСиМП', '201'), 'regular-mandatory-services'],
    ]);
    const ex = excludedEpTotals(ALL_DEPTS, yearSel, overrides);
    expect(ex.count).toBe(9);
    const base = excludedEpTotals(ALL_DEPTS, yearSel);
    expect(base.plan - ex.plan).toBeCloseTo(250, 5);
  });
});
