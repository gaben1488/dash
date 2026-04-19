/**
 * Dataset-level Signal Analysis
 *
 * Анализирует набор строк закупок на уровне ПОПУЛЯЦИИ (не отдельной строки).
 * Дополняет row-level signals.ts алгоритмами, требующими статистики по всему набору:
 *
 * 1. Benford Test — распределение первых значащих цифр (MAD)
 * 2. Z-Score Outlier Detection — выбросы по |Z| > 3
 * 3. 5-Level EP Risk Classification — НИЗКИЙ...КРИТИЧЕСКИЙ
 * 4. 3-Level Anomaly Detection — data → behavioral → systemic
 * 5. Composite Score — 4 веса: исполнение 40%, EP risk 25%, аномалии 20%, комплаенс 15%
 * 6. Noise Map — группировка проблем для снижения шума
 *
 * Портировано из procurement_report.gs (строки 2550–4600).
 * Шкала: 0-1 (0.42 = 42%), как и CalcEngine.
 */

import type { RowSignals } from './signals.js';
import {
  calculateMeanAndStdDev,
  calculateZScore,
  firstSignificantDigit,
  BENFORD_EXPECTED as BENFORD_EXPECTED_SHARED,
} from '../utils/statistics.js';
import { DEPT_COLUMNS } from '@aemr/shared';

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

/** Result of Benford's Law first-digit test */
export interface BenfordResult {
  /** Mean Absolute Deviation from expected distribution */
  mad: number;
  /** Observed frequency for digits 1-9 (index 0 = digit 1) */
  observed: number[];
  /** Expected Benford frequency for digits 1-9 */
  expected: number[];
  /** Total values analyzed */
  sampleSize: number;
  /** MAD conformity: 'close' ≤ 0.006, 'acceptable' ≤ 0.012, 'marginal' ≤ 0.015, 'nonconforming' > 0.015 */
  conformity: 'close' | 'acceptable' | 'marginal' | 'nonconforming';
}

/** Z-score outlier detection result */
export interface OutlierResult {
  /** Number of outliers detected */
  count: number;
  /** Indices of outlier rows in the input array */
  indices: number[];
  /** Mean of the dataset */
  mean: number;
  /** Standard deviation */
  stdDev: number;
  /** Z-threshold used (default 3) */
  threshold: number;
}

/** EP risk level — 5-level classification from procurement_report.gs line 4534 */
export type EpRiskLevel = 'НИЗКИЙ' | 'УМЕРЕННЫЙ' | 'ПОВЫШЕННЫЙ' | 'ВЫСОКИЙ' | 'КРИТИЧЕСКИЙ';

/** EP risk classification result for a department */
export interface EpRiskClassification {
  /** EP share in 0-1 scale */
  epShare: number;
  /** Normal/reference EP share (default 0.30) */
  normalShare: number;
  /** Excess: epShare - normalShare */
  excess: number;
  /** Risk level */
  level: EpRiskLevel;
}

/** Execution classification — maps to composite score */
export type ExecutionLevel = 'ОТЛИЧНОЕ' | 'ХОРОШЕЕ' | 'СРЕДНЕЕ' | 'НИЗКОЕ' | 'КРИТИЧЕСКОЕ';

/** Anomaly severity */
export type AnomalySeverity = 'ИНФОРМАЦИЯ' | 'СРЕДНЯЯ' | 'ВЫСОКАЯ' | 'КРИТИЧЕСКАЯ';

/** 3-level anomaly detection: data + behavioral + systemic */
export interface AnomalyResult {
  /** Level 1: Data integrity anomalies */
  dataAnomalies: DataAnomaly[];
  /** Level 2: Behavioral anomalies (snapshot comparison) */
  behavioralAnomalies: BehavioralAnomaly[];
  /** Level 3: Systemic issues */
  systemicAnomalies: SystemicAnomaly[];
  /** Total anomaly count across all levels */
  totalCount: number;
  /** Worst severity across all anomalies */
  worstSeverity: AnomalySeverity;
}

/** Level 1: Data anomaly types from procurement_report.gs line 3652 */
export interface DataAnomaly {
  type: 'EXEC_OVER_200' | 'FACT_NO_PLAN' | 'NEGATIVE_PLAN' | 'EXACT_MATCH' | 'ZERO_ECONOMY_WITH_FACT';
  rowIndex: number;
  details: string;
  severity: AnomalySeverity;
}

/** Level 2: Behavioral anomaly (requires previous snapshot) */
export interface BehavioralAnomaly {
  type: 'SUDDEN_INCREASE' | 'SUDDEN_DECREASE' | 'STATUS_REGRESSION' | 'PLAN_REWRITE';
  rowIndex: number;
  details: string;
  severity: AnomalySeverity;
  previousValue?: number;
  currentValue?: number;
}

/** Level 3: Systemic anomaly (pattern across rows) */
export interface SystemicAnomaly {
  type:
    | 'HIGH_EXACT_MATCH_RATE'
    | 'CLUSTERED_OVERDUE'
    | 'DEPT_EP_CONCENTRATION'
    | 'BENFORD_VIOLATION'
    | 'SUBORDINATE_CONCENTRATION'
    | 'VAGUE_HIGH_VALUE'
    | 'CANCELED_WITH_FACT';
  details: string;
  severity: AnomalySeverity;
  affectedRows: number[];
}

/** Composite score result: 4 weighted components */
export interface CompositeScore {
  /** Final composite score 0-100 (lower = better) */
  score: number;
  /** Grade: A-F */
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  /** Individual component scores */
  components: {
    execution: { raw: number; weighted: number; level: ExecutionLevel };
    epRisk: { raw: number; weighted: number; level: EpRiskLevel };
    anomaly: { raw: number; weighted: number; severity: AnomalySeverity };
    compliance: { raw: number; weighted: number; severity: AnomalySeverity };
  };
}

/** Noise map entry — groups related issues to reduce noise */
export interface NoiseGroup {
  /** Group key (e.g., 'ep_risk_dept_УЭР') */
  key: string;
  /** Human-readable label */
  label: string;
  /** Number of individual issues in group */
  count: number;
  /** Row indices */
  rows: number[];
  /** Representative severity */
  severity: AnomalySeverity;
  /** Representative description */
  summary: string;
}

/** Seasonal anomaly type identifiers */
export type SeasonalAnomalyType =
  | 'SCHOOL_REPAIR_OUTSIDE_HOLIDAYS'
  | 'LATE_SCHOOL_FOOD_CONTRACT'
  | 'WINTER_ROAD_WORK'
  | 'LATE_FUEL_PROCUREMENT'
  | 'BOILER_REPAIR_HEATING_SEASON'
  | 'Q4_SPENDING_SPIKE'
  | 'DECEMBER_RUSH_CONTRACT';

