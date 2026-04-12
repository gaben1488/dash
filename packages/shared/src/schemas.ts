import { z } from 'zod';

// ============================================================
// AEMR Platform — Zod Validation Schemas
// ============================================================

// ────────────────────────────────────────────────────────────
// 1. Domain literal unions
// ────────────────────────────────────────────────────────────

export const DepartmentIdSchema = z.enum([
  'УЭР', 'УИО', 'УАГЗО', 'УФБП', 'УД', 'УДТХ', 'УКСиМП', 'УО',
]);

export const ProcurementMethodSchema = z.enum(['ЭА', 'ЕП', 'ЭК', 'ЭЗК']);

export const ProcurementTypeSchema = z.enum([
  'Текущая деятельность',
  'Программное мероприятие',
]);

export const BudgetLevelSchema = z.enum(['fb', 'kb', 'mb']);

export const MoneyUnitSchema = z.enum(['тыс. руб.', 'млн руб.', 'млрд руб.']);

// ────────────────────────────────────────────────────────────
// 2. Analytical / pipeline enums
// ────────────────────────────────────────────────────────────

export const MetricOriginSchema = z.enum(['official', 'calculated', 'hybrid']);

export const PeriodScopeSchema = z.enum([
  'annual', 'q1', 'q2', 'q3', 'q4', 'monthly', 'cumulative',
]);

export const ValueTypeSchema = z.enum([
  'number', 'currency', 'percent', 'date', 'text', 'integer', 'boolean',
]);

export const UnitTypeSchema = z.enum([
  'rubles', 'thousand_rubles', 'million_rubles', 'count', 'percent', 'days', 'none',
]);

export const ProcurementKindSchema = z.enum([
  'competitive', 'single_source', 'electronic_auction', 'request_quotations', 'tender', 'all',
]);

export const RowClassificationSchema = z.enum([
  'procurement', 'procurement_derived', 'service', 'separator', 'summary', 'note', 'header', 'unknown',
]);

export const IssueSeveritySchema = z.enum(['error', 'warning', 'info', 'significant', 'critical']);

export const RuleSeveritySchema = z.enum(['error', 'warning', 'info']);

export const ControlIssueSeveritySchema = z.enum(['error', 'warning', 'info']);

export const RuleScopeSchema = z.enum(['svod', 'department', 'both']);

export const IssueOriginSchema = z.enum([
  'spreadsheet_rule', 'bi_heuristic', 'delta_mismatch', 'runtime_error', 'mapping_error', 'language_defect',
]);

export const ControlIssueOriginSchema = z.enum(['spreadsheet_rule', 'bi_heuristic']);

export const IssueStatusSchema = z.enum([
  'open', 'acknowledged', 'in_progress', 'resolved', 'wont_fix', 'false_positive',
]);

export const TrustGradeSchema = z.enum(['A', 'B', 'C', 'D', 'F']);

// ────────────────────────────────────────────────────────────
// 3. Budget breakdown
// ────────────────────────────────────────────────────────────

export const BudgetBreakdownSchema = z.object({
  fb: z.number(),
  kb: z.number(),
  mb: z.number(),
  total: z.number(),
});

// ────────────────────────────────────────────────────────────
// 4. Department metrics (from СВОД)
// ────────────────────────────────────────────────────────────

export const PeriodMetricsSchema = z.object({
  planned: z.number(),
  fact: z.number(),
  deviation: z.number(),
  executionPct: z.number(),
  planSum: BudgetBreakdownSchema,
  factSum: BudgetBreakdownSchema,
});

export const CompetitiveMetricsSchema = z.object({
  q1: PeriodMetricsSchema,
  year: PeriodMetricsSchema,
  economy: z.number().nullable(),
});

export const SoleSupplierMetricsSchema = z.object({
  q1: PeriodMetricsSchema,
  year: PeriodMetricsSchema,
  economy: z.number().nullable(),
  epSharePct: z.number(),
});

export const DepartmentMetricsSchema = z.object({
  id: DepartmentIdSchema,
  competitive: CompetitiveMetricsSchema,
  soleSupplier: SoleSupplierMetricsSchema,
});

