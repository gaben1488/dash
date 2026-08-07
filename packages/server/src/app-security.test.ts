import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

async function withServerEnv(env: Record<string, string | undefined>): Promise<FastifyInstance> {
  vi.resetModules();
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: 'test',
    AEMR_API_KEY: '',
    SQLITE_PATH: ':memory:',
    LOG_LEVEL: 'silent',
    ...env,
  };

  const { createApp } = await import('./app.js');
  return createApp({ logger: false });
}

async function withAuthEnv(env: Record<string, string | undefined>) {
  vi.resetModules();
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: 'test',
    AEMR_API_KEY: '',
    SQLITE_PATH: ':memory:',
    LOG_LEVEL: 'silent',
    ...env,
  };

  const { default: Fastify } = await import('fastify');
  const { registerAuthHook } = await import('./middleware/auth.js');
  const app = Fastify({ logger: false });
  return { app, registerAuthHook };
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

describe('server security defaults', () => {
  it('fails closed when production auth key is missing', async () => {
    const { app, registerAuthHook } = await withAuthEnv({ NODE_ENV: 'production', AEMR_API_KEY: '' });
    try {
      expect(() => registerAuthHook(app)).toThrow(/AEMR_API_KEY is required/);
    } finally {
      await app.close();
    }
  }, 30_000);
});

describe('server security routes in production', () => {
  let app: FastifyInstance | undefined;

  beforeAll(async () => {
    app = await withServerEnv({
      NODE_ENV: 'production',
      AEMR_API_KEY: 'secret-key',
      GOOGLE_SHEETS_SPREADSHEET_ID: 'spreadsheet-id',
      GOOGLE_SERVICE_ACCOUNT_EMAIL: 'svc@example.test',
      GOOGLE_PRIVATE_KEY: 'private-key',
      GOOGLE_API_KEY: 'google-api-key',
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('keeps health public but does not expose Google or auth configuration', async () => {
    const res = await app!.inject({ method: 'GET', url: '/api/health' });
    const body = res.json<Record<string, unknown>>();

    expect(res.statusCode).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.service).toBe('aemr-server');
    expect(body).not.toHaveProperty('spreadsheetId');
    expect(body).not.toHaveProperty('hasServiceAccount');
    expect(body).not.toHaveProperty('hasApiKey');
    expect(body).not.toHaveProperty('serviceAccountEmail');
  });

  it('requires the bearer token for protected API routes', async () => {
    const noToken = await app!.inject({ method: 'GET', url: '/api/settings/status' });
    const wrongToken = await app!.inject({
      method: 'GET',
      url: '/api/settings/status',
      headers: { Authorization: 'Bearer wrong-key' },
    });
    const rightToken = await app!.inject({
      method: 'GET',
      url: '/api/settings/status',
      headers: { Authorization: 'Bearer secret-key' },
    });

    expect(noToken.statusCode).toBe(401);
    expect(wrongToken.statusCode).toBe(401);
    expect(rightToken.statusCode).toBe(200);
  });

  it('does not register the sheets debug endpoint in production', async () => {
    const res = await app!.inject({
      method: 'GET',
      url: '/api/debug/sheets',
      headers: { Authorization: 'Bearer secret-key' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('rejects row write range injection and invalid row numbers before Google Sheets write', async () => {
    const rangeField = await app!.inject({
      method: 'PUT',
      url: '/api/rows/uo/2/field',
      headers: { Authorization: 'Bearer secret-key' },
      payload: { field: 'A5:Z5', value: '=IMPORTXML("https://example.test","//x")' },
    });
    const invalidRow = await app!.inject({
      method: 'PUT',
      url: '/api/rows/uo/not-a-row/field',
      headers: { Authorization: 'Bearer secret-key' },
      payload: { field: 'G', value: 'safe text' },
    });
    const batch = await app!.inject({
      method: 'POST',
      url: '/api/data/rows',
      headers: { Authorization: 'Bearer secret-key' },
      payload: {
        rows: [
          { deptId: 'uo', rowIndex: 2, changes: { 'A5:Z5': 'bad' } },
          { deptId: 'uo', rowIndex: 1, changes: { G: 'header write' } },
        ],
      },
    });

    // Проверяется инвариант безопасности (отказ до записи), а не дословная
    // формулировка: тексты ошибок переписаны на человеческие в зоне «Серверные
    // ответы», их страж — routes/route-messages.test.ts.
    expect(rangeField.statusCode).toBe(400);
    expect(rangeField.json<{ error: string }>().error).toContain('столбца');
    expect(invalidRow.statusCode).toBe(400);
    expect(invalidRow.json<{ error: string }>().error).toContain('Номер строки');
    expect(batch.statusCode).toBe(200);
    expect(batch.json<{ results: Array<{ success: boolean; error?: string }> }>().results).toEqual([
      expect.objectContaining({ success: false, error: expect.stringContaining('столбца') }),
      // Строка 1 — заголовок. Отклоняется тем же guard'ом границ (rowWriteError), что и запись
      // за пределами листа; сообщение теперь точное, а не слитное «колонка ... или строка ...».
      expect.objectContaining({ success: false, error: expect.stringContaining('Номер строки') }),
    ]);
  });
});
