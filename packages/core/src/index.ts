export { runPipeline, type PipelineInput } from './pipeline/orchestrator.js';
export { ingestBatchGetResponse, ingestSheetRows } from './pipeline/ingest.js';
export { normalizeMetrics } from './pipeline/normalize.js';
export { classifyRows } from './pipeline/classify.js';
export { validateData } from './pipeline/validate.js';
export { computeDeltas } from './pipeline/delta.js';
export { computeTrustScore } from './trust/scorer.js';
export { detectSignals, classifyRowState, getSignalBadges, type RowSignals, type RowState } from './pipeline/signals.js';
export { normalizeCell, normalizeMoney, normalizeDate, normalizeStatus, detectFieldType, applyTextNormalization, type NormalizationResult, type TextNormalizationResult } from './pipeline/normalizer-rules.js';
export { validateInput, isFormulaColumn, isEditableColumn, getColumnDescription } from './pipeline/input-control.js';
export { type RecalculatedMetrics, type QuarterMetrics, type ActivityBreakdown, type SubordinateMetrics, type SubPeriodMetrics } from './pipeline/recalculate.js';
export { CalcEngine, standardRowFilter, getValue, sliceResults, approvedEconomy, DEFAULT_EXTRACTORS, STANDARD_METRICS, STANDARD_DERIVED, type RawRow, type GroupedResults, type AccumulatedValue, type MetricDefinition, type DerivedMetricDefinition, type SliceFilter, type GateCondition } from './pipeline/calc-engine.js';
export { adaptToRecalcMetrics } from './pipeline/calc-engine-adapter.js';
export { reconcile, reconcileMonthly, crossVerifyQuarterly, type ReconSummary, type ReconRow, type MonthlyReconSummary, type MonthlyReconRow, type MonthlyReconCell, type QuarterCrossSummary, type QuarterCrossRow, type QuarterCrossCell } from './pipeline/reconcile.js';
export { computeUnifiedGrid, reconcileUnified, type UnifiedOfficialMetric, type UnifiedReconRow, type UnifiedReconStatus } from './pipeline/unified-svod.js';
export { parseSHDYUSheet, validateSHDYUConsistency } from './pipeline/shdyu-ingest.js';
export { analyzeDataset, benfordTest, detectOutliers, classifyEpRisk, classifyExecution, computeCompositeScore, buildNoiseMap, detectDataAnomalies, detectBehavioralAnomalies, detectSystemicAnomalies } from './pipeline/dataset-signals.js';
export type { BenfordResult, OutlierResult, EpRiskClassification, EpRiskLevel, ExecutionLevel, AnomalySeverity, AnomalyResult, DataAnomaly, BehavioralAnomaly, SystemicAnomaly, CompositeScore, NoiseGroup, DatasetAnalysis, DatasetAnalysisInput } from './pipeline/dataset-signals.js';

// Analytics modules
export * from './analytics/index.js';

// Metrics KB registry
export { METRIC_KB, getMetricKB, getMetricTooltip, getMetricsByCategory, ALL_METRIC_KEYS } from './metrics/index.js';
export type { KBEntryData, MetricCategory, MetricUnit } from './metrics/index.js';

// Каноническая метрика «исполнение квартального плана» (G = E/D, канон СВОД + отчёт 20.03.2026)
export { quarterExecution, quarterExecutionFromCounts } from './metrics/quarter-execution.js';
export type { QuarterExecutionOptions, QuarterExecutionResult } from './metrics/quarter-execution.js';

// buildReport-проекция — сердце страницы «Отчёт» (фаза 1.4-1.5, дуга-3)
export { buildReport } from './report/build-report.js';
export type { BuildReportInput, BuildReportOptions } from './report/build-report.js';
export type {
  Report, ReportPeriod, ReportOrigin, IntegralSummary, GrbsReportBlock,
  GrbsQuarterSlice, GrbsYearSlice, MethodSplit, PlanFactCounts, BudgetMoney, ReportSignal, PendingPosition,
  PendingRemainder,
} from './report/types.js';

// History — snapshot-diff (слой 1 фичи «История изменений»)
export { diffMetrics, sentimentFor } from './history/snapshot-diff.js';
export type { Direction, Sentiment, MetricRow, MetricDelta } from './history/snapshot-diff.js';
