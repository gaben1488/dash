/**
 * Contract for read-only manual diagnostics of Google source workbooks.
 *
 * This correlates reads done at distinct times. It is not a source snapshot
 * and never certifies unrelated metrics, text, history, or cross-book checks.
 */
export type SourceStageStatus = 'complete' | 'partial' | 'failed';

export interface SourceDeepBookEvidence {
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

export interface SourceDeepEvidence {
  complete: boolean;
  at: string;
  expectedBooks: number;
  books: SourceDeepBookEvidence[];
  changedValueBooks: string[];
}

export interface SourceRowValidationEvidence {
  success: boolean;
  name: string;
  resolvedSheetName: string;
  rowsChecked: number;
  rowsRead?: number;
  /** false for a readable aggregate: no department row rules were executed. */
  validationPerformed?: boolean;
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

export interface SourceDiagnosticRun {
  schemaVersion: 'dash-source-diagnostics/v1';
  runId: string;
  startedAt: string;
  completedAt: string;
  /** Completeness of the two listed stages, not correctness of all metrics. */
  status: SourceStageStatus;
  consistency: 'non_atomic';
  stages: {
    deep: {
      status: SourceStageStatus;
      startedAt: string;
      completedAt: string;
      result: SourceDeepEvidence | null;
      error: string | null;
    };
    rows: {
      status: SourceStageStatus;
      startedAt: string;
      completedAt: string;
      expectedSources: number;
      validatedBooks: number;
      accessOnlyBooks: number;
      failedSources: string[];
      results: SourceRowValidationEvidence[];
      error: string | null;
    };
    metrics: { status: 'not_run'; reason: string };
    text: { status: 'not_run'; reason: string };
    crossbook: { status: 'not_run'; reason: string };
    history: { status: 'not_run'; reason: string };
  };
}
