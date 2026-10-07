import { describe, expect, it } from 'vitest';
import { normalizeMonitoring } from './contract';
import { portraitFrom } from './portrait';

describe('покрытие снижения цены', () => {
  it('сохраняет цену без НМЦК, но считает снижение только по полным парам', () => {
    const rows = normalizeMonitoring({ procedures: [
      { stage: 'awarded', nmck: null, auctionPrice: 100 },
      { stage: 'awarded', nmck: 200, auctionPrice: 150 },
    ] }).procedures;
    const p = portraitFrom(rows);
    expect(p.priceTotal).toBe(250);
    expect(p.savingsTotal).toBe(50);
    expect(p.portfolio).toMatchObject({ value: 25, base: 1 });
  });

  it('показывает неизвестное снижение, когда нет ни одной полной пары', () => {
    const p = portraitFrom(normalizeMonitoring({ procedures: [
      { stage: 'awarded', nmck: null, auctionPrice: 100 },
    ] }).procedures);
    expect(p.savingsTotal).toBeNull();
    expect(p.portfolio.value).toBeNull();
  });
});