/** Seasonal anomaly detected at dataset level */
export interface SeasonalAnomaly {
  type: SeasonalAnomalyType;
  severity: 'critical' | 'high' | 'medium';
  /** Index in the rows array (-1 for aggregate signals like Q4_SPENDING_SPIKE) */
  rowIndex: number;
  deptId?: string;
  /** Human-readable Russian description */
  description: string;
  /** Signal-specific data */
  details: Record<string, unknown>;
}

/** Full dataset analysis result */
export interface DatasetAnalysis {
  benford: BenfordResult;
  outliers: OutlierResult;
  anomalies: AnomalyResult;
  compositeScore: CompositeScore;
  noiseMap: NoiseGroup[];
  epRisk: EpRiskClassification;
  /** Execution level based on exec_count_pct */
  executionLevel: ExecutionLevel;
  /** Row-level data anomalies (EXACT_MATCH, NEGATIVE_PLAN, etc.) */
  dataAnomalyFlags: Map<number, DataAnomaly[]>;
  /** Seasonal / calendar-based anomalies */
  seasonalAnomalies: SeasonalAnomaly[];
  /** Suspicious splitting groups: multiple EP rows < 600K with similar subjects */
  suspiciousSplitting: SplittingGroup[];
}

/** Result of suspicious splitting detection (44-ФЗ anti-splitting) */
export interface SplittingGroup {
  /** Department / subordinate grouping key */
  groupKey: string;
  /** Row indices of suspected split rows */
  rowIndices: number[];
  /** Common subject substring */
  commonSubject: string;
  /** Total amount across all rows in group */
  totalAmount: number;
  /** Number of rows in the group */
  count: number;
}

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

/** Re-export shared Benford expected frequencies */
const BENFORD_EXPECTED = BENFORD_EXPECTED_SHARED;

/** MAD conformity thresholds (Nigrini 2012) */
const BENFORD_CLOSE = 0.006;
const BENFORD_ACCEPTABLE = 0.012;
const BENFORD_MARGINAL = 0.015;

/** Normal EP share reference point (шкала 0-1) */
const NORMAL_EP_SHARE = 0.30;

/** EP risk excess thresholds (procurement_report.gs line 4534) */
const EP_EXCESS_THRESHOLDS: Array<[number, EpRiskLevel]> = [
  [0.40, 'КРИТИЧЕСКИЙ'],
  [0.25, 'ВЫСОКИЙ'],
  [0.10, 'ПОВЫШЕННЫЙ'],
  [0.00, 'УМЕРЕННЫЙ'],
];

/** Composite score weights (procurement_report.gs line 4549) */
const COMPOSITE_WEIGHTS = {
  execution: 0.40,
  epRisk: 0.25,
  anomaly: 0.20,
  compliance: 0.15,
} as const;

/** Execution level → raw score mapping */
const EXECUTION_SCORES: Record<ExecutionLevel, number> = {
  'ОТЛИЧНОЕ': 0,
  'ХОРОШЕЕ': 15,
  'СРЕДНЕЕ': 40,
  'НИЗКОЕ': 70,
  'КРИТИЧЕСКОЕ': 100,
};

/** EP risk level → raw score mapping */
const EP_RISK_SCORES: Record<EpRiskLevel, number> = {
  'НИЗКИЙ': 0,
  'УМЕРЕННЫЙ': 20,
  'ПОВЫШЕННЫЙ': 50,
  'ВЫСОКИЙ': 75,
  'КРИТИЧЕСКИЙ': 100,
};

/** Anomaly severity → raw score mapping */
const ANOMALY_SCORES: Record<AnomalySeverity, number> = {
  'ИНФОРМАЦИЯ': 5,
  'СРЕДНЯЯ': 15,
  'ВЫСОКАЯ': 30,
  'КРИТИЧЕСКАЯ': 50,
};

/** EXACT_MATCH threshold: |fact - plan| / plan < 0.0001 */
const EXACT_MATCH_THRESHOLD = 0.0001;

/** EP splitting threshold: п.4 ст.93 44-ФЗ limit for sole-source */
const EP_SPLITTING_THRESHOLD = 600_000;

/** Minimum number of similar EP rows to flag as suspicious splitting */
const SPLITTING_MIN_GROUP_SIZE = 3;

// ────────────────────────────────────────────────────────────
// 1. Benford Test
// ────────────────────────────────────────────────────────────

/**
 * Benford's Law first-significant-digit test.
 * Портировано из procurement_report.gs строка 2550.
 *
 * @param amounts - массив денежных сумм для анализа
 * @returns BenfordResult с MAD и конформностью
 */
export function benfordTest(amounts: number[]): BenfordResult {
  const observed = new Array(9).fill(0);
  let validCount = 0;

  for (const amount of amounts) {
    if (Math.abs(amount) < 1) continue; // skip zero and near-zero

    const digit = firstSignificantDigit(amount);
    if (!isNaN(digit)) {
      observed[digit - 1]++;
      validCount++;
    }
  }

  // Normalize to frequencies
  const observedFreq = observed.map(c => validCount > 0 ? c / validCount : 0);

  // Calculate MAD
  let madSum = 0;
  for (let i = 0; i < 9; i++) {
    madSum += Math.abs(observedFreq[i] - BENFORD_EXPECTED[i]);
  }
  const mad = madSum / 9;

  // Determine conformity level
  let conformity: BenfordResult['conformity'];
  if (mad <= BENFORD_CLOSE) conformity = 'close';
  else if (mad <= BENFORD_ACCEPTABLE) conformity = 'acceptable';
  else if (mad <= BENFORD_MARGINAL) conformity = 'marginal';
  else conformity = 'nonconforming';

  return {
    mad,
    observed: observedFreq,
    expected: [...BENFORD_EXPECTED],
    sampleSize: validCount,
    conformity,
  };
}

// ────────────────────────────────────────────────────────────
// 2. Z-Score Outlier Detection
// ────────────────────────────────────────────────────────────

/**
 * Detects outliers using Z-score method.
 * Портировано из procurement_report.gs строка 2600.
 *
 * @param values - numeric values to analyze
 * @param threshold - Z-score threshold (default 3)
 * @returns OutlierResult with outlier count and indices
 */
export function detectOutliers(values: number[], threshold = 3): OutlierResult {
  if (values.length < 3) {
    return { count: 0, indices: [], mean: 0, stdDev: 0, threshold };
  }

  const stats = calculateMeanAndStdDev(values);
  if (stats.stdDev === 0) {
    return { count: 0, indices: [], mean: stats.mean, stdDev: 0, threshold };
  }

  const indices: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const z = Math.abs(calculateZScore(values[i], stats.mean, stats.stdDev));
    if (z > threshold) {
      indices.push(i);
    }
  }

  return {
    count: indices.length,
    indices,
    mean: stats.mean,
    stdDev: stats.stdDev,
    threshold,
  };
}

