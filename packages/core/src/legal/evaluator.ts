import type { LegalAssessment, LegalFact, LegalRelease, LegalRule, LegalSource, LegalProvision } from '@aemr/shared';

export interface LegalEvaluationInput {
  rule: LegalRule;
  release: LegalRelease;
  source: LegalSource;
  provisions: readonly LegalProvision[];
  snapshotId: string;
  entityId: string;
  eventDay: string;
  grain: LegalRule['grain'];
  facts: readonly LegalFact[];
  /** Must be confirmed by independent legal review of all rule conditions. */
  applicability: 'confirmed' | 'excluded' | 'unknown';
  /** Explicit review results for external acts and exceptions. */
  resolvedDependencies: readonly string[];
  resolvedExceptions: readonly string[];
}
export function evaluateLegalRule(input: LegalEvaluationInput): LegalAssessment {
  const { rule, release, source } = input;
  const reasons: string[] = [];
  const facts = new Map(input.facts.map(f => [f.name, f]));
  const observedFact = facts.get(rule.metricId);
  const evidenceIds = [...new Set(input.facts.filter(f => f.evidenceId).map(f => f.evidenceId!))].sort();
  const limit = Number(rule.quantity.value);
  const observed = typeof observedFact?.value === 'number' && Number.isFinite(observedFact.value)
    ? observedFact.value : null;
  const output = (outcome: LegalAssessment['outcome']): LegalAssessment => ({
    ruleId: rule.id, ruleVersion: rule.version, releaseId: release.id,
    snapshotId: input.snapshotId, entityId: input.entityId,
    outcome, observed, limit: Number.isFinite(limit) ? limit : null,
    reasons, evidenceIds, provisionIds: [...rule.provisionIds],
  });
  if (input.applicability === 'excluded') return output('not_applicable');
  if (input.applicability !== 'confirmed') reasons.push('applicability_unknown');
  if (rule.status !== 'verified' || source.status !== 'verified' || release.status !== 'verified')
    reasons.push('unverified_legal_release');
  if (!release.ruleIds.includes(rule.id) || !release.sourceIds.includes(source.id)
    || source.id !== rule.sourceId) reasons.push('release_identity_mismatch');
  if (input.eventDay < rule.validFrom || (rule.validTo && input.eventDay >= rule.validTo))
    reasons.push('outside_effective_interval');
  if (rule.grain !== input.grain || rule.quantity.grain !== input.grain)
    reasons.push('measurement_grain_mismatch');
  if (rule.provisionIds.some(id => !input.provisions.some(p => p.id === id
    && p.sourceId === source.id && p.status === 'verified')))
    reasons.push('unverified_provision');
  for (const d of rule.dependencies) if (!input.resolvedDependencies.includes(d))
    reasons.push('unresolved_dependency:' + d);
  for (const e of rule.exceptions) if (!input.resolvedExceptions.includes(e))
    reasons.push('unresolved_exception:' + e);
  for (const f of rule.requiredFacts) {
    const fact = facts.get(f);
    if (!fact || fact.value === null || !fact.evidenceId)
      reasons.push('missing_fact_or_provenance:' + f);
  }
  if (!observedFact?.evidenceId || observed === null || observed < 0)
    reasons.push('missing_numeric_observation');
  if (!Number.isFinite(limit) || limit < 0) reasons.push('invalid_limit');
  if (rule.quantity.unit === 'ratio' && (observed !== null && observed > 1 || limit > 1))
    reasons.push('invalid_ratio');
  if (reasons.length) return output('insufficient_data');
  const violated = ({
    gt: observed! > limit,
    gte: observed! >= limit,
    lt: observed! < limit,
    lte: observed! <= limit,
    eq: observed! === limit,
  })[rule.quantity.comparator];
  return output(violated ? 'breached' : 'satisfied');
}
