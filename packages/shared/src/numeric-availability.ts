/**
 * C05.02 — a measured zero, an unread metric and a zero denominator are
 * different states. Chart series and titles must use the same completeness
 * policy; never invent a financial or Trust result from a partial source.
 */
export type SourceNumber = number | null | undefined;

export function observedNumber(value: SourceNumber): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

/** A known empty selection is handled by the caller; [] does not prove 0. */
export function completeSum(values: readonly SourceNumber[]): number | null {
  if (values.length === 0) return null;
  let total = 0;
  for (const value of values) {
    const observed = observedNumber(value);
    if (observed === null) return null;
    total += observed;
  }
  return Number.isFinite(total) ? total : null;
}

export function percentOf(part: SourceNumber, whole: SourceNumber, decimals = 1): number | null {
  const numerator = observedNumber(part);
  const denominator = observedNumber(whole);
  return numerator !== null && denominator !== null && denominator > 0
    ? +((numerator / denominator) * 100).toFixed(decimals)
    : null;
}

/** A missing earlier quarter also makes subsequent cumulative points unknown. */
export function cumulativePercentOfYear(
  quarterFacts: readonly SourceNumber[],
  annualPlan: SourceNumber,
): Array<number | null> {
  let cumulative = 0;
  let missing = false;
  return quarterFacts.map((fact) => {
    const observed = observedNumber(fact);
    if (observed === null) missing = true;
    else cumulative += observed;
    return missing ? null : percentOf(cumulative, annualPlan);
  });
}

/** Last adjacent observed quarter-to-quarter change; never bridge missing points. */
export function latestAdjacentObservedDelta(values: readonly SourceNumber[]): number | null {
  for (let i = values.length - 1; i >= 1; i--) {
    const current = observedNumber(values[i]);
    const previous = observedNumber(values[i - 1]);
    if (current !== null && previous !== null) return current - previous;
  }
  return null;
}

export function completeAverage(values: readonly SourceNumber[]): number | null {
  const sum = completeSum(values);
  return sum === null ? null : sum / values.length;
}

/**
 * An accepted activity-period map is complete: a category absent from that
 * map has no rows. But a missing entire map or a present category whose
 * amount was not read is unknown, not zero.
 */
export function materializedCategoryAmount(
  period: Record<string, { planTotal?: SourceNumber; factTotal?: SourceNumber } | undefined> | null | undefined,
  group: string,
  field: 'planTotal' | 'factTotal',
): number | null {
  if (!period) return null;
  const category = period[group];
  if (category === undefined) return 0;
  return observedNumber(category[field]);
}

export function confirmedEmptyCounts(plan: SourceNumber, fact: SourceNumber): boolean {
  return observedNumber(plan) === 0 && observedNumber(fact) === 0;
}