// ────────────────────────────────────────────────────────────
// 3. EP Risk Classification (5 levels)
// ────────────────────────────────────────────────────────────

/**
 * Classifies EP (sole-source) risk into 5 levels.
 * Портировано из procurement_report.gs строка 4534.
 *
 * @param epShare - доля ЕП в общем объёме (шкала 0-1)
 * @param normalShare - эталонная доля ЕП (default 0.30)
 * @returns EpRiskClassification
 */
export function classifyEpRisk(
  epShare: number,
  normalShare: number = NORMAL_EP_SHARE,
): EpRiskClassification {
  const excess = epShare - normalShare;

  // Use tolerance for floating-point comparison (0.40 - 0.30 = 0.10000000000000003)
  // Original procurement_report.gs: ≤0 НИЗКИЙ, ≤0.10 УМЕРЕННЫЙ, ≤0.25 ПОВЫШЕННЫЙ, ≤0.40 ВЫСОКИЙ, >0.40 КРИТИЧЕСКИЙ
  const eps = 1e-9;
  let level: EpRiskLevel = 'НИЗКИЙ';
  if (excess > 0.40 + eps) level = 'КРИТИЧЕСКИЙ';
  else if (excess > 0.25 + eps) level = 'ВЫСОКИЙ';
  else if (excess > 0.10 + eps) level = 'ПОВЫШЕННЫЙ';
  else if (excess > eps) level = 'УМЕРЕННЫЙ';

  return { epShare, normalShare, excess, level };
}

// ────────────────────────────────────────────────────────────
// 4. Execution Level Classification
// ────────────────────────────────────────────────────────────

/**
 * Classifies execution level based on exec_count_pct (шкала 0-1).
 *
 * @param execCountPct - доля исполненных в штуках (0-1)
 * @returns ExecutionLevel
 */
export function classifyExecution(execCountPct: number): ExecutionLevel {
  const eps = 1e-9; // Float tolerance (consistent with classifyEpRisk)
  if (execCountPct >= 0.90 - eps) return 'ОТЛИЧНОЕ';
  if (execCountPct >= 0.70 - eps) return 'ХОРОШЕЕ';
  if (execCountPct >= 0.50 - eps) return 'СРЕДНЕЕ';
  if (execCountPct >= 0.30 - eps) return 'НИЗКОЕ';
  return 'КРИТИЧЕСКОЕ';
}

// ────────────────────────────────────────────────────────────
// 5. Data-Level Anomaly Detection (Level 1)
// ────────────────────────────────────────────────────────────

/** Helper to extract numeric value from row cells */
function numFromRow(row: unknown[], colIndex: number): number {
  const v = row[colIndex];
  if (v == null) return 0;
  const n = parseFloat(String(v));
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Detects Level 1 (data integrity) anomalies per row.
 * Портировано из procurement_report.gs строка 3652 (checkDataIntegrity_).
 *
 * Column indices: K=10 (plan total), Y=24 (fact total)
 *
 * @param rows - array of raw row arrays
 * @returns Map of row index → anomalies
 */
export function detectDataAnomalies(rows: unknown[][]): Map<number, DataAnomaly[]> {
  const result = new Map<number, DataAnomaly[]>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 25) continue;

    const planTotal = numFromRow(row, DEPT_COLUMNS.TOTAL_PLAN);
    const factTotal = numFromRow(row, DEPT_COLUMNS.TOTAL_FACT);
    const anomalies: DataAnomaly[] = [];

    // EXEC_OVER_200: факт > план × 2
    if (planTotal > 0 && factTotal > planTotal * 2) {
      anomalies.push({
        type: 'EXEC_OVER_200',
        rowIndex: i,
        details: `Факт (${factTotal.toLocaleString('ru-RU')}) превышает план (${planTotal.toLocaleString('ru-RU')}) более чем в 2 раза`,
        severity: 'ВЫСОКАЯ',
      });
    }

    // FACT_NO_PLAN: план = 0, факт > 0
    if ((planTotal === 0 || Number.isNaN(planTotal)) && factTotal > 0) {
      anomalies.push({
        type: 'FACT_NO_PLAN',
        rowIndex: i,
        details: `Есть факт (${factTotal.toLocaleString('ru-RU')}), но план не задан`,
        severity: 'ВЫСОКАЯ',
      });
    }

    // NEGATIVE_PLAN: план < 0
    if (planTotal < 0) {
      anomalies.push({
        type: 'NEGATIVE_PLAN',
        rowIndex: i,
        details: `Отрицательный план: ${planTotal.toLocaleString('ru-RU')}`,
        severity: 'КРИТИЧЕСКАЯ',
      });
    }

    // EXACT_MATCH: |факт - план| / план < 0.0001 (шаблонное заполнение)
    if (planTotal > 0 && factTotal > 0) {
      const diff = Math.abs(factTotal - planTotal) / planTotal;
      if (diff < EXACT_MATCH_THRESHOLD) {
        anomalies.push({
          type: 'EXACT_MATCH',
          rowIndex: i,
          details: `Факт точно совпадает с планом (разница ${(diff * 100).toFixed(4)}%) — возможное шаблонное заполнение`,
          severity: 'СРЕДНЯЯ',
        });
      }
    }

    // ZERO_ECONOMY_WITH_FACT: есть факт, AD помечено экономией, но экономия = 0
    // Column AD=29, Z=25 (economy FB), AA=26 (economy KB), AB=27 (economy MB)
    if (factTotal > 0 && planTotal > 0 && factTotal < planTotal) {
      const ecoFB = numFromRow(row, DEPT_COLUMNS.ECONOMY_FB);
      const ecoKB = numFromRow(row, DEPT_COLUMNS.ECONOMY_KB);
      const ecoMB = numFromRow(row, DEPT_COLUMNS.ECONOMY_MB);
      const totalEco = ecoFB + ecoKB + ecoMB;
      if (totalEco === 0) {
        const adText = String(row[DEPT_COLUMNS.FLAG] ?? '').toLowerCase();
        if (adText.includes('эконом')) {
          anomalies.push({
            type: 'ZERO_ECONOMY_WITH_FACT',
            rowIndex: i,
            details: `AD помечено как экономия, но суммы экономии (Z+AA+AB) = 0`,
            severity: 'СРЕДНЯЯ',
          });
        }
      }
    }

    if (anomalies.length > 0) {
      result.set(i, anomalies);
    }
  }

  return result;
}

// ────────────────────────────────────────────────────────────
// 6. Behavioral Anomaly Detection (Level 2)
// ────────────────────────────────────────────────────────────

