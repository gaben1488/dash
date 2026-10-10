import type { DeltaResult } from '@aemr/shared';

/**
 * Evidence coverage is independent of the legacy A-F score.
 * An absent comparison must never be reported as 100% agreement.
 * Only compare like-with-like DeltaResult pairs produced by the pipeline.
 */
export interface ReconciliationAssurance {
  state: 'not_checked' | 'incomplete' | 'divergent' | 'consistent';
  comparable: number;
  unavailable: number;
  mismatched: number;
  matched: number;
  total: number;
  coveragePct: number | null;
}

export function assessReconciliation(deltas: readonly DeltaResult[]): ReconciliationAssurance {
  let comparable = 0;
  let unavailable = 0;
  let mismatched = 0;
  let matched = 0;

  for (const d of deltas) {
    if (d.officialValue === null || d.calculatedValue === null ||
      !Number.isFinite(d.officialValue) || !Number.isFinite(d.calculatedValue)) {
      unavailable += 1;
      continue;
    }
    comparable += 1;
    if (d.withinTolerance === true) matched += 1;
    else mismatched += 1;
  }

  const total = comparable + unavailable;
  const state: ReconciliationAssurance['state'] =
    comparable === 0 ? 'not_checked' :
      mismatched > 0 ? 'divergent' :
        unavailable > 0 ? 'incomplete' : 'consistent';

  return {
    state, comparable, unavailable, mismatched, matched, total,
    coveragePct: total > 0 ? Math.round(comparable / total * 1000) / 10 : null,
  };
}
