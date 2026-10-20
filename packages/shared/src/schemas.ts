import { z } from 'zod';
import { SourceCoverageSchema } from './source-coverage.js';
import { ALL_DEPT_IDS } from './department-registry.js';

// ============================================================
// AEMR Platform — Zod Validation Schemas
// ============================================================

// ────────────────────────────────────────────────────────────
// 1. Domain literal unions
// ────────────────────────────────────────────────────────────

/** Department ID enum derived from canonical DEPARTMENT_REGISTRY */
export const DepartmentIdSchema = z.enum(ALL_DEPT_IDS as unknown as [string, ...string[]]);

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
  rowSeq: z.string().optional(),
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
  score: z.number().min(0).max(100).nullable(),
  issues: z.number().int(),
  criticalIssues: z.number().int(),
  details: z.string(),
});

export const TrustScoreSchema = z.object({
  overall: z.number().min(0).max(100).nullable(),
  components: z.array(TrustComponentSchema),
  grade: TrustGradeSchema.nullable(),
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
    targetYear: z.number().int().nullable().optional(),
    readModel: z.object({ state: z.enum(['refreshing', 'stale']) }).optional(),
    sourceCoverage: SourceCoverageSchema.optional(),
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
  months: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  planTotal: z.number().nullable(),
  factTotal: z.number().nullable(),
  executionPercent: z.number().nullable(),
  economyTotal: z.number().nullable(),
  economyFB: z.number().nullable().optional(),
  economyKB: z.number().nullable().optional(),
  economyMB: z.number().nullable().optional(),
  competitiveCount: z.number().nullable().optional(),
  soleCount: z.number().nullable().optional(),
  issueCount: z.number().int(),
  criticalIssueCount: z.number().int(),
  trustScore: z.number().nullable(),
  trustComponents: z.array(TrustComponentSchema).optional(),
  status: z.enum(['normal', 'warning', 'critical']),
  quarters: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  signalCounts: z.record(z.string(), z.number()).optional(),
  byActivity: z.record(z.string(), z.unknown()).optional(),
  subordinates: z.array(z.unknown()).optional(),
  economyConflicts: z.number().optional(),
});

export const DashboardPeriodSummarySchema = z.object({
  kpCount: z.number().nullable(),
  kpFactCount: z.number().nullable(),
  kpPlan: z.number().nullable(),
  kpFact: z.number().nullable(),
  kpPercent: z.number().nullable(),
  epCount: z.number().nullable(),
  epFactCount: z.number().nullable(),
  epPlan: z.number().nullable(),
  epFact: z.number().nullable(),
  epPercent: z.number().nullable(),
  fbPlan: z.number().nullable(),
  kbPlan: z.number().nullable(),
  mbPlan: z.number().nullable(),
  fbFact: z.number().nullable(),
  kbFact: z.number().nullable(),
  mbFact: z.number().nullable(),
  epFbPlan: z.number().nullable().optional(),
  epKbPlan: z.number().nullable().optional(),
  epMbPlan: z.number().nullable().optional(),
  epFbFact: z.number().nullable().optional(),
  epKbFact: z.number().nullable().optional(),
  epMbFact: z.number().nullable().optional(),
  source: z.enum(['official', 'calculated']),
});

export const DashboardIssueSummarySchema = z.object({
  total: z.number().int(),
  bySeverity: z.record(z.string(), z.number()),
  byCategory: z.record(z.string(), z.number()),
  byDepartment: z.record(z.string(), z.number()),
  byOrigin: z.record(z.string(), z.number()),
  signalCounts: z.record(z.string(), z.number()),
});

