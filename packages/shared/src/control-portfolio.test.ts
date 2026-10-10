import { describe, expect, it } from 'vitest';
import { buildControlPortfolio, CONTROL_CHANNELS } from './control-portfolio.js';

describe('unified control origin registry', () => {
  it('names the eight existing control origins only once, without minting a new root source', () => {
    expect(new Set(CONTROL_CHANNELS.map(c => c.id)).size).toBe(8);
    expect(CONTROL_CHANNELS.map(c => c.id)).toEqual([
      'plan_checks','reconciliation','formula_integrity','book_integrity',
      'text_hygiene','procedure_monitoring','workload_events','uer_recommendations',
    ]);
  });

  it('does not report sources not yet checked as clean zero-findings sources', () => {
    const view = buildControlPortfolio('2026-10-11T00:00:00Z', {});
    expect(view.channels).toHaveLength(8);
    expect(view.channels.every(c => c.coverage === 'not_checked' && c.observations === null)).toBe(true);
    expect(view.atomicAcrossSources).toBe(false);
    expect(view.uniqueCrossSourceCasesVerified).toBe(false);
  });

  it('keeps coverage, raw findings and unique cases separate', () => {
    const result = buildControlPortfolio('2026-10-11T00:00:00Z', {
      plan_checks: { coverage:'checked', observations: 30, cases: 14, checkedUnits: 100,
        expectedUnits: 100, sourceAsOf: '2026-10-10T11:00:00Z', note: 'Снимок' },
      text_hygiene: { coverage:'partial', observations: 7, cases: null,
        checkedUnits: 20, expectedUnits: null, sourceAsOf: null, note: 'Не все книги' },
    });
    expect(result.channels[0]).toMatchObject({ observations: 30, cases: 14, coverage:'checked' });
    expect(result.channels[4]).toMatchObject({ observations: 7, cases: null, coverage:'partial' });
    expect(result.channels[5].observations).toBeNull();
  });

  it('does not make official decisions synonymous with automated recommendations or action counters', () => {
    const ledger = CONTROL_CHANNELS.find(c => c.id === 'uer_recommendations');
    const work = CONTROL_CHANNELS.find(c => c.id === 'workload_events');
    expect(ledger?.kind).toBe('official_decision');
    expect(work?.kind).toBe('activity');
  });
});
