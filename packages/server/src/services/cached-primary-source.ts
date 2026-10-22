/**
 * One admission rule for primary book caches used by raw and aggregate readers.
 * A valid global refresh time cannot certify an individual GRBS book.
 * Archives are deliberately not routed through this LIVE predicate: they keep
 * the original frozen source coverage and observation timestamp.
 */
import { DEPT_HEADER_ROWS } from '@aemr/shared';

export interface PrimaryReadEvidence {
  loadedAt?: string | null;
  error?: string | null;
  rowCount?: number | null;
}

/** Three header rows are a confirmed empty master, not an absent source. */
export function hasVerifiedPrimaryRows(
  values: unknown[][] | undefined,
  evidence: PrimaryReadEvidence | undefined,
): values is unknown[][] {
  if (!Array.isArray(values) || values.length < DEPT_HEADER_ROWS || !evidence || evidence.error) return false;
  const loadedAt = Date.parse(evidence.loadedAt ?? '');
  if (!Number.isFinite(loadedAt) || loadedAt <= 0) return false;
  // Read metadata and cache payload must describe one book read. Historical
  // fixtures without rowCount retain their previously accepted contract.
  return evidence.rowCount == null
    || (Number.isSafeInteger(evidence.rowCount) && evidence.rowCount === values.length);
}
