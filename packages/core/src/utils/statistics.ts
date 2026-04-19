/**
 * Shared statistical utilities for anomaly detection.
 *
 * Used by:
 * - pipeline/dataset-signals.ts (intra-dataset: threshold=3.0, MAD Benford)
 * - analytics/anomaly.ts (inter-department: threshold=2.0, chi-square Benford)
 *
 * Extracted to eliminate code duplication while keeping separate
 * statistical approaches for their different use cases.
 */

/** Mean and standard deviation result */
export interface MeanStdDev {
  mean: number;
  stdDev: number;
  count: number;
}

/**
 * Calculates mean and population standard deviation.
 * Returns count=0, mean=0, stdDev=0 for empty arrays.
 */
export function calculateMeanAndStdDev(values: number[]): MeanStdDev {
  if (values.length === 0) return { mean: 0, stdDev: 0, count: 0 };

  const sum = values.reduce((a, b) => a + b, 0);
  const mean = sum / values.length;

  const sqDiffSum = values.reduce((a, v) => a + (v - mean) ** 2, 0);
  const stdDev = Math.sqrt(sqDiffSum / values.length);

  return { mean, stdDev, count: values.length };
}

/**
 * Calculate Z-score for a single value against known mean/stdDev.
 * Returns 0 if stdDev is 0 (all values identical).
 */
export function calculateZScore(value: number, mean: number, stdDev: number): number {
  if (stdDev === 0) return 0;
  return (value - mean) / stdDev;
}

/**
 * Extract first significant digit from a number.
 * Handles leading zeros in decimals: 0.00123 → 1.
 * Returns NaN for 0 or non-numeric.
 */
export function firstSignificantDigit(value: number): number {
  const abs = Math.abs(value);
  if (abs < Number.EPSILON) return NaN;
  const cleaned = String(abs).replace(/^0*\.?0*/, '');
  const digit = parseInt(cleaned.charAt(0), 10);
  return digit >= 1 && digit <= 9 ? digit : NaN;
}

/** Benford's Law expected first-digit frequencies (digits 1-9) */
export const BENFORD_EXPECTED = Object.freeze(
  Array.from({ length: 9 }, (_, i) => Math.log10(1 + 1 / (i + 1))),
);
