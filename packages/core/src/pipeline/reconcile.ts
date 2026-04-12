/**
 * Reconciliation Engine
 * Compares official metrics from СВОД ТД-ПМ summary cells
 * against independently recalculated metrics from department rows.
 *
 * Assessment thresholds:
 *   < 1 %  — Совпадает          (ok)
 *   < 5 %  — Несопоставимо      (warning)  — check composition / period
 *   >= 5 % — Есть расхождение   (high)     — likely mapping error
 */

// ── Interfaces ────────────────────────────────────────────────────

export interface OfficialMetrics {
  planTotal: number;
  factTotal: number;
  economyTotal: number;
}

export interface ReconAssessment {
  /** Russian label shown in UI */
  status: 'Совпадает' | 'Несопоставимо' | 'Есть расхождение' | 'Нечего сравнивать';
  kind: 'ok' | 'neutral' | 'warning' | 'high';
  reason: string;
  maxAbsDelta: number;
  /** Likely source of the discrepancy */
  source: 'none' | 'methodology' | 'svod_error' | 'calc_error';
  sourceLabel: string;
}

export interface ReconRow {
  department: string;

  // Plan comparison
  fullPlanOfficial: number;
  fullPlanCalculated: number;
  planDelta: number;
  planDeltaPct: number;

  // Fact comparison
  fullFactOfficial: number;
  fullFactCalculated: number;
  factDelta: number;
  factDeltaPct: number;

  // Economy comparison
  ecoTotalOfficial: number;
  ecoTotalCalculated: number;
  ecoDelta: number;

  // Assessment
  assessment: ReconAssessment;
}

export interface ReconSummary {
  rows: ReconRow[];
  counts: {
    ok: number;
    neutral: number;
    warning: number;
    high: number;
  };
  overallStatus: string;
}

// ── Helpers ───────────────────────────────────────────────────────

function deltaPct(delta: number, base: number): number {
  return base !== 0 ? (delta / base) * 100 : 0;
}

function diagnoseSource(
  planDelta: number,
  factDelta: number,
  planOff: number,
  planCalc: number,
): { source: ReconAssessment['source']; sourceLabel: string } {
  // Both plan and fact deltas point the same direction → systematic
  const planSign = Math.sign(planDelta);
  const factSign = Math.sign(factDelta);

  if (planSign === 0 && factSign === 0) {
    return { source: 'none', sourceLabel: '—' };
  }

  // Calculated > Official consistently → our recalculation likely overcounts
  if (planCalc > planOff && planDelta > 0) {
    return { source: 'calc_error', sourceLabel: 'Ошибка расчёта' };
  }
  // Official > Calculated consistently → СВОД likely has extra/wrong data
  if (planOff > planCalc && planDelta < 0) {
    return { source: 'svod_error', sourceLabel: 'Ошибка СВОД' };
  }
  // Mixed signals or small differences → methodology difference
  return { source: 'methodology', sourceLabel: 'Методология' };
}

function assess(
  planDelta: number,
  factDelta: number,
  ecoDelta: number,
  planOff: number,
  factOff: number,
  planCalc: number,
): ReconAssessment {
  const maxAbs = Math.max(
    Math.abs(planDelta),
    Math.abs(factDelta),
    Math.abs(ecoDelta),
  );

  if (planOff === 0 && factOff === 0) {
    return {
      status: 'Нечего сравнивать',
      kind: 'neutral',
      reason: 'Нет данных в обоих слоях',
      maxAbsDelta: 0,
      source: 'none',
      sourceLabel: '—',
    };
  }

  // Use the larger of plan/fact official values as the base (minimum 1 to avoid /0)
  const baseForPct = Math.max(Math.abs(planOff), Math.abs(factOff), 1);
  const pctDelta = (maxAbs / baseForPct) * 100;

  const { source, sourceLabel } = pctDelta < 1
    ? { source: 'none' as const, sourceLabel: '—' }
    : diagnoseSource(planDelta, factDelta, planOff, planCalc);

  if (pctDelta < 1) {
    return {
      status: 'Совпадает',
      kind: 'ok',
      reason: 'Расчёт и свод согласованы (\u0394 < 1%)',
      maxAbsDelta: maxAbs,
      source: 'none',
      sourceLabel: '—',
    };
  }

  if (pctDelta < 5) {
    return {
      status: 'Несопоставимо',
      kind: 'warning',
      reason: `Дельта ${pctDelta.toFixed(1)}% \u2014 проверить состав и период`,
      maxAbsDelta: maxAbs,
      source,
      sourceLabel,
    };
  }

  return {
    status: 'Есть расхождение',
    kind: 'high',
    reason: `Дельта ${pctDelta.toFixed(1)}% \u2014 вероятна ошибка маппинга`,
    maxAbsDelta: maxAbs,
    source,
    sourceLabel,
  };
}

