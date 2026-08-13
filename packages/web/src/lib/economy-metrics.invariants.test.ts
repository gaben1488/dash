// ── Инвариант «итог равен сумме частей» для утверждённой экономии.
//
// Основной контракт (AD-гейт, бюджетный фильтр) закреплён в
// economy-metrics.test.ts. Здесь — про целостность итога: откуда он сложен
// и что делает расчёт, когда часть управлений не даёт квартальной разбивки.

import { describe, expect, it } from 'vitest';
import { getEconomyTotalBreakdown, getFilteredEconomyTotal } from './economy-metrics';

const withQuarters = {
  dept: 'УО',
  economyTotal: 30,
  quarters: {
    q1: { economyTotal: 10 },
    q2: { economyTotal: 20 },
  },
};

/** Управление, которое отдаёт только годовой итог, без разбивки. */
const yearOnly = { dept: 'УЭР', economyTotal: 50 };

describe('итог экономии складывается из всех управлений, а не из части', () => {
  it('управление без квартальной разбивки не пропадает из годового итога', () => {
    // Раньше достаточно было одному управлению иметь кварталы, чтобы все
    // остальные молча дали ноль: итог был 30 вместо 80.
    const b = getEconomyTotalBreakdown({ depts: [withQuarters, yearOnly], periodKey: 'year' });
    expect(b.total).toBe(80);
    expect(b.fromQuarters).toBe(30);
    expect(b.fromDeptLevel).toBe(50);
    expect(b.missingDepts).toEqual([]);
  });

  it('итог всегда равен сумме своих частей', () => {
    const b = getEconomyTotalBreakdown({ depts: [withQuarters, yearOnly], periodKey: 'year' });
    expect(b.total).toBe(b.fromQuarters + b.fromDeptLevel);
  });

  it('при суженном периоде годовое число не приписывается кварталу', () => {
    // Годовые 50 у УЭР к первому кварталу отнести нечем — в итог они не идут.
    const b = getEconomyTotalBreakdown({ depts: [withQuarters, yearOnly], periodKey: 'q1' });
    expect(b.total).toBe(10);
    expect(b.fromDeptLevel).toBe(0);
  });

  it('пропущенное управление названо, а не спрятано', () => {
    const b = getEconomyTotalBreakdown({ depts: [withQuarters, yearOnly], periodKey: 'q1' });
    expect(b.missingDepts).toEqual(['УЭР']);
  });

  it('управление без экономии вовсе не считается пропущенным', () => {
    const b = getEconomyTotalBreakdown({
      depts: [withQuarters, { dept: 'УД', economyTotal: 0 }],
      periodKey: 'q1',
    });
    expect(b.missingDepts).toEqual([]);
  });

  it('выбор всех четырёх кварталов равен выбору года', () => {
    const depts = [withQuarters, yearOnly];
    const year = getEconomyTotalBreakdown({ depts, periodKey: 'year' });
    const four = getEconomyTotalBreakdown({
      depts,
      periodKey: 'year',
      coveredQuarters: ['q1', 'q2', 'q3', 'q4'],
    });
    expect(four.total).toBe(year.total);
    expect(four.missingDepts).toEqual(year.missingDepts);
  });

  it('сумма кварталов по отдельности равна итогу за оба квартала', () => {
    const depts = [withQuarters];
    const q1 = getFilteredEconomyTotal({ depts, coveredQuarters: ['q1'] });
    const q2 = getFilteredEconomyTotal({ depts, coveredQuarters: ['q2'] });
    const both = getFilteredEconomyTotal({ depts, coveredQuarters: ['q1', 'q2'] });
    expect(q1 + q2).toBe(both);
  });

  it('бюджетный фильтр не ломает разбор итога', () => {
    const depts = [{
      dept: 'УО',
      economyTotal: 30,
      quarters: { q1: { economyTotal: 30, economyFB: 12, economyKB: 10, economyMB: 8 } },
    }];
    const b = getEconomyTotalBreakdown({ depts, periodKey: 'q1', selectedBudgets: new Set(['fb', 'kb']) });
    expect(b.total).toBe(22);
    expect(b.total).toBe(b.fromQuarters + b.fromDeptLevel);
  });

  it('одиночное число и разбор дают один и тот же итог', () => {
    const input = { depts: [withQuarters, yearOnly], periodKey: 'year' };
    expect(getFilteredEconomyTotal(input)).toBe(getEconomyTotalBreakdown(input).total);
  });
});
