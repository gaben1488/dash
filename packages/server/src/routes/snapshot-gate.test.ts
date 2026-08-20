/**
 * Характеризационный замок ПЕРЕД упрощением S2 (SIMPLIFY_REGISTER_2026-06-05):
 * отказ «снимок не собрался» был выписан в каждом обработчике отдельно —
 * своя `try/catch`, своя запись в журнал, свой `reply.status(503)`. Правка
 * сводит саму церемонию к одному помощнику, НЕ трогая тексты: они у роутов
 * разные и являются продуктовыми фразами, а не техническим кодом.
 *
 * Замок фиксирует то, что обязано пережить сведение: при недоступном источнике
 * с настроенными учётными данными роут отвечает 503 (не 200 с выдуманными
 * числами и не 500 с англоязычным стектрейсом), а тело несёт русскую фразу с
 * действием и без внутренних ключей.
 *
 * Учётные данные Google в этом тесте НЕПУСТЫЕ намеренно: гейт демо-подмены
 * срабатывает только при ненастроенных кредах, а нам нужен именно отказ.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

vi.mock('../services/google-sheets.js', () => ({
  batchGetCells: vi.fn(async () => { throw new Error('network disabled in test'); }),
  batchGetFormulas: vi.fn(async () => { throw new Error('network disabled in test'); }),
  getSpreadsheetMetadata: vi.fn(async () => { throw new Error('network disabled in test'); }),
  fetchSHDYUSheet: vi.fn(async () => { throw new Error('network disabled in test'); }),
  getSheetData: vi.fn(async () => { throw new Error('network disabled in test'); }),
  readDeptSheet: vi.fn(async () => { throw new Error('network disabled in test'); }),
  fetchDepartmentSpreadsheets: vi.fn(async () => { throw new Error('network disabled in test'); }),
}));

/** Фраза отказа: по-русски, с действием, без внутренних ключей и латиницы. */
function expectRefusalText(text: unknown): void {
  expect(typeof text).toBe('string');
  const s = String(text);
  expect(/[а-яА-Я]/.test(s)).toBe(true);
  expect(s).not.toMatch(/[A-Za-z]{4,}/);
  expect(s.length).toBeGreaterThan(20);
}

describe('отказ «снимок не собрался» — код и фраза', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      AEMR_API_KEY: '',
      SQLITE_PATH: ':memory:',
      LOG_LEVEL: 'silent',
      GOOGLE_SERVICE_ACCOUNT_EMAIL: 'robot@example.test',
      GOOGLE_PRIVATE_KEY: 'ключ-заглушка-достаточной-длины',
      GOOGLE_API_KEY: '',
    };
    const { dashboardRoutes } = await import('./dashboard.js');
    const { auditRoutes } = await import('./audit.js');
    const { setDeptSheetCache } = await import('../services/snapshot.js');
    setDeptSheetCache({});
    app = Fastify({ logger: false });
    await app.register(dashboardRoutes);
    await app.register(auditRoutes);
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  const cases: Array<[name: string, url: string]> = [
    ['пульт', '/api/dashboard?year=2026'],
    ['доверие району', '/api/trust'],
    ['доверие управлению', '/api/trust/uo'],
    ['квартальная сверка', '/api/reconciliation/quarterly'],
  ];

  for (const [name, url] of cases) {
    it(`${name}: 503 и русская фраза вместо выдуманных чисел`, async () => {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(503);
      expectRefusalText(res.json<{ error: string }>().error);
    }, 60_000);
  }
});