/**
 * Detects Level 2 (behavioral) anomalies by comparing current vs previous snapshot.
 * Requires previous snapshot data for comparison.
 *
 * @param currentRows - current snapshot rows
 * @param previousRows - previous snapshot rows (if null, returns empty)
 * @returns BehavioralAnomaly[]
 */
export function detectBehavioralAnomalies(
  currentRows: unknown[][],
  previousRows: unknown[][] | null,
): BehavioralAnomaly[] {
  if (!previousRows || previousRows.length === 0) return [];

  const anomalies: BehavioralAnomaly[] = [];
  const maxLen = Math.min(currentRows.length, previousRows.length);

  for (let i = 0; i < maxLen; i++) {
    const curr = currentRows[i];
    const prev = previousRows[i];
    if (!curr || !prev || curr.length < 25 || prev.length < 25) continue;

    const currPlan = numFromRow(curr, DEPT_COLUMNS.TOTAL_PLAN);
    const prevPlan = numFromRow(prev, DEPT_COLUMNS.TOTAL_PLAN);
    const currFact = numFromRow(curr, DEPT_COLUMNS.TOTAL_FACT);
    const prevFact = numFromRow(prev, DEPT_COLUMNS.TOTAL_FACT);

    // SUDDEN_INCREASE: plan increased by >50% between snapshots
    if (prevPlan > 0 && currPlan > prevPlan * 1.5) {
      anomalies.push({
        type: 'SUDDEN_INCREASE',
        rowIndex: i,
        details: `План вырос на ${((currPlan / prevPlan - 1) * 100).toFixed(0)}% между снимками`,
        severity: 'ВЫСОКАЯ',
        previousValue: prevPlan,
        currentValue: currPlan,
      });
    }

    // SUDDEN_DECREASE: plan decreased by >30%
    if (prevPlan > 0 && currPlan < prevPlan * 0.7 && currPlan > 0) {
      anomalies.push({
        type: 'SUDDEN_DECREASE',
        rowIndex: i,
        details: `План снизился на ${((1 - currPlan / prevPlan) * 100).toFixed(0)}% между снимками`,
        severity: 'СРЕДНЯЯ',
        previousValue: prevPlan,
        currentValue: currPlan,
      });
    }

    // PLAN_REWRITE: plan was 0, now has value (new row inserted)
    if (prevPlan === 0 && currPlan > 100_000) {
      anomalies.push({
        type: 'PLAN_REWRITE',
        rowIndex: i,
        details: `Появился новый план ${currPlan.toLocaleString('ru-RU')} (ранее 0)`,
        severity: 'ИНФОРМАЦИЯ',
        previousValue: 0,
        currentValue: currPlan,
      });
    }

    // STATUS_REGRESSION: had fact, now doesn't (data was removed)
    if (prevFact > 0 && currFact === 0) {
      anomalies.push({
        type: 'STATUS_REGRESSION',
        rowIndex: i,
        details: `Факт исчез: было ${prevFact.toLocaleString('ru-RU')}, стало 0`,
        severity: 'КРИТИЧЕСКАЯ',
        previousValue: prevFact,
        currentValue: 0,
      });
    }
  }

  return anomalies;
}

// ────────────────────────────────────────────────────────────
// 7. Systemic Anomaly Detection (Level 3)
// ────────────────────────────────────────────────────────────

/**
 * Detects Level 3 (systemic) anomalies — patterns across the whole dataset.
 *
 * @param dataAnomalies - Level 1 anomalies
 * @param benford - Benford test result
 * @param rows - all rows
 * @param rowSignals - per-row signals from signals.ts
 */
