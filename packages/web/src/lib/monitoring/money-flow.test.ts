import { expect, it } from 'vitest';
import { normalizeMonitoring } from './contract';
import { moneyFlowFrom } from './money-flow';
import { applySlices, emptySlices } from './slices';

it('covers the current plan, isolates reissued history, and keeps premature results visible', () => {
  const rows = normalizeMonitoring({ procedures: [
    { stage: 'awarded', nmck: 100, factsEligible: true },
    { stage: 'awarded', nmck: 20, factsEligible: false },
    { stage: 'published', nmck: 30, auctionPrice: 0 },
    { stage: 'no_result', nmck: 40 },
    { stage: 'reissued', nmck: 200 },
    { stage: 'unknown', nmck: 50 },
    { stage: 'application', nmck: null },
  ] }).procedures;
  const flow = moneyFlowFrom(rows);
  expect(flow.currentPlan).toBe(240);
  expect(flow.categories).toMatchObject({
    realized: { count: 1, nmck: 100 },
    work: { count: 3, nmck: 50, missing: 1 },
    unrealized: { count: 1, nmck: 40 },
    reissued: { count: 1, nmck: 200 },
    unknown: { count: 1, nmck: 50 },
  });
  expect(flow.awaitingDate).toBe(1);
  for (const [category, value] of Object.entries(flow.categories)) {
    const selected = applySlices(rows, { ...emptySlices(), moneyCategory: category as keyof typeof flow.categories });
    expect(selected).toHaveLength(value.count);
    expect(selected.reduce((sum, row) => sum + (row.nmck ?? 0), 0)).toBe(value.nmck);
  }
});
