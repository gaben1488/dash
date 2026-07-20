import { useMemo } from 'react';
import { useStore } from '../store';
import { getFilteredEconomyTotal } from '../lib/economy-metrics';
import { bothDeptKeyForms } from '../lib/dept-key';
import { aggregateSignalCounts } from '../lib/signal-counts';
import { shouldShowYearMismatch } from '../lib/year-mismatch';
import { resolvePeriodSelection, activePeriodKeys } from '../lib/selectors/period-resolution';
import { filterDeptsByDepartments, markDeptOnlyMode, filterDeptsBySearch } from '../lib/selectors/dept-filtering';
import { applySubordinateFilter } from '../lib/selectors/subordinate-override';
import { filterIssues, splitIssuesBySeverity } from '../lib/selectors/issues-filtering';
import { filterDeltas } from '../lib/selectors/deltas-filtering';
import { filterKpiCards, selectTopKpis } from '../lib/selectors/kpi-filtering';
import { aggregateTotals } from '../lib/selectors/totals-aggregation';
import { makeBudgetPlanFact, recalcTotalsByBudget } from '../lib/selectors/budget-filter';
import { resolveActivityKeys, recalcTotalsByActivity } from '../lib/selectors/activity-aggregation';
import { buildBarData, buildDeptCardOverrides } from '../lib/selectors/bar-data';
import { recalcSummaryByPeriod, applyBudgetZeroing } from '../lib/selectors/summary-by-period';
import { buildExecCountKpiCard, buildEconomyKpiCard, buildCompetitiveRatioKpiCard } from '../lib/selectors/derived-kpis';

/**
 * Centralized data filtering hook.
 * All pages use this to get consistently filtered data
 * based on global filter state (departments, period, procurement, subordinates, months, search, activity).
 *
 * Разрез E11-1 (move-only): вычисления живут чистыми селекторами в
 * web/src/lib/selectors/*; хук — тонкая композиция (читает store, зовёт
 * селекторы, собирает ПРЕЖНИЙ контракт возвращаемых полей — он не менялся).
 */
