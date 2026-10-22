import type { DataSnapshot } from '@aemr/shared';
import { explainSnapshotMetric } from '@aemr/core';
import { currentCalculationContextMatches } from './snapshot-calculation-context.js';

/**
 * Infrastructure guard: only reuse a saved snapshot when its context is
 * compatible with the installed executable catalog, profiles and thresholds.
 * Parsing, gates, formulas, source slices and dependencies belong to core.
 */
export function metricExplanation(snapshot: DataSnapshot, key: string) {
  const context = snapshot.metadata.calculationContext;
  if (context && !currentCalculationContextMatches(snapshot)) {
    return { status: 'unavailable', reason: 'CALCULATION_CONTEXT_CHANGED' } as const;
  }
  if (context && context.scope.targetYear !== (snapshot.metadata.targetYear ?? null)) {
    return { status: 'unavailable', reason: 'CALCULATION_SCOPE_CHANGED' } as const;
  }
  return explainSnapshotMetric(snapshot, key);
}
