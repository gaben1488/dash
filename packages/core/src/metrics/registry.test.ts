import { describe, expect, it } from 'vitest';
import { METRIC_KB } from './registry.js';

describe('METRIC_KB metric contract', () => {
  it('documents legacy savings_pct as fact-to-plan spending percent, not approved economy', () => {
    const entry = METRIC_KB.savings_pct;

    expect(entry).toBeDefined();
    expect(entry.label.toLowerCase()).not.toContain('эконом');
    expect(entry.label.toLowerCase()).not.toContain('отклонен');
    expect(entry.formula).toContain('fact_total / plan_total');
    expect(entry.note ?? '').toContain('legacy key');
    // Владелец переименовал столбец Q листа СВОД 18.08.2026: «Потрачено, %» →
    // «Законтрактовано, %». Расчёт не менялся, поэтому в допустимые слова
    // добавлено новое имя, а запрет называть показатель экономией остался.
    expect(`${entry.whatIs ?? ''} ${entry.howCalc ?? ''}`.toLowerCase())
      .toMatch(/потрачен|законтрактован|факт к плану|освоен/);
  });

  it('does not label limit−fact deviation as AD-gated economy (high_economy_count / signal_high_economy)', () => {
    // Ground truth signals.ts: economyPct = (plan_total − fact_total)/plan_total on competitive
    // methods only — NOT (limit − price), NOT AD-gated economy_total. The dictionary must match.
    const hec = METRIC_KB.high_economy_count;
    const sig = METRIC_KB.signal_high_economy;
    expect(hec).toBeDefined();
    expect(sig).toBeDefined();

    expect(hec.formula?.toLowerCase()).not.toMatch(/price|цена/);
    expect(hec.formula?.toLowerCase()).toMatch(/plan_total|факт/);
    expect(sig.formula?.toLowerCase()).not.toMatch(/price|цена/);
    expect(sig.formula?.toLowerCase()).toMatch(/plan_total|факт/);

    // Must carry the honest base caveat: this is limit−fact deviation, not ст.37 НМЦК economy.
    const hecText = `${hec.whatIs ?? ''} ${hec.howCalc ?? ''} ${hec.pitfalls ?? ''}`.toLowerCase();
    expect(hecText).toMatch(/нмцк|лимит.?[−-].?факт|не.*economy_total|прокси|разные баз/);
  });

  it('avg_reduction_pct is framed as deviation from limit, not AD-gated economy', () => {
    const ar = METRIC_KB.avg_reduction_pct;
    expect(ar).toBeDefined();
    const text = `${ar.whatIs ?? ''} ${ar.howCalc ?? ''}`.toLowerCase();
    expect(text).toMatch(/снижени|отклонени/);
    expect(text).toMatch(/не\s+ad|не.*economy_total|лимит.?[−-].?факт|не\s+ad-gated/);
  });
});
