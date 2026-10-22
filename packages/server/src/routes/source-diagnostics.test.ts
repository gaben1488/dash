import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SVOD_SHEET_NAME, SHDYU_MONTHLY_SHEET_NAME } from '@aemr/shared';

const at = '2026-10-22T07:00:00.000Z';
const deepResult = () => ({
  complete: true, at, expectedBooks: 2, changedValueBooks: [],
  books: ['УИО', 'УО'].map(book => ({
    book, formulasRead: true, metadataRead: true, analyzed: true,
    formulaCells: 30, formulaDefects: 0, metadataRemarks: 0, rowsJudged: 12, problems: [],
  })),
});
const deep = vi.fn(async () => deepResult());
const source = (name: string, validationMode: 'rows' | 'access_only' = 'rows') => ({
  name, success: true, validationMode, resolvedSheetName: name,
  rowsChecked: 2, issues: [],
  summary: { total: 0, critical: 0, warning: 0, info: 0 },
});
const checks = () => [
  source(SVOD_SHEET_NAME, 'access_only'), source('УО'), source('УИО'),
  source(SHDYU_MONTHLY_SHEET_NAME, 'access_only'),
];
const validateAllSources = vi.fn(async () => checks());
const sourceValues = vi.fn(() => ({
  'УО': [[], [], [], ['1', '', '', '', '', '', 'Закупка 1']],
  'УИО': [[], [], [], ['1', '', '', '', '', '', 'Закупка 2']],
}));
const sourceFilledAt = vi.fn(() => Date.parse(at));
const textHygiene = vi.fn(async () => ({
  asOf: at, rowsSource: 'live', booksChecked: ['УО', 'УИО'], booksSilent: [],
  totals: { rowsChecked: 2, cellsChecked: 12, hygieneFindings: 2, languageFindings: 1, countsByKind: {} },
  byDept: [], language: [], notes: [],
}));

vi.mock('./source-integrity.js', () => ({
  checkSourcesDeep: (...args: unknown[]) => deep(...(args as [])),
}));
vi.mock('../services/source-validation.js', () => ({
  validateAllSources: (...args: unknown[]) => validateAllSources(...(args as [])),
}));
vi.mock('../services/snapshot.js', () => ({
  getDeptSheetValues: () => sourceValues(),
  getDeptCacheFilledAt: () => sourceFilledAt(),
}));
vi.mock('./text-hygiene.js', () => ({
  buildTextHygieneResponse: (...args: unknown[]) => textHygiene(...(args as [])),
}));
vi.mock('../config.js', () => ({
  DEPARTMENT_SPREADSHEETS: { 'УО': 'one', 'УИО': 'two' },
}));
vi.mock('../services/source-log.js', () => ({
  redactFieldValue: (value: string) => value,
}));

let app: ReturnType<typeof Fastify>;
beforeAll(async () => {
  const { sourceDiagnosticsRoutes } = await import('./source-diagnostics.js');
  app = Fastify({ logger: false });
  await app.register(sourceDiagnosticsRoutes);
  await app.ready();
});
afterAll(async () => { await app.close(); });
beforeEach(() => {
  deep.mockReset();
  deep.mockImplementation(async () => deepResult());
  validateAllSources.mockReset();
  validateAllSources.mockImplementation(async () => checks());
  sourceValues.mockClear();
  sourceFilledAt.mockClear();
  textHygiene.mockClear();
});

