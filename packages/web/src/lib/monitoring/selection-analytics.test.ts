import { describe, expect, it } from 'vitest';
import { normalizeMonitoring } from './contract';
import { selectedAnalytics } from './selection-analytics';

describe('selected snapshot analytics', () => {
  it('counts only selected procedures and keeps their snapshot time', () => {
    const rows = normalizeMonitoring({ procedures: [
      { code: 'ЭА01-26', stage: 'awarded', nmck: 100, auctionPrice: 80, reductionRub: 20, reductionPct: 20, savingsTotal: 20, winnerName: 'А', winnerInn: '1234567890', publicationDate: '2026-09-01' },
      { code: 'ЭА02-26', stage: 'published', nmck: 200, publicationDate: '2026-10-01' },
    ] }).procedures;
    const result = selectedAnalytics(rows.slice(0, 1), '2026-10-08T00:00:00Z', 'publication');
    expect(result.source.readAt).toBe('2026-10-08T00:00:00Z');
    expect(result.analytics.funnel?.total).toBe(1);
    expect(result.analytics.suppliers?.suppliers).toHaveLength(1);
    expect(result.analytics.seasonality?.months).toHaveLength(1);
  });
  it('does not admit future or unreadable results just because the selection is local', () => {
    const rows = normalizeMonitoring({ procedures: [{ code: 'ЭА01-26', stage: 'awarded', factsEligible: false, nmck: 100, auctionPrice: 80, auctionDate: 'нечитаемая дата' }] }).procedures;
    const result = selectedAnalytics(rows, '2026-10-08T00:00:00Z', 'auction');
    expect(result.analytics.reduction?.portfolio.count).toBe(0);
  });
});
