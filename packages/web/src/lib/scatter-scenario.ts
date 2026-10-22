import type { LimitComparisonResponse } from '@aemr/shared';

/**
 * Hypothetical arithmetic only. The competitive K/Y ratio and planned EP sum
 * are not a causal counterfactual. If activity scopes cannot be aligned, do
 * not present a monetary number with a falsely shared header perimeter.
 */
export function conditionalEpProjection(input: {
  scatter: LimitComparisonResponse | null;
  epPlan: number;
  epHasData: boolean;
  dashboardLoading: boolean;
  yearMatches: boolean;
  activityAligned: boolean;
  budgetAligned: boolean;
  searchAligned: boolean;
  institutionAligned: boolean;
  methodAligned: boolean;
}): number | null {
  const { scatter, epPlan, epHasData, dashboardLoading, yearMatches, activityAligned, budgetAligned, searchAligned, institutionAligned, methodAligned } = input;
  if (!scatter || dashboardLoading || !yearMatches || !activityAligned || !budgetAligned || !searchAligned || !institutionAligned || !methodAligned || !epHasData
    || !scatter.coverage.complete || scatter.summary.count === 0
    || !Number.isFinite(epPlan) || epPlan <= 0) return null;
  const ratio = scatter.summary.limitReductionPercent;
  if (ratio === null || !Number.isFinite(ratio)) return null;
  return epPlan * (ratio / 100);
}