// ────────────────────────────────────────────────────────────
// 5. Row-level data
// ────────────────────────────────────────────────────────────

export const ProcurementRowSchema = z.object({
  rowIndex: z.number().int(),
  id: z.string().nullable(),
  description: z.string().nullable(),
  type: ProcurementTypeSchema.nullable(),
  method: ProcurementMethodSchema.nullable(),
  planAmounts: BudgetBreakdownSchema,
  factAmounts: BudgetBreakdownSchema,
  planDate: z.string().nullable(),
  factDate: z.string().nullable(),
  status: z.string().nullable(),
  comment: z.string().nullable(),
  hasFormula: z.record(z.string(), z.boolean()),
});

// ────────────────────────────────────────────────────────────
// 6. Row signals
// ────────────────────────────────────────────────────────────

export const RowSignalSchema = z.object({
  signed: z.boolean(),
  planning: z.boolean(),
  notDue: z.boolean(),
  financeDelay: z.boolean(),
  canceled: z.boolean(),
  overdue: z.boolean(),
  hasFact: z.boolean(),
  planPast: z.boolean(),
  planSoon: z.boolean(),
  inconsistentSigned: z.boolean(),
});

// ────────────────────────────────────────────────────────────
// 7. Control layer
// ────────────────────────────────────────────────────────────

export const ControlIssueSchema = z.object({
  id: z.string(),
  ruleId: z.string(),
  severity: ControlIssueSeveritySchema,
  origin: ControlIssueOriginSchema,
  department: z.union([DepartmentIdSchema, z.literal('СВОД')]),
  sheet: z.string(),
  cell: z.string(),
  row: z.number().int(),
  message: z.string(),
  expected: z.unknown(),
  actual: z.unknown(),
});

export const IssueSchema = z.object({
  id: z.string(),
  severity: IssueSeveritySchema,
  origin: IssueOriginSchema,
  category: z.string(),
  title: z.string(),
  description: z.string(),
  sheet: z.string().optional(),
  cell: z.string().optional(),
  row: z.number().optional(),
  metricKey: z.string().optional(),
  departmentId: z.string().optional(),
  recommendation: z.string().optional(),
  status: IssueStatusSchema,
  detectedAt: z.string(),
  detectedBy: z.string(),
});

// ────────────────────────────────────────────────────────────
// 8. Trust score
// ────────────────────────────────────────────────────────────

export const TrustComponentSchema = z.object({
  name: z.string(),
  label: z.string(),
  weight: z.number(),
  score: z.number().min(0).max(100),
  issues: z.number().int(),
  criticalIssues: z.number().int(),
  details: z.string(),
});

export const TrustScoreSchema = z.object({
  overall: z.number().min(0).max(100),
  components: z.array(TrustComponentSchema),
  grade: TrustGradeSchema,
  computedAt: z.string(),
  basedOnSnapshot: z.string(),
});

// ────────────────────────────────────────────────────────────
// 9. Snapshot / workbook
// ────────────────────────────────────────────────────────────

export const CellValueSchema = z.object({
  v: z.unknown(),
  f: z.string().optional(),
});

export const SheetDataSchema = z.record(z.string(), CellValueSchema.optional());

export const WorkbookSnapshotSchema = z.object({
  sheets: z.record(z.string(), SheetDataSchema),
  loadedAt: z.string(),
  spreadsheetId: z.string(),
});

// ────────────────────────────────────────────────────────────
// 10. Dashboard payload (new model)
// ────────────────────────────────────────────────────────────

export const DashboardPayloadSchema = z.object({
  snapshot: WorkbookSnapshotSchema,
  summary: DepartmentMetricsSchema,
  departments: z.array(DepartmentMetricsSchema),
  issues: z.array(ControlIssueSchema),
  trust: TrustScoreSchema,
  rows: z.record(DepartmentIdSchema, z.array(ProcurementRowSchema)),
});

// ────────────────────────────────────────────────────────────
// 11. Legacy pipeline schemas
// ────────────────────────────────────────────────────────────

export const RawCellValueSchema = z.object({
  sheet: z.string(),
  cell: z.string(),
  rawValue: z.unknown(),
  formattedValue: z.string().nullable(),
  formula: z.string().nullable(),
  valueType: z.string(),
  readAt: z.string(),
});

