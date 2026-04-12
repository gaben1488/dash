import { nanoid } from 'nanoid';
import type { DataSnapshot, NormalizedMetric, Issue, ReportMapEntry, ValidationRule } from '@aemr/shared';
import { SVOD_SHEET_NAME, CHECK_REGISTRY, LEGACY_SIGNAL_TO_CHECK, LEGACY_RULE_TO_CHECK, DEPT_HEADER_ROWS, buildCellDict, isMetaRow } from '@aemr/shared';
import { ingestBatchGetResponse, ingestSheetRows } from './ingest.js';
import { normalizeMetrics } from './normalize.js';
import { classifyRows } from './classify.js';
import { validateData } from './validate.js';
import { computeDeltas } from './delta.js';
import { computeTrustScore } from '../trust/scorer.js';
import type { RecalculatedMetrics } from './recalculate.js';
import { CalcEngine, standardRowFilter } from './calc-engine.js';
import { adaptToRecalcMetrics } from './calc-engine-adapter.js';
import { detectSignals, type RowSignals } from './signals.js';

export interface PipelineInput {
  /** Ответ batchGet для официальных ячеек */
  batchGetData: Array<{
    range: string;
    values: unknown[][];
    formulas?: unknown[][];
  }>;
  /** Построчные данные листов для пересчёта */
  sheetRows: Record<string, unknown[][]>;
  /** Карта метрик */
  reportMap: ReportMapEntry[];
  /** Правила валидации */
  rules: ValidationRule[];
  /** ID таблицы */
  spreadsheetId: string;
  /** Target year for recalculation (e.g. 2026). If set, only rows from this year are counted. */
  targetYear?: number;
}

/** Map Russian short names → Latin IDs used in REPORT_MAP keys */
const SHEET_TO_DEPT_ID: Record<string, string> = {
  'УЭР': 'uer', 'УИО': 'uio', 'УАГЗО': 'uagzo', 'УФБП': 'ufbp',
  'УД': 'ud', 'УДТХ': 'udtx', 'УКСиМП': 'uksimp', 'УО': 'uo',
};

/**
 * Merge RecalculatedMetrics into the calculatedMetrics map.
 * Creates NormalizedMetric entries with keys matching REPORT_MAP:
 *   grbs.{deptId}.kp.{period}.count, grbs.{deptId}.ep.{period}.total_plan, etc.
 */