export const DashboardDataSchema = z.object({
  snapshot: DataSnapshotSchema,
  kpiCards: z.array(KPICardSchema),
  departmentSummaries: z.array(DepartmentSummarySchema),
  summaryByPeriod: z.record(z.string(), DashboardPeriodSummarySchema),
  recentIssues: z.array(IssueSchema),
  recentIssuesRef: z.literal('snapshot.issues').optional(),
  signalCounts: z.record(z.string(), z.number()),
  issueSummary: DashboardIssueSummarySchema,
  trust: TrustScoreSchema,
  lastRefreshed: z.string(),
  year: z.number().int(),
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

// ────────────────────────────────────────────────────────────
// 14. API route response contracts (для web fetchParsed)
// .passthrough(): лишние поля ответа не считаются ошибкой —
// страницы могут опираться на незадекларированные поля.
// ────────────────────────────────────────────────────────────

export const HealthResponseSchema = z.object({
  status: z.string(),
  timestamp: z.string(),
  service: z.string(),
}).passthrough();

export const PageInfoSchema = z.object({
  page: z.number(),
  limit: z.number(),
  total: z.number(),
  totalPages: z.number(),
});

/** GET /api/issues — status лениво (в БД встречается легаси 'closed') */
export const IssuesListResponseSchema = z.object({
  issues: z.array(IssueSchema.extend({ status: z.string() }).passthrough()),
  pagination: PageInfoSchema,
  counts: z.object({
    total: z.number(),
    byStatus: z.record(z.string(), z.number()),
    bySeverity: z.record(z.string(), z.number()),
  }).passthrough(),
}).passthrough();

/** Существующие Dash-решения и комментарии; не Google-посты и не правки ячеек. */
export const IssueHistoryEventSchema = z.object({
  eventId: z.string().min(1),
  issueId: z.string(),
  type: z.enum(['status_change', 'comment']),
  source: z.enum(['dash_decision', 'dash_comment']),
  at: z.string().min(1),
  author: z.string().nullable(),
  text: z.string().nullable(),
  from: z.string().optional(),
  to: z.string().optional(),
  reason: z.string().nullable().optional(),
  justification: z.string().nullable().optional(),
  responsible: z.string().nullable().optional(),
  deadline: z.string().nullable().optional(),
}).passthrough();
export type IssueHistoryEvent = z.infer<typeof IssueHistoryEventSchema>;

/** GET /api/issues/:id/history */
export const IssueHistoryResponseSchema = z.object({
  issueId: z.string(),
  history: z.array(IssueHistoryEventSchema),
}).passthrough();

/** GET /api/journal */
export const JournalEntrySchema = z.object({
  type: z.string(),
  timestamp: z.string().nullable().optional(),
  actor: z.string().nullable().optional(),
  action: z.string(),
  details: z.string().nullable().optional(),
}).passthrough();

export const JournalListResponseSchema = z.object({
  entries: z.array(JournalEntrySchema),
  pagination: PageInfoSchema,
  counts: z.object({
    total: z.number(),
    byAction: z.record(z.string(), z.number()),
  }).passthrough(),
}).passthrough();

/** GET /api/journal/stats */
export const JournalStatsResponseSchema = z.object({
  period: z.string(),
  totalActions: z.number(),
  uniqueUsers: z.number(),
  snapshotCount: z.number(),
  editCount: z.number(),
  errorCount: z.number(),
  issueCreated: z.number(),
  issueResolved: z.number(),
}).passthrough();

/** GET /api/sources */
export const SourceStatusSchema = z.object({
  name: z.string(),
  type: z.string(),
  spreadsheetId: z.string().nullable().optional(),
  status: z.string(),
  statusLabel: z.string(),
  lastSuccess: z.string().nullable(),
  rowCount: z.number().nullable(),
}).passthrough();

export const SourcesResponseSchema = z.object({
  sources: z.array(SourceStatusSchema),
  totalSources: z.number(),
  onlineCount: z.number(),
  errorCount: z.number(),
}).passthrough();

/** GET /api/history — таймлайн снимков */
export const SnapshotHistoryEntrySchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  trustOverall: z.number().nullable(),
  trustGrade: z.string().nullable(),
  issueCount: z.number().nullable(),
}).passthrough();

export const SnapshotHistoryResponseSchema = z.array(SnapshotHistoryEntrySchema);

/** GET /api/metrics — official/calculated + deltas текущего снимка */
export const MetricsResponseSchema = z.object({
  official: z.record(z.string(), NormalizedMetricSchema.passthrough()),
  calculated: z.record(z.string(), NormalizedMetricSchema.passthrough()),
  deltas: z.array(DeltaResultSchema.passthrough()),
}).passthrough();