// ── Main reconciliation ───────────────────────────────────────────

/**
 * Compare official СВОД metrics with row-by-row recalculated metrics
 * for every department present in either dataset.
 *
 * @param officialMetrics    Map<departmentName, metrics> from summary cells.
 * @param calculatedMetrics  Map<departmentName, metrics> from recalculateFromRows().
 */
export function reconcile(
  officialMetrics: Map<string, OfficialMetrics>,
  calculatedMetrics: Map<string, OfficialMetrics>,
): ReconSummary {
  const rows: ReconRow[] = [];
  const departments = new Set([
    ...officialMetrics.keys(),
    ...calculatedMetrics.keys(),
  ]);

  for (const dept of departments) {
    const off: OfficialMetrics = officialMetrics.get(dept) ?? {
      planTotal: 0,
      factTotal: 0,
      economyTotal: 0,
    };
    const calc: OfficialMetrics = calculatedMetrics.get(dept) ?? {
      planTotal: 0,
      factTotal: 0,
      economyTotal: 0,
    };

    const planDelta = calc.planTotal - off.planTotal;
    const factDelta = calc.factTotal - off.factTotal;
    const ecoDelta = calc.economyTotal - off.economyTotal;

    const assessment = assess(
      planDelta,
      factDelta,
      ecoDelta,
      off.planTotal,
      off.factTotal,
      calc.planTotal,
    );

    rows.push({
      department: dept,
      fullPlanOfficial: off.planTotal,
      fullPlanCalculated: calc.planTotal,
      planDelta,
      planDeltaPct: deltaPct(planDelta, off.planTotal),
      fullFactOfficial: off.factTotal,
      fullFactCalculated: calc.factTotal,
      factDelta,
      factDeltaPct: deltaPct(factDelta, off.factTotal),
      ecoTotalOfficial: off.economyTotal,
      ecoTotalCalculated: calc.economyTotal,
      ecoDelta,
      assessment,
    });
  }

  const counts = {
    ok: rows.filter((r) => r.assessment.kind === 'ok').length,
    neutral: rows.filter((r) => r.assessment.kind === 'neutral').length,
    warning: rows.filter((r) => r.assessment.kind === 'warning').length,
    high: rows.filter((r) => r.assessment.kind === 'high').length,
  };

  let overallStatus: string;
  if (counts.high > 0) {
    overallStatus = 'Есть расхождения';
  } else if (counts.warning > 0) {
    overallStatus = 'Требует проверки';
  } else {
    overallStatus = 'Данные согласованы';
  }

  return { rows, counts, overallStatus };
}

// ── Monthly SHDYU reconciliation ────────────────────────────────

export interface MonthlyReconCell {
  shdyu: number;
  calc: number;
  delta: number;
  deltaPct: number;
  status: 'ok' | 'warning' | 'high' | 'empty';
}

