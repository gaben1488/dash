/**
 * Read-only source-diagnostics wire contract.
 *
 * A diagnostic run correlates independent reads; it is NEVER a frozen or
 * atomic historical source cut. 'not_run' must not be treated as passed.
 */
export type SourceDiagnosticStageState = 'complete' | 'partial' | 'failed';

export interface SourceDeepCheckBook {
  book: string;
  metadataRead: boolean;
  metadataRemarks: number | null;
  formulasRead: boolean;
  analyzed: boolean;
  formulaCells: number | null;
  rowsJudged: number | null;
  formulaDefects: number | null;
  problems: string[];
}

export interface SourceDeepCheck {
  complete: boolean;
  at: string;
  expectedBooks: number;
  books: SourceDeepCheckBook[];
  changedValueBooks: string[];
}

export interface SourceValidationObservation {
  name: string;
  success: boolean;
  /** rows for GRBS; access_only for aggregated source sheets. */
  validationMode?: 'rows' | 'access_only';
  resolvedSheetName: string;
  rowsChecked: number;
  issues: Array<{
    row: number;
    type: 'signal' | 'data_type' | 'negative_money';
    severity: 'critical' | 'warning' | 'info';
    message: string;
    field?: string;
  }>;
  summary: { total: number; critical: number; warning: number; info: number };
  error?: string;
}

export interface DiagnosticStageBase {
  state: SourceDiagnosticStageState;
  startedAt: string;
  completedAt: string;
  error: string | null;
}

export interface SourceTextDiagnosticStage {
  state: SourceDiagnosticStageState | 'not_run';
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  reason: string | null;
  rowsSource: 'live' | 'snapshot' | 'none' | null;
  asOf: string | null;
  booksChecked: number;
  silentBooks: string[];
  /** Null if the current source was not sufficiently read. */
  findings: number | null;
  rowsChecked: number | null;
  cellsChecked: number | null;
}

export interface SourceDiagnosticRun {
  schemaVersion: 'sources-diagnostics/v1';
  runId: string;
  startedAt: string;
  completedAt: string;
  /** Coverage of BOTH executed stages, not of all application checks. */
  status: SourceDiagnosticStageState;
  consistency: 'non_atomic';
  stages: {
    deep: DiagnosticStageBase & { result: SourceDeepCheck | null };
    rows: DiagnosticStageBase & {
      expectedSources: number;
      checkedBooks: number;
      accessOnlyBooks: number;
      failedSources: string[];
      results: SourceValidationObservation[];
    };
    metrics: { state: 'not_run'; reason: string };
    crossbook: { state: 'not_run'; reason: string };
    text: SourceTextDiagnosticStage;
    history: { state: 'not_run'; reason: string };
  };
}