/** Конкретные действия относятся к тому же замороженному выпуску, что и Word. */
export const ReportActionSchema = z.object({
  signal_id: z.string().min(1), code: z.string().min(1),
  severity: z.enum(['needs_attention', 'blocks_release']),
  owner_kind: z.enum(['SOURCE_OWNER', 'ENGINE']), owner: z.string().nullable(),
  user_action_required: z.boolean(), title: z.string(), cause: z.string(),
  report_effect: z.string(), action: z.string(), resolved_when: z.string(),
  recommendation_id: z.string().nullable(), source_row_key: z.string().nullable(),
  locations: z.array(z.object({
    source_id: z.string().nullable(), sheet: z.string().nullable(), sheet_id: z.number().int().nullable(),
    row: z.number().int().nullable(), column: z.string(), a1: z.string().nullable(), url: z.string().nullable(),
    subject: z.string().nullable(), business_id: z.string().nullable(),
  })),
});
// Frozen v1/v2 releases retain their contracts. v3 keeps repeated business
// labels as observations, with every address and no implied corrective action.
const ReportAssuranceCoreSchema = z.object({
  fully_automated: z.boolean(),
  user_action_count: z.number().int().nonnegative(), engine_action_count: z.number().int().nonnegative(),
  active_recommendations: z.number().int().nonnegative(),
  link_status_counts: z.record(z.string(), z.number().int().nonnegative()),
  action_status_counts: z.record(z.string(), z.number().int().nonnegative()),
  actions: z.array(ReportActionSchema), meaning: z.string(),
});
const ReportSourceStatementSchema = z.object({
  kind: z.enum(['NO_FUNDING_REPORTED', 'FUNDING_REPORTED', 'POSTPONED_REPORTED',
    'PLAN_YEAR_CHANGE_REPORTED', 'CONTRACT_DATE_REPORTED']),
  target: z.union([z.number().int(), z.string(), z.null()]),
  field: z.string(), column: z.string(), quote: z.string(),
  source_text: z.string(), evidence_kind: z.literal('SOURCE_STATEMENT'),
});
const ReportAssuranceV2Schema = ReportAssuranceCoreSchema.extend({
  contract: z.literal('actionable-assurance-v2'),
  source_observations: z.array(z.object({
    source_row_key: z.string().nullable(),
    events: z.array(ReportSourceStatementSchema),
  })),
  nonprocurement_identity_observations: z.number().int().nonnegative(),
});
export const ReportAssuranceSchema = z.discriminatedUnion('contract', [
  ReportAssuranceCoreSchema.extend({ contract: z.literal('actionable-assurance-v1') }),
  ReportAssuranceV2Schema,
  ReportAssuranceV2Schema.extend({
    contract: z.literal('actionable-assurance-v3'),
    business_id_observations: z.array(z.object({
      code: z.literal('DUPLICATE_BUSINESS_ID'), grbs: z.string().nullable(),
      business_id: z.string().nullable(), locations: ReportActionSchema.shape.locations,
      user_action_required: z.literal(false), meaning: z.string(),
    })),
  }),
]);
export type ReportAssurance = z.infer<typeof ReportAssuranceSchema>;

const ReportCommandRecordSchema = z.object({
  status: z.enum(['QUEUED', 'RUNNING', 'VERIFIED', 'VERIFIED_WITH_WARNINGS', 'NOT_ISSUED']),
  attempt_id: z.string().regex(/^[a-f0-9]{32}$/),
  requested_at: z.string().datetime({ offset: true }).optional(),
  started_at: z.string().datetime({ offset: true }).optional(),
  finished_at: z.string().datetime({ offset: true }).nullable().optional(),
  stage: z.enum(['inputs', 'acquisition', 'publication_selection', 'build', 'publication']).optional(),
  error_code: z.string().regex(/^[A-Z][A-Z0-9_]*$/).optional(),
  release_id: z.string().regex(/^REL-[a-f0-9]{64}$/).optional(),
}).strict();
export const ReportCommandSchema = ReportCommandRecordSchema.refine(command =>
  !['VERIFIED', 'VERIFIED_WITH_WARNINGS'].includes(command.status) || command.release_id !== undefined,
{ message: 'A published command requires its release receipt' });
export type ReportCommand = z.infer<typeof ReportCommandSchema>;
export const ReportRefreshResponseSchema = ReportCommandRecordSchema.extend({
  // Keep the acknowledgement understood by already-open older browser tabs.
  // Actual execution state is read from the durable command endpoint.
  status: z.enum(['STARTED', 'RUNNING']),
  message: z.string(),
});
export type ReportRefreshResponse = z.infer<typeof ReportRefreshResponseSchema>;

/** Brief weekly facts from the frozen Word publication, not the live dashboard. */
export const PublishedWeeklySummarySchema = z.object({
  status: z.enum(['NOT_AVAILABLE', 'INCOMPARABLE', 'COMPARABLE']),
  baseline_date: z.string().nullable(),
  message: z.string(),
  totals: z.array(z.object({
    label: z.string(),
    plan_before: z.number(), plan_after: z.number(),
    fact_before: z.number(), fact_after: z.number(),
  })),
  changes: z.array(z.object({ label: z.string(), count: z.number().int().nonnegative() })),
  examples: z.array(z.string()),
  unmatched_positions: z.number().int().nonnegative(),
  recommendations_added: z.number().int().nonnegative(),
  recommendations_revised: z.number().int().nonnegative(),
  procedure_stage_changes: z.number().int().nonnegative(),
});
export type PublishedWeeklySummary = z.infer<typeof PublishedWeeklySummarySchema>;

