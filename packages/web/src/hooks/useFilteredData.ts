import { useMemo } from 'react';
import { useStore, QUARTER_MONTHS, type PeriodScope } from '../store';

/**
 * Centralized data filtering hook.
 * All pages use this to get consistently filtered data
 * based on global filter state (departments, period, procurement, subordinates, months, search, activity).
 */
export function useFilteredData() {
  const {
    dashboardData,
    selectedDepartments,
    selectedSubordinates,
    period,
    activeMonths,
    procurementFilter,
    activityFilter,
    selectedMethods,
    selectedActivities,
    selectedBudgets,
    searchQuery,
    subordinatesMap,
    year,
    dataYear,
  } = useStore();

  return useMemo(() => {
    const allDepts: any[] = dashboardData?.departmentSummaries ?? [];
    const allIssues: any[] = dashboardData?.snapshot?.issues ?? dashboardData?.recentIssues ?? [];
    const allDeltas: any[] = dashboardData?.snapshot?.deltas ?? [];
    const trust = dashboardData?.trust ?? null;
    const kpiCards: any[] = dashboardData?.kpiCards ?? [];
    const rawSummaryByPeriod: Record<string, any> = dashboardData?.summaryByPeriod ?? {};

    // ── 1. Department filter ──
    // selectedDepartments uses Russian short names (УЭР, УИО), while
    // department data from API has both .id (uer) and .nameShort (УЭР)
    const hasDeptFilter = selectedDepartments.size > 0;
    let depts = hasDeptFilter
      ? allDepts.filter((d: any) =>
          selectedDepartments.has(d.department?.id) ||
          selectedDepartments.has(d.department?.nameShort))
      : allDepts;

    // ── 2. Subordinate filter ──
    // When subordinates are selected, we:
    //   a) Keep only departments that contain at least one selected subordinate
    //   b) Override department-level aggregates (planTotal, factTotal, etc.)
    //      with the SUM of only the selected subordinates' metrics from bySubordinate[]
    // This ensures dashboard cards, bar charts, and KPI totals reflect the subordinate slice,
    // not the full department.
    const hasSubFilter = selectedSubordinates.size > 0;
    if (hasSubFilter) {
      const deptIdsWithSubs = new Set<string>();
      for (const [deptId, subs] of Object.entries(subordinatesMap)) {
        if (subs.some((s: string) => selectedSubordinates.has(s))) {
          deptIdsWithSubs.add(deptId);
        }
      }
      // Bug fix: subordinatesMap keys are Russian short names (e.g. 'УЭР') while
      // d.department?.id is the English slug (e.g. 'uer'). Check both fields.
      depts = depts.filter((d: any) =>
        deptIdsWithSubs.has(d.department?.id) ||
        deptIdsWithSubs.has(d.department?.nameShort)
      );

      // Override department aggregates with subordinate-level totals.
      // SubordinateMetrics now includes quarters{}, months{}, byMethod{} for full drill-down.
      depts = depts.map((d: any) => {
        const subList: any[] = d.subordinates ?? [];
        const matchedSubs = subList.filter((s: any) => selectedSubordinates.has(s.name));
        if (matchedSubs.length === 0) return d;

        // Sum matched subordinate year-level metrics
        let subPlan = 0, subFact = 0, subKP = 0, subEP = 0, subEconomy = 0, subRows = 0;
        for (const ms of matchedSubs) {
          subPlan += ms.planTotal ?? 0;
          subFact += ms.factTotal ?? 0;
          subKP += ms.competitiveCount ?? 0;
          subEP += ms.epCount ?? 0;
          subEconomy += ms.economyTotal ?? 0;
          subRows += ms.rowCount ?? 0;
        }
        const subExecPct = subPlan > 0 ? +((subFact / subPlan) * 100).toFixed(1) : 0;

        // Sum subordinate quarter-level breakdowns (including per-budget)
        const quarters: Record<string, any> = {};
        for (const qk of ['q1', 'q2', 'q3', 'q4']) {
          let qPlanCount = 0, qFactCount = 0, qPlanTotal = 0, qFactTotal = 0, qEco = 0;
          let qPlanFB = 0, qPlanKB = 0, qPlanMB = 0, qFactFB = 0, qFactKB = 0, qFactMB = 0;
          let qEcoFB = 0, qEcoKB = 0, qEcoMB = 0;
          for (const ms of matchedSubs) {
            const sq = ms.quarters?.[qk];
            if (sq) {
              qPlanCount += sq.planCount ?? 0;
              qFactCount += sq.factCount ?? 0;
              qPlanTotal += sq.planTotal ?? 0;
              qFactTotal += sq.factTotal ?? 0;
              qEco += sq.economyTotal ?? 0;
              qPlanFB += sq.planFB ?? 0; qPlanKB += sq.planKB ?? 0; qPlanMB += sq.planMB ?? 0;
              qFactFB += sq.factFB ?? 0; qFactKB += sq.factKB ?? 0; qFactMB += sq.factMB ?? 0;
              qEcoFB += sq.economyFB ?? 0; qEcoKB += sq.economyKB ?? 0; qEcoMB += sq.economyMB ?? 0;
            }
          }
          quarters[qk] = {
            ...(d.quarters?.[qk] ?? {}),
            planCount: qPlanCount, factCount: qFactCount,
            planTotal: qPlanTotal, factTotal: qFactTotal,
            economyTotal: qEco,
            planFB: qPlanFB, planKB: qPlanKB, planMB: qPlanMB,
            factFB: qFactFB, factKB: qFactKB, factMB: qFactMB,
            economyFB: qEcoFB, economyKB: qEcoKB, economyMB: qEcoMB,
            executionPct: qPlanTotal > 0 ? +((qFactTotal / qPlanTotal) * 100).toFixed(1) : 0,
          };
        }

        // Sum subordinate month-level breakdowns (including per-budget)
        const months: Record<number, any> = {};
        for (let mi = 1; mi <= 12; mi++) {
          let mPlanCount = 0, mFactCount = 0, mPlanTotal = 0, mFactTotal = 0, mEco = 0;
          let mPlanFB = 0, mPlanKB = 0, mPlanMB = 0, mFactFB = 0, mFactKB = 0, mFactMB = 0;
          let mEcoFB = 0, mEcoKB = 0, mEcoMB = 0;
          let hasData = false;
          for (const ms of matchedSubs) {
            const sm = ms.months?.[mi];
            if (sm) {
              hasData = true;
              mPlanCount += sm.planCount ?? 0;
              mFactCount += sm.factCount ?? 0;
              mPlanTotal += sm.planTotal ?? 0;
              mFactTotal += sm.factTotal ?? 0;
              mEco += sm.economyTotal ?? 0;
              mPlanFB += sm.planFB ?? 0; mPlanKB += sm.planKB ?? 0; mPlanMB += sm.planMB ?? 0;
              mFactFB += sm.factFB ?? 0; mFactKB += sm.factKB ?? 0; mFactMB += sm.factMB ?? 0;
              mEcoFB += sm.economyFB ?? 0; mEcoKB += sm.economyKB ?? 0; mEcoMB += sm.economyMB ?? 0;
            }
          }
          if (hasData) {
            months[mi] = {
              ...(d.months?.[mi] ?? {}),
              planCount: mPlanCount, factCount: mFactCount,
              planTotal: mPlanTotal, factTotal: mFactTotal,
              economyTotal: mEco,
              planFB: mPlanFB, planKB: mPlanKB, planMB: mPlanMB,
              factFB: mFactFB, factKB: mFactKB, factMB: mFactMB,
              economyFB: mEcoFB, economyKB: mEcoKB, economyMB: mEcoMB,
              executionPct: mPlanTotal > 0 ? +((mFactTotal / mPlanTotal) * 100).toFixed(1) : 0,
            };
          }
        }

        return {
          ...d,
          planTotal: subPlan,
          factTotal: subFact,
          executionPercent: subExecPct,
          competitiveCount: subKP,
          soleCount: subEP,
          economyTotal: subEconomy,
          quarters,
          months,
          subordinates: matchedSubs,
          _subFiltered: true,
          _subRowCount: subRows,
        };
      });
    }

    // ── 3. Search filter ──
    const normalizedSearch = (searchQuery ?? '').trim().toLowerCase();
    if (normalizedSearch) {
      depts = depts.filter((d: any) => {
        const name = (d.department?.name ?? '').toLowerCase();
        const nameShort = (d.department?.nameShort ?? '').toLowerCase();
        const id = (d.department?.id ?? '').toLowerCase();
        return name.includes(normalizedSearch) || nameShort.includes(normalizedSearch) || id.includes(normalizedSearch);
      });
    }

    // ── 4. Issues filter (dept + subordinate + search) ──
    let issues = hasDeptFilter
      ? allIssues.filter((i: any) => {
          if (!i.departmentId) return true;
          return selectedDepartments.has(i.departmentId) || selectedDepartments.has(i.department);
        })
      : allIssues;

    if (hasSubFilter) {
      issues = issues.filter((i: any) => {
        // Issues without subordinateId pass through (org-level issues)
        if (!i.subordinateId) return true;
        return selectedSubordinates.has(i.subordinateId);
      });
    }

    if (normalizedSearch) {
      issues = issues.filter((i: any) => {
        const title = (i.title ?? '').toLowerCase();
        const desc = (i.description ?? '').toLowerCase();
        const dept = (i.departmentId ?? '').toLowerCase();
        return title.includes(normalizedSearch) || desc.includes(normalizedSearch) || dept.includes(normalizedSearch);
      });
    }

    // ── 4b. Activity filter for issues (multi-select) ──
    if (selectedActivities.size > 0) {
      issues = issues.filter((i: any) => {
        // Issues without activityType (СВОД-level, mapping) pass through
        if (!i.activityType) return true;
        return selectedActivities.has(i.activityType);
      });
    }

    // ── 5. Deltas filter ──
    const deltas = hasDeptFilter
      ? allDeltas.filter((d: any) => {
          if (!d.metricKey) return true;
          // metricKey has format grbs.uer.kp.q1.count — dept id (uer) is at position 1
          const keyDeptId = d.metricKey.split('.')[1] ?? '';
          return selectedDepartments.has(keyDeptId) ||
            [...selectedDepartments].some(sd => d.metricKey.includes(sd.toLowerCase()));
        })
      : allDeltas;

    // ── 6. Period / month resolution ──
    // Determine what period to use for data access.
    // If specific months are selected AND month-level data exists, use months directly.
    // Otherwise, map to quarters or use 'year'.
    const hasMonthData = depts.some((d: any) => d.months && Object.keys(d.months).length > 0);
    const hasActiveMonths = activeMonths.size > 0;

    let periodKey = period; // 'year' | 'q1' | 'q2' | 'q3' | 'q4'
    const coveredQuarters: string[] = [];
    // Quarters where ALL 3 months are selected (use quarter-level data for accuracy)
    const fullQuarters: string[] = [];
    // Months that belong to partially-selected quarters (sum month-level data)
    const partialMonths: number[] = [];
    const useMonthLevel = hasActiveMonths && hasMonthData;

    if (hasActiveMonths) {
      for (const [qKey, months] of Object.entries(QUARTER_MONTHS)) {
        const selectedInQ = months.filter((m: number) => activeMonths.has(m));
        if (selectedInQ.length > 0) {
          coveredQuarters.push(qKey);
          if (selectedInQ.length === 3) {
            // All 3 months of this quarter selected → use quarter-level data
            fullQuarters.push(qKey);
          } else {
            // Only some months selected → sum month-level data for those months
            partialMonths.push(...selectedInQ);
          }
        }
      }
      if (coveredQuarters.length === 1) {
        periodKey = coveredQuarters[0] as PeriodScope;
      }
    }

    // ── 7. KPI cards filtered by department + procurement type ──
    // When departments are selected, show only kpiCards whose metricKey
    // matches one of the selected departments (grbs.{deptId}.*)
    let filteredKpiCards = kpiCards;
    if (hasDeptFilter) {
      // Build set of dept IDs that are selected (need English IDs for metricKey matching)
      const selectedDeptIds = new Set<string>();
      for (const d of depts) {
        if (d.department?.id) selectedDeptIds.add(d.department.id);
      }
      filteredKpiCards = kpiCards.filter((k: any) => {
        const key = k.metricKey ?? '';
        // Summary keys (competitive.*, sole.*) — always show
        if (!key.startsWith('grbs.')) return true;
        // grbs.{deptId}.* — show only if deptId is selected
        const deptId = key.split('.')[1];
        return selectedDeptIds.has(deptId);
      });
    }

    // ── 7b. Search filter for kpiCards ──
    if (normalizedSearch) {
      filteredKpiCards = filteredKpiCards.filter((k: any) => {
        const label = (k.label ?? '').toLowerCase();
        const metricKey = (k.metricKey ?? '').toLowerCase();
        return label.includes(normalizedSearch) || metricKey.includes(normalizedSearch);
      });
    }

    const kpKeys = [`competitive.${periodKey}.percent`, `competitive.${periodKey}.count`];
    const epKeys = [`sole.${periodKey}.percent`, `sole.${periodKey}.count`];
    const keyMetrics = procurementFilter === 'competitive' ? kpKeys
      : procurementFilter === 'single' ? epKeys
      : [...kpKeys, ...epKeys];

    const topKpis = keyMetrics
      .map(key => filteredKpiCards.find((k: any) => k.metricKey === key))
      .filter(Boolean)
      .slice(0, 6);
    if (topKpis.length === 0 && filteredKpiCards.length > 0) {
      topKpis.push(...filteredKpiCards.slice(0, 6));
    }


    // ── 8. Aggregate stats from filtered departments ──
    // Multi-select: empty Set = show all; otherwise show only selected methods
    const showKP = selectedMethods.size === 0 || selectedMethods.has('competitive');
    const showEP = selectedMethods.size === 0 || selectedMethods.has('single');

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

    // ── 9. Activity filter — adjust totals using byActivity breakdown ──
    // Multi-select: empty Set = all (no filter), otherwise filter by selected activities.
    const isActivityFiltered = selectedActivities.size > 0;
    const ALL_ACTIVITY_KEYS = ['program', 'current_program', 'current_non_program'];
    const actKeys = isActivityFiltered ? [...selectedActivities] : ALL_ACTIVITY_KEYS;

    if (isActivityFiltered) {
      // Recalculate aggregate totals using byActivity breakdown
      totalPlan = 0;
      totalFact = 0;
      totalKP = 0;
      totalEP = 0;

      for (const d of depts) {
        const ba = d.byActivity ?? {};
        // Determine active period keys
        const periodKeys = hasActiveMonths && coveredQuarters.length > 0
          ? coveredQuarters
          : [periodKey];

        for (const pk of periodKeys) {
          const qActivity = ba[pk];
          if (!qActivity) continue;

          for (const ak of actKeys) {
            const a = qActivity[ak];
            if (!a) continue;
            totalPlan += a.planTotal ?? 0;
            totalFact += a.factTotal ?? 0;
            totalKP += a.planCount ?? 0; // approximate — byActivity doesn't split KP/EP
          }
        }
      }
    }

    // ── 9b. Budget filter — recalculate totals using per-budget breakdown ──
    const isBudgetFiltered = selectedBudgets.size > 0;
    const budgetShowFB = !isBudgetFiltered || selectedBudgets.has('fb');
    const budgetShowKB = !isBudgetFiltered || selectedBudgets.has('kb');
    const budgetShowMB = !isBudgetFiltered || selectedBudgets.has('mb');

    /** Sum plan/fact from quarter's per-budget fields, respecting budget filter */
    const budgetPlanFact = (q: any): { plan: number; fact: number } => {
      if (!q || !isBudgetFiltered) return { plan: q?.planTotal ?? 0, fact: q?.factTotal ?? 0 };
      let plan = 0, fact = 0;
      if (budgetShowFB) { plan += q.planFB ?? 0; fact += q.factFB ?? 0; }
      if (budgetShowKB) { plan += q.planKB ?? 0; fact += q.factKB ?? 0; }
      if (budgetShowMB) { plan += q.planMB ?? 0; fact += q.factMB ?? 0; }
      return { plan, fact };
    };

    if (isBudgetFiltered && !isActivityFiltered) {
      totalPlan = 0;
      totalFact = 0;
      for (const d of depts) {
        if (d._subFiltered) {
          for (const qk of ['q1', 'q2', 'q3', 'q4']) {
            const { plan, fact } = budgetPlanFact(d.quarters?.[qk]);
            totalPlan += plan; totalFact += fact;
          }
        } else if (useMonthLevel) {
          for (const monthNum of activeMonths) {
            const { plan, fact } = budgetPlanFact(d.months?.[monthNum]);
            totalPlan += plan; totalFact += fact;
          }
        } else {
          const aggregateQuarters = hasActiveMonths && coveredQuarters.length > 0
            ? coveredQuarters : [periodKey];
          for (const qKey of aggregateQuarters) {
            const { plan, fact } = budgetPlanFact(d.quarters?.[qKey]);
            totalPlan += plan; totalFact += fact;
          }
        }
      }
    }

    // ── 10. Execution bar data per department ──
    const overallExecCountPct = totalPlanCount > 0
      ? +((totalFactCount / totalPlanCount) * 100).toFixed(1) : null;

    const barData = depts.map((d: any) => {
      let pct = 0, plan = 0, fact = 0, kp = 0, ep = 0;
      let execCountPct: number | null = null;

      // Subordinate-filtered: use the already-overridden dept-level values
      if (d._subFiltered) {
        kp = d.competitiveCount ?? 0;
        ep = d.soleCount ?? 0;
        if (isBudgetFiltered) {
          for (const qk of ['q1', 'q2', 'q3', 'q4']) {
            const bf = budgetPlanFact(d.quarters?.[qk]);
            plan += bf.plan; fact += bf.fact;
          }
        } else {
          plan = d.planTotal ?? 0;
          fact = d.factTotal ?? 0;
        }
        pct = plan > 0 ? +((fact / plan) * 100).toFixed(1) : (d.executionPercent ?? 0);
        // Sum plan/fact counts from sub quarters for execCountPct
        let dPC = 0, dFC = 0;
        for (const qk of ['q1', 'q2', 'q3', 'q4']) {
          const sq = d.quarters?.[qk];
          if (sq) { dPC += sq.planCount ?? 0; dFC += sq.factCount ?? 0; }
        }
        execCountPct = dPC > 0 ? +((dFC / dPC) * 100).toFixed(1) : null;
      } else if (isActivityFiltered) {
        // Use byActivity breakdown for activity-filtered bar data
        const ba = d.byActivity ?? {};
        const periodKeys = hasActiveMonths && coveredQuarters.length > 0
          ? coveredQuarters
          : [periodKey];

        for (const pk of periodKeys) {
          const qAct = ba[pk];
          if (!qAct) continue;
          for (const ak of actKeys) {
            const a = qAct[ak];
            if (!a) continue;
            plan += a.planTotal ?? 0;
            fact += a.factTotal ?? 0;
            kp += a.planCount ?? 0;
          }
        }
        pct = plan > 0 ? +((fact / plan) * 100).toFixed(1) : 0;
      } else if (useMonthLevel) {
        // Aggregate selected months for this department
        let dPC = 0, dFC = 0;
        for (const monthNum of activeMonths) {
          const m = d.months?.[monthNum];
          if (!m) continue;
          dPC += m.planCount ?? 0; dFC += m.factCount ?? 0;
          if (isBudgetFiltered) {
            const bf = budgetPlanFact(m);
            plan += bf.plan; fact += bf.fact;
          } else {
            plan += m.planTotal ?? 0;
            fact += m.factTotal ?? 0;
          }
          kp += m.kpCount ?? 0;
          ep += m.epCount ?? 0;
        }
        pct = plan > 0 ? +((fact / plan) * 100).toFixed(1) : 0;
        execCountPct = dPC > 0 ? +((dFC / dPC) * 100).toFixed(1) : null;
      } else {
        const q = d.quarters?.[periodKey];
        kp = q?.kpCount ?? d.competitiveCount ?? 0;
        ep = q?.epCount ?? d.soleCount ?? 0;
        execCountPct = q?.execCountPct ?? null;
        if (isBudgetFiltered) {
          const bf = budgetPlanFact(q);
          plan = bf.plan; fact = bf.fact;
          pct = plan > 0 ? +((fact / plan) * 100).toFixed(1) : 0;
        } else {
          pct = q?.executionPct ?? d.executionPercent ?? 0;
          plan = q?.planTotal ?? d.planTotal ?? 0;
          fact = q?.factTotal ?? d.factTotal ?? 0;
        }
      }

      return {
        name: d.department?.nameShort ?? d.department?.id ?? '?',
        nameShort: d.department?.nameShort ?? d.department?.id ?? '?',
        id: d.department?.id,
        pct,
        planTotal: plan,
        factTotal: fact,
        kpCount: showKP ? kp : 0,
        epCount: showEP ? ep : 0,
        execCountPct,
      };
    });

    // ── 11. summaryByPeriod filtered by departments, procurement, and activity ──
    // Recalculate when any filter narrows the dataset beyond the full API response.
    let summaryByPeriod = rawSummaryByPeriod;
    const needsSummaryRecalc = (hasDeptFilter && depts.length > 0 && depts.length < allDepts.length)
      || selectedMethods.size > 0 || isActivityFiltered || selectedBudgets.size > 0;

    if (needsSummaryRecalc) {
      const filteredSummary: Record<string, any> = {};
      const periodKeys = ['q1', 'q2', 'q3', 'q4', 'year'];
      for (const pk of periodKeys) {
        let kpCount = 0, kpFactCount = 0, kpPlan = 0, kpFact = 0;
        let epCount = 0, epFactCount = 0, epPlan = 0, epFact = 0;
        let fbPlan = 0, kbPlan = 0, mbPlan = 0, fbFact = 0, kbFact = 0, mbFact = 0;

        if (isActivityFiltered) {
          // Use byActivity breakdown when activity filter is active
          for (const d of depts) {
            const ba = d.byActivity?.[pk];
            if (!ba) continue;
            for (const ak of actKeys) {
              const a = ba[ak];
              if (!a) continue;
              // byActivity doesn't split KP/EP budget, so approximate from counts
              kpCount += a.planCount ?? 0;
              kpFactCount += a.factCount ?? 0;
              kpPlan += a.planTotal ?? 0;
              kpFact += a.factTotal ?? 0;
            }
          }
        } else {
          for (const d of depts) {
            const q = d.quarters?.[pk];
            if (!q) continue;
            kpCount += q.kpCount ?? 0;
            kpFactCount += q.kpFactCount ?? 0;
            kpPlan += q.kpPlanTotal ?? 0;
            kpFact += q.kpFactTotal ?? 0;
            epCount += q.epCount ?? 0;
            epFactCount += q.epFactCount ?? 0;
            epPlan += q.epPlanTotal ?? 0;
            epFact += q.epFactTotal ?? 0;
            fbPlan += q.planFB ?? 0;
            kbPlan += q.planKB ?? 0;
            mbPlan += q.planMB ?? 0;
            fbFact += q.factFB ?? 0;
            kbFact += q.factKB ?? 0;
            mbFact += q.factMB ?? 0;
          }
        }

        // Apply procurement filter: zero out excluded type (multi-select)
        if (!showKP) {
          kpCount = 0; kpFactCount = 0; kpPlan = 0; kpFact = 0;
        }
        if (!showEP) {
          epCount = 0; epFactCount = 0; epPlan = 0; epFact = 0;
        }

        filteredSummary[pk] = {
          kpCount, kpFactCount, kpPlan, kpFact,
          kpPercent: kpCount > 0 ? kpFactCount / kpCount : 0,
          epCount, epFactCount, epPlan, epFact,
          epPercent: epCount > 0 ? epFactCount / epCount : 0,
          fbPlan, kbPlan, mbPlan, fbFact, kbFact, mbFact,
          source: 'filtered',
        };
      }
      summaryByPeriod = filteredSummary;
    }

    // ── 11a. Budget filter — zero out non-selected budgets in summary ──
    if (selectedBudgets.size > 0) {
      const showFB = selectedBudgets.has('fb');
      const showKB = selectedBudgets.has('kb');
      const showMB = selectedBudgets.has('mb');
      for (const pk of Object.keys(summaryByPeriod)) {
        const s = summaryByPeriod[pk];
        if (!s) continue;
        if (!showFB) { s.fbPlan = 0; s.fbFact = 0; }
        if (!showKB) { s.kbPlan = 0; s.kbFact = 0; }
        if (!showMB) { s.mbPlan = 0; s.mbFact = 0; }
      }
    }

    // ── 11b. Attach sparkData (quarterly series) to KPI cards ──
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

    // ── 11c. Compute trend for KPI cards (current vs previous period) ──
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

    // ── 11c. exec_count_pct as FIRST KPI card (ГЛАВНЫЙ KPI руководства) ──
    if (overallExecCountPct != null) {
      topKpis.unshift({
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
      });
    }

    // ── 11d. Derived KPI cards: fill up to 6 ──
    if (topKpis.length < 6 && totalPlan > 0) {
      const economyTotal = totalPlan - totalFact;
      const savingsRate = totalPlan > 0 ? (economyTotal / totalPlan) * 100 : 0;
      topKpis.push({
        metricKey: '_derived.savings_rate',
        label: 'Экономия',
        value: `${savingsRate.toFixed(1)}%`,
        unit: 'percent',
        period: periodKey === 'year' ? 'annual' : periodKey,
        status: savingsRate >= 5 ? 'normal' : savingsRate >= 0 ? 'warning' : 'critical',
        origin: 'calculated',
      });
    }
    if (topKpis.length < 6 && (totalKP + totalEP) > 0) {
      const competitiveRatio = ((totalKP / (totalKP + totalEP)) * 100);
      topKpis.push({
        metricKey: '_derived.competitive_ratio',
        label: 'Доля КП',
        value: `${competitiveRatio.toFixed(1)}%`,
        unit: 'percent',
        period: periodKey === 'year' ? 'annual' : periodKey,
        status: competitiveRatio >= 50 ? 'normal' : 'warning',
        origin: 'calculated',
      });
    }

    // ── 12. Activity-aware department card data ──
    // When activity filter is active, override dept-level plan/fact/execution with filtered values
    const deptCardOverrides: Record<string, { planTotal: number; factTotal: number; executionPercent: number | null }> = {};
    if (isActivityFiltered || useMonthLevel || isBudgetFiltered) {
      for (const bd of barData) {
        deptCardOverrides[bd.id] = {
          planTotal: bd.planTotal,
          factTotal: bd.factTotal,
          executionPercent: bd.pct,
        };
      }
    }

    // Severity counts
    const criticalIssues = issues.filter((i: any) => i.severity === 'critical' || i.severity === 'error');
    const warningIssues = issues.filter((i: any) => i.severity === 'warning' || i.severity === 'significant');

    // Signal counts from API (full dataset, not truncated recentIssues)
    const signalCounts: Record<string, number> = dashboardData?.signalCounts ?? {};

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
      /** true when selected year doesn't match the loaded data year */
      yearMismatch: year !== 'all' && year !== dataYear,
    };
  }, [
    dashboardData,
    selectedDepartments,
    selectedSubordinates,
    subordinatesMap,
    period,
    activeMonths,
    selectedMethods,
    selectedActivities,
    selectedBudgets,
    procurementFilter,
    activityFilter,
    searchQuery,
    year,
    dataYear,
  ]);
}
