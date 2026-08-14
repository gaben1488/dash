// ============================================================
// AEMR Platform — Core Type Definitions
// ============================================================

import type { UnifiedGrid, SvodReconRow } from './unified-svod.js';
import type { SvodGridBlock } from './svod-grid.js';

// ────────────────────────────────────────────────────────────
// 1. Domain literal unions
// ────────────────────────────────────────────────────────────

/** Идентификатор управления / ГРБС */
export type DepartmentId =
  | 'УЭР'
  | 'УИО'
  | 'УАГЗО'
  | 'УФБП'
  | 'УД'
  | 'УДТХ'
  | 'УКСиМП'
  | 'УО';

/** Способ закупки */
export type ProcurementMethod = 'ЭА' | 'ЕП' | 'ЭК' | 'ЭЗК';

/** Тип закупки */
export type ProcurementType = 'Текущая деятельность' | 'Программное мероприятие';

/** Уровень бюджета: fb = федеральный, kb = краевой, mb = муниципальный */
export type BudgetLevel = 'fb' | 'kb' | 'mb';

/** Единица отображения денежных сумм */
export type MoneyUnit = 'тыс. руб.' | 'млн руб.' | 'млрд руб.';

// ────────────────────────────────────────────────────────────
// 2. Analytical / pipeline enums
// ────────────────────────────────────────────────────────────

/** Источник значения метрики */
export type MetricOrigin = 'official' | 'calculated' | 'hybrid';

/** Период */
export type PeriodScope = 'annual' | 'q1' | 'q2' | 'q3' | 'q4' | 'monthly' | 'cumulative';

/** Тип значения */
export type ValueType = 'number' | 'currency' | 'percent' | 'date' | 'text' | 'integer' | 'boolean';

/** Единица измерения (внутренняя) */
export type UnitType = 'rubles' | 'thousand_rubles' | 'million_rubles' | 'count' | 'percent' | 'days' | 'none';

/** Вид закупки (аналитический) */
export type ProcurementKind = 'competitive' | 'single_source' | 'electronic_auction' | 'request_quotations' | 'tender' | 'all';

/** Классификация строки */
export type RowClassification =
  | 'procurement'
  | 'procurement_derived'
  | 'service'
  | 'separator'
  | 'summary'
  | 'note'
  | 'header'
  | 'unknown';

/** Серьёзность проблемы (включает legacy-значения для обратной совместимости) */
export type IssueSeverity = 'error' | 'warning' | 'info' | 'significant' | 'critical';

/** Серьёзность правила валидации */
export type RuleSeverity = 'error' | 'warning' | 'info';

/** Серьёзность контрольного замечания (новая модель, только 3 уровня) */
export type ControlIssueSeverity = 'error' | 'warning' | 'info';

/** Область применения правила */
export type RuleScope = 'svod' | 'department' | 'both';

/** Источник проблемы (включает legacy-значения для обратной совместимости) */
export type IssueOrigin =
  | 'spreadsheet_rule'
  | 'bi_heuristic'
  | 'delta_mismatch'
  | 'runtime_error'
  | 'mapping_error'
  | 'language_defect';

/** Источник контрольного замечания (новая модель, только 2 значения) */
export type ControlIssueOrigin = 'spreadsheet_rule' | 'bi_heuristic';

/** Тип профиля поля */
export type FieldProfile = 'formula' | 'manual' | 'validated' | 'protected' | 'reference' | 'status' | 'date' | 'amount' | 'control_flag';

/** Статус проблемы */
export type IssueStatus = 'open' | 'acknowledged' | 'in_progress' | 'resolved' | 'wont_fix' | 'false_positive';

/** Буква оценки доверия */
export type TrustGrade = 'A' | 'B' | 'C' | 'D' | 'F';

// ────────────────────────────────────────────────────────────
// 3. Budget breakdown
// ────────────────────────────────────────────────────────────

