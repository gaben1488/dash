/**
 * Types for the AEMR metrics KB (Knowledge Base) registry.
 */

/** Categories for grouping metrics in UI. */
export type MetricCategory =
  | 'execution'   // plan/fact/deviation/exec%
  | 'budget'      // plan/fact by budget level (FB/KB/MB)
  | 'economy'     // savings, economy_total, AD flags
  | 'method'      // competitive vs EP breakdown
  | 'trust'       // trust score components
  | 'quality';    // issue counts, data quality

/** Unit type for display formatting. */
export type MetricUnit = 'count' | 'currency' | 'percent';

/**
 * KB entry data — everything needed for a KBTooltip on any metric.
 * Matches the KBEntry interface from web/components/KBTooltip.tsx.
 */
export interface KBEntryData {
  /** Human-readable metric label. */
  label: string;
  /** Formula explanation, e.g. "fact_count / plan_count × 100". */
  formula: string;
  /** CalcEngine source path, e.g. "CalcEngine → total.exec_count_pct". */
  source: string;
  /** Spreadsheet cell reference template (use {dept_row} placeholder). */
  cell?: string;
  /** Threshold description for color coding. */
  thresholds?: string;
  /** Legal reference (44-ФЗ). */
  law?: string;
  /** Additional note. */
  note?: string;
  /** Display unit. */
  unit: MetricUnit;
  /** Logical category for grouping. */
  category: MetricCategory;
}
