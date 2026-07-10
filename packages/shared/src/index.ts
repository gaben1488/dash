// Re-export everything from types (base definitions)
export * from './types.js';

// Re-export schemas (zod schemas for runtime validation, API contracts, drizzle-lite)
export * from './schemas.js';

// Re-export report-map, explicitly handling name collisions.
// report-map.ts defines its own DepartmentId (lowercase IDs), SheetData (2D array),
// and DepartmentMetrics (RowMetrics-based). We alias them to avoid conflict
// with the new domain types in types.ts.
export {
  DEPARTMENT_IDS,
  DEPARTMENT_NAMES,
  DEPARTMENT_SHORT_NAMES,
  SVOD_COLUMNS,
  COLUMNS,
  FORMULA_COLUMNS,
  RULE_COLUMNS,
  DEPARTMENT_ROWS,
  SUMMARY_ROWS,
  DEPARTMENTS,
  REPORT_MAP,
  extractMetric,
  buildDepartmentMetrics,
  buildSummaryMetrics,
  getAllCellAddresses,
  getMetricsByGroup,
  getMetricsByDepartment,
  getMetricByKey,
} from './report-map.js';

export type {
  DepartmentId as ReportMapDepartmentId,
  SheetData as RawSheetData,
  DepartmentMetrics as ReportMapDepartmentMetrics,
  ColumnLetter,
  RowMetrics,
  DepartmentRowConfig,
  SummaryMetrics,
} from './report-map.js';

// Re-export rule-book
export * from './rule-book.js';

// Re-export constants
export * from './constants.js';

// Re-export production data-source defaults
export * from './data-sources.js';

// Re-export centralized column mapping
export * from './column-map.js';

// Re-export ШДЮ mapping
export * from './shdyu-map.js';

// Re-export activity scope (ось ТД/ПМ/ТД-ПМ — фильтр AN4 листа ШДЮ)
export * from './activity-scope.js';

// Re-export канон «само управление» (ось C: аппарат ГРБС vs подвед — единый предикат)
export * from './org-itself.js';

// Re-export канон «пустая дата факта» (ось Q) — семантически отдельно от org-itself
export * from './fact-date.js';

// Re-export СВОД view builder (панель просмотра — точная копия листа из officialMetrics)
export * from './svod-view.js';

// Re-export единая сетка СВОД (CalcEngine-истина: активность×метод×бюджет×период)
export * from './unified-svod.js';

// Re-export unified class system
export * from './unified-class-system.js';

// Re-export department registry (canonical source of truth)
export * from './department-registry.js';

// Re-export sheet classifier (SSOT: имя листа → смысл; см. classifySheet)
export * from './sheet-classifier.js';

// Re-export all dictionaries (canonical methods, ГРБС aliases, EP reasons, legal refs, etc.)
// See packages/shared/src/dictionaries/index.ts for full barrel.
// Integration plan: AEMR_DICTIONARIES_PLAN.md §2.
export * from './dictionaries/index.js';