describe('POST /api/sources/diagnostics/run — сервер является координатором', () => {
  it('собирает один запуск с двумя этапами, четырьмя источниками и честными границами', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/sources/diagnostics/run' });
    expect(response.statusCode).toBe(200);
    const result = response.json();
    expect(result).toMatchObject({
      schemaVersion: 'sources-diagnostics/v1',
      status: 'complete',
      consistency: 'non_atomic',
      stages: {
        deep: { state: 'complete', result: { expectedBooks: 2 } },
        rows: { state: 'complete', expectedSources: 4, checkedBooks: 2, accessOnlyBooks: 2, failedSources: [] },
        text: { state: 'complete', rowsSource: 'live', booksChecked: 2, silentBooks: [], findings: 3 },
        metrics: { state: 'not_run' },
        crossbook: { state: 'not_run' },
        text: { state: 'not_run' },
        history: { state: 'not_run' },
      },
    });
    expect(result.runId).toEqual(expect.any(String));
    expect(result.startedAt).toEqual(expect.any(String));
    expect(result.completedAt).toEqual(expect.any(String));
    expect(result.stages.rows.results).toHaveLength(4);
    expect(deep).toHaveBeenCalledTimes(1);
    expect(validateAllSources).toHaveBeenCalledTimes(1);
    expect(textHygiene).toHaveBeenCalledTimes(1);
  });

  it('даже при отказе глубокого чтения не пропускает построчные проверки', async () => {
    deep.mockRejectedValueOnce(new Error('Google access unavailable'));
    const result = (await app.inject({ method: 'POST', url: '/api/sources/diagnostics/run' })).json();
    expect(result.status).toBe('partial');
    expect(result.stages.deep).toMatchObject({ state: 'failed', result: null });
    expect(result.stages.rows).toMatchObject({ state: 'complete', checkedBooks: 2 });
    expect(validateAllSources).toHaveBeenCalledTimes(1);
  });

  it('не объявляет отсутствие одной книги и чужой режим за успешную проверку', async () => {
    validateAllSources.mockResolvedValueOnce([
      source(SVOD_SHEET_NAME, 'access_only'),
      source('УО', 'access_only'), // incorrect coverage, even though success=true
      source(SHDYU_MONTHLY_SHEET_NAME, 'access_only'), // missing УИО
    ]);
    const result = (await app.inject({ method: 'POST', url: '/api/sources/diagnostics/run' })).json();
    expect(result.status).toBe('partial');
    expect(result.stages.rows.state).toBe('partial');
    expect(result.stages.rows.failedSources).toEqual(expect.arrayContaining(['УИО', 'УО']));
    expect(result.stages.rows.checkedBooks).toBe(0);
  });

  it('не подменяет непрочитанный текущий текст сохранённым снимком', async () => {
    sourceFilledAt.mockReturnValueOnce(0);
    const result = (await app.inject({ method: 'POST', url: '/api/sources/diagnostics/run' })).json();
    expect(result.status).toBe('partial');
    expect(result.stages.text).toMatchObject({ state: 'not_run' });
    expect(textHygiene).not.toHaveBeenCalled();
  });

  it('текстовый этап не подтверждается снимком вместо живого кэша', async () => {
    textHygiene.mockResolvedValueOnce({
      asOf: at, rowsSource: 'snapshot', booksChecked: ['УО'], booksSilent: ['УИО'],
      totals: { rowsChecked: 2, cellsChecked: 2, hygieneFindings: 0, languageFindings: 0, countsByKind: {} },
      byDept: [], language: [], notes: [],
    });
    const result = (await app.inject({ method: 'POST', url: '/api/sources/diagnostics/run' })).json();
    expect(result.stages.text.state).toBe('not_run');
    expect(result.stages.text.rowsSource).toBe('snapshot');
    expect(result.stages.text.findings).toBeNull();
    expect(result.stages.text.silentBooks).toContain('УИО');
    expect(result.status).toBe('partial');
  });

  it('два параллельных запроса используют один запуск, а не два чтения Google', async () => {
    let finish: (value: ReturnType<typeof deepResult>) => void = () => undefined;
    deep.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = app.inject({ method: 'POST', url: '/api/sources/diagnostics/run' });
    const second = app.inject({ method: 'POST', url: '/api/sources/diagnostics/run' });
    await vi.waitFor(() => expect(deep).toHaveBeenCalledTimes(1));
    finish(deepResult());
    const [a, b] = await Promise.all([first, second]);
    expect(a.json().runId).toBe(b.json().runId);
    expect(deep).toHaveBeenCalledTimes(1);
    expect(validateAllSources).toHaveBeenCalledTimes(1);
  });
});
