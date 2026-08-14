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
export { CalcEngine, classifyMethodGroup, standardRowFilter, getValue, sliceResults, slicePeriods, approvedEconomy, DEFAULT_EXTRACTORS, STANDARD_METRICS, STANDARD_DERIVED, type RawRow, type GroupedResults, type AccumulatedValue, type MetricDefinition, type DerivedMetricDefinition, type SliceFilter, type GateCondition } from './pipeline/calc-engine.js';
export {
  classifyUnfunded, classifyFactQuarterMissing, classifyAfterSlice,
  classifySign, classifyMethod, classifyCancelled, classifyParsing,
  columnLetter, sheetRowOf, type ReconMeasure, type ClassifyInput,
} from './pipeline/recon-classify.js';
export { buildRootCauses, explainReconLine, linkCascades, type BuildCausesInput } from './pipeline/recon-causes.js';
// Экономические метрики целевого дизайна: каждая с паспортом, порогами и
// классификатором зоны (см. docs/superpowers/plans/2026-08-07-launch-readiness.md §2).
export {
  decemberOverhang, planningAccuracy, sourceExecutionGap, quarterCompliance,
  classifyDecemberOverhang, classifyPlanningAccuracy, classifySourceExecutionGap,
  classifyQuarterCompliance, planningAccuracyGrade,
  DECEMBER_OVERHANG_THRESHOLDS, PLANNING_ACCURACY_GRADES,
  SOURCE_GAP_THRESHOLDS, QUARTER_COMPLIANCE_THRESHOLDS,
  type BudgetSource, type MetricZone, type RatioValue,
  type DecemberOverhangOptions, type DecemberOverhangResult,
  type PlanningAccuracyOptions, type PlanningAccuracyResult,
  type SourceExecutionGapOptions, type SourceExecutionGapResult,
  type QuarterComplianceOptions, type QuarterComplianceResult,
} from './metrics/economic.js';
export { adaptToRecalcMetrics } from './pipeline/calc-engine-adapter.js';
export { reconcile, reconcileMonthly, crossVerifyQuarterly, type ReconSummary, type ReconRow, type MonthlyReconSummary, type MonthlyReconRow, type MonthlyReconCell, type QuarterCrossSummary, type QuarterCrossRow, type QuarterCrossCell } from './pipeline/reconcile.js';
export { computeUnifiedGrid, reconcileUnified, type UnifiedOfficialMetric, type UnifiedReconRow, type UnifiedReconStatus } from './pipeline/unified-svod.js';
export { parseSHDYUSheet, validateSHDYUConsistency } from './pipeline/shdyu-ingest.js';
export { linkRowsToProcedures, buildProcedureIndex, type ProcedureLinkRow, type ProcedureLink, type ProcedureIndex } from './pipeline/procedure-link.js';
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
export { buildReport, sumPending } from './report/build-report.js';
export type { BuildReportInput, BuildReportOptions } from './report/build-report.js';
export type {
  Report, ReportPeriod, ReportOrigin, IntegralSummary, GrbsReportBlock,
  GrbsQuarterSlice, GrbsYearSlice, MethodSplit, PlanFactCounts, BudgetMoney, ReportSignal, PendingPosition,
  PendingRemainder, LifecycleBreakdown, LifecycleBucket, ReasonBreakdown, ReasonBucket,
} from './report/types.js';

// Comments — несогласованность комментария со структурой (п.72а: этапность при
// заключённом, просроченное обещание; п.74б: посторонний текст в AG)
export { detectCommentInconsistencies } from './pipeline/comment-consistency.js';
export type {
  CommentAnnotation, CommentColumn, CommentInconsistencyKind, CommentRowRef,
  MonitoringStageContext,
} from './pipeline/comment-consistency.js';

// History — snapshot-diff (слой 1 фичи «История изменений»)
export { diffMetrics, sentimentFor } from './history/snapshot-diff.js';
export type { Direction, Sentiment, MetricRow, MetricDelta } from './history/snapshot-diff.js';

// Timeline — таймлайн строки по всей истории проекта (канон п.75в) +
// «закупки, близкие к реализации» (п.75б) + срезы архивных недель
export { buildRowTimeline } from './timeline/row-timeline.js';
export type {
  RowTimeline, TimelineEvent, TimelineEventKind, TimelineSource,
  RowTimelineInput, RowObservation, JournalCellChange,
} from './timeline/row-timeline.js';
export { buildUpcoming } from './timeline/upcoming.js';
export type { UpcomingInputRow, UpcomingOptions, UpcomingRiskRow, UpcomingReason } from './timeline/upcoming.js';
export { weekSliceObservations, WEEK_SLICE_DATES } from './timeline/week-slices.js';
export type { WeekSliceKey, WeekSliceObservation } from './timeline/week-slices.js';