/** Разбивка по уровням бюджета */
export interface BudgetBreakdown {
  /** Федеральный бюджет */
  fb: number;
  /** Краевой бюджет */
  kb: number;
  /** Муниципальный бюджет */
  mb: number;
  /** Итого */
  total: number;
}

// ────────────────────────────────────────────────────────────
// 4. Department metrics (extracted from СВОД ТД-ПМ)
// ────────────────────────────────────────────────────────────

/** Метрики за один период (квартал или год) */
export interface PeriodMetrics {
  /** Количество процедур (план) */
  planned: number;
  /** Количество процедур (факт) */
  fact: number;
  /** Отклонение (план - факт) */
  deviation: number;
  /** Процент исполнения */
  executionPct: number;
  /** Плановые суммы по бюджетам */
  planSum: BudgetBreakdown;
  /** Фактические суммы по бюджетам */
  factSum: BudgetBreakdown;
}

/** Метрики конкурентных процедур */
export interface CompetitiveMetrics {
  q1: PeriodMetrics;
  year: PeriodMetrics;
  /** Экономия по конкурентным процедурам (тыс. руб.), null если нет данных */
  economy: number | null;
}

/** Метрики закупок у единственного поставщика */
export interface SoleSupplierMetrics {
  q1: PeriodMetrics;
  year: PeriodMetrics;
  /** Экономия по ЕП (тыс. руб.), null если нет данных */
  economy: number | null;
  /** Доля ЕП в общем объёме закупок (%) */
  epSharePct: number;
}

/** Метрики одного управления, извлечённые из сводного листа */
export interface DepartmentMetrics {
  id: DepartmentId;
  competitive: CompetitiveMetrics;
  soleSupplier: SoleSupplierMetrics;
}

// ────────────────────────────────────────────────────────────
// 5. Row-level data (from department sheets)
// ────────────────────────────────────────────────────────────

/** Строка закупки из листа управления */
export interface ProcurementRow {
  /** Номер строки в листе */
  rowIndex: number;
  /** Реестровый номер закупки */
  id: string | null;
  /** Наименование / описание */
  description: string | null;
  /** Тип: текущая деятельность или программное мероприятие */
  type: ProcurementType | null;
  /** Способ закупки */
  method: ProcurementMethod | null;
  /** Плановые суммы по бюджетам */
  planAmounts: BudgetBreakdown;
  /** Фактические суммы по бюджетам */
  factAmounts: BudgetBreakdown;
  /** Плановая дата (ISO или "dd.MM.yyyy") */
  planDate: string | null;
  /** Фактическая дата */
  factDate: string | null;
  /** Статус процедуры */
  status: string | null;
  /** Комментарий */
  comment: string | null;
  /** Карта «столбец -> содержит ли формулу» */
  hasFormula: Record<string, boolean>;
}

// ────────────────────────────────────────────────────────────
// 7. Control layer
// ────────────────────────────────────────────────────────────

/** Проблема контроля качества (компактная, для dashboard) */
export interface ControlIssue {
  id: string;
  ruleId: string;
  severity: ControlIssueSeverity;
  origin: ControlIssueOrigin;
  department: DepartmentId | 'СВОД';
  sheet: string;
  cell: string;
  row: number;
  message: string;
  expected: unknown;
  actual: unknown;
}

/** Проблема (расширенная, для pipeline / аудит-лога) */
export interface Issue {
  id: string;
  severity: IssueSeverity;
  origin: IssueOrigin;
  category: string;
  title: string;
  description: string;
  sheet?: string;
  cell?: string;
  row?: number;
  metricKey?: string;
  departmentId?: string;
  /** Subordinate org name from col C ("_org_itself" when col C is empty) */
  subordinateId?: string;
  recommendation?: string;
  /** Activity type derived from row column F (TYPE) */
  activityType?: 'program' | 'current_program' | 'current_non_program';
  /** Signal key from detectSignals() (overdue, stalledContract, factExceedsPlan, etc.) */
  signal?: string;
  /** Issue group from unified class system (data_integrity, temporal, financial, etc.) */
  group?: string;
  /** Check ID from CHECK_REGISTRY (budget_sum_plan, overdue, etc.) */
  checkId?: string;
  /** KB hint from CHECK_REGISTRY for UI tooltips */
  kbHint?: string;
  status: IssueStatus;
  detectedAt: string;
  detectedBy: string;
}

