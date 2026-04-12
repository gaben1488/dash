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
export { recalculateFromRows, type RecalculatedMetrics, type QuarterMetrics, type ActivityBreakdown, type SubordinateMetrics, type SubPeriodMetrics } from './pipeline/recalculate.js';
export { CalcEngine, standardRowFilter, getValue, sliceResults, DEFAULT_EXTRACTORS, STANDARD_METRICS, STANDARD_DERIVED, type RawRow, type GroupedResults, type AccumulatedValue, type MetricDefinition, type DerivedMetricDefinition, type SliceFilter, type GateCondition } from './pipeline/calc-engine.js';
export { adaptToRecalcMetrics } from './pipeline/calc-engine-adapter.js';
export { reconcile, reconcileMonthly, crossVerifyQuarterly, type ReconSummary, type ReconRow, type MonthlyReconSummary, type MonthlyReconRow, type MonthlyReconCell, type QuarterCrossSummary, type QuarterCrossRow, type QuarterCrossCell } from './pipeline/reconcile.js';
export { parseSHDYUSheet } from './pipeline/shdyu-ingest.js';

// Analytics modules
export * from './analytics/index.js';

// Metrics KB registry
export { METRIC_KB, getMetricKB, getMetricTooltip, getMetricsByCategory, ALL_METRIC_KEYS } from './metrics/index.js';
export type { KBEntryData, MetricCategory, MetricUnit } from './metrics/index.js';
