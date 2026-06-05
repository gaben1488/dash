import { describe, expect, it } from 'vitest';
import { deriveCell, type UnifiedCell } from './unified-svod.js';

describe('deriveCell', () => {
  it('keeps amountDeviation as plan minus fact, while spentPct is fact over plan', () => {
    const cell: UnifiedCell = {
      planCount: 10,
      factCount: 6,
      planFB: 700,
      planKB: 300,
      planMB: 0,
      factFB: 500,
      factKB: 100,
      factMB: 0,
      economyFB: 30,
      economyKB: 20,
      economyMB: 10,
    };

    expect(deriveCell(cell)).toMatchObject({
      planTotal: 1_000,
      factTotal: 600,
      amountDeviation: 400,
      spentPct: 0.6,
      economyTotal: 60,
    });
  });
});
