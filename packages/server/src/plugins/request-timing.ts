import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import type { FastifyInstance, FastifyRequest } from 'fastify';

type Stage = 'reader' | 'model' | 'contract' | 'sql' | 'decode' | 'google' | 'normalize';
interface Window {
  start: number; startedAt: string; serialization?: number;
  stages: Partial<Record<Stage, number>>; cpu: NodeJS.CpuUsage;
}
const windows = new WeakMap<FastifyRequest, Window>();
const activeWindow = new AsyncLocalStorage<Window>();

/** Inclusive stage durations: concurrent work and process CPU must never be added as independent costs. */
export async function requestStage<T>(request: FastifyRequest, stage: Stage, operation: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try { const window = windows.get(request); return await (window ? activeWindow.run(window, operation) : operation()); } finally {
    const window = windows.get(request);
    if (window) window.stages[stage] = (window.stages[stage] ?? 0) + performance.now() - start;
  }
}

/** A refresh scheduled after serving a saved snapshot is not part of that HTTP GET.
 * Avoid inheriting the parent's AsyncLocalStorage into background acquisitions.
 */
export function withoutRequestTiming<T>(operation: () => T): T {
  return activeWindow.exit(operation);
}

/** Include actual Google request attempts in the enclosing HTTP window, not retry backoff.
 * Background source reads have no HTTP window and remain in the existing source log.
 */
export async function measureAsyncStage<T>(stage: 'google', operation: () => Promise<T>): Promise<T> {
  const window = activeWindow.getStore();
  if (!window) return operation();
  const start = performance.now();
  try { return await operation(); } finally {
    window.stages[stage] = (window.stages[stage] ?? 0) + performance.now() - start;
  }
}

/** Nested synchronous SQL/decoding/normalization costs; inclusive, not additive. */
export function measureReadStage<T>(stage: 'sql' | 'decode' | 'normalize', operation: () => T): T {
  const start = performance.now();
  try { return operation(); } finally {
    const window = activeWindow.getStore();
    if (window) window.stages[stage] = (window.stages[stage] ?? 0) + performance.now() - start;
  }
}

export function registerRequestTiming(app: FastifyInstance): void {
  const intervalMs = 20;
  const samplingStarted = performance.now();
  let sampledAt = samplingStarted;
  // ponytail: 2048 bounded samples cover about 41s; longer reads explicitly report partial sampling.
  const samples: Array<{ from: number; to: number }> = [];
  const timer = setInterval(() => {
    const now = performance.now();
    samples.push({ from: sampledAt, to: now });
    sampledAt = now;
    if (samples.length > 2048) samples.shift();
  }, intervalMs);
  timer.unref();
  app.addHook('onClose', async () => { clearInterval(timer); });
  const loopDelay = (start: number, now: number) => {
    let maxMs = Math.max(0, now - Math.max(sampledAt, start) - intervalMs);
    for (const sample of samples) {
      if (sample.to >= start) maxMs = Math.max(maxMs, sample.to - Math.max(sample.from, start) - intervalMs);
    }
    return { eventLoopProcessMaxDelayMs: maxMs, eventLoopSampleIntervalMs: intervalMs,
      eventLoopSamplingComplete: start >= (samples[0]?.from ?? samplingStarted) };
  };
  app.addHook('onRequest', async request => {
    windows.set(request, { start: performance.now(), startedAt: new Date().toISOString(), stages: {}, cpu: process.cpuUsage() });
  });
  app.addHook('preSerialization', async (request, _reply, payload) => {
    const window = windows.get(request);
    if (window) window.serialization = performance.now();
    return payload;
  });
  app.addHook('onSend', async (request, reply, payload) => {
    const window = windows.get(request);
    reply.header('X-Request-Id', request.id);
    if (window) {
      const now = performance.now();
      const stages = Object.entries(window.stages).map(([name, ms]) => `${name};dur=${ms!.toFixed(2)}`);
      reply.header('Server-Timing', [`app;dur=${(now - window.start).toFixed(2)}`,
        `serialize;dur=${window.serialization === undefined ? '0' : (now - window.serialization).toFixed(2)}`, ...stages,
        `loop;dur=${loopDelay(window.start, now).eventLoopProcessMaxDelayMs.toFixed(2)}`].join(', '));
    }
    return payload;
  });
  app.addHook('onResponse', async (request, reply) => {
    const window = windows.get(request);
    if (!window) return;
    const cpu = process.cpuUsage(window.cpu);
    request.log.info({ kind: 'request_window', requestId: request.id, route: request.routeOptions.url, status: reply.statusCode,
      startedAt: window.startedAt, endedAt: new Date().toISOString(),
      elapsedMs: performance.now() - window.start, stagesMs: window.stages,
      ...loopDelay(window.start, performance.now()),
      processCpuMs: (cpu.user + cpu.system) / 1000, inclusiveNonAdditive: true }, 'Request timing');
    windows.delete(request);
  });
}