/** Per-budget reconciliation for a single block (KP or EP) */
export interface BudgetReconCells {
  planFB: MonthlyReconCell;
  planKB: MonthlyReconCell;
  planMB: MonthlyReconCell;
  factFB: MonthlyReconCell;
  factKB: MonthlyReconCell;
  factMB: MonthlyReconCell;
  economyFB: MonthlyReconCell;
  economyKB: MonthlyReconCell;
  economyMB: MonthlyReconCell;
}

export interface MonthlyReconRow {
  deptId: string;
  deptName: string;
  month: number;
  compPlan: MonthlyReconCell;
  compFact: MonthlyReconCell;
  compPlanTotal: MonthlyReconCell;
  compFactTotal: MonthlyReconCell;
  epPlan: MonthlyReconCell;
  epFact: MonthlyReconCell;
  epPlanTotal: MonthlyReconCell;
  epFactTotal: MonthlyReconCell;
  compBudget?: BudgetReconCells;
  epBudget?: BudgetReconCells;
  warnings?: string[];
}

export interface MonthlyReconSummary {
  rows: MonthlyReconRow[];
  counts: { ok: number; warning: number; high: number; empty: number };
  overallStatus: string;
}

function makeCell(shdyu: number, calc: number): MonthlyReconCell {
  if (shdyu === 0 && calc === 0) {
    return { shdyu: 0, calc: 0, delta: 0, deltaPct: 0, status: 'empty' };
  }
  const delta = calc - shdyu;
  const base = Math.max(Math.abs(shdyu), 1);
  const pctVal = (delta / base) * 100;
  const absPct = Math.abs(pctVal);
  const status: 'ok' | 'warning' | 'high' = absPct < 1 ? 'ok' : absPct < 5 ? 'warning' : 'high';
  return { shdyu, calc, delta, deltaPct: pctVal, status };
}

/**
 * Compare SHDYU monthly dynamics data against row-by-row recalculation.
 *
 * @param recalcResults  Per-department RecalculatedMetrics (from pipeline)
 * @param shdyuData      Per-department SHDYUDeptData (from ШДЮ sheet)
 * @param deptNames      Map grbsId → display name
 */
