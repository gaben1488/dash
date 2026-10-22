import { describe, expect, it } from 'vitest';
import { freezeThresholds } from '@aemr/shared';
import { detectAntiCorruption, type AntiCorruptionRow } from './anticorruption.js';

const rows = (economy: number): AntiCorruptionRow[] => Array.from({ length: 6 }, (_, i) => ({
  rowIndex: i + 4, method: 'ЭА', planTotal: 100, factTotal: 60, economy, subject: 'Поставка',
}));
describe('management signals require relevant evidence', () => {
  it.each([0, 40])('official economy %s does not establish competition or initial price', economy => {
    const result = detectAntiCorruption('D', { rows: rows(economy) });
    expect(result.flags.filter(flag => ['zero_competition', 'price_inflation'].includes(flag.indicator))).toEqual([]);
  });
  it('unconfirmed screening findings do not penalize discipline', () => {
    const masterRows = rows(0).map(row => ({ ...row, method: 'ЕП', planTotal: 700 }));
    const context = freezeThresholds('2026-09-30')['law.epSmallSingleContract'];
    const result = detectAntiCorruption('D', { rows: masterRows, epSingleThreshold: context });
    expect(result.flags.length).toBeGreaterThan(0);
    expect(result.flags.every(flag => flag.message.includes('не доказан'))).toBe(true);
    expect(result.disciplinaryPenalty).toBe(0);
    const withoutEvidence = detectAntiCorruption('D', { rows: masterRows });
    expect(withoutEvidence.flags).toEqual([]);
    expect(withoutEvidence.unavailableIndicators.some(item => item.indicator === 'ep_over_limit')).toBe(true);
  });
});
