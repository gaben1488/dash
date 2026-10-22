/**
 * Correlated read-only diagnostics on the current Dash runtime.
 *
 * It REUSES the existing deep inspector and source validator. We never
 * load historical snapshots, persist a new week, or write to Google Sheets.
 * The two reads are sequential and non-atomic; each has its own timestamp.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { SHDYU_MONTHLY_SHEET_NAME, SVOD_SHEET_NAME } from '@aemr/shared';
import type { SourceDiagnosticRun, SourceStageStatus } from '@aemr/shared';
import { DEPARTMENT_SPREADSHEETS } from '../config.js';
import { validateAllSources } from '../services/source-validation.js';
import { redactFieldValue } from '../services/source-log.js';
import { performDeepSourceCheck } from './source-integrity.js';

type DeepStage = SourceDiagnosticRun['stages']['deep'];
type RowsStage = SourceDiagnosticRun['stages']['rows'];

const excluded = {
  metrics: { status: 'not_run', reason: 'Пересчёт и сверка метрик не выполнялись' },
  text: { status: 'not_run', reason: 'Проверка текста и орфографии не выполнялась' },
  crossbook: { status: 'not_run', reason: 'Межкнижные сверки не выполнялись' },
  history: { status: 'not_run', reason: 'Исторические снимки не проверялись' },
} as const satisfies Pick<SourceDiagnosticRun['stages'], 'metrics' | 'text' | 'crossbook' | 'history'>;

function safeError(err: unknown): string {
  return String(redactFieldValue(err instanceof Error ? err.message : String(err)));
}

async function runDiagnostics(app: FastifyInstance): Promise<SourceDiagnosticRun> {
  const startedAt = new Date().toISOString();
  const runId = randomUUID();
  const deepStart = new Date().toISOString();
  let deep: DeepStage;
  try {
    const result = await performDeepSourceCheck(app);
    deep = {
      status: result.complete ? 'complete' : result.expectedBooks > 0 ? 'partial' : 'failed',
      startedAt: deepStart, completedAt: new Date().toISOString(),
      result, error: null,
    };
  } catch (err) {
    deep = { status: 'failed', startedAt: deepStart,
      completedAt: new Date().toISOString(), result: null, error: safeError(err) };
  }

  const expectedNames = [
    SVOD_SHEET_NAME, ...Object.keys(DEPARTMENT_SPREADSHEETS), SHDYU_MONTHLY_SHEET_NAME,
  ];
  const expected = new Map(expectedNames.map(name => [
    name, name === SVOD_SHEET_NAME || name === SHDYU_MONTHLY_SHEET_NAME ? 'access' : 'rows',
  ] as const));
  const rowStart = new Date().toISOString();
  let rows: RowsStage;
  try {
    const results = await validateAllSources();
    const byName = new Map<string, typeof results>();
    for (const result of results) {
      byName.set(result.name, [...(byName.get(result.name) ?? []), result]);
    }
    const failed = new Set<string>();
    let validatedBooks = 0;
    let accessOnlyBooks = 0;

    for (const [name, scope] of expected) {
      const items = byName.get(name) ?? [];
      if (items.length !== 1) { failed.add(name); continue; }
      const item = items[0];
      const validCount = Number.isInteger(item.rowsChecked) && item.rowsChecked >= 0;
      const validSummary = Number.isInteger(item.summary?.total) && item.summary.total >= 0;
      const validResult = item.success === true && validCount && validSummary
        && (scope === 'rows'
          ? item.validationPerformed === true && item.rowsChecked > 0
          : item.validationPerformed === false);
      if (!validResult) { failed.add(name); continue; }
      if (scope === 'rows') validatedBooks++;
      else accessOnlyBooks++;
    }
    for (const name of byName.keys()) {
      if (!expected.has(name)) failed.add(name);
    }

    const complete = Object.keys(DEPARTMENT_SPREADSHEETS).length > 0 && failed.size === 0;
    rows = {
      status: complete ? 'complete' : validatedBooks + accessOnlyBooks > 0 ? 'partial' : 'failed',
      startedAt: rowStart, completedAt: new Date().toISOString(),
      expectedSources: expectedNames.length, validatedBooks, accessOnlyBooks,
      failedSources: [...failed].sort(),
      results: results.map(item => item.success ? item : {
        ...item, error: safeError(item.error ?? 'Не удалось проверить источник'),
      }),
      error: null,
    };
  } catch (err) {
    rows = {
      status: 'failed', startedAt: rowStart, completedAt: new Date().toISOString(),
      expectedSources: expectedNames.length, validatedBooks: 0, accessOnlyBooks: 0,
      failedSources: expectedNames, results: [], error: safeError(err),
    };
  }

  const status: SourceStageStatus =
    deep.status === 'complete' && rows.status === 'complete' ? 'complete'
      : deep.status === 'failed' && rows.status === 'failed' ? 'failed' : 'partial';

  return {
    schemaVersion: 'dash-source-diagnostics/v1', runId, startedAt,
    completedAt: new Date().toISOString(), status, consistency: 'non_atomic',
    stages: { deep, rows, ...excluded },
  };
}

// Run-level coalescing prevents the two tabs from starting two overlapping
// validation bursts. This is a read model, not persisted historical state.
let inFlight: Promise<SourceDiagnosticRun> | null = null;

export function sourceDiagnosticsRoutes(app: FastifyInstance): void {
  app.post('/api/sources/diagnostics/run', async () => {
    if (!inFlight) inFlight = runDiagnostics(app).finally(() => { inFlight = null; });
    return inFlight;
  });
}