function mergeRecalcIntoMetrics(
  target: Map<string, NormalizedMetric>,
  recalc: RecalculatedMetrics,
  sheetName: string,
): void {
  const dept = SHEET_TO_DEPT_ID[sheetName] ?? sheetName.toLowerCase();
  const now = new Date().toISOString();

  function put(key: string, value: number, unit: 'rub' | 'count' | 'percent', period: string): void {
    const unitMap: Record<string, import('@aemr/shared').UnitType> = {
      rub: 'rubles', count: 'count', percent: 'percent',
    };
    const periodMap: Record<string, import('@aemr/shared').PeriodScope> = {
      q1: 'q1', q2: 'q2', q3: 'q3', q4: 'q4', year: 'annual',
    };
    target.set(key, {
      metricKey: key,
      value,
      numericValue: value,
      displayValue: unit === 'percent' ? `${(value * 100).toFixed(1)}%`
        : unit === 'rub' ? value.toLocaleString('ru-RU') + ' ₽'
        : String(Math.round(value)),
      origin: 'calculated' as const,
      period: periodMap[period] ?? 'annual',
      unit: unitMap[unit],
      sourceSheet: dept,
      sourceCell: '',
      formula: null,
      confidence: 1,
      readAt: now,
      warnings: [],
    });
  }

  // Per-quarter metrics
  for (const qk of ['q1', 'q2', 'q3', 'q4'] as const) {
    const q = recalc.quarters[qk];
    const prefix = `grbs.${dept}`;

    put(`${prefix}.kp.${qk}.count`, q.competitive.plan, 'count', qk);
    put(`${prefix}.kp.${qk}.fact`, q.competitive.fact, 'count', qk);
    put(`${prefix}.kp.${qk}.percent`, q.competitive.plan > 0 ? q.competitive.fact / q.competitive.plan : 0, 'percent', qk);
    put(`${prefix}.kp.${qk}.total_plan`, q.competitive.planSum, 'rub', qk);
    put(`${prefix}.kp.${qk}.total_fact`, q.competitive.factSum, 'rub', qk);
    put(`${prefix}.kp.${qk}.fb_plan`, q.competitive.planFB, 'rub', qk);
    put(`${prefix}.kp.${qk}.kb_plan`, q.competitive.planKB, 'rub', qk);
    put(`${prefix}.kp.${qk}.mb_plan`, q.competitive.planMB, 'rub', qk);
    put(`${prefix}.kp.${qk}.fb_fact`, q.competitive.factFB, 'rub', qk);
    put(`${prefix}.kp.${qk}.kb_fact`, q.competitive.factKB, 'rub', qk);
    put(`${prefix}.kp.${qk}.mb_fact`, q.competitive.factMB, 'rub', qk);
    // KP: deviation (F), amount_dev (P = fact−plan), savings_pct (Q = fact/plan), economy (R-U)
    put(`${prefix}.kp.${qk}.deviation`, q.competitive.fact - q.competitive.plan, 'count', qk);
    const kpAmtDev = q.competitive.factSum - q.competitive.planSum;
    put(`${prefix}.kp.${qk}.amount_dev`, kpAmtDev, 'rub', qk);
    put(`${prefix}.kp.${qk}.savings_pct`, q.competitive.planSum > 0 ? q.competitive.factSum / q.competitive.planSum : 0, 'percent', qk);
    put(`${prefix}.kp.${qk}.economy_fb`, q.competitive.economyFB, 'rub', qk);
    put(`${prefix}.kp.${qk}.economy_kb`, q.competitive.economyKB, 'rub', qk);
    put(`${prefix}.kp.${qk}.economy_mb`, q.competitive.economyMB, 'rub', qk);
    put(`${prefix}.kp.${qk}.economy_total`, q.competitive.economyTotal, 'rub', qk);
    put(`${prefix}.ep.${qk}.count`, q.ep.plan, 'count', qk);
    put(`${prefix}.ep.${qk}.fact`, q.ep.fact, 'count', qk);
    put(`${prefix}.ep.${qk}.percent`, q.ep.plan > 0 ? q.ep.fact / q.ep.plan : 0, 'percent', qk);
    put(`${prefix}.ep.${qk}.total_plan`, q.ep.planSum, 'rub', qk);
    put(`${prefix}.ep.${qk}.total_fact`, q.ep.factSum, 'rub', qk);
    put(`${prefix}.ep.${qk}.fb_plan`, q.ep.planFB, 'rub', qk);
    put(`${prefix}.ep.${qk}.kb_plan`, q.ep.planKB, 'rub', qk);
    put(`${prefix}.ep.${qk}.mb_plan`, q.ep.planMB, 'rub', qk);
    put(`${prefix}.ep.${qk}.fb_fact`, q.ep.factFB, 'rub', qk);
    put(`${prefix}.ep.${qk}.kb_fact`, q.ep.factKB, 'rub', qk);
    put(`${prefix}.ep.${qk}.mb_fact`, q.ep.factMB, 'rub', qk);
    // EP: deviation (F), amount_dev (P = fact−plan), savings_pct (Q = fact/plan), economy (R-U)
    put(`${prefix}.ep.${qk}.deviation`, q.ep.fact - q.ep.plan, 'count', qk);
    const epAmtDev = q.ep.factSum - q.ep.planSum;
    put(`${prefix}.ep.${qk}.amount_dev`, epAmtDev, 'rub', qk);
    put(`${prefix}.ep.${qk}.savings_pct`, q.ep.planSum > 0 ? q.ep.factSum / q.ep.planSum : 0, 'percent', qk);
    put(`${prefix}.ep.${qk}.economy_fb`, q.ep.economyFB, 'rub', qk);
    put(`${prefix}.ep.${qk}.economy_kb`, q.ep.economyKB, 'rub', qk);
    put(`${prefix}.ep.${qk}.economy_mb`, q.ep.economyMB, 'rub', qk);
    put(`${prefix}.ep.${qk}.economy_total`, q.ep.economyTotal, 'rub', qk);

    put(`${prefix}.${qk}.plan_count`, q.planCount, 'count', qk);
    put(`${prefix}.${qk}.fact_count`, q.factCount, 'count', qk);
    put(`${prefix}.${qk}.plan_total`, q.planTotal, 'rub', qk);
    put(`${prefix}.${qk}.fact_total`, q.factTotal, 'rub', qk);
    put(`${prefix}.${qk}.fb_plan`, q.planFB, 'rub', qk);
    put(`${prefix}.${qk}.kb_plan`, q.planKB, 'rub', qk);
    put(`${prefix}.${qk}.mb_plan`, q.planMB, 'rub', qk);
    put(`${prefix}.${qk}.fb_fact`, q.factFB, 'rub', qk);
    put(`${prefix}.${qk}.kb_fact`, q.factKB, 'rub', qk);
    put(`${prefix}.${qk}.mb_fact`, q.factMB, 'rub', qk);
    put(`${prefix}.${qk}.economy_total`, q.economyTotal, 'rub', qk);
    put(`${prefix}.${qk}.economy_fb`, q.economyFB, 'rub', qk);
    put(`${prefix}.${qk}.economy_kb`, q.economyKB, 'rub', qk);
    put(`${prefix}.${qk}.economy_mb`, q.economyMB, 'rub', qk);
    put(`${prefix}.${qk}.execution_pct`, q.executionPct, 'percent', qk);
    put(`${prefix}.${qk}.exec_count_pct`, q.execCountPct, 'percent', qk);
    put(`${prefix}.${qk}.comp_exec_count_pct`, q.compExecCountPct, 'percent', qk);
    put(`${prefix}.${qk}.ep_exec_count_pct`, q.epExecCountPct, 'percent', qk);
  }

  // Year totals
  const y = recalc.year;
  const yp = `grbs.${dept}`;
  put(`${yp}.year.plan_count`, y.planCount, 'count', 'year');
  put(`${yp}.year.fact_count`, y.factCount, 'count', 'year');
  put(`${yp}.year.plan_total`, y.planTotal, 'rub', 'year');
  put(`${yp}.year.fact_total`, y.factTotal, 'rub', 'year');
  put(`${yp}.year.fb_plan`, y.planFB, 'rub', 'year');
  put(`${yp}.year.kb_plan`, y.planKB, 'rub', 'year');
  put(`${yp}.year.mb_plan`, y.planMB, 'rub', 'year');
  put(`${yp}.year.fb_fact`, y.factFB, 'rub', 'year');
  put(`${yp}.year.kb_fact`, y.factKB, 'rub', 'year');
  put(`${yp}.year.mb_fact`, y.factMB, 'rub', 'year');
  put(`${yp}.year.economy_total`, y.economyTotal, 'rub', 'year');
  put(`${yp}.year.economy_fb`, y.economyFB, 'rub', 'year');
  put(`${yp}.year.economy_kb`, y.economyKB, 'rub', 'year');
  put(`${yp}.year.economy_mb`, y.economyMB, 'rub', 'year');
  put(`${yp}.year.execution_pct`, y.executionPct, 'percent', 'year');
  put(`${yp}.year.exec_count_pct`, y.execCountPct, 'percent', 'year');
  put(`${yp}.year.comp_exec_count_pct`, y.compExecCountPct, 'percent', 'year');
  put(`${yp}.year.ep_exec_count_pct`, y.epExecCountPct, 'percent', 'year');
  put(`${yp}.year.competitive_count`, recalc.totalCompetitive, 'count', 'year');
  put(`${yp}.year.ep_count`, recalc.totalEP, 'count', 'year');
  put(`${yp}.year.ep_share_pct`, recalc.epSharePct, 'percent', 'year');
  put(`${yp}.year.data_row_count`, recalc.dataRowCount, 'count', 'year');

  // Year-level KP/EP breakdown (matches REPORT_MAP keys) — sum across quarters
  const qs = recalc.quarters;
  const sumQ = (fn: (q: typeof qs.q1) => number) => fn(qs.q1) + fn(qs.q2) + fn(qs.q3) + fn(qs.q4);
  const kpYearPlan = qs.q1.competitive.plan + qs.q2.competitive.plan + qs.q3.competitive.plan + qs.q4.competitive.plan;
  const kpYearFact = qs.q1.competitive.fact + qs.q2.competitive.fact + qs.q3.competitive.fact + qs.q4.competitive.fact;
  const kpYearPlanSum = qs.q1.competitive.planSum + qs.q2.competitive.planSum + qs.q3.competitive.planSum + qs.q4.competitive.planSum;
  const kpYearFactSum = qs.q1.competitive.factSum + qs.q2.competitive.factSum + qs.q3.competitive.factSum + qs.q4.competitive.factSum;
  put(`${yp}.kp.year.count`, kpYearPlan, 'count', 'year');
  put(`${yp}.kp.year.fact`, kpYearFact, 'count', 'year');
  put(`${yp}.kp.year.percent`, kpYearPlan > 0 ? kpYearFact / kpYearPlan : 0, 'percent', 'year');
  put(`${yp}.kp.year.total_plan`, kpYearPlanSum, 'rub', 'year');
  put(`${yp}.kp.year.total_fact`, kpYearFactSum, 'rub', 'year');
  put(`${yp}.kp.year.deviation`, kpYearFact - kpYearPlan, 'count', 'year');
  const kpYearAmtDev = kpYearFactSum - kpYearPlanSum;
  put(`${yp}.kp.year.amount_dev`, kpYearAmtDev, 'rub', 'year');
  put(`${yp}.kp.year.savings_pct`, kpYearPlanSum > 0 ? kpYearFactSum / kpYearPlanSum : 0, 'percent', 'year');
  put(`${yp}.kp.year.economy_fb`, sumQ(q => q.competitive.economyFB), 'rub', 'year');
  put(`${yp}.kp.year.economy_kb`, sumQ(q => q.competitive.economyKB), 'rub', 'year');
  put(`${yp}.kp.year.economy_mb`, sumQ(q => q.competitive.economyMB), 'rub', 'year');
  put(`${yp}.kp.year.economy_total`, sumQ(q => q.competitive.economyTotal), 'rub', 'year');

  const epYearPlan = qs.q1.ep.plan + qs.q2.ep.plan + qs.q3.ep.plan + qs.q4.ep.plan;
  const epYearFact = qs.q1.ep.fact + qs.q2.ep.fact + qs.q3.ep.fact + qs.q4.ep.fact;
  const epYearPlanSum = qs.q1.ep.planSum + qs.q2.ep.planSum + qs.q3.ep.planSum + qs.q4.ep.planSum;
  const epYearFactSum = qs.q1.ep.factSum + qs.q2.ep.factSum + qs.q3.ep.factSum + qs.q4.ep.factSum;
  put(`${yp}.ep.year.count`, epYearPlan, 'count', 'year');
  put(`${yp}.ep.year.fact`, epYearFact, 'count', 'year');
  put(`${yp}.ep.year.percent`, epYearPlan > 0 ? epYearFact / epYearPlan : 0, 'percent', 'year');
  put(`${yp}.ep.year.total_plan`, epYearPlanSum, 'rub', 'year');
  put(`${yp}.ep.year.total_fact`, epYearFactSum, 'rub', 'year');
  put(`${yp}.ep.year.deviation`, epYearFact - epYearPlan, 'count', 'year');
  const epYearAmtDev = epYearFactSum - epYearPlanSum;
  put(`${yp}.ep.year.amount_dev`, epYearAmtDev, 'rub', 'year');
  put(`${yp}.ep.year.savings_pct`, epYearPlanSum > 0 ? epYearFactSum / epYearPlanSum : 0, 'percent', 'year');
  put(`${yp}.ep.year.economy_fb`, sumQ(q => q.ep.economyFB), 'rub', 'year');
  put(`${yp}.ep.year.economy_kb`, sumQ(q => q.ep.economyKB), 'rub', 'year');
  put(`${yp}.ep.year.economy_mb`, sumQ(q => q.ep.economyMB), 'rub', 'year');
  put(`${yp}.ep.year.economy_total`, sumQ(q => q.ep.economyTotal), 'rub', 'year');

  // ── EP total & EP percent (matches REPORT_MAP grbs.{dept}.ep.total / ep.percent) ──
  // ep.total = EP year plan count (matches SVOD column D at epYear row)
  // ep.percent = EP fact budget share: epFactSum / (kpFactSum + epFactSum)
  //   SVOD formula: G64 = O{epFactRow} / O{totalRow} (money, not counts)
  put(`${yp}.ep.total`, epYearPlan, 'count', 'year');
  const totalYearFactBudget = kpYearFactSum + epYearFactSum;
  put(`${yp}.ep.percent`, totalYearFactBudget > 0 ? epYearFactSum / totalYearFactBudget : 0, 'percent', 'year');

  // ── Year-level per-method budget breakdown ──
  put(`${yp}.kp.year.fb_plan`, sumQ(q => q.competitive.planFB), 'rub', 'year');
  put(`${yp}.kp.year.kb_plan`, sumQ(q => q.competitive.planKB), 'rub', 'year');
  put(`${yp}.kp.year.mb_plan`, sumQ(q => q.competitive.planMB), 'rub', 'year');
  put(`${yp}.kp.year.fb_fact`, sumQ(q => q.competitive.factFB), 'rub', 'year');
  put(`${yp}.kp.year.kb_fact`, sumQ(q => q.competitive.factKB), 'rub', 'year');
  put(`${yp}.kp.year.mb_fact`, sumQ(q => q.competitive.factMB), 'rub', 'year');
  put(`${yp}.ep.year.fb_plan`, sumQ(q => q.ep.planFB), 'rub', 'year');
  put(`${yp}.ep.year.kb_plan`, sumQ(q => q.ep.planKB), 'rub', 'year');
  put(`${yp}.ep.year.mb_plan`, sumQ(q => q.ep.planMB), 'rub', 'year');
  put(`${yp}.ep.year.fb_fact`, sumQ(q => q.ep.factFB), 'rub', 'year');
  put(`${yp}.ep.year.kb_fact`, sumQ(q => q.ep.factKB), 'rub', 'year');
  put(`${yp}.ep.year.mb_fact`, sumQ(q => q.ep.factMB), 'rub', 'year');

  // ── Economy per-method (matches REPORT_MAP grbs.{dept}.economy.kp / economy.ep) ──
  const ecoKP = sumQ(q => q.competitive.economyTotal);
  const ecoEP = sumQ(q => q.ep.economyTotal);
  put(`${yp}.economy.kp`, ecoKP, 'rub', 'year');
  put(`${yp}.economy.ep`, ecoEP, 'rub', 'year');
  put(`${yp}.economy.kp.fb`, sumQ(q => q.competitive.economyFB), 'rub', 'year');
  put(`${yp}.economy.kp.kb`, sumQ(q => q.competitive.economyKB), 'rub', 'year');
  put(`${yp}.economy.kp.mb`, sumQ(q => q.competitive.economyMB), 'rub', 'year');
  put(`${yp}.economy.ep.fb`, sumQ(q => q.ep.economyFB), 'rub', 'year');
  put(`${yp}.economy.ep.kb`, sumQ(q => q.ep.economyKB), 'rub', 'year');
  put(`${yp}.economy.ep.mb`, sumQ(q => q.ep.economyMB), 'rub', 'year');

  // ── Hybrid economy audit: mathematical (ungated) vs AD-approved ──
  put(`${yp}.economy.math`, recalc.economyTotalMath, 'rub', 'year');
  put(`${yp}.economy.conflicts`, recalc.conflicts, 'count', 'year');

  // Monthly metrics (m1-m12)
  if (recalc.months) {
    for (let mi = 1; mi <= 12; mi++) {
      const m = recalc.months[mi];
      if (!m || m.planCount === 0 && m.factCount === 0) continue;
      const mk = `m${mi}`;
      put(`${yp}.${mk}.plan_count`, m.planCount, 'count', 'year');
      put(`${yp}.${mk}.fact_count`, m.factCount, 'count', 'year');
      put(`${yp}.${mk}.plan_total`, m.planTotal, 'rub', 'year');
      put(`${yp}.${mk}.fact_total`, m.factTotal, 'rub', 'year');
      put(`${yp}.${mk}.fb_plan`, m.planFB, 'rub', 'year');
      put(`${yp}.${mk}.kb_plan`, m.planKB, 'rub', 'year');
      put(`${yp}.${mk}.mb_plan`, m.planMB, 'rub', 'year');
      put(`${yp}.${mk}.fb_fact`, m.factFB, 'rub', 'year');
      put(`${yp}.${mk}.kb_fact`, m.factKB, 'rub', 'year');
      put(`${yp}.${mk}.mb_fact`, m.factMB, 'rub', 'year');
      put(`${yp}.${mk}.economy_total`, m.economyTotal, 'rub', 'year');
      put(`${yp}.${mk}.economy_fb`, m.economyFB, 'rub', 'year');
      put(`${yp}.${mk}.economy_kb`, m.economyKB, 'rub', 'year');
      put(`${yp}.${mk}.economy_mb`, m.economyMB, 'rub', 'year');
      put(`${yp}.${mk}.execution_pct`, m.executionPct, 'percent', 'year');
      put(`${yp}.${mk}.exec_count_pct`, m.execCountPct, 'percent', 'year');
      put(`${yp}.${mk}.comp_exec_count_pct`, m.compExecCountPct, 'percent', 'year');
      put(`${yp}.${mk}.ep_exec_count_pct`, m.epExecCountPct, 'percent', 'year');
      put(`${yp}.kp.${mk}.count`, m.competitive.plan, 'count', 'year');
      put(`${yp}.kp.${mk}.fact`, m.competitive.fact, 'count', 'year');
      put(`${yp}.kp.${mk}.total_plan`, m.competitive.planSum, 'rub', 'year');
      put(`${yp}.kp.${mk}.total_fact`, m.competitive.factSum, 'rub', 'year');
      put(`${yp}.ep.${mk}.count`, m.ep.plan, 'count', 'year');
      put(`${yp}.ep.${mk}.fact`, m.ep.fact, 'count', 'year');
      put(`${yp}.ep.${mk}.total_plan`, m.ep.planSum, 'rub', 'year');
      put(`${yp}.ep.${mk}.total_fact`, m.ep.factSum, 'rub', 'year');
    }
  }
}

