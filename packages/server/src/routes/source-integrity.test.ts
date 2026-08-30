/**
 * Страж маршрута /api/sources/integrity.
 *
 * Главное обещание: пустой перечень замечаний НЕ выдаётся за «всё хорошо».
 * Ответ обязан всегда называть границу знания — какие книги смотрели, каких
 * не касались, подключён ли разбор формул и какие колонки вообще читаются.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const formulaDeliveryState = vi.fn(() => ({
  sinkConnected: false,
  books: [
    { book: 'УО', at: '2026-08-30T12:00:00.000Z', cells: 29_700, handled: false, failedBecause: 'разбор формул не подключён' },
  ],
}));

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
}));

vi.mock('../services/metadata-watch.js', () => ({
  metadataWatchState: () => metadataWatchState(),
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