export function detectSystemicAnomalies(
  dataAnomalies: Map<number, DataAnomaly[]>,
  benford: BenfordResult,
  rows: unknown[][],
  rowSignals?: Map<number, RowSignals>,
): SystemicAnomaly[] {
  const anomalies: SystemicAnomaly[] = [];

  // HIGH_EXACT_MATCH_RATE: >15% of rows have exact match
  const exactMatchRows: number[] = [];
  for (const [idx, das] of dataAnomalies) {
    if (das.some(a => a.type === 'EXACT_MATCH')) {
      exactMatchRows.push(idx);
    }
  }
  const dataRowCount = rows.filter(r => r && r.length >= 25 && numFromRow(r, DEPT_COLUMNS.TOTAL_PLAN) > 0).length;
  if (dataRowCount > 10 && exactMatchRows.length / dataRowCount > 0.15) {
    anomalies.push({
      type: 'HIGH_EXACT_MATCH_RATE',
      details: `${exactMatchRows.length} из ${dataRowCount} строк (${((exactMatchRows.length / dataRowCount) * 100).toFixed(0)}%) имеют точное совпадение факт=план — системное шаблонное заполнение`,
      severity: 'ВЫСОКАЯ',
      affectedRows: exactMatchRows,
    });
  }

  // BENFORD_VIOLATION: non-conforming Benford test
  if (benford.sampleSize >= 50 && benford.conformity === 'nonconforming') {
    anomalies.push({
      type: 'BENFORD_VIOLATION',
      details: `Закон Бенфорда: MAD=${benford.mad.toFixed(4)} (${benford.conformity}), выборка ${benford.sampleSize}. Возможна манипуляция данными.`,
      severity: 'ВЫСОКАЯ',
      affectedRows: [],
    });
  }

  // CLUSTERED_OVERDUE: >30% overdue rows in one department = systemic issue
  if (rowSignals) {
    const overdueRows: number[] = [];
    for (const [idx, signals] of rowSignals) {
      if (signals.overdue) overdueRows.push(idx);
    }
    if (dataRowCount > 5 && overdueRows.length / dataRowCount > 0.30) {
      anomalies.push({
        type: 'CLUSTERED_OVERDUE',
        details: `${overdueRows.length} из ${dataRowCount} строк (${((overdueRows.length / dataRowCount) * 100).toFixed(0)}%) просрочены — системная проблема исполнения`,
        severity: 'КРИТИЧЕСКАЯ',
        affectedRows: overdueRows,
      });
    }
  }

  // DEPT_EP_CONCENTRATION: EP risk signals concentrated in one department
  if (rowSignals) {
    const epRiskRows: number[] = [];
    for (const [idx, signals] of rowSignals) {
      if (signals.epRisk) epRiskRows.push(idx);
    }
    if (epRiskRows.length > 5) {
      anomalies.push({
        type: 'DEPT_EP_CONCENTRATION',
        details: `${epRiskRows.length} строк с ЕП-риском — требует проверки на концентрацию у одного поставщика`,
        severity: 'СРЕДНЯЯ',
        affectedRows: epRiskRows,
      });
    }
  }

  // SUBORDINATE_CONCENTRATION: один подвед забирает >80% бюджета (ОЭСР red flag)
  {
    const subTotals = new Map<string, { plan: number; rows: number[] }>();
    let grandTotal = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 25) continue;
      const plan = numFromRow(row, DEPT_COLUMNS.TOTAL_PLAN);
      if (plan <= 0) continue;
      grandTotal += plan;
      const sub = normalizeSub(String(row[DEPT_COLUMNS.SUBORDINATE] ?? ''));
      const entry = subTotals.get(sub) ?? { plan: 0, rows: [] };
      entry.plan += plan;
      entry.rows.push(i);
      subTotals.set(sub, entry);
    }
    if (grandTotal > 0 && subTotals.size > 1) {
      for (const [sub, data] of subTotals) {
        const share = data.plan / grandTotal;
        if (share > 0.80 && data.rows.length > 3) {
          anomalies.push({
            type: 'SUBORDINATE_CONCENTRATION',
            details: `Подведомственная "${sub}" получает ${(share * 100).toFixed(0)}% бюджета (${data.rows.length} строк из ${dataRowCount}) — риск концентрации`,
            severity: 'СРЕДНЯЯ',
            affectedRows: data.rows,
          });
        }
      }
    }
  }

  // VAGUE_HIGH_VALUE: расплывчатое описание на дорогих закупках (>5M) — red flag по ОЭСР
  {
    const vagueRows: number[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 25) continue;
      const plan = numFromRow(row, DEPT_COLUMNS.TOTAL_PLAN);
      if (plan < 5_000_000) continue; // только дорогие закупки
      const desc = String(row[DEPT_COLUMNS.DESCRIPTION] ?? '').trim();
      const subj = String(row[DEPT_COLUMNS.SUBJECT] ?? '').trim();
      const text = (desc + ' ' + subj).trim();
      // Расплывчатое описание: короткое (<50 символов) или только общие слова
      // Threshold raised from 30→50: real data shows 30 chars catches legit entries like
      // "Закупка компьютерного оборудования" (35 chars). 50 is more balanced.
      if (text.length < 50 || /^(закупка|поставка|услуг|работ|прочие|иные|другие|разное)\s*$/i.test(text)) {
        vagueRows.push(i);
      }
    }
    if (vagueRows.length > 0) {
      anomalies.push({
        type: 'VAGUE_HIGH_VALUE',
        details: `${vagueRows.length} дорогих закупок (>5 млн) с расплывчатым описанием (<50 символов) — затрудняет контроль`,
        severity: 'СРЕДНЯЯ',
        affectedRows: vagueRows,
      });
    }
  }

  // CANCELED_WITH_FACT: отменена/снята, но есть существенные фактические суммы (ОЭСР: status-amount inconsistency)
  {
    const inconsistentRows: number[] = [];
    const cancelPatterns = /отмен|не требуется|снят|подлежит удалению/i;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 25) continue;
      const status = String(row[DEPT_COLUMNS.STATUS] ?? '').toLowerCase();
      const comment = String(row[DEPT_COLUMNS.COMMENT_GRBS] ?? '').toLowerCase();
      if (!cancelPatterns.test(status) && !cancelPatterns.test(comment)) continue;
      const factTotal = numFromRow(row, DEPT_COLUMNS.TOTAL_FACT);
      if (factTotal > 100_000) { // >100K факт на отменённой закупке
        inconsistentRows.push(i);
      }
    }
    if (inconsistentRows.length > 0) {
      anomalies.push({
        type: 'CANCELED_WITH_FACT',
        details: `${inconsistentRows.length} отменённых/снятых закупок с фактическими суммами >100K — несоответствие статуса и данных`,
        severity: 'ВЫСОКАЯ',
        affectedRows: inconsistentRows,
      });
    }
  }

  return anomalies;
}

// ────────────────────────────────────────────────────────────
// 8. Composite Score
// ────────────────────────────────────────────────────────────

/**
 * Calculates composite risk score (0-100, lower = better).
 * Портировано из procurement_report.gs строка 4549.
 *
 * @param executionLevel - execution classification
 * @param epRiskLevel - EP risk classification
 * @param worstAnomalySeverity - worst anomaly severity
 * @param worstComplianceSeverity - worst compliance severity
 * @returns CompositeScore
 */
export function computeCompositeScore(
  executionLevel: ExecutionLevel,
  epRiskLevel: EpRiskLevel,
  worstAnomalySeverity: AnomalySeverity = 'ИНФОРМАЦИЯ',
  worstComplianceSeverity: AnomalySeverity = 'ИНФОРМАЦИЯ',
): CompositeScore {
  const execRaw = EXECUTION_SCORES[executionLevel];
  const epRaw = EP_RISK_SCORES[epRiskLevel];
  const anomalyRaw = ANOMALY_SCORES[worstAnomalySeverity];
  const complianceRaw = ANOMALY_SCORES[worstComplianceSeverity];

  const score =
    execRaw * COMPOSITE_WEIGHTS.execution +
    epRaw * COMPOSITE_WEIGHTS.epRisk +
    anomalyRaw * COMPOSITE_WEIGHTS.anomaly +
    complianceRaw * COMPOSITE_WEIGHTS.compliance;

  // Grade: A-F (inverted: A = best = lowest score)
  let grade: CompositeScore['grade'];
  if (score < 10) grade = 'A';
  else if (score < 25) grade = 'B';
  else if (score < 40) grade = 'C';
  else if (score < 60) grade = 'D';
  else grade = 'F';

  return {
    score,
    grade,
    components: {
      execution: { raw: execRaw, weighted: execRaw * COMPOSITE_WEIGHTS.execution, level: executionLevel },
      epRisk: { raw: epRaw, weighted: epRaw * COMPOSITE_WEIGHTS.epRisk, level: epRiskLevel },
      anomaly: { raw: anomalyRaw, weighted: anomalyRaw * COMPOSITE_WEIGHTS.anomaly, severity: worstAnomalySeverity },
      compliance: { raw: complianceRaw, weighted: complianceRaw * COMPOSITE_WEIGHTS.compliance, severity: worstComplianceSeverity },
    },
  };
}

// ────────────────────────────────────────────────────────────
// 9. Noise Map
// ────────────────────────────────────────────────────────────

/**
 * Groups individual issues into noise-reduced clusters.
 * Портировано из v39 buildNoiseMap.
 *
 * @param dataAnomalies - Level 1 anomalies
 * @param rowSignals - per-row signals
 * @returns NoiseGroup[]
 */
