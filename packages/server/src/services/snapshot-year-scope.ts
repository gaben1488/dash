/** A saved fallback must prove that its computed metrics cover the requested year.
 * Legacy snapshots without targetYear metadata cannot be silently reused.
 * null means all-years; a number means that exact planning year.
 */
export function sameSnapshotYearScope(
  candidate: { readonly metadata?: { readonly targetYear?: number | null } },
  requestedYear?: number,
): boolean {
  return candidate.metadata?.targetYear === (requestedYear ?? null);
}
