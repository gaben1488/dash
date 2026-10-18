import Fastify from 'fastify';
import { expect, it } from 'vitest';
import { registerRequestTiming } from './request-timing.js';

it('measures the actual request and serialization window without exposing source query values', async () => {
  const app = Fastify();
  registerRequestTiming(app);
  app.get('/read', async () => ({ values: Array.from({ length: 100 }, () => 'synthetic') }));
  const response = await app.inject('/read?source=PRIVATE_DO_NOT_LOG');
  expect(response.statusCode).toBe(200);
  expect(response.headers['server-timing']).toMatch(/app;dur=\d+(?:\.\d+)?, serialize;dur=\d+(?:\.\d+)?/);
  expect(response.headers['server-timing']).not.toContain('PRIVATE');
  await app.close();
});
