import { describe, expect, it } from 'vitest';
import { activePeriodKeys, resolvePeriodSelection } from './period-resolution';

describe('resolvePeriodSelection (извлечено из useFilteredData §6)', () => {
  it('фильтр пуст (нет месяцев) — periodKey проходит как есть, ничего не выведено', () => {
    const r = resolvePeriodSelection('year', new Set(), true);
    expect(r.periodKey).toBe('year');
    expect(r.coveredQuarters).toEqual([]);
    expect(r.fullQuarters).toEqual([]);
    expect(r.partialMonths).toEqual([]);
    expect(r.useMonthLevel).toBe(false);
    expect(r.hasActiveMonths).toBe(false);
  });

  it('квартальный period без месяцев остаётся квартальным', () => {
    expect(resolvePeriodSelection('q2', new Set(), false).periodKey).toBe('q2');
  });

  it('все 3 месяца одного квартала — квартал перекрывает period, fullQuarters', () => {
    const r = resolvePeriodSelection('year', new Set([7, 8, 9]), true);
    expect(r.periodKey).toBe('q3');
    expect(r.coveredQuarters).toEqual(['q3']);
    expect(r.fullQuarters).toEqual(['q3']);
    expect(r.partialMonths).toEqual([]);
    expect(r.useMonthLevel).toBe(true);
  });

  it('один месяц — частичный квартал, periodKey переключается на его квартал', () => {
    const r = resolvePeriodSelection('year', new Set([7]), true);
    expect(r.periodKey).toBe('q3');
    expect(r.coveredQuarters).toEqual(['q3']);
    expect(r.fullQuarters).toEqual([]);
    expect(r.partialMonths).toEqual([7]);
  });

  it('месяцы двух кварталов — periodKey НЕ переключается (остаётся period)', () => {
    const r = resolvePeriodSelection('year', new Set([1, 4]), true);
    expect(r.periodKey).toBe('year');
    expect(r.coveredQuarters).toEqual(['q1', 'q2']);
    expect(r.partialMonths).toEqual([1, 4]);
  });

  it('месяцы выбраны, но month-данных нет — useMonthLevel false', () => {
    const r = resolvePeriodSelection('year', new Set([1]), false);
    expect(r.useMonthLevel).toBe(false);
    expect(r.hasActiveMonths).toBe(true);
  });
});

describe('activePeriodKeys', () => {
  it('без месяцев — одиночный periodKey', () => {
    expect(activePeriodKeys({ hasActiveMonths: false, coveredQuarters: [], periodKey: 'q1' })).toEqual(['q1']);
  });

  it('с месяцами — покрытые кварталы', () => {
    expect(activePeriodKeys({ hasActiveMonths: true, coveredQuarters: ['q1', 'q2'], periodKey: 'year' }))
      .toEqual(['q1', 'q2']);
  });
});
