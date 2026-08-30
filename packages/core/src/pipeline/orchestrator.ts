import { nanoid } from 'nanoid';
import { issueIdentity, nextOccurrence, SEP } from './issue-identity.js';
import type { DataSnapshot, NormalizedMetric, Issue, ReportMapEntry, ValidationRule } from '@aemr/shared';
import { SVOD_SHEET_NAME, CHECK_REGISTRY, LEGACY_SIGNAL_TO_CHECK, issueSuppressedByRowClass, epRiskStrictnessOfReason, DEPT_HEADER_ROWS, buildCellDict, checkDeptHeaderGeometry, collectRowsByDept, isMetaRow, parseSvodGrid, CYRILLIC_TO_LATIN, findDept, subordinateKey, formulaErrorCells } from '@aemr/shared';
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
import { formulaIntegrityIssues } from './formula-integrity.js';
import { analyzeDataset, type DatasetAnalysis } from './dataset-signals.js';

export interface PipelineInput {
  /** Ответ batchGet для официальных ячеек */
  batchGetData: Array<{
    range: string;
    values: unknown[][];
    formulas?: unknown[][];
  }>;
  /** Построчные данные листов для пересчёта */
  sheetRows: Record<string, unknown[][]>;
  /**
   * Формулы формульных граф книг ГРБС по листам — сетка той же геометрии, что
   * `sheetRows` (`[строка][колонка листа]`, колонка 0 = A). Так её и отдаёт
   * чтение сервера (`getSheetFormulaColumns`).
   *
   * ОТСУТСТВИЕ КЛЮЧА И ПУСТАЯ СЕТКА ЗНАЧАТ ОДНО: формулы НЕ ЧИТАЛИ. Это не
   * «дефектов нет»: формулы читаются по вебхуку и в ночном обходе (решение
   * владельца §22 п.7), а быстрое плановое обновление за них не платит — и
   * не имеет права выдавать своё молчание за чистую книгу.
   */
  sheetFormulas?: Record<string, unknown[][]>;
  /** Карта метрик */
  reportMap: ReportMapEntry[];
  /** Правила валидации */
  rules: ValidationRule[];
  /** ID таблицы */
  spreadsheetId: string;
  /** Target year for recalculation (e.g. 2026). If set, only rows from this year are counted. */
  targetYear?: number;
  /**
   * Год, за который считает официальный лист СВОД. Нужен сверке: расчёт
   * без года суммирует все годы книги, лист — только свой, и вычитать их
   * друг из друга нельзя (Д21). Неизвестен — сверка ведёт себя как раньше.
   */
  officialYear?: number;
}

/**
 * Единица и период метрики — две неизменные таблицы соответствия.
 * SIMPLIFY_REGISTER_2026-06-05 §C1: оба литерала лежали внутри put() и
 * putSummary() и пересобирались на каждую записанную метрику (десятки тысяч
 * раз за прогон). Содержимое дословно прежнее, замок — orchestrator-summary.test.ts
 * «C1 — разметка единиц и периода у метрик оркестратора».
 */
const METRIC_UNIT: Record<string, import('@aemr/shared').UnitType> = {
  rub: 'rubles', count: 'count', percent: 'percent',
};
const METRIC_PERIOD: Record<string, import('@aemr/shared').PeriodScope> = {
  q1: 'q1', q2: 'q2', q3: 'q3', q4: 'q4', year: 'annual',
};

/** Map Russian short names → Latin IDs used in REPORT_MAP keys.
 *  Delegates to canonical CYRILLIC_TO_LATIN from department-registry. */
const SHEET_TO_DEPT_ID: Record<string, string> = { ...CYRILLIC_TO_LATIN };

/**
 * Канон резолва ГРБС-листа (блок А п.4 пирамиды): реестр → latinId; лист,
 * которого реестр не знает (ШДЮ, служебный, переименованный), → null и
 * ЧЕСТНЫЙ ПРОПУСК аналитики — как attachUnifiedGrid на сервере. Прежний
 * фолбэк sheetName.toLowerCase() плодил фантомный «ГРБС», который дальше
 * нигде не матчился (тихий дроп блока).
 */
function sheetDeptId(sheetName: string): string | null {
  return SHEET_TO_DEPT_ID[sheetName] ?? findDept(sheetName)?.latinId ?? null;
}

