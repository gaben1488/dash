/**
 * A12: единый семантический контракт финансового результата.
 *
 * Отдельные значения не взаимозаменяемы: фактическое снижение торгов,
 * утверждённая экономия, свободный остаток и прогнозная экономия.
 * Контракт намеренно не изменяет ни одного рабочего расчёта до проверки
 * потребителей и миграции на одну каноническую модель.
 */
export type EconomyMeaning =
  | 'auction_price_reduction'
  | 'approved_savings'
  | 'uncommitted_budget_balance'
  | 'projected_competitive_savings';

export type EconomyEvidence =
  | { kind: 'observed'; sourceId: string; snapshotId: string; asOf: string }
  | { kind: 'approved'; sourceId: string; snapshotId: string; asOf: string; approvalId: string }
  | { kind: 'modelled'; sourceId: string; snapshotId: string; asOf: string; modelId: string; modelVersion: string };

export type EconomyMeasure = Readonly<{
  meaning: EconomyMeaning;
  amountRub: number | null;
  evidence: EconomyEvidence;
}>;

export function validateEconomyMeasure(value: EconomyMeasure): EconomyMeasure {
  if (value.amountRub !== null && !Number.isFinite(value.amountRub)) {
    throw new Error('ECONOMY_NON_FINITE_AMOUNT');
  }
  const e = value.evidence;
  if (!e.sourceId || !e.snapshotId || !/^\d{4}-\d{2}-\d{2}/.test(e.asOf)) {
    throw new Error('ECONOMY_MISSING_PROVENANCE');
  }
  if (value.meaning === 'projected_competitive_savings') {
    if (e.kind !== 'modelled' || !e.modelId || !e.modelVersion) {
      throw new Error('ECONOMY_FORECAST_REQUIRES_MODEL');
    }
  } else if (e.kind === 'modelled') {
    throw new Error('ECONOMY_FORECAST_MUST_NOT_BE_ACTUAL');
  }
  if (value.meaning === 'approved_savings' && e.kind !== 'approved') {
    throw new Error('ECONOMY_APPROVAL_REQUIRED');
  }
  return value;
}

export function calculateCompetitiveForecast(input: Readonly<{
  competitiveUncommittedRub: number | null;
  weightedReductionRate: number | null;
  sourceId: string;
  snapshotId: string;
  asOf: string;
  modelId: string;
  modelVersion: string;
}>): EconomyMeasure {
  const { competitiveUncommittedRub: base, weightedReductionRate: rate } = input;
  if (base !== null && (!Number.isFinite(base) || base < 0)) {
    throw new Error('ECONOMY_INVALID_BASE');
  }
  if (rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > 1)) {
    throw new Error('ECONOMY_INVALID_RATE');
  }
  return validateEconomyMeasure({
    meaning: 'projected_competitive_savings',
    amountRub: base === null || rate === null ? null : Math.round(base * rate * 100) / 100,
    evidence: {
      kind: 'modelled',
      sourceId: input.sourceId,
      snapshotId: input.snapshotId,
      asOf: input.asOf,
      modelId: input.modelId,
      modelVersion: input.modelVersion,
    },
  });
}