export function useFilteredData() {
  const {
    dashboardData,
    selectedDepartments,
    selectedSubordinates,
    period,
    activeMonths,
    activityFilter,
    selectedMethods,
    selectedActivities,
    selectedBudgets,
    searchQuery,
    subordinatesMap,
    year,
    dataYear,
    deptOnlyMode,
    loading,
  } = useStore();

  return useMemo(() => {
    const allDepts: any[] = dashboardData?.departmentSummaries ?? [];
    const allIssues: any[] = dashboardData?.snapshot?.issues ?? dashboardData?.recentIssues ?? [];
    const allDeltas: any[] = dashboardData?.snapshot?.deltas ?? [];
    const trust = dashboardData?.trust ?? null;
    const kpiCards: any[] = dashboardData?.kpiCards ?? [];
    const rawSummaryByPeriod: Record<string, any> = dashboardData?.summaryByPeriod ?? {};

    // ── Оси ГРБС / подвед / dept-only / поиск ──
    const hasDeptFilter = selectedDepartments.size > 0;
    const hasSubFilter = selectedSubordinates.size > 0;
    const normalizedSearch = (searchQuery ?? '').trim().toLowerCase();

    let depts = filterDeptsByDepartments(allDepts, selectedDepartments);
    depts = applySubordinateFilter(depts, selectedSubordinates, subordinatesMap);
    depts = markDeptOnlyMode(depts, deptOnlyMode);
    depts = filterDeptsBySearch(depts, normalizedSearch);

    // ── Issues / deltas (обе формы депт-ключа — Б5) ──
    const selectedDeptBothForms = bothDeptKeyForms(selectedDepartments);
    const issues = filterIssues(allIssues, {
      hasDeptFilter, selectedDeptBothForms, selectedSubordinates, normalizedSearch, selectedActivities,
    });
    const deltas = filterDeltas(allDeltas, selectedDeptBothForms, hasDeptFilter);

    // ── Период (эффективный periodKey из period + activeMonths) ──
    const hasMonthData = depts.some((d: any) => d.months && Object.keys(d.months).length > 0);
    const resolution = resolvePeriodSelection(period, activeMonths, hasMonthData);
    const { periodKey, coveredQuarters, useMonthLevel, hasActiveMonths } = resolution;

    // ── KPI-карточки ──
    const filteredKpiCards = filterKpiCards(kpiCards, { hasDeptFilter, depts, normalizedSearch });
    const topKpis = selectTopKpis(filteredKpiCards, periodKey, selectedMethods);
    // DEPRECATED (спека §3.4): умирает при переходе на FilterContext — слепой
    // фолбэк «первые 6 карточек» заменится честным year-фолбэком с бейджем скоупа.
    if (topKpis.length === 0 && filteredKpiCards.length > 0) {
      topKpis.push(...filteredKpiCards.slice(0, 6));
    }

    // ── Тоталы: способ (КП/ЕП) + смешанная агрегация кварталов/месяцев ──
    const showKP = selectedMethods.size === 0 || selectedMethods.has('competitive');
    const showEP = selectedMethods.size === 0 || selectedMethods.has('single');
    let { totalKP, totalEP, totalPlan, totalFact, totalPlanCount, totalFactCount } =
      aggregateTotals(depts, resolution, { showKP, showEP, activeMonths, hasMonthData });

    // ── Оси бюджета и вида деятельности (пересчёт тоталов при активном фильтре) ──
    const isBudgetFiltered = selectedBudgets.size > 0;
    const budgetPlanFact = makeBudgetPlanFact(selectedBudgets);
    const isActivityFiltered = selectedActivities.size > 0;
    const actKeys = resolveActivityKeys(selectedActivities);

    if (isActivityFiltered) {
      ({ totalPlan, totalFact, totalKP, totalEP } = recalcTotalsByActivity(depts, {
        actKeys, periodKeys: activePeriodKeys(resolution), budgetPlanFact,
      }));
    }
    if (isBudgetFiltered && !isActivityFiltered) {
      ({ totalPlan, totalFact } = recalcTotalsByBudget(depts, {
        budgetPlanFact, useMonthLevel, activeMonths, hasActiveMonths, coveredQuarters, periodKey,
      }));
    }

    // ── Бар-чарт исполнения per-департамент ──
    const overallExecCountPct = totalPlanCount > 0
      ? +((totalFactCount / totalPlanCount) * 100).toFixed(1) : null;
    const barData = buildBarData(depts, {
      budgetPlanFact, isBudgetFiltered, isActivityFiltered, actKeys,
      useMonthLevel, activeMonths, hasActiveMonths, coveredQuarters, periodKey, showKP, showEP,
    });

    // ── summaryByPeriod: пересчёт, когда фильтры сузили датасет ──
    const needsSummaryRecalc = (hasDeptFilter && depts.length > 0 && depts.length < allDepts.length)
      || selectedMethods.size > 0 || isActivityFiltered || selectedBudgets.size > 0;
    let summaryByPeriod = needsSummaryRecalc
      ? recalcSummaryByPeriod(depts, { isActivityFiltered, actKeys, budgetPlanFact, showKP, showEP })
      : rawSummaryByPeriod;
    summaryByPeriod = applyBudgetZeroing(summaryByPeriod, selectedBudgets);

    // ── DEPRECATED (спека §3.4): умирает при переходе на FilterContext ──
    // sparkData/trend МУТИРУЮТСЯ прямо в kpi-объектах (в т.ч. объектах store) —
    // уйдёт следующим разрезом вместе с прекращением мутации карточек.
    // 11b. Attach sparkData (quarterly series) to KPI cards
    for (const kpi of topKpis) {
      if (kpi.metricKey?.startsWith('_derived')) continue;
      const key = kpi.metricKey ?? '';
      const spark: number[] = [];
      for (const qk of ['q1', 'q2', 'q3', 'q4']) {
        const q = summaryByPeriod[qk];
        if (!q) { spark.push(0); continue; }
        if (key.includes('competitive') && key.includes('percent')) spark.push(q.kpPercent ?? 0);
        else if (key.includes('sole') && key.includes('percent')) spark.push(q.epPercent ?? 0);
        else if (key.includes('competitive') && key.includes('count')) spark.push(q.kpCount ?? 0);
        else if (key.includes('sole') && key.includes('count')) spark.push(q.epCount ?? 0);
        else spark.push(0);
      }
      if (spark.some(v => v > 0)) kpi.sparkData = spark;
    }
    // 11c. Compute trend for KPI cards (current vs previous period)
    const QUARTER_ORDER = ['q1', 'q2', 'q3', 'q4'];
    const prevPeriodKey = periodKey === 'year' ? 'q4'
      : QUARTER_ORDER[QUARTER_ORDER.indexOf(periodKey) - 1] ?? null;
    if (prevPeriodKey && summaryByPeriod[periodKey] && summaryByPeriod[prevPeriodKey]) {
      const cur = summaryByPeriod[periodKey];
      const prev = summaryByPeriod[prevPeriodKey];
      for (const kpi of topKpis) {
        if (kpi.trend || kpi.metricKey?.startsWith('_derived')) continue;
        const key = kpi.metricKey ?? '';
        let curVal = 0, prevVal = 0;
        if (key.includes('competitive') && key.includes('percent')) {
          curVal = cur.kpPercent ?? 0; prevVal = prev.kpPercent ?? 0;
        } else if (key.includes('sole') && key.includes('percent')) {
          curVal = cur.epPercent ?? 0; prevVal = prev.epPercent ?? 0;
        } else if (key.includes('competitive') && key.includes('count')) {
          curVal = cur.kpCount ?? 0; prevVal = prev.kpCount ?? 0;
        } else if (key.includes('sole') && key.includes('count')) {
          curVal = cur.epCount ?? 0; prevVal = prev.epCount ?? 0;
        }
        if (prevVal > 0) {
          const diff = curVal - prevVal;
          const pctChange = Math.abs(diff / prevVal);
          kpi.trend = pctChange < 0.02 ? 'stable' : diff > 0 ? 'up' : 'down';
        }
      }
    }
    // ── конец DEPRECATED-блока мутаций ──

    // ── Производные KPI-карточки (гварды порядка/заполнения — как до разреза) ──
    if (overallExecCountPct != null) {
      topKpis.unshift(buildExecCountKpiCard(overallExecCountPct, periodKey, depts));
    }
    if (topKpis.length < 6 && totalPlan > 0) {
      const economyTotal = getFilteredEconomyTotal({ depts, periodKey, coveredQuarters, selectedBudgets });
      topKpis.push(buildEconomyKpiCard({ totalPlan, economyTotal, periodKey }));
    }
    if (topKpis.length < 6 && (totalKP + totalEP) > 0) {
      topKpis.push(buildCompetitiveRatioKpiCard({ totalKP, totalEP, periodKey }));
    }

    // ── Оверрайды карточек, severity, сигналы ──
    const deptCardOverrides = buildDeptCardOverrides(
      barData, isActivityFiltered || useMonthLevel || isBudgetFiltered);
    const { criticalIssues, warningIssues } = splitIssuesBySeverity(issues);
    // Signal counts: суммируем по ОТФИЛЬТРОВАННЫМ депам (depts), фолбэк на серверный полный.
    const signalCounts = aggregateSignalCounts(depts, dashboardData?.signalCounts ?? {});

    return {
      // Raw filtered collections
      depts,
      issues,
      deltas,
      trust,
      kpiCards: filteredKpiCards,
      summaryByPeriod,
      signalCounts,

      // Pre-indexed lookup for O(1) dept→execCountPct (avoids O(n²) in DeptCard rendering)
      execCountPctByDeptId: Object.fromEntries(barData.map((b: any) => [b.id, b.execCountPct])),

      // Derived
      topKpis,
      barData,
      totalKP,
      totalEP,
      totalPlan,
      totalFact,
      totalEconomy: getFilteredEconomyTotal({ depts, periodKey, coveredQuarters, selectedBudgets }),
      overallExecCountPct,
      totalPlanCount,
      totalFactCount,
      criticalIssues,
      warningIssues,
      periodKey,
      coveredQuarters,

      // Month-level awareness
      useMonthLevel,
      hasMonthData,

      // Activity-aware overrides for department cards
      deptCardOverrides,
      isActivityFiltered,

      // Filter state for convenience
      hasDeptFilter,
      hasSubFilter,
      allDepts,
      activeActivityFilter: activityFilter,
      selectedMethods,
      selectedActivities,
      selectedBudgets,
      activeSearchQuery: normalizedSearch,

      // Year filter awareness
      year,
      dataYear,
      /** true when selected year doesn't match the loaded data year (and not loading) */
      yearMismatch: shouldShowYearMismatch(year, dataYear, loading),
    };
  }, [
    dashboardData,
    selectedDepartments,
    selectedSubordinates,
    deptOnlyMode,
    subordinatesMap,
    period,
    activeMonths,
    selectedMethods,
    selectedActivities,
    selectedBudgets,
    activityFilter,
    searchQuery,
    year,
    dataYear,
    loading,
  ]);
}
