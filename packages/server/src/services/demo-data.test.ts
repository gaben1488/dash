import { describe, expect, it } from 'vitest';
import { createDemoSnapshot } from './demo-data.js';

/**
 * B-7: demoFinalize (aggregate СВОД cells, e.g. competitive.year) computed
 * amountDeviation as planTotal - factTotal, while demoGenRow (per-dept
 * cells, e.g. grbs.uer.kp.year) and the core invariant (amount_deviation =
 * fact_total - plan_total, packages/core/src/pipeline/calc-engine.ts:355,
 * pinned by exec-count-pct.test.ts) both use factTotal - planTotal.
 *
 * Every DEMO_DEPTS entry has kpExec < 1 (under-execution for the
 * competitive/'kp' method), so every per-dept amount_dev cell that is
 * summed into the 'competitive.year' aggregate is negative (недоосвоение).
 * The aggregate, built by accumulating those same rows, must therefore
 * also be negative. The bug flips its sign to positive.
 */
describe('createDemoSnapshot amount_dev sign consistency (B-7)', () => {
  it('aggregate competitive.year.amount_dev has the same (negative) sign as the per-dept grbs.*.kp.year.amount_dev cells it sums', () => {
    const snapshot = createDemoSnapshot();
    const m = snapshot.officialMetrics;

    const deptValue = m['grbs.uer.kp.year.amount_dev']?.numericValue;
    const aggValue = m['competitive.year.amount_dev']?.numericValue;

    expect(deptValue).toBeDefined();
    expect(aggValue).toBeDefined();

    // Synthetic УЭР 'kp' (kpExec: 0.70 < 1) is under-execution: fact < plan,
    // so per-dept amount_dev must be negative under the fact-plan convention.
    expect(deptValue!).toBeLessThan(0);

    // competitive.year sums all 8 depts' kp rows, every one under-execution
    // (all DEMO_DEPTS.kpExec < 1) -> the aggregate must also be negative.
    // FAILS on current HEAD: demoFinalize computes planTotal - factTotal,
    // which is positive here, opposite the per-dept cells composing it.
    expect(aggValue!).toBeLessThan(0);
  });
});
