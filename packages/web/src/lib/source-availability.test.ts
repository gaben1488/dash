import { describe, expect, it } from 'vitest';
import {
  completeAverage, completeSum, confirmedEmptyCounts,
  cumulativePercentOfYear, materializedCategoryAmount, observedNumber, percentOf,
} from './source-availability';

describe('C05.02: source completeness is not a fabricated zero', () => {
  it('distinguishes a measured zero, unread value and invalid number', () => {
    expect(observedNumber(0)).toBe(0);
    expect(observedNumber(-15)).toBe(-15);
    expect(observedNumber(null)).toBeNull();
    expect(observedNumber(undefined)).toBeNull();
    expect(observedNumber(Number.NaN)).toBeNull();
    expect(observedNumber(Infinity)).toBeNull();
  });

  it('fails closed on a partly unread department / financing sum', () => {
    expect(completeSum([0, 5, -2])).toBe(3);
    expect(completeSum([0, 0])).toBe(0);
    expect(completeSum([0, null, 5])).toBeNull();
    expect(completeSum([undefined])).toBeNull();
    expect(completeSum([])).toBeNull();
  });

  it('distinguishes zero numerator, absent denominator and zero base', () => {
    expect(percentOf(0, 100)).toBe(0);
    expect(percentOf(25, 100)).toBe(25);
    expect(percentOf(null, 100)).toBeNull();
    expect(percentOf(20, null)).toBeNull();
    expect(percentOf(0, 0)).toBeNull();
  });

  it('does not recover an invented cumulative growth curve after an unread quarter', () => {
    expect(cumulativePercentOfYear([0, 20, 30, 0], 100)).toEqual([0, 20, 50, 50]);
    expect(cumulativePercentOfYear([10, null, 30, 40], 100)).toEqual([10, null, null, null]);
    expect(cumulativePercentOfYear([10, 20], null)).toEqual([null, null]);
    expect(cumulativePercentOfYear([10, 20], 0)).toEqual([null, null]);
  });

  it('recognizes absent categories in an accepted period but not an absent period', () => {
    expect(materializedCategoryAmount(undefined, 'current_program', 'planTotal')).toBeNull();
    expect(materializedCategoryAmount({ current_non_program: { planTotal: 12 } }, 'current_program', 'planTotal')).toBe(0);
    expect(materializedCategoryAmount({ current_non_program: { planTotal: 0 } }, 'current_non_program', 'planTotal')).toBe(0);
    expect(materializedCategoryAmount({ current_program: { planTotal: null } }, 'current_program', 'planTotal')).toBeNull();
    expect(materializedCategoryAmount({ current_program: {} }, 'current_program', 'planTotal')).toBeNull();
  });

  it('does not average unread Trust or declare a source with missing counts empty', () => {
    expect(completeAverage([0, 60, 90])).toBe(50);
    expect(completeAverage([60, null])).toBeNull();
    expect(confirmedEmptyCounts(0, 0)).toBe(true);
    expect(confirmedEmptyCounts(null, 0)).toBe(false);
    expect(confirmedEmptyCounts(0, undefined)).toBe(false);
    expect(confirmedEmptyCounts(0, 2)).toBe(false);
  });
});
