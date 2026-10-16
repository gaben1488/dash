import Fastify from 'fastify';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { reportReleaseRoutes } from './report-releases.js';

interface ReaderEvent { phase: 'start' | 'finish' | 'abort'; pid: number }

/** Production proc-report is a Linux executable; use a real local child, no mocks. */
async function nativeReaderFixture() {
  const root = await mkdtemp(join(tmpdir(), 'aemr-reader-abort-'));
  const trace = join(root, 'events.jsonl');
  const command = join(root, 'reader.mjs');
  await writeFile(trace, '');
  await writeFile(command, `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
const trace = ${JSON.stringify(trace)};
const record = phase => appendFileSync(trace, JSON.stringify({ phase, pid: process.pid }) + '\\n');
record('start');
const timer = setTimeout(() => {
  record('finish');
  console.log(JSON.stringify({ selected: null, latest_matching: null, attempt: null }));
}, 3000);
process.once('SIGTERM', () => { clearTimeout(timer); record('abort'); process.exit(0); });
`, { mode: 0o700 });
  vi.stubEnv('REPORT_ENGINE_BIN', command);
  vi.stubEnv('REPORT_STATE_DIR', join(root, 'state'));
  const app = Fastify();
  await app.register(reportReleaseRoutes);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/api/report-releases`;
  const events = async (): Promise<ReaderEvent[]> => (await readFile(trace, 'utf8'))
    .split('\n').filter(Boolean).map(line => JSON.parse(line) as ReaderEvent);
  return {
    base, events,
    async close() {
      // Failed RED assertions must not leave their synthetic children behind.
      for (let count = 0; count < 400; count++) {
        const rows = await events();
        if (rows.filter(row => row.phase === 'start').every(start =>
          rows.some(row => row.pid === start.pid && row.phase !== 'start'))) break;
        await delay(10);
      }
      await app.close();
      await rm(root, { recursive: true });
    },
  };
}

afterEach(() => vi.unstubAllEnvs());

it.skipIf(process.platform === 'win32')('stops the abandoned native GET child while a subsequent completed GET stays intact', async () => {
  const reader = await nativeReaderFixture();
  try {
    const controller = new AbortController();
    const first = fetch(reader.base, { signal: controller.signal }).catch(() => null);
    await expect.poll(async () => (await reader.events()).filter(row => row.phase === 'start').length).toBe(1);
    const [initial] = await reader.events();
    controller.abort();
    await first;
    await expect.poll(async () => (await reader.events()).some(row =>
      row.pid === initial.pid && row.phase === 'abort'), { timeout: 1000 }).toBe(true);
    const second = await fetch(reader.base);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ selected: null, latest_matching: null, attempt: null });
    const rows = await reader.events();
    expect(rows.filter(row => row.phase === 'start')).toHaveLength(2);
    expect(rows.filter(row => row.phase === 'abort')).toEqual([{ phase: 'abort', pid: initial.pid }]);
    expect(rows.filter(row => row.phase === 'finish')).toHaveLength(1);
  } finally {
    await reader.close();
  }
}, 10_000);

it.skipIf(process.platform === 'win32')('keeps accepted archive preparation running after its client disconnects', async () => {
  const reader = await nativeReaderFixture();
  try {
    const controller = new AbortController();
    const response = fetch(`${reader.base}/prepare`, {
      method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: '2026-10-17', year: 2026, quarter: 4 }),
    }).catch(() => null);
    await expect.poll(async () => (await reader.events()).filter(row => row.phase === 'start').length).toBe(1);
    controller.abort();
    await response;
    await expect.poll(async () => (await reader.events()).filter(row => row.phase === 'finish').length,
      { timeout: 4500 }).toBe(1);
    expect((await reader.events()).some(row => row.phase === 'abort')).toBe(false);
  } finally {
    await reader.close();
  }
}, 10_000);