// ────────────────────────────────────────────────────────────
// 8. Trust score
// ────────────────────────────────────────────────────────────

/** Компонент скоринга доверия */
export interface TrustComponent {
  name: string;
  label: string;
  weight: number;
  score: number;
  issues: number;
  criticalIssues: number;
  details: string;
}

/** Общая оценка доверия */
export interface TrustScore {
  overall: number;
  components: TrustComponent[];
  grade: TrustGrade;
  computedAt: string;
  basedOnSnapshot: string;
}

// ────────────────────────────────────────────────────────────
// 9. Snapshot / workbook
// ────────────────────────────────────────────────────────────

/** Ячейка листа: v = значение, f = формула (опционально) */
export interface CellValue {
  v: unknown;
  f?: string;
}

/** Данные одного листа: ключ = адрес ячейки (напр. "D14") */
export type SheetData = Record<string, CellValue | undefined>;

/** Снимок всей книги */
export interface WorkbookSnapshot {
  sheets: Record<string, SheetData>;
  loadedAt: string;
  spreadsheetId: string;
}

// ────────────────────────────────────────────────────────────
// 10. Dashboard aggregate (new model)
// ────────────────────────────────────────────────────────────

/** Полный пакет данных для фронтенда */
export interface DashboardPayload {
  snapshot: WorkbookSnapshot;
  summary: DepartmentMetrics;
  departments: DepartmentMetrics[];
  issues: ControlIssue[];
  trust: TrustScore;
  rows: Record<DepartmentId, ProcurementRow[]>;
}

// ────────────────────────────────────────────────────────────
// 11. Legacy / backward-compatible types (used by report-map,
//     pipeline modules, server routes)
// ────────────────────────────────────────────────────────────

/** Департамент / ГРБС (legacy, used by report-map.ts) */
export interface Department {
  id: string;
  name: string;
  nameShort: string;
  sheetName: string;
  svodRange: { startRow: number; endRow: number };
  controlCells: Record<string, string>;
}

/** Запись маппинга: метрика -> ячейка */
export interface ReportMapEntry {
  metricKey: string;
  label: string;
  description?: string;
  originType: MetricOrigin;
  period: PeriodScope;
  valueType: ValueType;
  sourceUnit: UnitType;
  displayUnit: UnitType;
  sourceSheet: string;
  sourceCell: string;
  procurementKind?: ProcurementKind;
  group: string;
  subgroup?: string;
  departmentId?: string;
  fallbackPolicy: 'null' | 'zero' | 'last_known' | 'error';
  tolerance?: number;
  validationNotes?: string;
}

/** Считанное сырое значение из Google Sheets */
export interface RawCellValue {
  sheet: string;
  cell: string;
  rawValue: unknown;
  formattedValue: string | null;
  formula: string | null;
  valueType: string;
  readAt: string;
}

/** Нормализованное значение метрики */
export interface NormalizedMetric {
  metricKey: string;
  value: number | string | boolean | null;
  numericValue: number | null;
  displayValue: string;
  origin: MetricOrigin;
  period: PeriodScope;
  unit: UnitType;
  sourceSheet: string;
  sourceCell: string;
  formula: string | null;
  confidence: number;
  readAt: string;
  warnings: string[];
}

/** Результат дельта-проверки */
export interface DeltaResult {
  metricKey: string;
  label: string;
  officialValue: number | null;
  calculatedValue: number | null;
  delta: number | null;
  deltaPercent: number | null;
  withinTolerance: boolean;
  explanation: string;
}