export function reconcileMonthly(
  recalcResults: Record<string, any>,
  shdyuData: Record<string, any>,
  deptNames: Record<string, string>,
): MonthlyReconSummary {
  const rows: MonthlyReconRow[] = [];
  // Exclude 'all' (SHDYU_ALL_BLOCK) — it's for cross-validation, not per-dept reconciliation
  const deptIds = new Set([
    ...Object.keys(recalcResults),
    ...Object.keys(shdyuData).filter(k => k !== 'all'),
  ]);

  for (const deptId of deptIds) {
    const recalc = recalcResults[deptId];
    const shdyu = shdyuData[deptId];
    const deptName = deptNames[deptId] ?? deptId;

    for (let m = 1; m <= 12; m++) {
      const sh = shdyu?.months?.[m];
      const rc = recalc?.months?.[m];

      // Skip months with no data on either side
      if (!sh && (!rc || (rc.planCount === 0 && rc.factCount === 0))) continue;

      const compPlan = makeCell(sh?.compPlanCount ?? 0, rc?.competitive?.plan ?? 0);
      const compFact = makeCell(sh?.compFactCount ?? 0, rc?.competitive?.fact ?? 0);
      const compPlanTotal = makeCell(sh?.compPlanTotal ?? 0, rc?.competitive?.planSum ?? 0);
      const compFactTotal = makeCell(sh?.compFactTotal ?? 0, rc?.competitive?.factSum ?? 0);
      const epPlan = makeCell(sh?.epPlanCount ?? 0, rc?.ep?.plan ?? 0);
      const epFact = makeCell(sh?.epFactCount ?? 0, rc?.ep?.fact ?? 0);
      const epPlanTotal = makeCell(sh?.epPlanTotal ?? 0, rc?.ep?.planSum ?? 0);
      const epFactTotal = makeCell(sh?.epFactTotal ?? 0, rc?.ep?.factSum ?? 0);

      // Per-budget reconciliation (ФБ/КБ/МБ) using full SHDYU data
      const shComp = sh?.comp;
      const shEp = sh?.ep;
      const compBudget: BudgetReconCells | undefined = shComp ? {
        planFB: makeCell(shComp.planFB, rc?.competitive?.planFB ?? 0),
        planKB: makeCell(shComp.planKB, rc?.competitive?.planKB ?? 0),
        planMB: makeCell(shComp.planMB, rc?.competitive?.planMB ?? 0),
        factFB: makeCell(shComp.factFB, rc?.competitive?.factFB ?? 0),
        factKB: makeCell(shComp.factKB, rc?.competitive?.factKB ?? 0),
        factMB: makeCell(shComp.factMB, rc?.competitive?.factMB ?? 0),
        economyFB: makeCell(shComp.economyFB, rc?.competitive?.economyFB ?? 0),
        economyKB: makeCell(shComp.economyKB, rc?.competitive?.economyKB ?? 0),
        economyMB: makeCell(shComp.economyMB, rc?.competitive?.economyMB ?? 0),
      } : undefined;
      const epBudget: BudgetReconCells | undefined = shEp ? {
        planFB: makeCell(shEp.planFB, rc?.ep?.planFB ?? 0),
        planKB: makeCell(shEp.planKB, rc?.ep?.planKB ?? 0),
        planMB: makeCell(shEp.planMB, rc?.ep?.planMB ?? 0),
        factFB: makeCell(shEp.factFB, rc?.ep?.factFB ?? 0),
        factKB: makeCell(shEp.factKB, rc?.ep?.factKB ?? 0),
        factMB: makeCell(shEp.factMB, rc?.ep?.factMB ?? 0),
        economyFB: makeCell(shEp.economyFB, rc?.ep?.economyFB ?? 0),
        economyKB: makeCell(shEp.economyKB, rc?.ep?.economyKB ?? 0),
        economyMB: makeCell(shEp.economyMB, rc?.ep?.economyMB ?? 0),
      } : undefined;

      // Detect missing SHDYU data: calculated > 0 but SHDYU = 0
      const warnings: string[] = [];
      if (!sh && rc && (rc.competitive.plan > 0 || rc.ep.plan > 0)) {
        warnings.push(`ШДЮ: данные за месяц ${m} отсутствуют, но расчёт содержит ${rc.competitive.plan + rc.ep.plan} закупок`);
      }

      rows.push({
        deptId,
        deptName,
        month: m,
        compPlan,
        compFact,
        compPlanTotal,
        compFactTotal,
        epPlan,
        epFact,
        epPlanTotal,
        epFactTotal,
        ...(compBudget ? { compBudget } : {}),
        ...(epBudget ? { epBudget } : {}),
        ...(warnings.length > 0 ? { warnings } : {}),
      });
    }
  }

  const allCells = rows.flatMap(r => [
    r.compPlan, r.compFact, r.compPlanTotal, r.compFactTotal,
    r.epPlan, r.epFact, r.epPlanTotal, r.epFactTotal,
  ]);

  const counts = {
    ok: allCells.filter(c => c.status === 'ok').length,
    warning: allCells.filter(c => c.status === 'warning').length,
    high: allCells.filter(c => c.status === 'high').length,
    empty: allCells.filter(c => c.status === 'empty').length,
  };

  const overallStatus = counts.high > 0
    ? 'Есть расхождения'
    : counts.warning > 0
    ? 'Требует проверки'
    : 'Данные согласованы';

  return { rows, counts, overallStatus };
}

// ── SHDYU ↔ SVOD quarterly cross-verification ──────────────────

export interface QuarterCrossCell {
  shdyuSum: number;
  svodValue: number;
  delta: number;
  deltaPct: number;
  status: 'ok' | 'warning' | 'high' | 'empty';
}

export interface QuarterCrossRow {
  deptId: string;
  deptName: string;
  quarter: number;
  compPlan: QuarterCrossCell;
  compFact: QuarterCrossCell;
  epPlan: QuarterCrossCell;
  epFact: QuarterCrossCell;
}

