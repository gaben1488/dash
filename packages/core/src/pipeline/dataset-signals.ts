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
import { numFromRow } from '../utils/row-cells.js';
import { detectSeasonalAnomalies } from './seasonal.js';
import { detectSuspiciousSplitting } from './splitting.js';
import { detectDataAnomalies, detectBehavioralAnomalies, detectSystemicAnomalies } from './anomalies.js';
import type { DataAnomaly, BehavioralAnomaly, SystemicAnomaly } from './anomalies.js';
import type { SplittingGroup } from './splitting.js';
import type { SeasonalAnomaly } from './seasonal.js';

// Сезонные аномалии вынесены в ./seasonal.ts (чанк G-3)
export { detectSeasonalAnomalies };

// Дробление закупок вынесено в ./splitting.ts (чанк G-3, шаг 2)
export { detectSuspiciousSplitting };

// Детекторы аномалий вынесены в ./anomalies.ts (чанк G-3, шаг 3)
export { detectDataAnomalies, detectBehavioralAnomalies, detectSystemicAnomalies };
export type { DataAnomaly, BehavioralAnomaly, SystemicAnomaly } from './anomalies.js';
export type { SplittingGroup } from './splitting.js';
export type { SeasonalAnomaly, SeasonalAnomalyType } from './seasonal.js';

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

/** EP splitting threshold: п.4 ч.1 ст.93 44-ФЗ single-contract limit for sole-source */

/** Minimum number of similar EP rows to flag as suspicious splitting */

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
  for (const [threshold, thresholdLevel] of EP_EXCESS_THRESHOLDS) {
    if (excess > threshold + eps) {
      level = thresholdLevel;
      break;
    }
  }

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

/**
 * Detects Level 1 (data integrity) anomalies per row.
 * Портировано из procurement_report.gs строка 3652 (checkDataIntegrity_).
 *
 * Column indices: K=10 (plan total), Y=24 (fact total)
 *
 * @param rows - array of raw row arrays
 * @returns Map of row index → anomalies
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


/** Get string value from a row cell */

/** Нормализует столбец C → сентинел «само управление» или имя подведа (канон @aemr/shared). */
/**
 * Detect seasonal / calendar-based anomalies in a department dataset.
 *
 * These signals identify procurements that violate seasonal logic:
 * school repairs during school year, road work in winter, late fuel contracts, etc.
 */

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