/** Классифицированная строка данных */
export interface ClassifiedRow {
  rowIndex: number;
  sheet: string;
  classification: RowClassification;
  classificationConfidence: number;
  cells: Record<string, unknown>;
  classificationReasons: string[];
}

/** Контекст для проверки правила */
export interface RuleCheckContext {
  cells: Record<string, unknown>;
  rowIndex: number;
  sheet: string;
  classification: RowClassification;
  allRows?: ClassifiedRow[];
}

/** Результат проверки одного правила на одной строке */
export interface RuleCheckResult {
  passed: boolean;
  message?: string;
  cell?: string;
  actual?: unknown;
  expected?: unknown;
}

/** Правило валидации из RuleBook */
export interface ValidationRule {
  id: string;
  name: string;
  description: string;
  severity: RuleSeverity;
  origin: IssueOrigin;
  scope: RuleScope;
  check: (ctx: RuleCheckContext) => RuleCheckResult;
  /** @deprecated use scope */
  appliesTo?: string[];
  /** @deprecated */
  rowFilter?: RowClassification[];
  /** @deprecated */
  type?: string;
  /** @deprecated */
  enabled?: boolean;
  /** Parameters for rule execution */
  params: Record<string, unknown>;
}

/** Снимок данных (pipeline output) */
export interface DataSnapshot {
  id: string;
  spreadsheetId: string;
  createdAt: string;
  officialMetrics: Record<string, NormalizedMetric>;
  calculatedMetrics: Record<string, NormalizedMetric>;
  deltas: DeltaResult[];
  issues: Issue[];
  trust: TrustScore;
  rowCount: number;
  /** Per-department recalculation results (keyed by deptId: uer, uio, etc.) */
  recalcResults?: Record<string, any>;
  /** ШДЮ monthly dynamics data (keyed by grbsId) */
  shdyuData?: Record<string, any>;
  /** Единая сетка СВОД (ГРБС × активность(4) × метод × период), CalcEngine из атомов. */
  unifiedGrid?: UnifiedGrid;
  /** Сверка среза ВСЕ единой сетки против ячеек листа СВОД ТД-ПМ. */
  unifiedReconciliation?: SvodReconRow[];
  /** Dataset-level analysis per department: Benford, Z-score, composite score, noise map (keyed by deptId) */
  datasetAnalyses?: Record<string, any>;
  /**
   * Строки-атомы книг ГРБС на момент снимка — БЕЗ шапки (DEPT_HEADER_ROWS
   * срезаны), ключ — кириллическое короткое имя («УЭР»…). Фундамент честной
   * истории: отчёт прошлой недели пересчитывается из ЭТИХ строк, а не из
   * живого кэша под датой среза. Поле опционально честно: снимки, сохранённые
   * до 2026-07-24, строк не несут — для них история недоступна.
   */
  rowsByDept?: Record<string, unknown[][]>;
  /**
   * Разобранный лист СВОД ТД-ПМ (parseSvodGrid) на момент снимка — официальная
   * сетка для сверки-колонки исторического отчёта. Компактнее и стабильнее
   * сырых values листа. Той же опциональности, что rowsByDept.
   */
  svodGrid?: SvodGridBlock[];
  metadata: {
    sheetsRead: string[];
    cellsRead: number;
    readDurationMs: number;
    pipelineDurationMs: number;
    /** Row count per individual sheet (e.g. 'СВОД ТД-ПМ': 279, 'УЭР': 1024) */
    perSheetRowCount?: Record<string, number>;
  };
}

// ────────────────────────────────────────────────────────────
// 12. API response types (server routes)
// ────────────────────────────────────────────────────────────