export function buildNoiseMap(
  dataAnomalies: Map<number, DataAnomaly[]>,
  rowSignals?: Map<number, RowSignals>,
): NoiseGroup[] {
  const groups = new Map<string, NoiseGroup>();

  // Group data anomalies by type
  for (const [idx, anomalies] of dataAnomalies) {
    for (const a of anomalies) {
      const key = `data_${a.type}`;
      const existing = groups.get(key);
      if (existing) {
        existing.count++;
        existing.rows.push(idx);
        // Escalate severity
        if (severityRank(a.severity) > severityRank(existing.severity)) {
          existing.severity = a.severity;
        }
      } else {
        groups.set(key, {
          key,
          label: anomalyTypeLabel(a.type),
          count: 1,
          rows: [idx],
          severity: a.severity,
          summary: a.details,
        });
      }
    }
  }

  // Group row signals by type
  if (rowSignals) {
    const signalKeys: Array<{ key: keyof RowSignals; label: string; severity: AnomalySeverity }> = [
      { key: 'overdue', label: 'Просроченные закупки', severity: 'ВЫСОКАЯ' },
      { key: 'epRisk', label: 'ЕП-риски (>600K)', severity: 'СРЕДНЯЯ' },
      { key: 'economyConflict', label: 'Конфликты флага экономии', severity: 'СРЕДНЯЯ' },
      { key: 'highEconomy', label: 'Высокая экономия >25%', severity: 'СРЕДНЯЯ' },
      { key: 'factExceedsPlan', label: 'Факт превышает план', severity: 'ВЫСОКАЯ' },
      { key: 'stalledContract', label: 'Подвисшие контракты', severity: 'СРЕДНЯЯ' },
      { key: 'dataQuality', label: 'Проблемы качества данных', severity: 'ИНФОРМАЦИЯ' },
      { key: 'formulaBroken', label: 'Ошибки формул', severity: 'КРИТИЧЕСКАЯ' },
      { key: 'epJustificationMissing', label: 'ЕП без обоснования', severity: 'ВЫСОКАЯ' },
      { key: 'budgetUnderallocation', label: 'Факт без плана', severity: 'ВЫСОКАЯ' },
    ];

    for (const { key: sigKey, label, severity } of signalKeys) {
      const matchingRows: number[] = [];
      for (const [idx, signals] of rowSignals) {
        if (signals[sigKey]) matchingRows.push(idx);
      }
      if (matchingRows.length > 0) {
        const gKey = `signal_${sigKey}`;
        groups.set(gKey, {
          key: gKey,
          label,
          count: matchingRows.length,
          rows: matchingRows,
          severity,
          summary: `${matchingRows.length} строк с сигналом "${label}"`,
        });
      }
    }
  }

  // Sort by severity (desc) then count (desc)
  return [...groups.values()].sort((a, b) => {
    const sev = severityRank(b.severity) - severityRank(a.severity);
    if (sev !== 0) return sev;
    return b.count - a.count;
  });
}

// ────────────────────────────────────────────────────────────
// 10. Full Dataset Analysis (Orchestrator)
// ────────────────────────────────────────────────────────────

export interface DatasetAnalysisInput {
  /** Raw rows from department sheet */
  rows: unknown[][];
  /** Previous snapshot rows (for behavioral anomaly detection) */
  previousRows?: unknown[][] | null;
  /** Per-row signals from detectSignals() */
  rowSignals?: Map<number, RowSignals>;
  /** Execution count percentage (шкала 0-1) from CalcEngine */
  execCountPct: number;
  /** EP share percentage (шкала 0-1) from CalcEngine */
  epSharePct: number;
  /** Whether compliance issues exist */
  hasComplianceIssues?: boolean;
  /** Worst compliance severity */
  complianceSeverity?: AnomalySeverity;
  /** Department identifier (for seasonal anomaly context) */
  deptId?: string;
  /** Reference date for time-based checks (defaults to current date) */
  referenceDate?: Date;
}

// ────────────────────────────────────────────────────────────
// 8. Suspicious Splitting Detection (44-ФЗ anti-splitting)
// ────────────────────────────────────────────────────────────

/**
 * Detects suspicious splitting of procurements.
 * Per п.4 ст.93 44-ФЗ, sole-source (ЕП) purchases under 600K don't need competition.
 * A common evasion: split one large purchase into multiple small ЕП <600K.
 *
 * Detection: group EP rows by subordinate, find rows with similar descriptions
 * (longest common substring >= 8 chars) and plan_total < 600K, flag groups of 3+.
 *
 * @param rows - raw row arrays from department sheet
 * @returns array of splitting groups
 */
export function detectSuspiciousSplitting(rows: unknown[][]): SplittingGroup[] {
  interface EpCandidate {
    rowIndex: number;
    subject: string;
    subordinate: string;
    planTotal: number;
  }

  const candidates: EpCandidate[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 25) continue;

    const method = String(row[DEPT_COLUMNS.METHOD] ?? '').trim().toLowerCase();
    if (!method.includes('еп') && !method.includes('единствен')) continue;

    const planTotal = numFromRow(row, DEPT_COLUMNS.TOTAL_PLAN);
    if (planTotal <= 0 || planTotal >= EP_SPLITTING_THRESHOLD) continue;

    const subject = String(row[DEPT_COLUMNS.SUBJECT] ?? row[DEPT_COLUMNS.DESCRIPTION] ?? '').trim().toLowerCase();
    if (subject.length < 3) continue;

    const subordinate = normalizeSub(String(row[DEPT_COLUMNS.SUBORDINATE] ?? ''));

    candidates.push({ rowIndex: i, subject, subordinate, planTotal });
  }

  if (candidates.length < SPLITTING_MIN_GROUP_SIZE) return [];

  // Group by subordinate (or '_org' if empty)
  const bySubordinate = new Map<string, EpCandidate[]>();
  for (const c of candidates) {
    const key = c.subordinate || '_org';
    if (!bySubordinate.has(key)) bySubordinate.set(key, []);
    bySubordinate.get(key)!.push(c);
  }

  const results: SplittingGroup[] = [];

  for (const [groupKey, group] of bySubordinate) {
    if (group.length < SPLITTING_MIN_GROUP_SIZE) continue;

    const visited = new Set<number>();

    for (let i = 0; i < group.length; i++) {
      if (visited.has(i)) continue;

      const cluster: EpCandidate[] = [group[i]];
      visited.add(i);

      for (let j = i + 1; j < group.length; j++) {
        if (visited.has(j)) continue;

        if (subjectsAreSimilar(group[i].subject, group[j].subject)) {
          cluster.push(group[j]);
          visited.add(j);
        }
      }

      if (cluster.length >= SPLITTING_MIN_GROUP_SIZE) {
        const totalAmount = cluster.reduce((sum, c) => sum + c.planTotal, 0);
        if (totalAmount >= EP_SPLITTING_THRESHOLD) {
          results.push({
            groupKey,
            rowIndices: cluster.map(c => c.rowIndex),
            commonSubject: cluster[0].subject.slice(0, 80),
            totalAmount,
            count: cluster.length,
          });
        }
      }
    }
  }

  return results;
}

