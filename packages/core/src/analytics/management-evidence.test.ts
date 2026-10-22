import { describe, expect, it } from 'vitest';
import { detectAntiCorruption, type AntiCorruptionRow } from './anticorruption.js';

const rows = (economy: number): AntiCorruptionRow[] => Array.from({ length: 6 }, (_, i) => ({
  rowIndex: i + 4, method: 'ЭА', planTotal: 100, factTotal: 60, economy, subject: 'Поставка',
}));
describe('management signals require relevant evidence', () => {
  it.each([0, 40])('official economy %s does not establish competition or initial price', economy => {
    const result = detectAntiCorruption('D', { rows: rows(economy) });
    expect(result.flags.filter(flag => ['zero_competition', 'price_inflation'].includes(flag.indicator))).toEqual([]);
  });
  it('unconfirmed screening flags do not penalize discipline', () => {
    const result = detectAntiCorruption('D', { rows: rows(0).map(row => ({ ...row, method: 'ЕП', planTotal: 700 })) });
    expect(result.flags).toEqual([]); // no frozen threshold or contract-level evidence
    expect(result.unavailableIndicators.some(item => item.indicator === 'ep_over_limit')).toBe(true);
    expect(result.disciplinaryPenalty).toBe(0);
  });
});