export interface DashboardPeriodSummary {
  kpCount: number | null;
  kpFactCount: number | null;
  kpPlan: number | null;
  kpFact: number | null;
  kpPercent: number | null;
  epCount: number | null;
  epFactCount: number | null;
  epPlan: number | null;
  epFact: number | null;
  epPercent: number | null;
  fbPlan: number | null;
  kbPlan: number | null;
  mbPlan: number | null;
  fbFact: number | null;
  kbFact: number | null;
  mbFact: number | null;
  epFbPlan?: number | null;
  epKbPlan?: number | null;
  epMbPlan?: number | null;
  epFbFact?: number | null;
  epKbFact?: number | null;
  epMbFact?: number | null;
  source: 'official' | 'calculated';
}

export interface DashboardIssueSummary {
  total: number;
  bySeverity: Record<string, number>;
  byCategory: Record<string, number>;
  byDepartment: Record<string, number>;
  byOrigin: Record<string, number>;
  signalCounts: Record<string, number>;
}

export interface DashboardData {
  snapshot: DataSnapshot;
  kpiCards: KPICard[];
  departmentSummaries: DepartmentSummary[];
  summaryByPeriod: Record<string, DashboardPeriodSummary>;
  recentIssues: Issue[];
  signalCounts: Record<string, number>;
  issueSummary: DashboardIssueSummary;
  trust: TrustScore;
  lastRefreshed: string;
  /** Year the data belongs to (from query param or current year) */
  year: number;
}

export interface KPICard {
  metricKey: string;
  label: string;
  value: string;
  numericValue: number | null;
  unit: string;
  period: string;
  trend?: 'up' | 'down' | 'stable';
  trendValue?: string;
  origin: MetricOrigin;
  sourceCell: string;
  status: 'normal' | 'warning' | 'critical';
  delta?: {
    calculatedValue: string;
    deltaPercent: string;
    withinTolerance: boolean;
  };
}

export interface DepartmentSummary {
  department: Department;
  months?: Record<string, Record<string, unknown>>;
  planTotal: number | null;
  factTotal: number | null;
  executionPercent: number | null;
  economyTotal: number | null;
  economyFB?: number | null;
  economyKB?: number | null;
  economyMB?: number | null;
  competitiveCount?: number | null;
  soleCount?: number | null;
  issueCount: number;
  criticalIssueCount: number;
  trustScore: number;
  trustComponents?: TrustComponent[];
  status: 'normal' | 'warning' | 'critical';
  quarters?: Record<string, Record<string, unknown>>;
  signalCounts?: Record<string, number>;
  byActivity?: Record<string, unknown>;
  subordinates?: unknown[];
  economyConflicts?: number;
}

/** Generic API envelope */
export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ────────────────────────────────────────────────────────────
// 13. Configuration
// ────────────────────────────────────────────────────────────

export interface AppConfig {
  google: {
    spreadsheetId: string;
    serviceAccountEmail?: string;
    privateKey?: string;
    apiKey?: string;
  };
  server: {
    port: number;
    host: string;
    logLevel: string;
  };
  cache: {
    ttlSeconds: number;
    /** Период самообновления источников сервером, мин.; 0 — выключено (канон п.66). */
    autoRefreshMinutes: number;
    /** Предельный возраст кэша книг, при котором его можно смешивать со свежим официалом, с. */
    sourceFreshnessSeconds: number;
  };
  database: {
    url: string;
    postgresUrl?: string;
    provider: 'sqlite' | 'postgresql';
  };
  auth: {
    /** API key for Bearer token auth. If empty, auth is disabled (dev mode). */
    apiKey?: string;
  };
  /** Четверг-cron еженедельного снимка (server/services/weekly-snapshot-cron). */
  weeklySnapshot: {
    /** Ежечасный тик включён; в NODE_ENV=test планировщик не стартует. */
    enabled: boolean;
    /**
     * Календарь продукта: фиксированное смещение от UTC в часах. Дефолт —
     * Камчатка (UTC+12, DST нет): «четверг Камчатки» на UTC-сервере
     * начинается в среду 12:00 UTC.
     */
    utcOffsetHours: number;
  };
}
