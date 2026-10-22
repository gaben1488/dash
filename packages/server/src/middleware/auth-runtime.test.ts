import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authConfig = vi.hoisted(() => ({ apiKey: '' }));
vi.mock('../config.js', () => ({ config: { auth: authConfig } }));
import { registerAuthHook } from './auth.js';

let app: FastifyInstance;
beforeEach(() => {
  app = Fastify({ logger: false });
  authConfig.apiKey = '';
  vi.stubEnv('AEMR_PUBLIC_READONLY', 'false');
});
afterEach(async () => {
  await app.close();
  vi.unstubAllEnvs();
});

describe('explicit runtime authentication policy', () => {
  it.each([undefined, '', 'production', 'staging', 'prod', 'Development'])(
    'refuses a missing key when NODE_ENV is %s', (mode) => {
      vi.stubEnv('NODE_ENV', mode);
      expect(() => registerAuthHook(app)).toThrow(/AEMR_API_KEY is required/);
    },
  );

  it.each([' ', '\t\n'])('does not accept a whitespace-only key in a protected runtime', (key) => {
    vi.stubEnv('NODE_ENV', 'production');
    authConfig.apiKey = key;
    expect(() => registerAuthHook(app)).toThrow(/AEMR_API_KEY is required/);
  });

  it.each(['development', 'test'])('permits explicit %s without a key', async (mode) => {
    vi.stubEnv('NODE_ENV', mode);
    registerAuthHook(app);
    app.get('/api/private', async () => ({ ok: true }));
    const response = await app.inject({ method: 'GET', url: '/api/private' });
    expect(response.statusCode).toBe(200);
  });

  it.each([undefined, 'staging', 'production'])('protects API reads with the configured key in %s', async (mode) => {
    vi.stubEnv('NODE_ENV', mode);
    authConfig.apiKey = 'unit-test-key';
    registerAuthHook(app);
    app.get('/api/private', async () => ({ ok: true }));
    app.get('/api/health', async () => ({ status: 'ok' }));
    expect((await app.inject({ method: 'GET', url: '/api/private' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/private', headers: { authorization: 'Bearer another-key' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/private', headers: { authorization: 'Bearer unit-test-key' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
  });
});
