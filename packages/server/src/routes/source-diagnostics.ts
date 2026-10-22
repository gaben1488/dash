/**
 * One server-owned, read-only diagnostic request for source books.
 *
 * The two existing inspectors have different scopes and read at different
 * moments: this is a correlated RUN, not a frozen historical snapshot.
 * Only stages explicitly executed on current source rows can be marked complete.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { SHDYU_MONTHLY_SHEET_NAME, SVOD_SHEET_NAME } from '@aemr/shared';
import type { SourceDiagnosticRun, SourceDiagnosticStageState } from '@aemr/shared';
import { DEPARTMENT_SPREADSHEETS } from '../config.js';
import { redactFieldValue } from '../services/source-log.js';
import { getDeptCacheFilledAt, getDeptSheetValues } from '../services/snapshot.js';
import { buildTextHygieneResponse } from './text-hygiene.js';
import { validateAllSources, type SourceValidationResult } from '../services/source-validation.js';
import { checkSourcesDeep } from './source-integrity.js';

type StageState = SourceDiagnosticStageState;
type DeepStage = SourceDiagnosticRun['stages']['deep'];
type RowsStage = SourceDiagnosticRun['stages']['rows'];
type TextStage = SourceDiagnosticRun['stages']['text'];

const notRun = {
  metrics: { state: 'not_run', reason: 'Метрики не пересчитывались и их значения этим запросом не подтверждены' },
  crossbook: { state: 'not_run', reason: 'Межкнижная сверка не запускалась' },
  history: { state: 'not_run', reason: 'Исторические и недельные снимки не сравнивались' },
} as const satisfies Pick<SourceDiagnosticRun['stages'], 'metrics' | 'crossbook' | 'history'>;

function safeError(err: unknown): string {
  return String(redactFieldValue(err instanceof Error ? err.message : String(err)));
}

async function runDiagnostics(app: FastifyInstance): Promise<SourceDiagnosticRun> {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();

  const deepStart = new Date().toISOString();
  let deep: DeepStage;
  try {
    const result = await checkSourcesDeep(app);
    deep = {
      state: result.complete ? 'complete' : result.expectedBooks > 0 ? 'partial' : 'failed',
      startedAt: deepStart, completedAt: new Date().toISOString(),
      result, error: null,
    };
  } catch (err) {
    deep = {
      state: 'failed', startedAt: deepStart, completedAt: new Date().toISOString(),
      result: null, error: safeError(err),
    };
  }

  // Every source result must be accounted for exactly once. The two aggregates
  // are access-only; they NEVER count as checked GRBS rows.
  const expectedNames = [
    SVOD_SHEET_NAME, ...Object.keys(DEPARTMENT_SPREADSHEETS), SHDYU_MONTHLY_SHEET_NAME,
  ];
  const modes = new Map(expectedNames.map(name =>
    [name, name === SVOD_SHEET_NAME || name === SHDYU_MONTHLY_SHEET_NAME ? 'access_only' : 'rows'] as const));
  const rowStart = new Date().toISOString();
  let rows: RowsStage;
  try {
    const result = await validateAllSources();
    const seen = new Map<string, SourceValidationResult[]>();
    for (const item of result) {
      const prior = seen.get(item.name) ?? [];
      prior.push(item);
      seen.set(item.name, prior);
    }

    let checkedBooks = 0;
    let accessOnlyBooks = 0;
    const failedSources: string[] = [];
    for (const name of expectedNames) {
      const candidates = seen.get(name) ?? [];
      if (candidates.length !== 1) { failedSources.push(name); continue; }
      const item = candidates[0];
      const expectedMode = modes.get(name);
      if (item.success !== true || item.validationMode !== expectedMode
        || !Number.isFinite(item.rowsChecked) || item.rowsChecked < 0
        || !Number.isFinite(item.summary?.total)
        || (expectedMode === 'rows' && item.rowsChecked === 0)) {
        failedSources.push(name);
        continue;
      }
      if (expectedMode === 'rows') checkedBooks++;
      else accessOnlyBooks++;
    }
    for (const name of seen.keys()) {
      if (!modes.has(name)) failedSources.push(name);
    }
    const complete = expectedNames.length > 2 && failedSources.length === 0;
    rows = {
      state: complete ? 'complete' : checkedBooks + accessOnlyBooks > 0 ? 'partial' : 'failed',
      startedAt: rowStart, completedAt: new Date().toISOString(), error: null,
      expectedSources: expectedNames.length, checkedBooks, accessOnlyBooks,
      failedSources,
      results: result.map(item => item.success ? item : {
        ...item, error: safeError(item.error ?? 'Не удалось прочитать источник'),
      }),
    };
  } catch (err) {
    rows = {
      state: 'failed', startedAt: rowStart, completedAt: new Date().toISOString(),
      error: safeError(err),
      expectedSources: expectedNames.length, checkedBooks: 0, accessOnlyBooks: 0,
      failedSources: expectedNames, results: [],
    };
  }

  // Text diagnostics must run on the live cache just filled by this inspection.
  // Their standalone route may legitimately fall back to a saved snapshot; the
  // combined run must not silently treat historical text as a fresh finding.
  const textStart = new Date().toISOString();
  const noText = (reason: string): TextStage => ({
    state: 'not_run', startedAt: null, completedAt: null, error: null, reason,
    rowsSource: null, asOf: null, booksChecked: 0, silentBooks: [],
    findings: null, rowsChecked: null, cellsChecked: null,
  });
  let text: TextStage;
  if (deep.state === 'failed' || getDeptCacheFilledAt() <= 0
    || Object.keys(getDeptSheetValues()).length === 0) {
    text = noText('Свежие строки книг недоступны; исторические тексты не считаются проверенными.');
  } else {
    try {
      const review = await buildTextHygieneResponse();
      const expected = Object.keys(DEPARTMENT_SPREADSHEETS);
      const exact = expected.length > 0 && review.booksSilent.length === 0
        && review.booksChecked.length === expected.length
        && expected.every(name => review.booksChecked.includes(name));
      if (review.rowsSource !== 'live') {
        text = noText('Получены только строки сохранённого снимка; актуальные тексты не проверены.');
        text.rowsSource = review.rowsSource;
        text.asOf = review.asOf;
        text.silentBooks = review.booksSilent;
      } else {
        const complete = deep.state === 'complete' && exact
          && Number.isFinite(review.totals.cellsChecked)
          && Number.isFinite(review.totals.hygieneFindings)
          && Number.isFinite(review.totals.languageFindings);
        text = {
          state: complete ? 'complete' : 'partial',
          startedAt: textStart, completedAt: new Date().toISOString(),
          error: null,
          reason: complete ? null : 'Текстовая проверка охватила не все ожидаемые книги или источник не подтверждён.',
          rowsSource: 'live', asOf: review.asOf,
          booksChecked: review.booksChecked.length, silentBooks: review.booksSilent,
          findings: review.totals.hygieneFindings + review.totals.languageFindings,
          rowsChecked: review.totals.rowsChecked, cellsChecked: review.totals.cellsChecked,
        };
      }
    } catch (err) {
      text = {
        state: 'failed', startedAt: textStart, completedAt: new Date().toISOString(),
        error: safeError(err), reason: null,
        rowsSource: null, asOf: null, booksChecked: 0, silentBooks: [],
        findings: null, rowsChecked: null, cellsChecked: null,
      };
    }
  }

  const status: StageState = deep.state === 'complete' && rows.state === 'complete' && text.state === 'complete'
    ? 'complete'
    : deep.state === 'failed' && rows.state === 'failed' && (text.state === 'failed' || text.state === 'not_run')
      ? 'failed' : 'partial';

  return {
    schemaVersion: 'sources-diagnostics/v1', runId, startedAt,
    completedAt: new Date().toISOString(), status, consistency: 'non_atomic',
    stages: { deep, rows, text, ...notRun },
  };
}

// One in-flight run on the server: two tabs may not independently trigger
// bursts of Google API reads or return unrelated source cuts for one click.
let inFlight: Promise<SourceDiagnosticRun> | null = null;

export function sourceDiagnosticsRoutes(app: FastifyInstance): void {
  app.post('/api/sources/diagnostics/run', async () => {
    if (!inFlight) {
      inFlight = runDiagnostics(app).finally(() => { inFlight = null; });
    }
    return inFlight;
  });
}
