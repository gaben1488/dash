import type { TrustCheckCounts } from './types.js';

/** A check result is meaningful only with a complete, consistent denominator. */
export function summarizeCheckCoverage(observations: readonly TrustCheckCounts[]):
  (TrustCheckCounts & { score: number | null }) | null {
  if (observations.length === 0 || observations.some(c =>
    ![c.expected, c.checked, c.failed].every(n => Number.isSafeInteger(n) && n >= 0)
    || c.failed > c.checked || c.checked > c.expected)) return null;
  const counts = observations.reduce((sum, c) => ({
    expected: sum.expected + c.expected, checked: sum.checked + c.checked, failed: sum.failed + c.failed,
  }), { expected: 0, checked: 0, failed: 0 });
  if (!Object.values(counts).every(Number.isSafeInteger)) return null;
  return { ...counts, score: counts.expected > 0 && counts.checked === counts.expected
    ? Math.round(100 * (counts.checked - counts.failed) / counts.checked) : null };
}