/**
 * Merge RecalculatedMetrics into the calculatedMetrics map.
 * Creates NormalizedMetric entries with keys matching REPORT_MAP:
 *   grbs.{deptId}.kp.{period}.count, grbs.{deptId}.ep.{period}.total_plan, etc.
 */
function mergeRecalcIntoMetrics(
  target: Map<string, NormalizedMetric>,
  recalc: RecalculatedMetrics,
  dept: string,
): void {
  const now = new Date().toISOString();

  /**
   * Доля от знаменателя: `null` = базы нет (лист печатает прочерк). Единая
   * дверь всех процентов оркестратора — прежние `x > 0 ? a/b : 0` по всему
   * файлу выдавали «исполнение 0 %» там, где плана попросту не было, и
   * управление получало за это штраф (реестр расхождений 08.08 §2).
   */
  function ratio(part: number, whole: number): number | null {
    return whole > 0 ? part / whole : null;
  }

  /**
   * Метрика с нулевым знаменателем НЕ материализуется: отсутствие ключа —
   * честная пустота, тогда как ключ со значением 0 неотличим от «посчитано и
   * вышло ноль» и уходит в сверку как настоящее число. Тот же приём, что у
   * помесячного свода ниже.
   */
  function put(key: string, value: number | null, unit: 'rub' | 'count' | 'percent', period: string): void {
    if (value === null) return;
    target.set(key, {
      metricKey: key,
      value,
      numericValue: value,
      displayValue: unit === 'percent' ? `${(value * 100).toFixed(1)}%`
        : unit === 'rub' ? value.toLocaleString('ru-RU') + ' ₽'
        : String(Math.round(value)),
      origin: 'calculated' as const,
      period: METRIC_PERIOD[period] ?? 'annual',
      unit: METRIC_UNIT[unit],
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
    put(`${prefix}.kp.${qk}.percent`, ratio(q.competitive.fact, q.competitive.plan), 'percent', qk);
    put(`${prefix}.kp.${qk}.total_plan`, q.competitive.planSum, 'rub', qk);
    put(`${prefix}.kp.${qk}.total_fact`, q.competitive.factSum, 'rub', qk);
    put(`${prefix}.kp.${qk}.fb_plan`, q.competitive.planFB, 'rub', qk);
    put(`${prefix}.kp.${qk}.kb_plan`, q.competitive.planKB, 'rub', qk);
    put(`${prefix}.kp.${qk}.mb_plan`, q.competitive.planMB, 'rub', qk);
    put(`${prefix}.kp.${qk}.fb_fact`, q.competitive.factFB, 'rub', qk);
    put(`${prefix}.kp.${qk}.kb_fact`, q.competitive.factKB, 'rub', qk);
    put(`${prefix}.kp.${qk}.mb_fact`, q.competitive.factMB, 'rub', qk);
    // KP: deviation (F), amount_dev (P = fact−plan, как лист СВОД), savings_pct (Q = fact/plan), economy (R-U)
    put(`${prefix}.kp.${qk}.deviation`, q.competitive.fact - q.competitive.plan, 'count', qk);
    const kpAmtDev = q.competitive.factSum - q.competitive.planSum;
    put(`${prefix}.kp.${qk}.amount_dev`, kpAmtDev, 'rub', qk);
    put(`${prefix}.kp.${qk}.savings_pct`, ratio(q.competitive.factSum, q.competitive.planSum), 'percent', qk);
    put(`${prefix}.kp.${qk}.economy_fb`, q.competitive.economyFB, 'rub', qk);
    put(`${prefix}.kp.${qk}.economy_kb`, q.competitive.economyKB, 'rub', qk);
    put(`${prefix}.kp.${qk}.economy_mb`, q.competitive.economyMB, 'rub', qk);
    put(`${prefix}.kp.${qk}.economy_total`, q.competitive.economyTotal, 'rub', qk);
    put(`${prefix}.ep.${qk}.count`, q.ep.plan, 'count', qk);
    put(`${prefix}.ep.${qk}.fact`, q.ep.fact, 'count', qk);
    put(`${prefix}.ep.${qk}.percent`, ratio(q.ep.fact, q.ep.plan), 'percent', qk);
    put(`${prefix}.ep.${qk}.total_plan`, q.ep.planSum, 'rub', qk);
    put(`${prefix}.ep.${qk}.total_fact`, q.ep.factSum, 'rub', qk);
    put(`${prefix}.ep.${qk}.fb_plan`, q.ep.planFB, 'rub', qk);
    put(`${prefix}.ep.${qk}.kb_plan`, q.ep.planKB, 'rub', qk);
    put(`${prefix}.ep.${qk}.mb_plan`, q.ep.planMB, 'rub', qk);
    put(`${prefix}.ep.${qk}.fb_fact`, q.ep.factFB, 'rub', qk);
    put(`${prefix}.ep.${qk}.kb_fact`, q.ep.factKB, 'rub', qk);
    put(`${prefix}.ep.${qk}.mb_fact`, q.ep.factMB, 'rub', qk);
    // EP: deviation (F), amount_dev (P = fact−plan, как лист СВОД), savings_pct (Q = fact/plan), economy (R-U)
    put(`${prefix}.ep.${qk}.deviation`, q.ep.fact - q.ep.plan, 'count', qk);
    const epAmtDev = q.ep.factSum - q.ep.planSum;
    put(`${prefix}.ep.${qk}.amount_dev`, epAmtDev, 'rub', qk);
    put(`${prefix}.ep.${qk}.savings_pct`, ratio(q.ep.factSum, q.ep.planSum), 'percent', qk);
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
  put(`${yp}.kp.year.percent`, ratio(kpYearFact, kpYearPlan), 'percent', 'year');
  put(`${yp}.kp.year.total_plan`, kpYearPlanSum, 'rub', 'year');
  put(`${yp}.kp.year.total_fact`, kpYearFactSum, 'rub', 'year');
  put(`${yp}.kp.year.deviation`, kpYearFact - kpYearPlan, 'count', 'year');
  const kpYearAmtDev = kpYearFactSum - kpYearPlanSum;
  put(`${yp}.kp.year.amount_dev`, kpYearAmtDev, 'rub', 'year');
  put(`${yp}.kp.year.savings_pct`, ratio(kpYearFactSum, kpYearPlanSum), 'percent', 'year');
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
  put(`${yp}.ep.year.percent`, ratio(epYearFact, epYearPlan), 'percent', 'year');
  put(`${yp}.ep.year.total_plan`, epYearPlanSum, 'rub', 'year');
  put(`${yp}.ep.year.total_fact`, epYearFactSum, 'rub', 'year');
  put(`${yp}.ep.year.deviation`, epYearFact - epYearPlan, 'count', 'year');
  const epYearAmtDev = epYearFactSum - epYearPlanSum;
  put(`${yp}.ep.year.amount_dev`, epYearAmtDev, 'rub', 'year');
  put(`${yp}.ep.year.savings_pct`, ratio(epYearFactSum, epYearPlanSum), 'percent', 'year');
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
  put(`${yp}.ep.percent`, ratio(epYearFactSum, totalYearFactBudget), 'percent', 'year');

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
      if (!m || (m.planCount === 0 && m.factCount === 0)) continue;
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

  /** Доля свода — то же правило, что и у put(): нет базы, нет числа. */
  function ratioSummary(part: number, whole: number): number | null {
    return whole > 0 ? part / whole : null;
  }

  function putSummary(key: string, value: number | null, unit: 'rub' | 'count' | 'percent', period: string): void {
    if (value === null) return;
    target.set(key, {
      metricKey: key,
      value,
      numericValue: value,
      displayValue: unit === 'percent' ? `${(value * 100).toFixed(1)}%`
        : unit === 'rub' ? value.toLocaleString('ru-RU') + ' ₽'
        : String(Math.round(value)),
      origin: 'calculated' as const,
      period: METRIC_PERIOD[period] ?? 'annual',
      unit: METRIC_UNIT[unit],
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
    putSummary(`competitive.${p}.percent`, ratioSummary(kpFact, kpCount), 'percent', p);
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
    putSummary(`competitive.${p}.savings_pct`, ratioSummary(kpFactTotal, kpPlanTotal), 'percent', p);
    putSummary(`competitive.${p}.economy_fb`, kpEcoFb, 'rub', p);
    putSummary(`competitive.${p}.economy_kb`, kpEcoKb, 'rub', p);
    putSummary(`competitive.${p}.economy_mb`, kpEcoMb, 'rub', p);
    putSummary(`competitive.${p}.economy_total`, kpEcoTotal, 'rub', p);

    // Sole (ЕП)
    putSummary(`sole.${p}.count`, epCount, 'count', p);
    putSummary(`sole.${p}.fact_count`, epFact, 'count', p);
    const epDeviation = epFact - epCount;
    putSummary(`sole.${p}.deviation`, epDeviation, 'count', p);
    putSummary(`sole.${p}.percent`, ratioSummary(epFact, epCount), 'percent', p);
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
    putSummary(`sole.${p}.savings_pct`, ratioSummary(epFactTotal, epPlanTotal), 'percent', p);
    putSummary(`sole.${p}.economy_fb`, epEcoFb, 'rub', p);
    putSummary(`sole.${p}.economy_kb`, epEcoKb, 'rub', p);
    putSummary(`sole.${p}.economy_mb`, epEcoMb, 'rub', p);
    putSummary(`sole.${p}.economy_total`, epEcoTotal, 'rub', p);
  }

  // Помесячный свод района (пирамида агрегации §4.2, gap №3).
  //
  // Ключи grbs.{dept}.kp.m{N}.* конвейер писал с 2026-06, но свод их не
  // складывал: цикл выше идёт только по кварталам и году. Из-за этого
  // помесячный разрез существовал у каждого ГРБС и НЕ существовал у района
  // — сравнить месяц района с листом было не с чем.
  //
  // Складываем ровно те четыре меры, которые несут месячные ключи ГРБС
  // (счёт и деньги по КП и ЕП): побюджетной разбивки и экономии на этом
  // ярусе у ГРБС нет, и досчитывать её здесь значило бы завести вторую
  // семантику месяца.
  for (let mi = 1; mi <= 12; mi++) {
    const mk = `m${mi}`;
    let kpCount = 0, kpFact = 0, kpPlanTotal = 0, kpFactTotal = 0;
    let epCount = 0, epFact = 0, epPlanTotal = 0, epFactTotal = 0;

    for (const dept of ALL_DEPT_IDS) {
      const pfx = `grbs.${dept}`;
      kpCount += getVal(`${pfx}.kp.${mk}.count`);
      kpFact += getVal(`${pfx}.kp.${mk}.fact`);
      kpPlanTotal += getVal(`${pfx}.kp.${mk}.total_plan`);
      kpFactTotal += getVal(`${pfx}.kp.${mk}.total_fact`);
      epCount += getVal(`${pfx}.ep.${mk}.count`);
      epFact += getVal(`${pfx}.ep.${mk}.fact`);
      epPlanTotal += getVal(`${pfx}.ep.${mk}.total_plan`);
      epFactTotal += getVal(`${pfx}.ep.${mk}.total_fact`);
    }

    // Месяц без единой строки во всех ГРБС не материализуется: нулевой
    // ключ неотличим от «посчитано и вышло ноль» (канон честной пустоты).
    if (kpCount + kpFact + kpPlanTotal + kpFactTotal
      + epCount + epFact + epPlanTotal + epFactTotal === 0) continue;

    putSummary(`competitive.${mk}.count`, kpCount, 'count', mk);
    putSummary(`competitive.${mk}.fact_count`, kpFact, 'count', mk);
    putSummary(`competitive.${mk}.total_plan`, kpPlanTotal, 'rub', mk);
    putSummary(`competitive.${mk}.total_fact`, kpFactTotal, 'rub', mk);
    putSummary(`sole.${mk}.count`, epCount, 'count', mk);
    putSummary(`sole.${mk}.fact_count`, epFact, 'count', mk);
    putSummary(`sole.${mk}.total_plan`, epPlanTotal, 'rub', mk);
    putSummary(`sole.${mk}.total_fact`, epFactTotal, 'rub', mk);
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

/**
 * Снимок, каким его отдаёт ИМЕННО этот конвейер.
 *
 * В общем типе `DataSnapshot` поля `recalcResults` и `datasetAnalyses`
 * объявлены как «словарь чего-то неизвестного», и это не небрежность: пакет
 * `shared` лежит НИЖЕ ядра и о его расчётных типах знать не может — иначе
 * зависимость пойдёт по кругу. Раньше на этом месте стоял `any`, то есть
 * «проверять нечего»; теперь стоит `unknown` — «шаг наружу требует разбора».
 *
 * Здесь, внутри ядра, форма как раз известна, поэтому конвейер возвращает
 * уточнённый тип: читатель ядра работает с настоящими `DatasetAnalysis` и
 * `RecalculatedMetrics` без приведения типов, а внешний читатель по-прежнему
 * видит честное «разберись сам».
 */
export interface PipelineSnapshot extends DataSnapshot {
  recalcResults?: Record<string, RecalculatedMetrics>;
  datasetAnalyses?: Record<string, DatasetAnalysis>;
}

export function runPipeline(input: PipelineInput): PipelineSnapshot {
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
  // Сигналы строк по ГРБС — один прогон detectSignals на лист (блок А п.3),
  // переиспользуются в dataset-анализе 4b.
  const sheetSignalsByDept: Record<string, ReturnType<typeof detectSheetSignals>> = {};
  const engine = new CalcEngine();

  for (const [sheetName, rows] of Object.entries(input.sheetRows)) {
    const deptId = sheetDeptId(sheetName); // null = не-ГРБС лист (СВОД/служебный)
    const ingested = ingestSheetRows(rows);
    const classified = classifyRows(sheetName, ingested);
    totalRows += classified.length;
    perSheetRowCount[sheetName] = classified.length;

    // Валидация строк
    const sheetIssues = validateData(officialMetrics, classified, input.rules, input.reportMap);
    allIssues.push(...sheetIssues);

    // Signal detection + CalcEngine only for department sheets (СВОД has
    // different column layout). deptId === null — лист не из реестра ГРБС:
    // аналитика честно пропускается (канон attachUnifiedGrid), а не
    // вешается на фантомный lowercase-идентификатор.
    if (sheetName !== SVOD_SHEET_NAME && deptId !== null) {
      // Геометрия шапки проверяется ПЕРВОЙ: если столбцы съехали, все числа
      // ниже посчитаны не из тех колонок, и об этом надо сказать прежде,
      // чем показывать их как показатели управления (реестр багов
      // 09.07.2026, п.11).
      const headerIssue = headerGeometryIssue(sheetName, deptId, rows as unknown[][]);
      if (headerIssue) allIssues.push(headerIssue);

      // Сигналы строк считаются ОДИН раз на лист (блок А п.3): отсюда же
      // их берёт dataset-анализ 4b — второго прогона detectSignals нет.
      const sheetSignals = detectSheetSignals(rows as unknown[][]);
      sheetSignalsByDept[deptId] = sheetSignals;
      const signalIssues = detectSignalsToIssues(sheetName, sheetSignals, deptId);
      allIssues.push(...signalIssues);

      // Целостность формул книги — судится НОСИТЕЛЬ (ячейка формульной графы),
      // а не смысл строки, поэтому отдельным слоем. Слой сам молчит, когда
      // формул не читали; `startRow: 1` — договор чтения: обе сетки начинаются
      // с первой строки листа (google-sheets.ts, DeptSheetResult.startRow).
      allIssues.push(...formulaIntegrityIssues({
        book: sheetName,
        values: rows as unknown[][],
        formulas: input.sheetFormulas?.[sheetName] ?? [],
        startRow: 1,
      }, deptId));

      // Аналитический пересчёт из строк через CalcEngine (filter by target year to match СВОД scope)
      const grouped = engine.compute(rows as unknown[][], standardRowFilter, 3, input.targetYear);
      // Строки, не дошедшие до счёта, обязаны быть названы (реестр багов
      // 09.07.2026, п.6): счётчик droppedRows появился, но его никто не читал —
      // молчание осталось прежним.
      const dropIssue = droppedRowsIssue(
        sheetName,
        deptId,
        grouped.droppedRows,
        (rows as unknown[][]).length - DEPT_HEADER_ROWS - grouped.emptyRows,
        grouped.droppedRowNumbers,
      );
      if (dropIssue) allIssues.push(dropIssue);
      const recalc = adaptToRecalcMetrics(grouped, sheetName);
      mergeRecalcIntoMetrics(calculatedMetrics, recalc, deptId);
      recalcResults[deptId] = recalc;
    }
  }

  // Добавляем ошибки ингеста (стабильный id: ячейка + порядковый номер дубля)
  const ingestOcc = new Map<string, number>();
  for (const err of ingestResult.errors) {
    allIssues.push({
      id: issueIdentity(['ingest', err.cell, nextOccurrence(ingestOcc, String(err.cell))]),
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

  // 4b. Dataset-level signal analysis (Benford, Z-score, composite score, noise map)
  const datasetAnalyses: Record<string, DatasetAnalysis> = {};
  for (const [sheetName, rows] of Object.entries(input.sheetRows)) {
    if (sheetName === SVOD_SHEET_NAME) continue;
    const deptId = sheetDeptId(sheetName);
    if (deptId === null) continue; // не-ГРБС лист — честный пропуск (п.4)
    const recalc = recalcResults[deptId];
    if (!recalc) continue;

    // Сигналы строк уже собраны в основном цикле (detectSheetSignals) —
    // здесь только проекция Map<row, signals> без второго прогона.
    const rowSignals = new Map<number, RowSignals>();
    for (const [r, v] of sheetSignalsByDept[deptId] ?? new Map()) {
      rowSignals.set(r, v.signals);
    }
    const sheetRows = rows as unknown[][];

    datasetAnalyses[deptId] = analyzeDataset({
      rows: sheetRows,
      rowSignals,
      execCountPct: recalc.year.execCountPct,
      epSharePct: recalc.epSharePct,
    });
  }

  // 4c. Aggregate summary-level calculated metrics (competitive.*, sole.*)
  // These sum across all departments to match REPORT_MAP summary keys.
  mergeSummaryMetrics(calculatedMetrics);

  // 5. Delta — со знанием периметра обеих сторон (Д21): несравнимые пары
  // не превращаются в дельту, а объясняют, почему сверки нет.
  const deltas = computeDeltas(officialMetrics, calculatedMetrics, input.reportMap, {
    calcYear: input.targetYear,
    officialYear: input.officialYear,
  });

  // 6. Trust
  const trust = computeTrustScore(officialMetrics, allIssues, deltas, snapshotId);

  // 7. Атомы для честной истории: снимок несёт строки книг ГРБС без шапки и
  // распарсенную официальную сетку СВОД — из УЖЕ прочитанных input.sheetRows,
  // без второго чтения. Отчёт прошлой недели строится из этих полей снимка.
  // Пусто (листы не читались) → поля честно отсутствуют, а не лежат пустышками.
  const rowsByDept = collectRowsByDept(input.sheetRows);
  const svodGrid = parseSvodGrid(input.sheetRows[SVOD_SHEET_NAME] ?? []);

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
    datasetAnalyses,
    ...(Object.keys(rowsByDept).length > 0 ? { rowsByDept } : {}),
    ...(svodGrid.length > 0 ? { svodGrid } : {}),
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
// Геометрия шапки книги ГРБС
// ────────────────────────────────────────────────────────────

/**
 * Замечание о съехавшей раскладке столбцов, либо null, если якоря шапки на
 * месте (реестр багов 09.07.2026, п.11 «позиционное чтение колонок без
 * проверки геометрии»).
 *
 * Механизм: весь расчёт читает ячейки по номеру колонки. Вставили столбец —
 * и план берётся из способа закупки, дата из бюджета, а числа при этом
 * остаются числами, поэтому ни одна арифметическая проверка сдвига не видит.
 * Единственный признак — подписи шапки (третья строка книги), сверенные с
 * каноном раскладки.
 */
function headerGeometryIssue(
  sheetName: string,
  deptId: string,
  rows: unknown[][],
): Issue | null {
  const mismatches = checkDeptHeaderGeometry(rows);
  if (mismatches.length === 0) return null;
  const shown = mismatches
    .map(m => `«${m.expected}» ожидается в столбце ${m.column}, а стоит в ${m.foundAt}`)
    .join('; ');
  return {
    id: issueIdentity(['header-geometry', sheetName]),
    severity: 'critical',
    origin: 'runtime_error',
    category: 'header_geometry',
    group: 'data_quality',
    title: `Столбцы листа «${sheetName}» съехали: опорных подписей не на своём месте — ${mismatches.length}`,
    description:
      `В третьей строке листа опорные подписи стоят не в своих столбцах: ${shown}. ` +
      'Так выглядит вставленный или удалённый столбец. Расчёт читает ячейки по номеру ' +
      'столбца, поэтому после сдвига суммы плана берутся из соседней графы, а даты — из ' +
      'бюджетов; числа при этом остаются правдоподобными, и арифметика подмены не замечает.',
    sheet: sheetName,
    departmentId: deptId,
    recommendation:
      'Открыть лист и вернуть столбцы в эталонный порядок (A — № п/п, C — подведомственное учреждение, ' +
      'G — предмет контракта, K — итого плана, L — способ определения поставщика, O и P — квартал и год плана, ' +
      'Y — итого факта, AD — учитывать в расчёте экономии). Пока раскладка не восстановлена, показатели ' +
      'этого управления считать нельзя.',
    status: 'open',
    detectedAt: new Date().toISOString(),
    detectedBy: 'pipeline:header-geometry',
  };
}

// ────────────────────────────────────────────────────────────
// Строки, не дошедшие до счёта
// ────────────────────────────────────────────────────────────

/**
 * Порог, за которым отсев строк перестаёт быть бытовым и становится поводом
 * для разговора: доля отсеянных от числа строк данных листа.
 *
 * Реестр багов 09.07.2026, п.6 «CalcEngine молча дропает строки при провале
 * классификации»: счётчик `droppedRows` в движок добавили, но за пределами
 * его собственного теста к нему никто не обращался — сдвиг колонок или
 * сломанный разбор по-прежнему не подавали голоса. Ниже — тот самый
 * «порог-сигнал», которого не хватало.
 *
 * Разделители и пустые вставки между блоками листа — обычное дело, поэтому
 * замечание не выносится, пока отсев не набрал разом и заметную долю, и
 * ощутимое число строк: одна пустая строка на маленьком листе — не событие.
 */
const DROPPED_ROWS_SHARE_THRESHOLD = 0.1;
const DROPPED_ROWS_MIN_COUNT = 5;
/** Доля, при которой речь идёт уже не о мусоре в данных, а о сломанном разборе. */
const DROPPED_ROWS_BROKEN_SHARE = 0.5;

/**
 * Замечание о строках, отсеянных до накопления метрик, либо null, если отсев
 * укладывается в житейскую норму.
 *
 * Считаются только строки, отвергнутые классификацией (или пустые слоты);
 * строки чужого года движок в этот счётчик не пишет — там отбор по сроку, а
 * не поломка (см. GroupedResults.droppedRows).
 */
function droppedRowsIssue(
  sheetName: string,
  deptId: string,
  droppedRows: number,
  dataRowCount: number,
  droppedRowNumbers: readonly number[] = [],
): Issue | null {
  if (dataRowCount <= 0 || droppedRows < DROPPED_ROWS_MIN_COUNT) return null;
  const share = droppedRows / dataRowCount;
  if (share < DROPPED_ROWS_SHARE_THRESHOLD) return null;

  const broken = share >= DROPPED_ROWS_BROKEN_SHARE;
  const percent = (share * 100).toFixed(1).replace('.', ',');
  // Ответ «какие именно строчки» обязан быть в самой карточке (п.119, вопрос
  // владельца 20.08 по УАГЗО): адреса первых отвергнутых строк листа.
  const addresses = droppedRowNumbers.length > 0
    ? ` Первые из них — строки листа ${droppedRowNumbers.join(', ')}${droppedRows > droppedRowNumbers.length ? ` и ещё ${droppedRows - droppedRowNumbers.length}` : ''}.`
    : '';
  return {
    id: issueIdentity(['dropped-rows', sheetName]),
    severity: broken ? 'significant' : 'warning',
    origin: 'runtime_error',
    category: 'dropped_rows',
    group: 'data_quality',
    title: `Строки листа «${sheetName}» не попали в расчёт: ${droppedRows} из ${dataRowCount}`,
    description: (broken
      ? `Расчёт отверг ${percent} % заполненных строк листа — столько сразу отсеивается, когда колонки сдвинуты (вставили или убрали столбец) либо лист прочитан не с той вкладки. Показатели управления в таком виде считать нельзя.`
      : `Расчёт отверг ${percent} % заполненных строк листа: в них не хватает опознавательных признаков закупки (номер, предмет, способ, суммы). В показатели эти строки не вошли. Пустые строки листа отсевом не считаются.`)
      + addresses,
    sheet: sheetName,
    departmentId: deptId,
    recommendation: broken
      ? 'Сверить шапку листа с эталонной раскладкой столбцов (A — № п/п, G — предмет, K — итого плана, L — способ) и убедиться, что читается нужная вкладка книги.'
      : 'Открыть перечисленные строки листа: это записи без номера, предмета и способа закупки — либо дозаполнить, либо убрать, если это остатки разметки.',
    status: 'open',
    detectedAt: new Date().toISOString(),
    detectedBy: 'pipeline:calc-engine',
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

/**
 * Один прогон detectSignals на лист (блок А п.3 пирамиды): раньше сигналы
 * считались дважды — здесь для замечаний и второй раз в 4b для
 * dataset-анализа. Семантика сбора — как у 4b (все парсабельные строки);
 * фильтр мета-/пустых строк остаётся на стороне замечаний.
 */
function detectSheetSignals(
  rows: unknown[][],
): Map<number, { cells: Record<string, unknown>; signals: RowSignals }> {
  const out = new Map<number, { cells: Record<string, unknown>; signals: RowSignals }>();
  for (let r = DEPT_HEADER_ROWS; r < rows.length; r++) {
    const row = rows[r] as unknown[];
    if (!row || row.length < 5) continue;
    const cells = buildCellDict(row);
    try {
      out.set(r, { cells, signals: detectSignals(cells) });
    } catch { /* skip unparseable rows */ }
  }
  return out;
}

function detectSignalsToIssues(
  sheetName: string,
  sheetSignals: Map<number, { cells: Record<string, unknown>; signals: RowSignals }>,
  deptId: string,
): Issue[] {
  const signalOcc = new Map<string, number>();
  const issues: Issue[] = [];
  const now = new Date().toISOString();

  for (const [r, { cells, signals }] of sheetSignals) {
    // Skip non-data rows: summaries ("Итого"/"Всего"), separators
    const nameCell = String(cells['C'] ?? cells['D'] ?? '').trim();
    if (isMetaRow(nameCell)) continue;
    // Skip rows where all cells are empty (separators)
    const allEmpty = Object.values(cells).every(v => v === null || v === undefined || v === '');
    if (allEmpty) continue;

    const subject = String(cells['G'] ?? cells['D'] ?? '').slice(0, 80);
    // Column C = subordinate org; пусто/плейсхолдер = само управление (канон @aemr/shared)
    const subordinateId = subordinateKey(cells['C']);

    for (const [signalKey, meta] of Object.entries(SIGNAL_ISSUE_MAP)) {
      if (signals[signalKey as keyof RowSignals] !== true) continue;
      // Класс самой строки может гасить претензию по другому её признаку —
      // канон живёт в @aemr/shared (issueSuppressedByRowClass), а не здесь:
      // замечания рождаются ещё и на сервере, и второе место обязано судить
      // тем же правилом. Сегодня правило одно — инициативная заявка не идёт
      // в риск-списки (решение владельца п.137(3) от 21.08.2026).
      if (issueSuppressedByRowClass(signalKey, signals as unknown as Record<string, boolean>)) continue;

      // Стабильный id: содержимое строки-якоря (A/B/G/K + подвед C), не её номер.
      const idBase = ['signal', meta.checkId, sheetName, String(cells['C'] ?? ''), String(cells['A'] ?? ''), String(cells['B'] ?? ''), String(cells['G'] ?? ''), String(cells['K'] ?? '')] as const;
      // Строгость ЕП-риска — свойство СТРОКИ, а не ключа: развилка по степени
      // обоснованности (решение владельца п.137(2) от 21.08.2026). Дом правила
      // один и лежит в @aemr/shared: замечание конвейера, чип Реестра и
      // проверка источника на сервере обязаны звать одну функцию, иначе список
      // критических разойдётся с цветом чипов на экране.
      const severity: Issue['severity'] = signalKey === 'epRisk'
        ? epRiskStrictnessOfReason(cells['M'])
        : meta.severity;
      issues.push({
        id: issueIdentity([...idBase, nextOccurrence(signalOcc, idBase.join(SEP))]),
        severity,
        origin: 'bi_heuristic',
        category: `signal:${signalKey}`,
        signal: signalKey,
        group: meta.group,
        checkId: meta.checkId,
        kbHint: meta.kbHint,
        title: `${meta.title}: ${subject || `строка ${r + 1}`}`,
        // Ошибка формулы адресуется до ячейки: «в строке где-то #REF» не
        // проверить, «K12 = #ЗНАЧ!» — открыл и увидел (страж 29.08.2026).
        description: `${sheetName}, строка ${r + 1}${subject ? `: ${subject}` : ''}${
          signalKey === 'formulaBroken'
            ? ` — ${formulaErrorCells(cells).map(c => `${c.column}${r + 1} = ${c.value.length > 40 ? `${c.value.slice(0, 40)}…` : c.value}`).join(', ')}`
            : ''
        }`,
        sheet: sheetName,
        row: r + 1,
        // «№ п/п» (колонка A) — стабильный второй адрес: строки листа
        // двигаются, позиционный row на момент сборки устаревает (п.98б).
        rowSeq: String(cells['A'] ?? '').trim() || undefined,
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
