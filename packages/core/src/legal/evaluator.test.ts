import { describe, expect, it } from 'vitest';
import { evaluateLegalRule, type LegalEvaluationInput } from './evaluator.js';
const input: LegalEvaluationInput = {
  rule: {
    id: 'demo', version: '1', sourceId: 'law', provisionIds: ['p'],
    validFrom: '2026-01-01', status: 'verified', grain: 'contract',
    metricId: 'price', quantity: { value: '600000', unit: 'RUB', comparator: 'gt', grain: 'contract' },
    requiredFacts: ['price'], dependencies: [], exceptions: [],
  },
  release: { id: 'r1', sourceIds: ['law'], ruleIds: ['demo'], frozenAt: '2026-10-22', status: 'verified' },
  source: { id: 'law', title: 'test', sha256: 'abc', sourceUri: null, editionLabel: 'test',
    verifiedAt: '2026-10-22', status: 'verified' },
  provisions: [{ id: 'p', sourceId: 'law', editionId: 'e', article: '93', page: 1,
    textHash: 'abc', status: 'verified' }],
  snapshotId: 's1', entityId: 'contract-1', eventDay: '2026-10-22', grain: 'contract',
  facts: [{ name: 'price', value: 600001, evidenceId: 'source-row' }],
  applicability: 'confirmed', resolvedDependencies: [], resolvedExceptions: [],
};
describe('legal decision boundary', () => {
  it('requires a complete reviewed release', () => {
    expect(evaluateLegalRule(input).outcome).toBe('breached');
    expect(evaluateLegalRule({ ...input, source: { ...input.source, status: 'candidate' } }).outcome).toBe('insufficient_data');
  });
  it('does not confuse plan positions with contracts', () => {
    expect(evaluateLegalRule({ ...input, grain: 'plan_position' }).outcome).toBe('insufficient_data');
  });
  it('fails closed on missing evidence and dependencies', () => {
    expect(evaluateLegalRule({ ...input, facts: [{ name: 'price', value: 600001, evidenceId: null }] }).outcome).toBe('insufficient_data');
    expect(evaluateLegalRule({ ...input, rule: { ...input.rule, dependencies: ['government-decree'] } }).outcome).toBe('insufficient_data');
  });
  it('uses the event edition and handles boundaries', () => {
    expect(evaluateLegalRule({ ...input, eventDay: '2025-12-31' }).outcome).toBe('insufficient_data');
    expect(evaluateLegalRule({ ...input, facts: [{ name: 'price', value: 600000, evidenceId: 'e' }] }).outcome).toBe('satisfied');
  });
  it('does not turn exclusions into compliance', () => {
    expect(evaluateLegalRule({ ...input, applicability: 'excluded' }).outcome).toBe('not_applicable');
  });
});