export const NormalizedMetricSchema = z.object({
  metricKey: z.string(),
  value: z.union([z.number(), z.string(), z.boolean(), z.null()]),
  numericValue: z.number().nullable(),
  displayValue: z.string(),
  origin: MetricOriginSchema,
  period: PeriodScopeSchema,
  unit: UnitTypeSchema,
  sourceSheet: z.string(),
  sourceCell: z.string(),
  formula: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  readAt: z.string(),
  warnings: z.array(z.string()),
});

export const DeltaResultSchema = z.object({
  metricKey: z.string(),
  label: z.string(),
  officialValue: z.number().nullable(),
  calculatedValue: z.number().nullable(),
  delta: z.number().nullable(),
  deltaPercent: z.number().nullable(),
  withinTolerance: z.boolean(),
  explanation: z.string(),
});

export const DataSnapshotSchema = z.object({
  id: z.string(),
  spreadsheetId: z.string(),
  createdAt: z.string(),
  officialMetrics: z.record(z.string(), NormalizedMetricSchema),
  calculatedMetrics: z.record(z.string(), NormalizedMetricSchema),
  deltas: z.array(DeltaResultSchema),
  issues: z.array(IssueSchema),
  trust: TrustScoreSchema,
  rowCount: z.number().int(),
  metadata: z.object({
    sheetsRead: z.array(z.string()),
    cellsRead: z.number().int(),
    readDurationMs: z.number(),
    pipelineDurationMs: z.number(),
    perSheetRowCount: z.record(z.string(), z.number()).optional(),
  }),
});

// ────────────────────────────────────────────────────────────
// 12. API response schemas
// ────────────────────────────────────────────────────────────

export const KPICardSchema = z.object({
  metricKey: z.string(),
  label: z.string(),
  value: z.string(),
  numericValue: z.number().nullable(),
  unit: z.string(),
  period: z.string(),
  trend: z.enum(['up', 'down', 'stable']).optional(),
  trendValue: z.string().optional(),
  origin: MetricOriginSchema,
  sourceCell: z.string(),
  status: z.enum(['normal', 'warning', 'critical']),
  delta: z.object({
    calculatedValue: z.string(),
    deltaPercent: z.string(),
    withinTolerance: z.boolean(),
  }).optional(),
});

export const DepartmentSummarySchema = z.object({
  department: z.object({
    id: z.string(),
    name: z.string(),
    nameShort: z.string(),
    sheetName: z.string(),
    svodRange: z.object({ startRow: z.number(), endRow: z.number() }),
    controlCells: z.record(z.string(), z.string()),
  }),
  planTotal: z.number().nullable(),
  factTotal: z.number().nullable(),
  executionPercent: z.number().nullable(),
  economyTotal: z.number().nullable(),
  economyFB: z.number().nullable().optional(),
  economyKB: z.number().nullable().optional(),
  economyMB: z.number().nullable().optional(),
  issueCount: z.number().int(),
  criticalIssueCount: z.number().int(),
  trustScore: z.number(),
  status: z.enum(['normal', 'warning', 'critical']),
});

export const DashboardDataSchema = z.object({
  snapshot: DataSnapshotSchema,
  kpiCards: z.array(KPICardSchema),
  departmentSummaries: z.array(DepartmentSummarySchema),
  recentIssues: z.array(IssueSchema),
  trust: TrustScoreSchema,
  lastRefreshed: z.string(),
});

/** Generic API envelope */
export const ApiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    ok: z.boolean(),
    data: dataSchema.optional(),
    error: z.string().optional(),
    timestamp: z.string(),
  });

export const PaginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  });

// ────────────────────────────────────────────────────────────
// 13. API request schemas
// ────────────────────────────────────────────────────────────

export const RefreshRequestSchema = z.object({
  force: z.boolean().optional().default(false),
});

export const IssueUpdateSchema = z.object({
  status: IssueStatusSchema,
  comment: z.string().optional(),
});

export const SettingsUpdateSchema = z.object({
  cacheTtl: z.number().min(30).max(3600).optional(),
  enabledChecks: z.array(z.string()).optional(),
});
