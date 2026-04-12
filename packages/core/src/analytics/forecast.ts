/**
 * Forecasting Module
 * Generates execution forecasts based on monthly data.
 * Based on procurement_report.gs forecasting logic.
 */

import type { GRBSBaseline } from './grbs-profile.js';

export interface ForecastScenario {
  label: string;
  yearEndExecution: number;  // % (0-1)
  yearEndFact: number;       // absolute amount
  confidence: number;        // 0-1
  monthlyProjection: number[]; // [m1...m12] projected fact amounts
}

export interface ForecastResult {
  grbsId: string;
  scenarios: ForecastScenario[];
  currentExecution: number;  // current execution %
  monthsWithData: number;
  trend: 'accelerating' | 'decelerating' | 'stable' | 'insufficient_data';
}

/**
 * Linear extrapolation forecast.
 * Projects year-end based on current monthly trajectory.
 */
export function linearForecast(
  monthlyFacts: number[],
  yearPlan: number,
): ForecastScenario {
  const nonZero = monthlyFacts.filter(v => v > 0);
  if (nonZero.length === 0 || yearPlan <= 0) {
    return {
      label: 'Базовый (линейный)',
      yearEndExecution: 0,
      yearEndFact: 0,
      confidence: 0,
      monthlyProjection: new Array(12).fill(0),
    };
  }

  const currentTotal = monthlyFacts.reduce((s, v) => s + v, 0);
  const avgMonthly = currentTotal / nonZero.length;
  const remainingMonths = 12 - nonZero.length;
  const projectedTotal = currentTotal + avgMonthly * remainingMonths;

  const projection = [...monthlyFacts];
  for (let i = monthlyFacts.length; i < 12; i++) {
    projection.push(avgMonthly);
  }

  return {
    label: 'Базовый (линейный)',
    yearEndExecution: Math.min(projectedTotal / yearPlan, 2),
    yearEndFact: projectedTotal,
    confidence: Math.min(nonZero.length / 6, 1) * 0.7, // confidence grows with data
    monthlyProjection: projection,
  };
}

/**
 * Seasonal-adjusted forecast using ГРБС profile baselines.
 * Accounts for typical seasonal procurement patterns.
 */
export function seasonalForecast(
  monthlyFacts: number[],
  yearPlan: number,
  profile?: GRBSBaseline,
): ForecastScenario {
  // Default seasonal weights (typical government procurement pattern)
  const seasonalWeights = [
    0.04, 0.05, 0.10,  // Q1: slow start
    0.08, 0.08, 0.10,  // Q2: moderate
    0.08, 0.08, 0.10,  // Q3: moderate
    0.10, 0.10, 0.09,  // Q4: year-end rush
  ];

  const nonZero = monthlyFacts.filter(v => v > 0);
  if (nonZero.length < 2 || yearPlan <= 0) {
    return {
      label: 'Сезонный',
      yearEndExecution: 0,
      yearEndFact: 0,
      confidence: 0,
      monthlyProjection: new Array(12).fill(0),
    };
  }

  // Calculate scaling factor from actual vs expected seasonal
  const currentTotal = monthlyFacts.reduce((s, v) => s + v, 0);
  const expectedByNow = seasonalWeights
    .slice(0, nonZero.length)
    .reduce((s, w) => s + w, 0);
  const scaleFactor = expectedByNow > 0 ? currentTotal / (yearPlan * expectedByNow) : 1;

  const projection = [...monthlyFacts];
  let projectedTotal = currentTotal;
  for (let i = monthlyFacts.length; i < 12; i++) {
    const projected = yearPlan * seasonalWeights[i] * scaleFactor;
    projection.push(projected);
    projectedTotal += projected;
  }

  return {
    label: 'Сезонный',
    yearEndExecution: Math.min(projectedTotal / yearPlan, 2),
    yearEndFact: projectedTotal,
    confidence: Math.min(nonZero.length / 4, 1) * 0.8,
    monthlyProjection: projection,
  };
}

/**
 * Build 3 forecast scenarios (base, optimistic, pessimistic).
 */
export function buildScenarios(
  monthlyFacts: number[],
  yearPlan: number,
  profile?: GRBSBaseline,
): ForecastResult {
  const grbsId = profile?.grbsId ?? 'unknown';
  const nonZero = monthlyFacts.filter(v => v > 0);
  const currentTotal = monthlyFacts.reduce((s, v) => s + v, 0);

  if (nonZero.length < 2 || yearPlan <= 0) {
    return {
      grbsId,
      scenarios: [],
      currentExecution: yearPlan > 0 ? currentTotal / yearPlan : 0,
      monthsWithData: nonZero.length,
      trend: 'insufficient_data',
    };
  }

  const base = linearForecast(monthlyFacts, yearPlan);
  const seasonal = seasonalForecast(monthlyFacts, yearPlan, profile);

  // Optimistic: 120% of base projection
  const optimistic: ForecastScenario = {
    label: 'Оптимистичный',
    yearEndExecution: Math.min(base.yearEndExecution * 1.2, 2),
    yearEndFact: base.yearEndFact * 1.2,
    confidence: base.confidence * 0.6,
    monthlyProjection: base.monthlyProjection.map((v, i) =>
      i < nonZero.length ? v : v * 1.2
    ),
  };

  // Pessimistic: 80% of base projection
  const pessimistic: ForecastScenario = {
    label: 'Пессимистичный',
    yearEndExecution: base.yearEndExecution * 0.8,
    yearEndFact: base.yearEndFact * 0.8,
    confidence: base.confidence * 0.6,
    monthlyProjection: base.monthlyProjection.map((v, i) =>
      i < nonZero.length ? v : v * 0.8
    ),
  };

  // Determine trend
  let trend: ForecastResult['trend'] = 'stable';
  if (nonZero.length >= 3) {
    const recent = nonZero.slice(-3);
    const diffs = [recent[1] - recent[0], recent[2] - recent[1]];
    if (diffs[1] > diffs[0] * 1.1) trend = 'accelerating';
    else if (diffs[1] < diffs[0] * 0.9) trend = 'decelerating';
  }

  return {
    grbsId,
    scenarios: [base, seasonal, optimistic, pessimistic],
    currentExecution: yearPlan > 0 ? currentTotal / yearPlan : 0,
    monthsWithData: nonZero.length,
    trend,
  };
}
