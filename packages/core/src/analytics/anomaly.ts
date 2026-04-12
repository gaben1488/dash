/**
 * Anomaly Detection Module
 * Detects anomalies in procurement data using statistical methods.
 * Based on procurement_report.gs anomaly detection (Benford's Law, EWMA, Z-scores).
 */

export interface BenfordResult {
  /** Chi-square statistic */
  chiSquare: number;
  /** p-value (< 0.05 = significant deviation) */
  pValue: number;
  /** Distribution of first digits [1-9] as fractions */
  observed: number[];
  /** Expected Benford distribution */
  expected: number[];
  /** Whether the distribution passes Benford's Law test */
  passes: boolean;
  /** Number of values analyzed */
  sampleSize: number;
}

export interface EWMAResult {
  /** Smoothed values */
  smoothed: number[];
  /** Upper control limit */
  ucl: number[];
  /** Lower control limit */
  lcl: number[];
  /** Indices of outlier points */
  outliers: number[];
}

export interface ZScoreResult {
  deptId: string;
  value: number;
  zScore: number;
  isOutlier: boolean;
}

/**
 * Benford's Law analysis on contract amounts.
 * Expects a natural distribution of first digits in financial data.
 */
export function benfordAnalysis(amounts: number[]): BenfordResult {
  // Benford's expected distribution for first digit 1-9
  const expected = [
    0.301, 0.176, 0.125, 0.097, 0.079, 0.067, 0.058, 0.051, 0.046,
  ];

  // Count first digits
  const digitCounts = new Array(9).fill(0);
  let validCount = 0;

  for (const amount of amounts) {
    const abs = Math.abs(amount);
    if (abs < 1) continue;
    const firstDigit = parseInt(String(abs).charAt(0), 10);
    if (firstDigit >= 1 && firstDigit <= 9) {
      digitCounts[firstDigit - 1]++;
      validCount++;
    }
  }

  if (validCount < 30) {
    return {
      chiSquare: 0,
      pValue: 1,
      observed: digitCounts.map(c => validCount > 0 ? c / validCount : 0),
      expected,
      passes: true,
      sampleSize: validCount,
    };
  }

  const observed = digitCounts.map(c => c / validCount);

  // Chi-square test
  let chiSquare = 0;
  for (let i = 0; i < 9; i++) {
    const exp = expected[i] * validCount;
    chiSquare += Math.pow(digitCounts[i] - exp, 2) / exp;
  }

  // Approximate p-value for chi-square with 8 df
  // Using simplified approximation
  const df = 8;
  const pValue = chiSquarePValue(chiSquare, df);

  return {
    chiSquare: +chiSquare.toFixed(4),
    pValue: +pValue.toFixed(4),
    observed,
    expected,
    passes: pValue > 0.05,
    sampleSize: validCount,
  };
}

/**
 * Exponentially Weighted Moving Average (EWMA) for time series anomaly detection.
 * Identifies points outside control limits.
 */
export function ewmaDetection(
  series: number[],
  lambda: number = 0.3,
  sigmaMultiplier: number = 2.5,
): EWMAResult {
  if (series.length < 3) {
    return { smoothed: [...series], ucl: [], lcl: [], outliers: [] };
  }

  const mean = series.reduce((s, v) => s + v, 0) / series.length;
  const variance = series.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / series.length;
  const sigma = Math.sqrt(variance);

  const smoothed: number[] = [series[0]];
  const ucl: number[] = [];
  const lcl: number[] = [];
  const outliers: number[] = [];

  for (let i = 1; i < series.length; i++) {
    const prev = smoothed[i - 1];
    const s = lambda * series[i] + (1 - lambda) * prev;
    smoothed.push(s);

    // Control limits widen with time
    const factor = sigma * sigmaMultiplier * Math.sqrt(
      (lambda / (2 - lambda)) * (1 - Math.pow(1 - lambda, 2 * (i + 1)))
    );
    ucl.push(mean + factor);
    lcl.push(mean - factor);

    if (s > mean + factor || s < mean - factor) {
      outliers.push(i);
    }
  }

  return { smoothed, ucl, lcl, outliers };
}

/**
 * Z-score analysis for cross-department comparison.
 * Identifies departments that significantly deviate from the group.
 */
export function zScoreAnalysis(
  deptValues: Record<string, number>,
  threshold: number = 2.0,
): ZScoreResult[] {
  const values = Object.values(deptValues);
  if (values.length < 3) {
    return Object.entries(deptValues).map(([deptId, value]) => ({
      deptId, value, zScore: 0, isOutlier: false,
    }));
  }

  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const stdDev = Math.sqrt(
    values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length
  );

  if (stdDev === 0) {
    return Object.entries(deptValues).map(([deptId, value]) => ({
      deptId, value, zScore: 0, isOutlier: false,
    }));
  }

  return Object.entries(deptValues).map(([deptId, value]) => {
    const zScore = (value - mean) / stdDev;
    return {
      deptId,
      value,
      zScore: +zScore.toFixed(3),
      isOutlier: Math.abs(zScore) > threshold,
    };
  });
}

/**
 * Simplified chi-square p-value approximation.
 * Uses Wilson-Hilferty approximation for chi-square CDF.
 */
function chiSquarePValue(chiSquare: number, df: number): number {
  if (chiSquare <= 0) return 1;
  // Wilson-Hilferty approximation
  const z = Math.pow(chiSquare / df, 1 / 3) - (1 - 2 / (9 * df));
  const denom = Math.sqrt(2 / (9 * df));
  const standardNormal = z / denom;
  // Approximate standard normal CDF (Abramowitz and Stegun)
  return 1 - normalCDF(standardNormal);
}

function normalCDF(x: number): number {
  if (x < -6) return 0;
  if (x > 6) return 1;
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327; // 1/sqrt(2*pi)
  const p = d * Math.exp(-x * x / 2) * t *
    (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}
