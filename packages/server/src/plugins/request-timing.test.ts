import Fastify from 'fastify';
import { expect, it } from 'vitest';
import { registerRequestTiming, requestStage, measureAsyncStage, measureReadStage } from './request-timing.js';

it('measures the actual request and serialization window without exposing source query values', async () => {
  const app = Fastify();
  registerRequestTiming(app);
  app.get('/read', async () => ({ values: Array.from({ length: 100 }, () => 'synthetic') }));
  const response = await app.inject('/read?source=PRIVATE_DO_NOT_LOG');
  expect(response.statusCode).toBe(200);
  expect(response.headers['x-request-id']).toMatch(/^req-/);
  expect(response.headers['server-timing']).toMatch(/app;dur=\d+(?:\.\d+)?, serialize;dur=\d+(?:\.\d+)?/);
  expect(response.headers['server-timing']).not.toContain('PRIVATE');
  await app.close();
});

it('detects a synchronous event-loop block inside this request window', async () => {
  const app = Fastify();
  registerRequestTiming(app);
  app.get('/blocked', async () => {
    const end = performance.now() + 35;
    while (performance.now() < end) { /* Deliberate bounded block for the diagnostic. */ }
    return { ready: true };
  });
  const response = await app.inject('/blocked');
  const timing = String(response.headers['server-timing']);
  expect(Number(timing.match(/loop;dur=([\d.]+)/)?.[1])).toBeGreaterThan(10);
  await app.close();
});


it('reports nested SQL and decoding in the same reader window', async () => {
  const app = Fastify(); registerRequestTiming(app);
  app.get('/stored', request => requestStage(request, 'reader', async () => {
    const row = measureReadStage('sql', () => '{"saved":true}');
    return measureReadStage('decode', () => JSON.parse(row));
  }));
  const result = await app.inject('/stored');
  expect(result.json()).toEqual({ saved: true });
  const timing = String(result.headers['server-timing']);
  expect(timing).toContain('reader;dur='); expect(timing).toContain('sql;dur='); expect(timing).toContain('decode;dur=');
  await app.close();
});

it('correlates Google attempt and normalization with the enclosing model request', async () => {
  const app = Fastify(); registerRequestTiming(app);
  app.get('/captured-source', request => requestStage(request, 'model', async () => {
    const raw = await measureAsyncStage('google', async () => '{"entries":2}');
    return measureReadStage('normalize', () => JSON.parse(raw) as { entries: number });
  }));
  const first = await app.inject('/captured-source?source=PRIVATE_DO_NOT_LOG');
  expect(first.statusCode).toBe(200);
  expect(first.json()).toEqual({ entries: 2 });
  const timing = String(first.headers['server-timing']);
  expect(timing).toMatch(/model;dur=\\d+(?:\\.\\d+)?/);
  expect(timing).toMatch(/google;dur=\\d+(?:\\.\\d+)?/);
  expect(timing).toMatch(/normalize;dur=\\d+(?:\\.\\d+)?/);
  expect(timing).not.toContain('PRIVATE');
  // Off-request source reads must not create an HTTP window or leak into later requests.
  expect(await measureAsyncStage('google', async () => 'background')).toBe('background');
  const unrelated = await app.inject('/unknown');
  expect(String(unrelated.headers['server-timing'])).not.toContain('google;dur=');
  await app.close();
});
