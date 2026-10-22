/**
 * Legal KB v1: evidence and edition contracts. No law is certified by code generation.
 * Text candidates are never executable until reviewed and released.
 */
export type LegalVerification = 'candidate' | 'reviewed' | 'verified' | 'rejected';
export type LegalGrain = 'contract' | 'procedure' | 'plan_position' | 'customer_year';
export type LegalUnit = 'RUB' | 'thousandRUB' | 'ratio' | 'count' | 'days';
export type LegalComparator = 'gt' | 'gte' | 'lt' | 'lte' | 'eq';
export type LegalOutcome = 'satisfied' | 'breached' | 'not_applicable' | 'insufficient_data' | 'requires_review';
export interface LegalSource {
  id: string;
  title: string;
  sha256: string;
  sourceUri: string | null;
  editionLabel: string;
  verifiedAt: string | null;
  status: LegalVerification;
}
export interface LegalProvision {
  id: string;
  sourceId: string;
  editionId: string;
  article: string;
  part?: string;
  point?: string;
  page: number;
  textHash: string;
  status: LegalVerification;
}
export interface LegalQuantity {
  value: string;
  unit: LegalUnit;
  comparator: LegalComparator;
  grain: LegalGrain;
  numerator?: string;
  denominator?: string;
  period?: string;
}
export interface LegalRule {
  id: string;
  version: string;
  sourceId: string;
  provisionIds: readonly string[];
  validFrom: string;
  validTo?: string;
  status: LegalVerification;
  grain: LegalGrain;
  metricId: string;
  quantity: LegalQuantity;
  requiredFacts: readonly string[];
  dependencies: readonly string[];
  exceptions: readonly string[];
}
export interface LegalRelease {
  id: string;
  sourceIds: readonly string[];
  ruleIds: readonly string[];
  frozenAt: string;
  status: LegalVerification;
}
export interface LegalFact {
  name: string;
  value: number | string | boolean | null;
  evidenceId: string | null;
}
export interface LegalAssessment {
  ruleId: string;
  ruleVersion: string;
  releaseId: string;
  snapshotId: string;
  entityId: string;
  outcome: LegalOutcome;
  observed: number | null;
  limit: number | null;
  reasons: readonly string[];
  evidenceIds: readonly string[];
  provisionIds: readonly string[];
}