/** Сохранённый выпуск: дата и идентификатор не зависят от живого дашборда. */
export const PublishedReleaseSchema = z.object({
  release_id: z.string().regex(/^REL-[a-f0-9]{64}$/),
  snapshot_id: z.string().min(1),
  report_date: z.string().regex(/^\d{2}\.\d{2}\.\d{4}$/),
  cutoff_at: z.string().datetime({ offset: true }),
  published_at: z.string().datetime({ offset: true }),
  model_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  rules_version: z.string().min(1),
  renderer_version: z.string().min(1),
  status: z.enum(['VERIFIED', 'VERIFIED_WITH_WARNINGS']),
  operational_available: z.boolean().optional(),
  /** False retains exact artifacts/context but makes no source-replay promise. */
  replay_available: z.boolean().optional(),
  automation_assurance: ReportAssuranceSchema.optional(),
  /** Equal evidence of this release remains complete in the selected DTO. */
  automation_assurance_release_id: z.string().regex(/^REL-[a-f0-9]{64}$/).optional(),
  weekly_summary: PublishedWeeklySummarySchema.optional(),
});

/** Current worker observations; independent of the selected Word's historical cutoff. */
export const ReportOperationsSchema = z.object({
  checked_at: z.string().datetime({ offset: true }),
  worker_state: z.enum(['idle', 'running', 'interrupted', 'unknown']),
  running_duration_seconds: z.number().int().nonnegative().safe().nullable(),
  last_cycle_duration_seconds: z.number().int().nonnegative().safe().nullable(),
  last_success_at: z.string().datetime({ offset: true }).nullable(),
  last_success_age_seconds: z.number().int().nonnegative().safe().nullable(),
  check_stale: z.boolean(),
  last_failure_at: z.string().datetime({ offset: true }).nullable(),
  last_failure_code: z.string().regex(/^[A-Z][A-Z0-9_]{1,100}$/).nullable(),
  last_failure_stage: z.enum(['inputs', 'acquisition', 'publication_selection', 'build', 'publication']).nullable(),
  failure_resolved: z.boolean(),
  publication_cutoff_at: z.string().datetime({ offset: true }).nullable(),
});
export type ReportOperations = z.infer<typeof ReportOperationsSchema>;

export const ReportReleaseStatusSchema = z.object({
  operations: ReportOperationsSchema.optional(),
  latest: PublishedReleaseSchema.nullable(),
  attempt: z.object({
    status: z.enum(['RUNNING', 'NOT_ISSUED', 'VERIFIED', 'VERIFIED_WITH_WARNINGS']),
    report_date: z.string().optional(),
    started_at: z.string().datetime({ offset: true }).optional(),
    blockers: z.array(z.object({ code: z.string(), message: z.string() })).optional(),
    error_code: z.string().optional(),
    automation_assurance: ReportAssuranceSchema.nullable().optional(),
    automation_assurance_release_id: z.string().regex(/^REL-[a-f0-9]{64}$/).optional(),
  }).nullable(),
});
export type ReportReleaseStatus = z.infer<typeof ReportReleaseStatusSchema>;

export const ArchivePreparationSchema = z.object({
  status: z.enum(['READY', 'RUNNING', 'NOT_ISSUED']),
  code: z.enum(['ARCHIVE_READY', 'ARCHIVE_BUSY', 'ARCHIVE_NOT_FOUND', 'ARCHIVE_INPUT_INCOMPLETE',
    'ARCHIVE_CORRUPT', 'ARCHIVE_CHANGED', 'ARCHIVE_BUILD_FAILED']),
  message: z.string(),
  coverage: z.object({ departments: z.number().int().nonnegative(), rows: z.number().int().nonnegative(),
    missing_sections: z.array(z.string()) }).optional(),
});

/** Strict receipt context for exact and last-in-period frozen Word. */
const ContextualPublishedReleaseSchema = PublishedReleaseSchema.extend({
  report_year: z.number().int().min(1900).max(9999),
  quarter: z.number().int().min(1).max(4),
});

export const SelectedReportReleaseStatusSchema = z.object({
  operations: ReportOperationsSchema.optional(),
  archive: ArchivePreparationSchema.optional(),
  attempt: ReportReleaseStatusSchema.shape.attempt,
  selected: ContextualPublishedReleaseSchema.nullable(),
  /** Read-only period fallback; old Python engines may omit this key. */
  latest_matching: ContextualPublishedReleaseSchema.nullable().optional(),
});
export type SelectedReportReleaseStatus = z.infer<typeof SelectedReportReleaseStatusSchema>;
