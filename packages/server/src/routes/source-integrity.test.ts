/**
 * Страж маршрута /api/sources/integrity.
 *
 * Главное обещание: пустой перечень замечаний НЕ выдаётся за «всё хорошо».
 * Ответ обязан всегда называть границу знания — какие книги смотрели, каких
 * не касались, подключён ли разбор формул и какие колонки вообще читаются.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const REFRESH_AT = '2026-10-22T04:00:00.000Z';
type DeliveryState = { sinkConnected: boolean; books: Array<{ book: string; at: string; cells: number; handled: boolean; failedBecause?: string }> };
const defaultDeliveries = (): DeliveryState => ({
  sinkConnected: false,
  books: [{ book: 'УО', at: '2026-08-30T12:00:00.000Z', cells: 29_700, handled: false, failedBecause: 'разбор формул не подключён' }],
});
const formulaDeliveryState = vi.fn(defaultDeliveries);
const refreshAllSources = vi.fn(async () => ({
  loaded: ['УО', 'УИО'], failed: [], at: REFRESH_AT, changedBooks: [],
  formulaBooks: ['УО', 'УИО'], svodOk: true, svodChanged: false, booksRead: 2, skipped: [],
}));
const sweepMetadata = vi.fn(async () => [
  { book: 'УО', read: true, at: REFRESH_AT, remarks: [] },
  { book: 'УИО', read: true, at: REFRESH_AT, remarks: [] },
]);
const formulaVerdicts = vi.fn(() => [
  { book: 'УО', at: REFRESH_AT, rowsJudged: 2, defects: [] },
  { book: 'УИО', at: REFRESH_AT, rowsJudged: 1, defects: [] },
]);

/* Existing GET fixture deliberately represents an incomplete last observation. */

const metadataWatchState = vi.fn(() => ({
  canonSyncedAt: '2026-08-30',
  books: [
    {
      book: 'УО',
      read: true,
      at: '2026-08-30T15:00:00.000Z',
      remarks: [
        {
          book: 'УО',
          kind: 'protection_removed' as const,
          column: 'Y',
          expected: 'колонка под защитой',
          actual: 'защиты нет',
          text: 'В книге «УО» снята защита формульной колонки Y',
        },
      ],
    },
  ],
  notWatched: ['УИО'],
}));

vi.mock('../services/source-refresh.js', () => ({
  formulaDeliveryState: () => formulaDeliveryState(),
  refreshAllSources: (...args: unknown[]) => refreshAllSources(...(args as [])),
}));

vi.mock('../services/metadata-watch.js', () => ({
  metadataWatchState: () => metadataWatchState(),
  sweepMetadata: (...args: unknown[]) => sweepMetadata(...(args as [])),
}));

vi.mock('../services/formula-sink.js', () => ({
  formulaVerdicts: () => formulaVerdicts(),
}));

vi.mock('../config.js', () => ({
  config: { google: { spreadsheetId: 'file-svod' } },
  DEPARTMENT_SPREADSHEETS: { 'УО': 'file-uo', 'УИО': 'file-uio' },
}));

vi.mock('../services/google-sheets.js', () => ({
  FORMULA_COLUMNS: ['K', 'O', 'P', 'R', 'S', 'T', 'Y', 'Z', 'AA', 'AB', 'AC'],
}));

let app: FastifyInstance;

beforeAll(async () => {
  const { sourceIntegrityRoutes } = await import('./source-integrity.js');
  app = Fastify({ logger: false });
  await app.register(sourceIntegrityRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  formulaDeliveryState.mockImplementation(defaultDeliveries);
  refreshAllSources.mockClear();
  sweepMetadata.mockClear();
  formulaVerdicts.mockClear();
});
describe('GET /api/sources/integrity', () => {
  it('называет границу знания, а не только замечания', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/sources/integrity' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      formulas: {
        columns: string[];
        sinkConnected: boolean;
        books: Array<{ book: string; handled: boolean; failedBecause?: string }>;
        notRead: string[];
      };
      metadata: {
        canonSyncedAt: string;
        books: Array<{ book: string; read: boolean; remarks: Array<{ column?: string }> }>;
        notWatched: string[];
      };
    };

    // Какие колонки вообще читаются — иначе «не найдено» не имеет границы.
    expect(body.formulas.columns).toHaveLength(11);
    // Разбор не подключён — сказано прямо, а не молчанием.
    expect(body.formulas.sinkConnected).toBe(false);
    expect(body.formulas.books[0].failedBecause).toBe('разбор формул не подключён');
    // Книга, по которой формулы не читались ни разу, названа.
    expect(body.formulas.notRead).toEqual(['УИО']);

    expect(body.metadata.canonSyncedAt).toBe('2026-08-30');
    expect(body.metadata.books[0].remarks[0].column).toBe('Y');
    // Книга, которой дозор не касался, названа отдельно от «замечаний нет».
    expect(body.metadata.notWatched).toEqual(['УИО']);
  }, 30_000);
});

describe('POST /api/sources/integrity/check', () => {
  it('forces all books, bypasses revision gating, but does not take a weekly snapshot', async () => {
    formulaDeliveryState.mockReturnValue({ sinkConnected: true, books: [
      { book: 'УО', at: REFRESH_AT, cells: 22, handled: true },
      { book: 'УИО', at: REFRESH_AT, cells: 11, handled: true },
    ] });
    const reply = await app.inject({ method: 'POST', url: '/api/sources/integrity/check' });
    expect(reply.statusCode).toBe(200);
    expect(sweepMetadata).toHaveBeenCalledTimes(1);
    expect(refreshAllSources).toHaveBeenCalledWith(expect.anything(), 'request', {
      withFormulas: true, fresh: true, askDrive: false, svod: false,
    });
    expect(reply.json()).toMatchObject({
      complete: true, expectedBooks: 2, changedValueBooks: [],
      books: [
        { book: 'УИО', metadataRead: true, formulasRead: true, analyzed: true, rowsJudged: 1, formulaDefects: 0 },
        { book: 'УО', metadataRead: true, formulasRead: true, analyzed: true, rowsJudged: 2, formulaDefects: 0 },
      ],
    });
    // There is no history lookup or snapshot creation in this route: an empty
    // first-week archive is a supported starting state, not a precondition.
  });

  it('reports an unhandled or unread book as unknown, never as zero defects', async () => {
    const reply = await app.inject({ method: 'POST', url: '/api/sources/integrity/check' });
    const data = reply.json();
    expect(reply.statusCode).toBe(200);
    expect(data.complete).toBe(false);
    expect(data.books.find((book: { book: string }) => book.book === 'УИО')).toMatchObject({
      formulasRead: false, analyzed: false, rowsJudged: null, formulaDefects: null,
    });
    expect(data.books.find((book: { book: string }) => book.book === 'УО').problems)
      .toContain('формулы этого запуска не прочитаны');
  });
});
