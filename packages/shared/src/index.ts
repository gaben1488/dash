// Re-export everything from types (base definitions)
export * from './types.js';

// Re-export schemas
export * from './schemas.js';

// Re-export report-map, explicitly handling name collisions.
// report-map.ts defines its own DepartmentId (lowercase IDs), SheetData (2D array),
// and DepartmentMetrics (RowMetrics-based). We alias them to avoid conflict
// with the new domain types in types.ts.
export {
  DEPARTMENT_IDS,
  DEPARTMENT_NAMES,
  DEPARTMENT_SHORT_NAMES,
  SVOD_SHEET,
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

// Re-export centralized column mapping
export * from './column-map.js';

// Re-export ШДЮ mapping
export * from './shdyu-map.js';

// Re-export unified class system
export * from './unified-class-system.js';
