/**
 * Ось подведов: сужение списка управлений и оверрайд департамент-агрегатов
 * суммой метрик выбранных подведов (год / кварталы / месяцы, вкл. per-budget).
 *
 * Извлечено move-only из useFilteredData.ts §2 (:50–178), разрез E11-1.
 * «Выживший» по спеке filter-system-target-2026-07-16 §3.4
 * (подвед-оверрайд агрегатов). Матчинг подведов по displayName (s.name) —
 * до D1-переезда на стабильные ID реестра подведов (спека §3.2).
 *
 * Пустой выбор подведов = депты возвращаются без изменений.
 */
export function applySubordinateFilter(
  depts: any[],
  selectedSubordinates: Set<string>,
  subordinatesMap: Record<string, string[]>,
): any[] {
  if (selectedSubordinates.size === 0) return depts;

  const deptIdsWithSubs = new Set<string>();
  for (const [deptId, subs] of Object.entries(subordinatesMap)) {
    if (subs.some((s: string) => selectedSubordinates.has(s))) {
      deptIdsWithSubs.add(deptId);
    }
  }
  // «Аппарат управления» (_org_itself) не обязан присутствовать в
  // subordinatesMap (Б4): он валиден для ЛЮБОГО выбранного управления —
  // не сужаем депты по нему, если выбраны и управления.
  if (selectedSubordinates.has('_org_itself') && deptIdsWithSubs.size === 0) {
    for (const deptId of Object.keys(subordinatesMap)) deptIdsWithSubs.add(deptId);
  }
  // Bug fix: subordinatesMap keys are Russian short names (e.g. 'УЭР') while
  // d.department?.id is the English slug (e.g. 'uer'). Check both fields.
  let result = depts.filter((d: any) =>
    deptIdsWithSubs.has(d.department?.id) ||
    deptIdsWithSubs.has(d.department?.nameShort)
  );

  // Override department aggregates with subordinate-level totals.
  // SubordinateMetrics now includes quarters{}, months{}, byMethod{} for full drill-down.
  result = result.map((d: any) => {
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

  return result;
}
