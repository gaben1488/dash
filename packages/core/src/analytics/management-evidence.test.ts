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
  it('unavailable legal input never becomes either a penalty or a false all-clear', () => {
    const ep = rows(0).map(row => ({ ...row, method: 'ЕП', planTotal: 700 }));
    const unknown = detectAntiCorruption('D', { rows: ep });
    expect(unknown.flags.some(flag => flag.indicator === 'ep_over_limit')).toBe(false);
    expect(unknown.unavailableIndicators).toContainEqual(expect.objectContaining({ indicator: 'ep_over_limit' }));
    expect(unknown.disciplinaryPenalty).toBe(0);

    const captured = { value: 600, unit: 'thousandRub', status: 'verified',
      edition: 'synthetic-test-only', sourceRef: 'synthetic verified-unit fixture' } as const;
    const screened = detectAntiCorruption('D', { rows: ep, epSingleThreshold: captured });
    expect(screened.flags.some(flag => flag.indicator === 'ep_over_limit')).toBe(true);
    expect(screened.flags.find(flag => flag.indicator === 'ep_over_limit')?.severity).toBe('low');
    expect(screened.disciplinaryPenalty).toBe(0);
  });
});