/**
 * Check if two subject strings are similar enough to suspect splitting.
 * Uses longest common substring: if LCS >= 8 chars, they're similar.
 */
function subjectsAreSimilar(a: string, b: string): boolean {
  if (a === b) return true;
  const minLen = Math.min(a.length, b.length);
  if (minLen < 8) return false;

  let maxLen = 0;
  for (let i = 0; i < a.length && maxLen < minLen; i++) {
    for (let j = 0; j < b.length; j++) {
      let k = 0;
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) {
        k++;
      }
      if (k > maxLen) maxLen = k;
    }
  }

  return maxLen >= 8;
}

/**
 * Runs full dataset-level analysis: Benford, Z-score, 3-level anomaly, composite score, noise map.
 * This is the main entry point — call after CalcEngine and row-level detectSignals().
 */
export function analyzeDataset(input: DatasetAnalysisInput): DatasetAnalysis {
  const { rows, previousRows, rowSignals, execCountPct, epSharePct } = input;

  // 1. Extract amounts for Benford test (plan totals, K=10)
  const amounts: number[] = [];
  for (const row of rows) {
    if (!row || row.length < 25) continue;
    const plan = numFromRow(row, DEPT_COLUMNS.TOTAL_PLAN);
    if (plan > 0) amounts.push(plan);
    const fact = numFromRow(row, DEPT_COLUMNS.TOTAL_FACT);
    if (fact > 0) amounts.push(fact);
  }
  const benford = benfordTest(amounts);

  // 2. Z-score outliers on plan totals
  const planAmounts = rows
    .filter(r => r && r.length >= 25)
    .map(r => numFromRow(r, DEPT_COLUMNS.TOTAL_PLAN))
    .filter(v => v > 0);
  const outliers = detectOutliers(planAmounts);

  // 3. Data anomalies (Level 1)
  const dataAnomalyFlags = detectDataAnomalies(rows);

  // 4. Behavioral anomalies (Level 2)
  const behavioralAnomalies = detectBehavioralAnomalies(rows, previousRows ?? null);

  // 5. Systemic anomalies (Level 3)
  const systemicAnomalies = detectSystemicAnomalies(dataAnomalyFlags, benford, rows, rowSignals);

  // 6. Aggregate anomalies
  const allDataAnomalies: DataAnomaly[] = [];
  for (const das of dataAnomalyFlags.values()) {
    allDataAnomalies.push(...das);
  }

  const allAnomalies = [...allDataAnomalies, ...behavioralAnomalies, ...systemicAnomalies];
  const worstAnomalySeverity = allAnomalies.reduce<AnomalySeverity>(
    (worst, a) => severityRank(a.severity) > severityRank(worst) ? a.severity : worst,
    'ИНФОРМАЦИЯ',
  );

  const anomalies: AnomalyResult = {
    dataAnomalies: allDataAnomalies,
    behavioralAnomalies,
    systemicAnomalies,
    totalCount: allAnomalies.length,
    worstSeverity: worstAnomalySeverity,
  };

  // 7. Classifications
  const executionLevel = classifyExecution(execCountPct);
  const epRisk = classifyEpRisk(epSharePct);

  // 8. Composite score
  const compositeScore = computeCompositeScore(
    executionLevel,
    epRisk.level,
    worstAnomalySeverity,
    input.complianceSeverity ?? 'ИНФОРМАЦИЯ',
  );

  // 9. Noise map
  const noiseMap = buildNoiseMap(dataAnomalyFlags, rowSignals);

  // 10. Seasonal anomalies
  const seasonalAnomalies = detectSeasonalAnomalies(rows, input.deptId, input.referenceDate);

  // 11. Suspicious splitting (44-ФЗ anti-splitting)
  const suspiciousSplitting = detectSuspiciousSplitting(rows);

  return {
    benford,
    outliers,
    anomalies,
    compositeScore,
    noiseMap,
    epRisk,
    executionLevel,
    dataAnomalyFlags,
    seasonalAnomalies,
    suspiciousSplitting,
  };
}

// ────────────────────────────────────────────────────────────
// 11. Seasonal Anomaly Detection
// ────────────────────────────────────────────────────────────

/** Regex patterns for seasonal signal detection */
const SEASONAL_RE = {
  repair: /ремонт|модерниз|реконструк/i,
  school: /школ|образов|детс|гимназ|лицей/i,
  food: /питан|пищ|обед|завтрак|столов/i,
  road: /дорог|асфальт|покрыт|тротуар|благоуст/i,
  fuel: /топлив|угл[яеьюи]|мазут|дизельн|ГСМ|котельн.*снабж/i,
  boiler: /котельн|отоплен|теплоснабж/i,
  signed: /подписан|заключен|исполнен/i,
} as const;

/**
 * Parse a DD.MM.YYYY date string (or Date object) from a row cell.
 * Returns null for invalid / missing values.
 */
function parseDateFromCell(val: unknown): Date | null {
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (val == null || val === '') return null;
  const s = String(val).trim();
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) {
    const d = new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
    return isNaN(d.getTime()) ? null : d;
  }
  const iso = new Date(s);
  return isNaN(iso.getTime()) ? null : iso;
}

/** Get string value from a row cell */
function strFromRow(row: unknown[], colIndex: number): string {
  const v = row[colIndex];
  return v == null ? '' : String(v);
}

/** Placeholder regex: "Х"/"х"/"X"/"x"/"-"/"—"/"–" = org itself, not a real subordinate */
const SUB_PLACEHOLDER_RE = /^[XxХх\-—–]$/u;

/** Normalize subordinate value: treat placeholders as empty → '_org_itself' */
function normalizeSub(raw: string): string {
  const s = raw.trim();
  if (!s || SUB_PLACEHOLDER_RE.test(s)) return '_org_itself';
  return s;
}

/**
 * Detect seasonal / calendar-based anomalies in a department dataset.
 *
 * These signals identify procurements that violate seasonal logic:
 * school repairs during school year, road work in winter, late fuel contracts, etc.
 */