/** All department IDs for aggregation */
const ALL_DEPT_IDS = Object.values(SHEET_TO_DEPT_ID);

/**
 * Aggregate per-department calculated metrics into summary-level keys
 * (competitive.q1.count, sole.year.total_plan, etc.) so that
 * computeDeltas can compare them against official СВОД summary cells.
 */
function mergeSummaryMetrics(target: Map<string, NormalizedMetric>): void {
  const now = new Date().toISOString();

  function getVal(key: string): number {
    return target.get(key)?.numericValue ?? 0;
  }

  function putSummary(key: string, value: number, unit: 'rub' | 'count' | 'percent', period: string): void {
    const unitMap: Record<string, import('@aemr/shared').UnitType> = {
      rub: 'rubles', count: 'count', percent: 'percent',
    };
    const periodMap: Record<string, import('@aemr/shared').PeriodScope> = {
      q1: 'q1', q2: 'q2', q3: 'q3', q4: 'q4', year: 'annual',
    };
    target.set(key, {
      metricKey: key,
      value,
      numericValue: value,
      displayValue: unit === 'percent' ? `${(value * 100).toFixed(1)}%`
        : unit === 'rub' ? value.toLocaleString('ru-RU') + ' ₽'
        : String(Math.round(value)),
      origin: 'calculated' as const,
      period: periodMap[period] ?? 'annual',
      unit: unitMap[unit],
      sourceSheet: 'summary',
      sourceCell: '',
      formula: null,
      confidence: 1,
      readAt: now,
      warnings: [],
    });
  }

  // Aggregate for all periods (matching REPORT_MAP summary entries)
  for (const p of ['q1', 'q2', 'q3', 'q4', 'year'] as const) {
    let kpCount = 0, kpFact = 0, kpPlanTotal = 0, kpFactTotal = 0;
    let kpFbPlan = 0, kpKbPlan = 0, kpMbPlan = 0;
    let kpFbFact = 0, kpKbFact = 0, kpMbFact = 0;
    let kpEcoFb = 0, kpEcoKb = 0, kpEcoMb = 0, kpEcoTotal = 0;
    let epCount = 0, epFact = 0, epPlanTotal = 0, epFactTotal = 0;
    let epFbPlan = 0, epKbPlan = 0, epMbPlan = 0;
    let epFbFact = 0, epKbFact = 0, epMbFact = 0;
    let epEcoFb = 0, epEcoKb = 0, epEcoMb = 0, epEcoTotal = 0;

    for (const dept of ALL_DEPT_IDS) {
      const pfx = `grbs.${dept}`;
      kpCount += getVal(`${pfx}.kp.${p}.count`);
      kpFact += getVal(`${pfx}.kp.${p}.fact`);
      kpPlanTotal += getVal(`${pfx}.kp.${p}.total_plan`);
      kpFactTotal += getVal(`${pfx}.kp.${p}.total_fact`);
      epCount += getVal(`${pfx}.ep.${p}.count`);
      epFact += getVal(`${pfx}.ep.${p}.fact`);
      epPlanTotal += getVal(`${pfx}.ep.${p}.total_plan`);
      epFactTotal += getVal(`${pfx}.ep.${p}.total_fact`);

      kpFbPlan += getVal(`${pfx}.kp.${p}.fb_plan`);
      kpKbPlan += getVal(`${pfx}.kp.${p}.kb_plan`);
      kpMbPlan += getVal(`${pfx}.kp.${p}.mb_plan`);
      kpFbFact += getVal(`${pfx}.kp.${p}.fb_fact`);
      kpKbFact += getVal(`${pfx}.kp.${p}.kb_fact`);
      kpMbFact += getVal(`${pfx}.kp.${p}.mb_fact`);
      kpEcoFb += getVal(`${pfx}.kp.${p}.economy_fb`);
      kpEcoKb += getVal(`${pfx}.kp.${p}.economy_kb`);
      kpEcoMb += getVal(`${pfx}.kp.${p}.economy_mb`);
      kpEcoTotal += getVal(`${pfx}.kp.${p}.economy_total`);

      epFbPlan += getVal(`${pfx}.ep.${p}.fb_plan`);
      epKbPlan += getVal(`${pfx}.ep.${p}.kb_plan`);
      epMbPlan += getVal(`${pfx}.ep.${p}.mb_plan`);
      epFbFact += getVal(`${pfx}.ep.${p}.fb_fact`);
      epKbFact += getVal(`${pfx}.ep.${p}.kb_fact`);
      epMbFact += getVal(`${pfx}.ep.${p}.mb_fact`);
      epEcoFb += getVal(`${pfx}.ep.${p}.economy_fb`);
      epEcoKb += getVal(`${pfx}.ep.${p}.economy_kb`);
      epEcoMb += getVal(`${pfx}.ep.${p}.economy_mb`);
      epEcoTotal += getVal(`${pfx}.ep.${p}.economy_total`);
    }

    // Competitive (КП)
    putSummary(`competitive.${p}.count`, kpCount, 'count', p);
    putSummary(`competitive.${p}.fact_count`, kpFact, 'count', p);
    // СВОД column F = fact_count − plan_count (negative when plan > fact)
    const kpDeviation = kpFact - kpCount;
    putSummary(`competitive.${p}.deviation`, kpDeviation, 'count', p);
    putSummary(`competitive.${p}.percent`, kpCount > 0 ? kpFact / kpCount : 0, 'percent', p);
    putSummary(`competitive.${p}.total_plan`, kpPlanTotal, 'rub', p);
    putSummary(`competitive.${p}.total_fact`, kpFactTotal, 'rub', p);

    putSummary(`competitive.${p}.fb_plan`, kpFbPlan, 'rub', p);
    putSummary(`competitive.${p}.kb_plan`, kpKbPlan, 'rub', p);
    putSummary(`competitive.${p}.mb_plan`, kpMbPlan, 'rub', p);
    putSummary(`competitive.${p}.fb_fact`, kpFbFact, 'rub', p);
    putSummary(`competitive.${p}.kb_fact`, kpKbFact, 'rub', p);
    putSummary(`competitive.${p}.mb_fact`, kpMbFact, 'rub', p);
    const kpAmtDev = kpFactTotal - kpPlanTotal;
    putSummary(`competitive.${p}.amount_dev`, kpAmtDev, 'rub', p);
    putSummary(`competitive.${p}.savings_pct`, kpPlanTotal > 0 ? kpFactTotal / kpPlanTotal : 0, 'percent', p);
    putSummary(`competitive.${p}.economy_fb`, kpEcoFb, 'rub', p);
    putSummary(`competitive.${p}.economy_kb`, kpEcoKb, 'rub', p);
    putSummary(`competitive.${p}.economy_mb`, kpEcoMb, 'rub', p);
    putSummary(`competitive.${p}.economy_total`, kpEcoTotal, 'rub', p);

    // Sole (ЕП)
    putSummary(`sole.${p}.count`, epCount, 'count', p);
    putSummary(`sole.${p}.fact_count`, epFact, 'count', p);
    const epDeviation = epFact - epCount;
    putSummary(`sole.${p}.deviation`, epDeviation, 'count', p);
    putSummary(`sole.${p}.percent`, epCount > 0 ? epFact / epCount : 0, 'percent', p);
    putSummary(`sole.${p}.total_plan`, epPlanTotal, 'rub', p);
    putSummary(`sole.${p}.total_fact`, epFactTotal, 'rub', p);
    putSummary(`sole.${p}.fb_plan`, epFbPlan, 'rub', p);
    putSummary(`sole.${p}.kb_plan`, epKbPlan, 'rub', p);
    putSummary(`sole.${p}.mb_plan`, epMbPlan, 'rub', p);
    putSummary(`sole.${p}.fb_fact`, epFbFact, 'rub', p);
    putSummary(`sole.${p}.kb_fact`, epKbFact, 'rub', p);
    putSummary(`sole.${p}.mb_fact`, epMbFact, 'rub', p);
    const epAmtDev = epFactTotal - epPlanTotal;
    putSummary(`sole.${p}.amount_dev`, epAmtDev, 'rub', p);
    putSummary(`sole.${p}.savings_pct`, epPlanTotal > 0 ? epFactTotal / epPlanTotal : 0, 'percent', p);
    putSummary(`sole.${p}.economy_fb`, epEcoFb, 'rub', p);
    putSummary(`sole.${p}.economy_kb`, epEcoKb, 'rub', p);
    putSummary(`sole.${p}.economy_mb`, epEcoMb, 'rub', p);
    putSummary(`sole.${p}.economy_total`, epEcoTotal, 'rub', p);
  }
}