export interface QuarterCrossSummary {
  rows: QuarterCrossRow[];
  counts: { ok: number; warning: number; high: number; empty: number };
  overallStatus: string;
}

function makeCrossCell(shdyuSum: number, svodValue: number): QuarterCrossCell {
  if (shdyuSum === 0 && svodValue === 0) {
    return { shdyuSum: 0, svodValue: 0, delta: 0, deltaPct: 0, status: 'empty' };
  }
  const delta = shdyuSum - svodValue;
  const base = Math.max(Math.abs(svodValue), 1);
  const pctVal = (delta / base) * 100;
  const absPct = Math.abs(pctVal);
  const status: 'ok' | 'warning' | 'high' = absPct < 1 ? 'ok' : absPct < 5 ? 'warning' : 'high';
  return { shdyuSum, svodValue, delta, deltaPct: pctVal, status };
}

const Q_MONTHS: Record<number, number[]> = {
  1: [1, 2, 3], 2: [4, 5, 6], 3: [7, 8, 9], 4: [10, 11, 12],
};

/**
 * Cross-verify SHDYU monthly data against quarterly totals.
 * Sums 3 SHDYU months per quarter, compares with recalculated quarterly metrics.
 * Discrepancy > 1% warrants investigation.
 */
export function crossVerifyQuarterly(
  shdyuData: Record<string, any>,
  recalcResults: Record<string, any>,
  deptNames: Record<string, string>,
): QuarterCrossSummary {
  const rows: QuarterCrossRow[] = [];
  const deptIds = new Set([...Object.keys(shdyuData), ...Object.keys(recalcResults)]);

  for (const deptId of deptIds) {
    const shdyu = shdyuData[deptId];
    const recalc = recalcResults[deptId];
    const deptName = deptNames[deptId] ?? deptId;

    for (let q = 1; q <= 4; q++) {
      const months = Q_MONTHS[q];
      const qk = `q${q}` as 'q1' | 'q2' | 'q3' | 'q4';
      const rq = recalc?.quarters?.[qk];

      let shCompPlan = 0, shCompFact = 0, shEpPlan = 0, shEpFact = 0;
      for (const m of months) {
        const sm = shdyu?.months?.[m];
        if (sm) {
          shCompPlan += sm.compPlanCount ?? 0;
          shCompFact += sm.compFactCount ?? 0;
          shEpPlan += sm.epPlanCount ?? 0;
          shEpFact += sm.epFactCount ?? 0;
        }
      }

      const svodCompPlan = rq?.competitive?.plan ?? 0;
      const svodCompFact = rq?.competitive?.fact ?? 0;
      const svodEpPlan = rq?.ep?.plan ?? 0;
      const svodEpFact = rq?.ep?.fact ?? 0;

      if (shCompPlan + shCompFact + shEpPlan + shEpFact +
          svodCompPlan + svodCompFact + svodEpPlan + svodEpFact === 0) continue;

      rows.push({
        deptId, deptName, quarter: q,
        compPlan: makeCrossCell(shCompPlan, svodCompPlan),
        compFact: makeCrossCell(shCompFact, svodCompFact),
        epPlan: makeCrossCell(shEpPlan, svodEpPlan),
        epFact: makeCrossCell(shEpFact, svodEpFact),
      });
    }
  }

  const allCells = rows.flatMap(r => [r.compPlan, r.compFact, r.epPlan, r.epFact]);
  const counts = {
    ok: allCells.filter(c => c.status === 'ok').length,
    warning: allCells.filter(c => c.status === 'warning').length,
    high: allCells.filter(c => c.status === 'high').length,
    empty: allCells.filter(c => c.status === 'empty').length,
  };

  return {
    rows,
    counts,
    overallStatus: counts.high > 0 ? 'Есть расхождения'
      : counts.warning > 0 ? 'Требует проверки' : 'Данные согласованы',
  };
}
