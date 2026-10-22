import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const AT = '2026-10-22T06:00:00.000Z';
const deepResult = () => ({
  complete: true, at: AT, expectedBooks: 2, changedValueBooks: [],
  books: ['УИО', 'УО'].map(book => ({
    book, metadataRead: true, metadataRemarks: 0,
    formulasRead: true, analyzed: true, formulaCells: 100,
    rowsJudged: 2, formulaDefects: 0, problems: [],
  })),
});
const deepCheck = vi.fn(async () => deepResult());
const source = (name: string, validationPerformed: boolean) => ({
  success: true, name, resolvedSheetName: name, validationPerformed,
  rowsChecked: validationPerformed ? 2 : 0, rowsRead: 10, issues: [],
  summary: { total: 0, critical: 0, warning: 0, info: 0 },
});
const results = () => [
  source('СВОД ТД-ПМ', false),
  source('УО', true),
  source('УИО', true),
  source('СВОД с месяцами', false),
];
const validateAllSources = vi.fn(async () => results());

vi.mock('./source-integrity.js', () => ({
  performDeepSourceCheck: (...args: unknown[]) => deepCheck(...(args as [])),
}));
vi.mock('../services/source-validation.js', () => ({
  validateAllSources: (...args: unknown[]) => validateAllSources(...(args as [])),
}));
vi.mock('../config.js', () => ({
  DEPARTMENT_SPREADSHEETS: { 'УО': 'book-uo', 'УИО': 'book-uio' },
}));

let app: FastifyInstance;
beforeAll(async () => {
  const { sourceDiagnosticsRoutes } = await import('./source-diagnostics.js');
  app = Fastify({ logger: false });
  await app.register(sourceDiagnosticsRoutes);
  await app.ready();
});
afterAll(async () => { await app.close(); });
beforeEach(() => {
  deepCheck.mockReset().mockImplementation(async () => deepResult());
  validateAllSources.mockReset().mockImplementation(async () => results());
});

describe('POST /api/sources/diagnostics/run — Dash79', () => {
  it('returns a correlated run with explicit limits; aggregates are access-only', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/sources/diagnostics/run' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      schemaVersion: 'dash-source-diagnostics/v1',
      status: 'complete',
      consistency: 'non_atomic',
      stages: {
        deep: { status: 'complete', result: { expectedBooks: 2 } },
        rows: { status: 'complete', expectedSources: 4, validatedBooks: 2,
          accessOnlyBooks: 2, failedSources: [] },
        metrics: { status: 'not_run' },
        text: { status: 'not_run' },
        crossbook: { status: 'not_run' },
        history: { status: 'not_run' },
      },
    });
    const body = response.json();
    expect(body.runId).toEqual(expect.any(String));
    expect(body.stages.deep.startedAt).toEqual(expect.any(String));
    expect(body.stages.rows.completedAt).toEqual(expect.any(String));
    expect(deepCheck).toHaveBeenCalledTimes(1);
    expect(validateAllSources).toHaveBeenCalledTimes(1);
  });

  it('on formula failure still validates source rows, retaining independent stages', async () => {
    deepCheck.mockRejectedValueOnce(new Error('Google 403'));
    const body = (await app.inject({ method: 'POST', url: '/api/sources/diagnostics/run' })).json();
    expect(body.status).toBe('partial');
    expect(body.stages.deep).toMatchObject({ status: 'failed', result: null });
    expect(body.stages.rows).toMatchObject({ status: 'complete', validatedBooks: 2 });
    expect(validateAllSources).toHaveBeenCalledTimes(1);
  });

  it('one missing or mislabeled workbook blocks complete even with zero issues', async () => {
    validateAllSources.mockResolvedValueOnce([
      source('СВОД ТД-ПМ', false), source('УО', false),
      source('СВОД с месяцами', false),
    ]);
    const body = (await app.inject({ method: 'POST', url: '/api/sources/diagnostics/run' })).json();
    expect(body.status).toBe('partial');
    expect(body.stages.rows).toMatchObject({
      status: 'partial', validatedBooks: 0, accessOnlyBooks: 2,
    });
    expect(body.stages.rows.failedSources).toEqual(expect.arrayContaining(['УО', 'УИО']));
  });

  it('two overlapping clicks share one run and do not duplicate reads', async () => {
    let resolve!: (value: ReturnType<typeof deepResult>) => void;
    deepCheck.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const first = app.inject({ method: 'POST', url: '/api/sources/diagnostics/run' });
    const second = app.inject({ method: 'POST', url: '/api/sources/diagnostics/run' });
    await Promise.resolve();
    resolve(deepResult());
    const [a, b] = await Promise.all([first, second]);
    expect(a.statusCode).toBe(200);
    expect(a.json().runId).toBe(b.json().runId);
    expect(deepCheck).toHaveBeenCalledTimes(1);
    expect(validateAllSources).toHaveBeenCalledTimes(1);
  });
});
