/**
 * Производные (calculated) KPI-карточки: главный KPI руководства
 * exec_count_pct, экономия (savings rate), доля КП.
 *
 * Извлечено move-only из useFilteredData.ts §11c'(:780–800) и §11d (:802–827),
 * разрез E11-1. Гварды порядка и заполнения («первым», «добить до 6»)
 * остаются на стороне хука — здесь только чистое построение карточек.
 */

/** §11c': exec_count_pct — ГЛАВНЫЙ KPI руководства, вставляется первым. */
export function buildExecCountKpiCard(
  overallExecCountPct: number,
  periodKey: string,
  depts: any[],
): any {
  return {
    metricKey: '_derived.exec_count_pct',
    label: 'Исполнение (кол-во)',
    value: `${overallExecCountPct}%`,
    numericValue: overallExecCountPct,
    unit: 'percent',
    period: periodKey === 'year' ? 'annual' : periodKey,
    status: overallExecCountPct >= 80 ? 'normal' : overallExecCountPct >= 50 ? 'warning' : 'critical',
    origin: 'calculated',
    sparkData: ['q1', 'q2', 'q3', 'q4'].map(qk => {
      let pc = 0, fc = 0;
      for (const d of depts) {
        const q = d.quarters?.[qk];
        if (q) { pc += q.planCount ?? 0; fc += q.factCount ?? 0; }
      }
      return pc > 0 ? +((fc / pc) * 100).toFixed(1) : 0;
    }),
  };
}

/** §11d: карточка экономии (savings rate = экономия / план). */
export function buildEconomyKpiCard(opts: {
  totalPlan: number;
  economyTotal: number;
  periodKey: string;
}): any {
  const { totalPlan, economyTotal, periodKey } = opts;
  const savingsRate = totalPlan > 0 ? (economyTotal / totalPlan) * 100 : 0;
  return {
    metricKey: '_derived.savings_rate',
    label: 'Экономия',
    value: `${savingsRate.toFixed(1)}%`,
    unit: 'percent',
    period: periodKey === 'year' ? 'annual' : periodKey,
    status: savingsRate >= 5 ? 'normal' : savingsRate >= 0 ? 'warning' : 'critical',
    origin: 'calculated',
  };
}

/** §11d: карточка доли конкурентных процедур (КП / (КП+ЕП)). */
export function buildCompetitiveRatioKpiCard(opts: {
  totalKP: number;
  totalEP: number;
  periodKey: string;
}): any {
  const { totalKP, totalEP, periodKey } = opts;
  const competitiveRatio = ((totalKP / (totalKP + totalEP)) * 100);
  return {
    metricKey: '_derived.competitive_ratio',
    label: 'Доля КП',
    value: `${competitiveRatio.toFixed(1)}%`,
    unit: 'percent',
    period: periodKey === 'year' ? 'annual' : periodKey,
    status: competitiveRatio >= 50 ? 'normal' : 'warning',
    origin: 'calculated',
  };
}
