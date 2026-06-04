import { describe, expect, it } from 'vitest';
import { selectedEconomy, getFilteredEconomyTotal } from './economy-metrics';

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
