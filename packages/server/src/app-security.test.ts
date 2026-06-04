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
});
