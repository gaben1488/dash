import { describe, it, expect } from 'vitest';
import {
  calculateMeanAndStdDev,
  calculateZScore,
  firstSignificantDigit,
  BENFORD_EXPECTED,
} from './statistics.js';

// ────────────────────────────────────────────────────────────
// calculateMeanAndStdDev
// ────────────────────────────────────────────────────────────

describe('calculateMeanAndStdDev', () => {
  it('returns zeros for empty array', () => {
    const result = calculateMeanAndStdDev([]);
    expect(result).toEqual({ mean: 0, stdDev: 0, count: 0 });
  });

  it('returns stdDev=0 for single value', () => {
    const result = calculateMeanAndStdDev([42]);
    expect(result.mean).toBe(42);
    expect(result.stdDev).toBe(0);
    expect(result.count).toBe(1);
  });

  it('returns stdDev=0 when all values are the same', () => {
    const result = calculateMeanAndStdDev([7, 7, 7, 7, 7]);
    expect(result.mean).toBe(7);
    expect(result.stdDev).toBe(0);
    expect(result.count).toBe(5);
  });

  it('calculates correctly for known data [2, 4, 4, 4, 5, 5, 7, 9]', () => {
    const result = calculateMeanAndStdDev([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(result.mean).toBe(5);
    expect(result.stdDev).toBeCloseTo(2, 1);
    expect(result.count).toBe(8);
  });

  it('handles negative values', () => {
    const result = calculateMeanAndStdDev([-10, -5, 0, 5, 10]);
    expect(result.mean).toBe(0);
    expect(result.stdDev).toBeCloseTo(Math.sqrt(50), 10);
    expect(result.count).toBe(5);
  });

  it('handles very large numbers without NaN', () => {
    const big = [1e12, 2e12, 3e12];
    const result = calculateMeanAndStdDev(big);
    expect(result.mean).toBe(2e12);
    expect(result.stdDev).toBeGreaterThan(0);
    expect(Number.isFinite(result.stdDev)).toBe(true);
  });

  it('computes population stdDev (not sample)', () => {
    // population stdDev of [0, 10] = 5, sample stdDev ~= 7.07
    const result = calculateMeanAndStdDev([0, 10]);
    expect(result.mean).toBe(5);
    expect(result.stdDev).toBe(5); // population, not sample
  });
});

// ────────────────────────────────────────────────────────────
// calculateZScore
// ────────────────────────────────────────────────────────────

describe('calculateZScore', () => {
  it('returns 0 when stdDev is 0', () => {
    expect(calculateZScore(100, 50, 0)).toBe(0);
  });

  it('returns 0 when value equals mean', () => {
    expect(calculateZScore(5, 5, 2)).toBe(0);
  });

  it('calculates positive z-score correctly', () => {
    expect(calculateZScore(12, 10, 2)).toBe(1);
  });

  it('calculates negative z-score correctly', () => {
    expect(calculateZScore(8, 10, 2)).toBe(-1);
  });

  it('handles extreme z-scores', () => {
    const z = calculateZScore(100, 0, 1);
    expect(z).toBe(100);
  });
});

// ────────────────────────────────────────────────────────────
// firstSignificantDigit
// ────────────────────────────────────────────────────────────

describe('firstSignificantDigit', () => {
  it('returns NaN for 0', () => {
    expect(firstSignificantDigit(0)).toBeNaN();
  });

  it('returns correct digit for 1-9', () => {
    for (let d = 1; d <= 9; d++) {
      expect(firstSignificantDigit(d)).toBe(d);
    }
  });

  it('extracts first digit from multi-digit numbers', () => {
    expect(firstSignificantDigit(456)).toBe(4);
    expect(firstSignificantDigit(9999)).toBe(9);
    expect(firstSignificantDigit(12345)).toBe(1);
  });

  it('handles decimals like 0.00123 → 1', () => {
    expect(firstSignificantDigit(0.00123)).toBe(1);
  });

  it('handles decimals like 0.5 → 5', () => {
    expect(firstSignificantDigit(0.5)).toBe(5);
  });

  it('handles negative numbers', () => {
    expect(firstSignificantDigit(-789)).toBe(7);
    expect(firstSignificantDigit(-0.003)).toBe(3);
  });

  it('returns NaN for very small numbers near epsilon', () => {
    expect(firstSignificantDigit(Number.EPSILON / 10)).toBeNaN();
  });
});

// ────────────────────────────────────────────────────────────
// BENFORD_EXPECTED
// ────────────────────────────────────────────────────────────

describe('BENFORD_EXPECTED', () => {
  it('has exactly 9 entries (digits 1-9)', () => {
    expect(BENFORD_EXPECTED).toHaveLength(9);
  });

  it('sums to approximately 1.0', () => {
    const sum = BENFORD_EXPECTED.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 10);
  });

  it('first entry (digit 1) is approximately 0.301', () => {
    expect(BENFORD_EXPECTED[0]).toBeCloseTo(0.30103, 4);
  });

  it('is frozen (immutable)', () => {
    expect(Object.isFrozen(BENFORD_EXPECTED)).toBe(true);
  });

  it('values are monotonically decreasing', () => {
    for (let i = 1; i < BENFORD_EXPECTED.length; i++) {
      expect(BENFORD_EXPECTED[i]).toBeLessThan(BENFORD_EXPECTED[i - 1]);
    }
  });
});
