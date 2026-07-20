import type { PeriodResolution } from './period-resolution';

/**
 * Агрегация тоталов (КП/ЕП, план/факт, счётчики) по отфильтрованным департаментам
 * со смешанной логикой периодов: полные кварталы quarter-level + частичные
 * месяцы month-level + подвед-оверрайд короткого замыкания.
 *
 * Извлечено move-only из useFilteredData.ts §8 (:333–462), разрез E11-1.
 * «Выживший» по спеке filter-system-target-2026-07-16 §3.4 (смешанная агрегация
 * полных кварталов + частичных месяцев).
 */
export interface AggregatedTotals {
  totalKP: number;
  totalEP: number;
  totalPlan: number;
  totalFact: number;
  /** count-based исполнение: totalFactCount / totalPlanCount */
  totalPlanCount: number;
  totalFactCount: number;
}

export function aggregateTotals(
  depts: any[],
  resolution: PeriodResolution,
  opts: {
    /** Способ (КП/ЕП): пустой selectedMethods = показывать оба */
    showKP: boolean;
    showEP: boolean;
    activeMonths: Set<number>;
    hasMonthData: boolean;
  },
): AggregatedTotals {
  const { periodKey, coveredQuarters, fullQuarters, partialMonths, useMonthLevel, hasActiveMonths } = resolution;
  const { showKP, showEP, activeMonths, hasMonthData } = opts;

  let totalKP = 0, totalEP = 0;
  let totalPlan = 0, totalFact = 0;
  // exec_count_pct aggregation (count-based: totalFactCount / totalPlanCount)
  let totalPlanCount = 0, totalFactCount = 0;

  for (const d of depts) {
    // ── Subordinate-filtered short-circuit ──
    // When subordinate filter overrode dept-level totals, the values on d are already
    // the subordinate slice (year-level). Use them directly — quarter/month breakdowns
    // on the original department object still represent the full department.
    if (d._subFiltered) {
      if (showKP) totalKP += d.competitiveCount ?? 0;
      if (showEP) totalEP += d.soleCount ?? 0;
      totalPlan += d.planTotal ?? 0;
      totalFact += d.factTotal ?? 0;
      // Count-based: sum from quarter data of overridden subs
      for (const qk of ['q1', 'q2', 'q3', 'q4']) {
        const sq = d.quarters?.[qk];
        if (sq) { totalPlanCount += sq.planCount ?? 0; totalFactCount += sq.factCount ?? 0; }
      }
      continue;
    }

    // ── Mixed month+quarter aggregation ──
    // When months are selected, we split into:
    //   - fullQuarters: all 3 months selected → use quarter-level data (more accurate)
    //   - partialMonths: only some months selected → sum month-level data
    // This handles mixed selections like "январь + 2 квартал" correctly.
    const hasMixed = hasActiveMonths && (fullQuarters.length > 0 || partialMonths.length > 0);

    if (hasMixed && hasMonthData && partialMonths.length > 0) {
      // Sum month-level data for partially-selected quarters
      for (const monthNum of partialMonths) {
        const m = d.months?.[monthNum];
        if (!m) continue;

        if (showKP) totalKP += m.kpCount ?? 0;
        if (showEP) totalEP += m.epCount ?? 0;
        totalPlanCount += m.planCount ?? 0;
        totalFactCount += m.factCount ?? 0;

        const hasBreakdown = (m.kpPlanTotal ?? 0) > 0 || (m.epPlanTotal ?? 0) > 0;
        if (hasBreakdown) {
          if (showKP) { totalPlan += m.kpPlanTotal ?? 0; totalFact += m.kpFactTotal ?? 0; }
          if (showEP) { totalPlan += m.epPlanTotal ?? 0; totalFact += m.epFactTotal ?? 0; }
        } else {
          totalPlan += m.planTotal ?? 0;
          totalFact += m.factTotal ?? 0;
        }
      }

      // Use quarter-level data for fully-selected quarters
      for (const qKey of fullQuarters) {
        const q = d.quarters?.[qKey];
        const dKP = q?.kpCount ?? 0;
        const dEP = q?.epCount ?? 0;
        const dKpPlan = q?.kpPlanTotal ?? 0;
        const dKpFact = q?.kpFactTotal ?? 0;
        const dEpPlan = q?.epPlanTotal ?? 0;
        const dEpFact = q?.epFactTotal ?? 0;

        if (showKP) totalKP += dKP;
        if (showEP) totalEP += dEP;
        totalPlanCount += q?.planCount ?? 0;
        totalFactCount += q?.factCount ?? 0;

        if (dKpPlan > 0 || dEpPlan > 0) {
          if (showKP) { totalPlan += dKpPlan; totalFact += dKpFact; }
          if (showEP) { totalPlan += dEpPlan; totalFact += dEpFact; }
        } else {
          totalPlan += q?.planTotal ?? 0;
          totalFact += q?.factTotal ?? 0;
        }
      }
    } else if (useMonthLevel) {
      // ── Pure month-level aggregation: all selected months individually ──
      for (const monthNum of activeMonths) {
        const m = d.months?.[monthNum];
        if (!m) continue;

        if (showKP) totalKP += m.kpCount ?? 0;
        if (showEP) totalEP += m.epCount ?? 0;
        totalPlanCount += m.planCount ?? 0;
        totalFactCount += m.factCount ?? 0;

        const hasBreakdown = (m.kpPlanTotal ?? 0) > 0 || (m.epPlanTotal ?? 0) > 0;
        if (hasBreakdown) {
          if (showKP) { totalPlan += m.kpPlanTotal ?? 0; totalFact += m.kpFactTotal ?? 0; }
          if (showEP) { totalPlan += m.epPlanTotal ?? 0; totalFact += m.epFactTotal ?? 0; }
        } else {
          totalPlan += m.planTotal ?? 0;
          totalFact += m.factTotal ?? 0;
        }
      }
    } else {
      // ── Quarter/year-level aggregation ──
      const aggregateQuarters = hasActiveMonths && coveredQuarters.length > 0
        ? coveredQuarters
        : [periodKey];

      for (const qKey of aggregateQuarters) {
        const q = d.quarters?.[qKey];
        const fb = aggregateQuarters.length === 1;
        const dKP = q?.kpCount ?? (fb ? (d.competitiveCount ?? 0) : 0);
        const dEP = q?.epCount ?? (fb ? (d.soleCount ?? 0) : 0);
        const dKpPlan = q?.kpPlanTotal ?? 0;
        const dKpFact = q?.kpFactTotal ?? 0;
        const dEpPlan = q?.epPlanTotal ?? 0;
        const dEpFact = q?.epFactTotal ?? 0;

        if (showKP) totalKP += dKP;
        if (showEP) totalEP += dEP;
        totalPlanCount += q?.planCount ?? 0;
        totalFactCount += q?.factCount ?? 0;

        if (dKpPlan > 0 || dEpPlan > 0) {
          if (showKP) { totalPlan += dKpPlan; totalFact += dKpFact; }
          if (showEP) { totalPlan += dEpPlan; totalFact += dEpFact; }
        } else {
          totalPlan += q?.planTotal ?? (fb ? (d.planTotal ?? 0) : 0);
          totalFact += q?.factTotal ?? (fb ? (d.factTotal ?? 0) : 0);
        }
      }
    }
  }

  return { totalKP, totalEP, totalPlan, totalFact, totalPlanCount, totalFactCount };
}