export function detectSeasonalAnomalies(
  rows: unknown[][],
  deptId?: string,
  referenceDate?: Date,
): SeasonalAnomaly[] {
  const now = referenceDate ?? new Date();
  const results: SeasonalAnomaly[] = [];

  // Per-row counters for Q4_SPENDING_SPIKE
  let totalFactRows = 0;
  let q4FactRows = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 21) continue;

    const subordinate = strFromRow(row, DEPT_COLUMNS.SUBORDINATE);
    const description = strFromRow(row, DEPT_COLUMNS.DESCRIPTION);
    const program = strFromRow(row, DEPT_COLUMNS.PROGRAM_NAME);
    const status = strFromRow(row, DEPT_COLUMNS.STATUS);
    const factDate = parseDateFromCell(row[DEPT_COLUMNS.FACT_DATE]);
    const planDate = parseDateFromCell(row[DEPT_COLUMNS.PLAN_DATE]);

    // Track Q4 stats
    if (factDate) {
      totalFactRows++;
      const month = factDate.getMonth(); // 0-based: Oct=9, Nov=10, Dec=11
      if (month >= 9) q4FactRows++;
    }

    const descOrProg = description + ' ' + program;
    const contextAll = subordinate + ' ' + description + ' ' + program;

    // 1. SCHOOL_REPAIR_OUTSIDE_HOLIDAYS — ремонт школ вне каникул
    if (
      SEASONAL_RE.repair.test(descOrProg) &&
      SEASONAL_RE.school.test(contextAll) &&
      factDate
    ) {
      const month = factDate.getMonth(); // 0=Jan..11=Dec
      // School year = September(8) through May(4)
      if (month >= 8 || month <= 4) {
        results.push({
          type: 'SCHOOL_REPAIR_OUTSIDE_HOLIDAYS',
          severity: 'critical',
          rowIndex: i,
          deptId,
          description: `Ремонт образовательного учреждения в учебный период (${factDate.toLocaleDateString('ru-RU')})`,
          details: { subordinate, description, factDate: factDate.toISOString(), month: month + 1 },
        });
      }
    }

    // 2. LATE_SCHOOL_FOOD_CONTRACT — контракт на питание не заключён после 15 августа
    if (
      SEASONAL_RE.food.test(description) &&
      SEASONAL_RE.school.test(contextAll) &&
      !SEASONAL_RE.signed.test(status)
    ) {
      // Determine procurement year from plan date or reference date
      const procYear = planDate ? planDate.getFullYear() : now.getFullYear();
      const deadline = new Date(procYear, 7, 15); // August 15
      if (now > deadline) {
        results.push({
          type: 'LATE_SCHOOL_FOOD_CONTRACT',
          severity: 'high',
          rowIndex: i,
          deptId,
          description: `Контракт на школьное питание не заключён после 15.08.${procYear}`,
          details: { subordinate, description, status, deadline: deadline.toISOString() },
        });
      }
    }

    // 3. WINTER_ROAD_WORK — дорожные работы зимой
    if (SEASONAL_RE.road.test(description) && factDate) {
      const month = factDate.getMonth(); // Dec=11, Jan=0, Feb=1, Mar=2
      if (month === 11 || month <= 2) {
        results.push({
          type: 'WINTER_ROAD_WORK',
          severity: 'critical',
          rowIndex: i,
          deptId,
          description: `Дорожные/благоустроительные работы в зимний период (${factDate.toLocaleDateString('ru-RU')})`,
          details: { description, factDate: factDate.toISOString(), month: month + 1 },
        });
      }
    }

    // 4. LATE_FUEL_PROCUREMENT — топливо не закуплено к отопительному сезону
    if (
      SEASONAL_RE.fuel.test(description) &&
      !SEASONAL_RE.signed.test(status)
    ) {
      const procYear = planDate ? planDate.getFullYear() : now.getFullYear();
      const deadline = new Date(procYear, 8, 1); // September 1
      if (now > deadline) {
        results.push({
          type: 'LATE_FUEL_PROCUREMENT',
          severity: 'critical',
          rowIndex: i,
          deptId,
          description: `Топливо/ГСМ не закуплено к началу отопительного сезона (01.09.${procYear})`,
          details: { description, status, deadline: deadline.toISOString() },
        });
      }
    }

    // 5. BOILER_REPAIR_HEATING_SEASON — ремонт котельной в отопительный сезон
    if (
      SEASONAL_RE.boiler.test(description) &&
      SEASONAL_RE.repair.test(description) &&
      factDate
    ) {
      const month = factDate.getMonth(); // Oct=9..Apr=3
      if (month >= 9 || month <= 3) {
        results.push({
          type: 'BOILER_REPAIR_HEATING_SEASON',
          severity: 'high',
          rowIndex: i,
          deptId,
          description: `Ремонт котельной/теплоснабжения в отопительный сезон (${factDate.toLocaleDateString('ru-RU')})`,
          details: { description, factDate: factDate.toISOString(), month: month + 1 },
        });
      }
    }

    // 7. DECEMBER_RUSH_CONTRACT — подозрительно быстрый контракт в декабре
    if (
      SEASONAL_RE.signed.test(status) &&
      factDate &&
      planDate &&
      factDate.getMonth() === 11 // December
    ) {
      const diffMs = factDate.getTime() - planDate.getTime();
      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays >= 0 && diffDays < 15) {
        results.push({
          type: 'DECEMBER_RUSH_CONTRACT',
          severity: 'medium',
          rowIndex: i,
          deptId,
          description: `Контракт заключён за ${diffDays} дн. в декабре (план→факт < 15 дн.)`,
          details: {
            description,
            planDate: planDate.toISOString(),
            factDate: factDate.toISOString(),
            daysDiff: diffDays,
          },
        });
      }
    }
  }

  // 6. Q4_SPENDING_SPIKE — аномальная концентрация в Q4
  if (totalFactRows > 0) {
    const q4Share = q4FactRows / totalFactRows;
    if (q4Share > 0.40) {
      results.push({
        type: 'Q4_SPENDING_SPIKE',
        severity: 'high',
        rowIndex: -1,
        deptId,
        description: `${Math.round(q4Share * 100)}% контрактов заключены в IV квартале (порог 40%)`,
        details: { q4FactRows, totalFactRows, q4Share: Math.round(q4Share * 100) / 100 },
      });
    }
  }

  return results;
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function severityRank(s: AnomalySeverity): number {
  switch (s) {
    case 'ИНФОРМАЦИЯ': return 0;
    case 'СРЕДНЯЯ': return 1;
    case 'ВЫСОКАЯ': return 2;
    case 'КРИТИЧЕСКАЯ': return 3;
  }
}

function anomalyTypeLabel(type: DataAnomaly['type']): string {
  switch (type) {
    case 'EXEC_OVER_200': return 'Факт > 200% плана';
    case 'FACT_NO_PLAN': return 'Факт без плана';
    case 'NEGATIVE_PLAN': return 'Отрицательный план';
    case 'EXACT_MATCH': return 'Точное совпадение факт=план';
    case 'ZERO_ECONOMY_WITH_FACT': return 'Нулевая экономия при факте';
  }
}
