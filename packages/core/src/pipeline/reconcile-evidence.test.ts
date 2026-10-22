import { describe, expect, it } from 'vitest';
import { reconcile } from './reconcile.js';

const values = (planTotal: number) => ({ planTotal, factTotal: 0, economyTotal: 0 });
describe('reconciliation evidence', () => {
  it.each([50, 150])('does not assign blame from a difference: %s', plan => {
    const row = reconcile(new Map([['D', values(100)]]), new Map([['D', values(plan)]])).rows[0];
    expect(row.assessment.sourceLabel).toBe('Причина не установлена');
    expect(row.assessment.reason).not.toMatch(/ошибка маппинга|недоступный источник/);
  });
  it('preserves a difference against observed zero without inventing broken formulas', () => {
    const row = reconcile(new Map([['D', values(0)]]), new Map([['D', values(100)]])).rows[0];
    expect(row.assessment.maxAbsDelta).toBe(100);
    expect(row.assessment.sourceLabel).toBe('Причина не установлена');
  });
  it('does not report agreement when neither layer has observations', () => {
    expect(reconcile(new Map(), new Map()).overallStatus).toBe('Нет данных для сравнения');
  });
});

it('keeps a missing layer unknown instead of manufacturing zero and a difference', () => {
  const row = reconcile(new Map(), new Map([['D', values(100)]])).rows[0];
  expect(row.fullPlanOfficial).toBeNull();
  expect(row.planDelta).toBeNull();
  expect(row.assessment.status).toBe('Несопоставимо');
});
it('keeps a percentage with zero denominator unavailable', () => {
  const row = reconcile(new Map([['D', values(0)]]), new Map([['D', values(100)]])).rows[0];
  expect(row.planDeltaPct).toBeNull();
});
