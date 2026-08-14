import { describe, expect, it } from 'vitest';
import { selectedEconomy, getFilteredEconomyTotal, getEconomyTotalBreakdown } from './economy-metrics';

// Contract: METRICS_CONTRACT.md:10-11,47 — economy_total is APPROVED economy
// (rows with fact_date AND AD="да"), i.e. Z+AA+AB. The UI must NOT compute economy
// as plan−fact / amount_deviation. These tests pin that invariant for the canonical
// helper that all economy aggregation must route through.

describe('selectedEconomy — AD-gated, never plan−fact', () => {
  it('returns economyTotal when no budget filter', () => {
    expect(selectedEconomy({ economyTotal: 35, economyFB: 20, economyKB: 10, economyMB: 5 })).toBe(35);
  });

  it('sums only the selected budget components', () => {
    const src = { economyTotal: 35, economyFB: 20, economyKB: 10, economyMB: 5 };
    expect(selectedEconomy(src, new Set(['fb']))).toBe(20);
    expect(selectedEconomy(src, new Set(['fb', 'kb']))).toBe(30);
    expect(selectedEconomy(src, new Set(['fb', 'kb', 'mb']))).toBe(35);
  });

  it('falls back to economyTotal when the selected budget components are absent', () => {
    expect(selectedEconomy({ economyTotal: 35 }, new Set(['fb']))).toBe(35);
  });

  it('treats null/absent approved economy as 0 — NOT plan−fact', () => {
    // A source with no approved economy contributes 0, even if (plan−fact) would be large.
    // The helper has no plan/fact inputs, so plan−fact is structurally impossible here.
    expect(selectedEconomy({ economyTotal: null })).toBe(0);
    expect(selectedEconomy({})).toBe(0);
    expect(selectedEconomy(null)).toBe(0);
    expect(selectedEconomy(undefined)).toBe(0);
  });
});

describe('getFilteredEconomyTotal', () => {
  const depts = [
    {
      economyTotal: 25,
      quarters: {
        q1: { economyTotal: 10, economyFB: 6, economyKB: 3, economyMB: 1 },
        q2: { economyTotal: 15, economyFB: 9, economyKB: 5, economyMB: 1 },
      },
    },
    {
      economyTotal: 17,
      quarters: {
        q1: { economyTotal: 7, economyFB: 4, economyKB: 2, economyMB: 1 },
        q2: { economyTotal: 10, economyFB: 6, economyKB: 3, economyMB: 1 },
      },
    },
  ];

  it('sums AD-gated economyTotal across depts/quarters for the year', () => {
    expect(getFilteredEconomyTotal({ depts, periodKey: 'year' })).toBe(42); // 10+15+7+10
  });

  it('respects the budget filter (per-budget economy only)', () => {
    expect(getFilteredEconomyTotal({ depts, periodKey: 'year', selectedBudgets: new Set(['fb']) })).toBe(25); // 6+9+4+6
  });

  it('uses dept-level economyTotal when no quarter data is present', () => {
    expect(getFilteredEconomyTotal({ depts: [{ economyTotal: 50 }], periodKey: 'year' })).toBe(50);
  });
});

// ── Страж бага #10 (реестр охоты 08.08): экономия за выбранный МЕСЯЦ
// считалась за весь покрытый квартал — на одном экране тоталы сужались
// месяцем, а экономия нет. Месячная ветвь обязана включаться тем же
// условием, что смешанная агрегация totals (partialMonths + hasMonthData).
describe('getFilteredEconomyTotal — месячная ветвь (баг #10)', () => {
  const depts = [
    {
      economyTotal: 25,
      quarters: {
        q1: { economyTotal: 10 },
        q2: { economyTotal: 15, economyFB: 9, economyKB: 5, economyMB: 1 },
      },
      months: {
        4: { economyTotal: 6, economyFB: 4, economyKB: 2, economyMB: 0 },
        5: { economyTotal: 9, economyFB: 5, economyKB: 3, economyMB: 1 },
      },
    },
  ];

  it('один месяц — экономия месяца, НЕ всего квартала', () => {
    // Май: coveredQuarters ['q2'] раньше давал 15 (весь q2) вместо 9 (май).
    expect(getFilteredEconomyTotal({
      depts, periodKey: 'q2', coveredQuarters: ['q2'],
      fullQuarters: [], partialMonths: [5], hasMonthData: true,
    })).toBe(9);
  });

  it('месяц + бюджет-фильтр — per-budget экономия месяца', () => {
    expect(getFilteredEconomyTotal({
      depts, periodKey: 'q2', coveredQuarters: ['q2'],
      fullQuarters: [], partialMonths: [5], hasMonthData: true,
      selectedBudgets: new Set(['fb']),
    })).toBe(5);
  });

  it('смешанный выбор: полный квартал quarter-level + частичный месяц month-level', () => {
    expect(getFilteredEconomyTotal({
      depts, periodKey: 'year', coveredQuarters: ['q1', 'q2'],
      fullQuarters: ['q1'], partialMonths: [4], hasMonthData: true,
    })).toBe(16); // q1 целиком (10) + апрель (6)
  });

  it('месячных данных в датасете нет — честный фолбэк на квартальную ветвь (как в totals)', () => {
    const noMonths = [{ economyTotal: 25, quarters: { q2: { economyTotal: 15 } } }];
    expect(getFilteredEconomyTotal({
      depts: noMonths, periodKey: 'q2', coveredQuarters: ['q2'],
      fullQuarters: [], partialMonths: [5], hasMonthData: false,
    })).toBe(15);
  });

  it('у управления нет месячной базы при выбранном месяце — пропуск называется вслух', () => {
    const mixed = [
      ...depts,
      { dept: 'УО', economyTotal: 99, quarters: { q2: { economyTotal: 99 } } },
    ];
    const b = getEconomyTotalBreakdown({
      depts: mixed, periodKey: 'q2', coveredQuarters: ['q2'],
      fullQuarters: [], partialMonths: [5], hasMonthData: true,
    });
    expect(b.total).toBe(9);            // только май первого управления
    expect(b.missingDepts).toEqual(['УО']); // 99 за q2 не приписаны маю молча
  });
});
