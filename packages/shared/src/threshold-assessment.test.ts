import { describe, expect, it } from 'vitest';
import { assessThreshold, thresholdAt, type ThresholdAssessmentInput } from './threshold-registry.js';

const quote = thresholdAt('law.quotationPurchaseLimit', '2026-10-01');
const ep = thresholdAt('law.epSmallSingleContract', '2026-10-22');
const role = thresholdAt('competition.epRoleInvestmentShare', '2026-10-22');

function evaluate(overrides: Partial<ThresholdAssessmentInput> = {}) {
  return assessThreshold({
    id: 'law.quotationPurchaseLimit',
    captured: quote,
    value: 21_000,
    unit: 'thousandRub',
    basis: 'procurement_nmck',
    purpose: 'legal',
    asOfDay: '2026-10-01',
    eventDay: '2026-10-01',
    applicability: 'confirmed',
    ...overrides,
  });
}

describe('C06.02 — one frozen threshold decision contract for every consumer', () => {
  it('legal result requires the correct verified edition, source date, unit, subject and applicability', () => {
    expect(evaluate()).toMatchObject({
      status: 'legal', exceeded: true,
      evidence: { id: 'law.quotationPurchaseLimit', asOfDay: '2026-10-01',
        value: 20_000, status: 'verified', unit: 'thousandRub' },
    });
    expect(evaluate({ value: 20_000 })).toMatchObject({ status: 'legal', exceeded: false });
    expect(evaluate({ value: 19_999 })).toMatchObject({ status: 'legal', exceeded: false });
  });

  it('pre-change and temporary quotation editions do not overwrite one another', () => {
    const old = thresholdAt('law.quotationPurchaseLimit', '2026-09-30');
    expect(evaluate({ captured: old, asOfDay: '2026-09-30', eventDay: '2026-09-30', value: 11_000 }))
      .toMatchObject({ status: 'legal', exceeded: true, evidence: { value: 10_000 } });
    expect(quote).toMatchObject({ value: 20_000 });
    expect(evaluate({ captured: old })).toMatchObject({
      status: 'unavailable', exceeded: null, reason: 'threshold_date_mismatch',
    });
  });

  it('an unverified law reference or future gap can NEVER become a legal pass', () => {
    expect(assessThreshold({
      id: 'law.epSmallSingleContract', captured: ep, value: 400,
      unit: 'thousandRub', basis: 'contract_price', purpose: 'legal',
      asOfDay: '2026-10-22', applicability: 'confirmed',
    })).toMatchObject({ status: 'unavailable', exceeded: null, reason: 'legal_edition_not_verified' });
    const future = thresholdAt('law.quotationPurchaseLimit', '2028-01-01');
    expect(evaluate({ captured: future, asOfDay: '2028-01-01' }))
      .toMatchObject({ status: 'unavailable', exceeded: null, reason: 'no_applicable_edition' });
  });

  it('reference screening of PLAN POSITIONS is distinct from a contract-level legal check', () => {
    expect(assessThreshold({
      id: 'law.epSmallSingleContract', captured: ep, value: 650,
      unit: 'thousandRub', basis: 'plan_position_total', purpose: 'screening',
    })).toMatchObject({
      status: 'reference', exceeded: true,
      reason: 'reference_only_not_a_legal_verdict',
      evidence: { status: 'unverified', id: 'law.epSmallSingleContract' },
    });
    expect(assessThreshold({
      id: 'law.epSmallSingleContract', captured: ep, value: 650,
      unit: 'thousandRub', basis: 'plan_position_total', purpose: 'legal',
      asOfDay: '2026-10-22', applicability: 'confirmed',
    })).toMatchObject({ status: 'unavailable', exceeded: null });
  });

  it('an internal role threshold is count based, not a money/share-of-SGOZ rule', () => {
    const common = {
      id: 'competition.epRoleInvestmentShare', captured: role, value: 0.4,
      unit: 'ratio' as const, purpose: 'screening' as const,
    };
    expect(assessThreshold({ ...common, basis: 'department_ep_count_share' }))
      .toMatchObject({ status: 'reference', exceeded: true, reason: 'internal_screening_only' });
    expect(assessThreshold({ ...common, basis: 'department_ep_amount_share' }))
      .toMatchObject({ status: 'unavailable', exceeded: null,
        reason: 'screening_measurement_basis_mismatch' });
    expect(assessThreshold({ ...common, purpose: 'legal', basis: 'department_ep_count_share' }))
      .toMatchObject({ status: 'unavailable', exceeded: null });
  });

  it.each([
    [{ captured: null }, 'missing_frozen_threshold'],
    [{ captured: { ...quote, id: 'law.epSmallSingleContract' } }, 'threshold_identity_mismatch'],
    [{ captured: { ...quote, asOfDay: '2026-09-30' } }, 'threshold_date_mismatch'],
    [{ captured: { ...quote, unit: undefined } }, 'threshold_unit_or_value_unavailable'],
    [{ unit: 'ratio' }, 'threshold_unit_or_value_unavailable'],
    [{ value: Number.NaN }, 'observation_unavailable'],
    [{ value: -1 }, 'observation_unavailable'],
    [{ value: null }, 'observation_unavailable'],
    [{ basis: 'plan_position_total' }, 'legal_measurement_basis_mismatch'],
    [{ eventDay: undefined }, 'legal_event_date_unavailable'],
    [{ eventDay: '2026-09-30' }, 'legal_edition_event_mismatch'],
    [{ applicability: 'unknown' }, 'legal_applicability_unconfirmed'],
    [{ applicability: 'excluded' }, 'not_applicable'],
    [{ asOfDay: undefined }, 'legal_edition_not_verified'],
  ] as Array<[Partial<ThresholdAssessmentInput>, string]>)(
    'fails closed instead of fabricating a successful check (%#)', (overrides, reason) => {
      expect(evaluate(overrides)).toMatchObject({ status: 'unavailable', exceeded: null, reason });
    },
  );

  it('old snapshots without rule identity/day may screen only — never legal', () => {
    const { id: _removedId, asOfDay: _removedDay, ...historic } = quote;
    expect(evaluate({ captured: historic })).toMatchObject({
      status: 'unavailable', reason: 'threshold_date_mismatch',
    });
    expect(assessThreshold({
      id: 'law.quotationPurchaseLimit', captured: historic, value: 21_000,
      unit: 'thousandRub', basis: 'procurement_nmck', purpose: 'screening',
    })).toMatchObject({ status: 'reference', exceeded: true });
  });
});