/**
 * Главный оркестратор пайплайна обработки данных.
 *
 * Последовательность:
 * 1. Ingest — приём сырых данных
 * 2. Normalize — нормализация типов и значений
 * 3. Classify — классификация строк
 * 4. Validate — проверка по правилам
 * 5. Delta — сравнение official vs calculated
 * 6. Trust — вычисление скоринга доверия
 */
export function runPipeline(input: PipelineInput): DataSnapshot {
  const pipelineStart = Date.now();
  const snapshotId = nanoid();

  // 1. Ingest: официальные ячейки
  const ingestResult = ingestBatchGetResponse(input.batchGetData, input.reportMap);

  // 2. Normalize: официальные метрики
  const officialMetrics = normalizeMetrics(ingestResult.cells, input.reportMap);

  // 3. Classify + Validate: построчно по листам
  const allIssues: Issue[] = [];
  let totalRows = 0;
  const perSheetRowCount: Record<string, number> = {};
  const calculatedMetrics = new Map<string, NormalizedMetric>();
  const recalcResults: Record<string, RecalculatedMetrics> = {};
  const engine = new CalcEngine();

  for (const [sheetName, rows] of Object.entries(input.sheetRows)) {
    const deptId = SHEET_TO_DEPT_ID[sheetName] ?? sheetName.toLowerCase();
    const ingested = ingestSheetRows(sheetName, rows);
    const classified = classifyRows(sheetName, ingested);
    totalRows += classified.length;
    perSheetRowCount[sheetName] = classified.length;

    // Валидация строк
    const sheetIssues = validateData(officialMetrics, classified, input.rules, input.reportMap);
    allIssues.push(...sheetIssues);

    // Signal detection + CalcEngine only for department sheets (СВОД has different column layout)
    if (sheetName !== SVOD_SHEET_NAME) {
      const signalIssues = detectSignalsToIssues(sheetName, rows as unknown[][], deptId);
      allIssues.push(...signalIssues);

      // Аналитический пересчёт из строк через CalcEngine (filter by target year to match СВОД scope)
      const grouped = engine.compute(rows as unknown[][], standardRowFilter, 3, input.targetYear);
      const recalc = adaptToRecalcMetrics(grouped, sheetName);
      mergeRecalcIntoMetrics(calculatedMetrics, recalc, sheetName);
      recalcResults[deptId] = recalc;
    }
  }

  // Добавляем ошибки ингеста
  for (const err of ingestResult.errors) {
    allIssues.push({
      id: nanoid(),
      severity: 'significant',
      origin: 'runtime_error',
      category: 'ingest_error',
      title: `Ошибка чтения: ${err.cell}`,
      description: err.error,
      status: 'open',
      detectedAt: ingestResult.readAt,
      detectedBy: 'pipeline:ingest',
    });
  }

  // 4b. Aggregate summary-level calculated metrics (competitive.*, sole.*)
  // These sum across all departments to match REPORT_MAP summary keys.
  mergeSummaryMetrics(calculatedMetrics);

  // 5. Delta
  const deltas = computeDeltas(officialMetrics, calculatedMetrics, input.reportMap);

  // 6. Trust
  const trust = computeTrustScore(officialMetrics, allIssues, deltas, snapshotId);

  return {
    id: snapshotId,
    spreadsheetId: input.spreadsheetId,
    createdAt: new Date().toISOString(),
    officialMetrics: Object.fromEntries(officialMetrics),
    calculatedMetrics: Object.fromEntries(calculatedMetrics),
    deltas,
    issues: allIssues,
    trust,
    rowCount: totalRows,
    recalcResults,
    metadata: {
      sheetsRead: ingestResult.sheets,
      cellsRead: ingestResult.cells.size,
      readDurationMs: ingestResult.durationMs,
      pipelineDurationMs: Date.now() - pipelineStart,
      perSheetRowCount,
    },
  };
}

// ────────────────────────────────────────────────────────────
// Signal → Issue conversion
// ────────────────────────────────────────────────────────────

/** Build signal→metadata map from CHECK_REGISTRY (single source of truth) */
const SIGNAL_ISSUE_MAP: Record<string, {
  severity: Issue['severity']; title: string; recommendation: string;
  checkId: string; group: string; kbHint: string;
}> = (() => {
  const map: Record<string, { severity: Issue['severity']; title: string; recommendation: string; checkId: string; group: string; kbHint: string }> = {};
  // Map legacy signal keys → CHECK_REGISTRY entries
  for (const [signalKey, checkId] of Object.entries(LEGACY_SIGNAL_TO_CHECK)) {
    const check = CHECK_REGISTRY.find(c => c.id === checkId);
    if (check) {
      map[signalKey] = {
        severity: check.severity as Issue['severity'],
        title: check.name,
        recommendation: check.recommendation,
        checkId: check.id,
        group: check.group,
        kbHint: check.kbHint,
      };
    }
  }
  // financeDelay теперь в CHECK_REGISTRY → маппится автоматически через LEGACY_SIGNAL_TO_CHECK
  return map;
})();

function detectSignalsToIssues(sheetName: string, rows: unknown[][], deptId: string): Issue[] {
  const issues: Issue[] = [];
  const now = new Date().toISOString();

  // Skip header rows — they are always headers in department sheets
  for (let r = DEPT_HEADER_ROWS; r < rows.length; r++) {
    const row = rows[r] as unknown[];
    if (!row || row.length < 5) continue;

    const cells = buildCellDict(row);

    // Skip non-data rows: summaries ("Итого"/"Всего"), separators
    const nameCell = String(cells['C'] ?? cells['D'] ?? '').trim();
    if (isMetaRow(nameCell)) continue;
    // Skip rows where all cells are empty (separators)
    const allEmpty = Object.values(cells).every(v => v === null || v === undefined || v === '');
    if (allEmpty) continue;

    let signals: RowSignals;
    try {
      signals = detectSignals(cells);
    } catch {
      continue;
    }

    const subject = String(cells['G'] ?? cells['D'] ?? '').slice(0, 80);
    // Column C = subordinate org; empty = org itself
    const subordinateId = String(cells['C'] ?? '').trim() || '_org_itself';

    for (const [signalKey, meta] of Object.entries(SIGNAL_ISSUE_MAP)) {
      if (signals[signalKey as keyof RowSignals] !== true) continue;

      issues.push({
        id: nanoid(),
        severity: meta.severity,
        origin: 'bi_heuristic',
        category: `signal:${signalKey}`,
        signal: signalKey,
        group: meta.group,
        checkId: meta.checkId,
        kbHint: meta.kbHint,
        title: `${meta.title}: ${subject || `строка ${r + 1}`}`,
        description: `${sheetName}, строка ${r + 1}${subject ? `: ${subject}` : ''}`,
        sheet: sheetName,
        row: r + 1,
        departmentId: deptId,
        subordinateId,
        recommendation: meta.recommendation,
        status: 'open',
        detectedAt: now,
        detectedBy: `pipeline:signal:${signalKey}`,
      });
    }
  }

  return issues;
}
