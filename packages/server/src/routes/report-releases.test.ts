import Fastify from 'fastify';
import { expect, it, vi } from 'vitest';
import { reportReleaseRoutes } from './report-releases.js';

it('does not acknowledge a refresh when durable admission fails', async () => {
  const app = Fastify();
  await app.register(reportReleaseRoutes, { refresh: async () => { throw new Error('private disk failure'); } });
  const response = await app.inject({ method: 'POST', url: '/api/report-releases/refresh' });
  expect(response.statusCode).toBe(503);
  expect(response.body).not.toContain('private disk failure');
  await app.close();
});

it('reads a bounded history page separately from the selected release detail', async () => {
  const app = Fastify();
  const read = vi.fn(async () => Buffer.from('{"releases":[],"next":null}'));
  await app.register(reportReleaseRoutes, { read });
  const before = `REL-${'a'.repeat(64)}`;
  expect((await app.inject('/api/report-releases/history?before=' + before)).statusCode).toBe(200);
  expect(read).toHaveBeenCalledWith('history', before, undefined, expect.any(AbortSignal));
  expect((await app.inject('/api/report-releases/history?before=../private')).statusCode).toBe(400);
  await app.close();
});

it('returns the stored projection and pinned documents without recalculating live data', async () => {
  const app = Fastify();
  const read = vi.fn(async (view: string) => Buffer.from(view === 'main' ? 'DOCX' : '{"snapshot_id":"frozen"}'));
  await app.register(reportReleaseRoutes, { read });
  const id = `REL-${'a'.repeat(64)}`;
  const response = await app.inject(`/api/report-releases/${id}/dashboard`);
  expect(response.json()).toEqual({ snapshot_id: 'frozen' });
  expect(read).toHaveBeenLastCalledWith('dashboard', id, undefined, expect.any(AbortSignal));
  const doc = await app.inject(`/api/report-releases/${id}/main.docx`);
  expect(doc.body).toBe('DOCX');
  expect(doc.headers['content-disposition']).toContain(`${id}-main.docx`);
  expect(doc.headers['cache-control']).toBe('private, no-store');
  await app.close();
});

it('rejects arbitrary paths and turns reader failures into a sanitized unavailable response', async () => {
  const app = Fastify();
  const read = vi.fn(async () => { throw new Error('private filesystem and source data'); });
  await app.register(reportReleaseRoutes, { read });
  expect((await app.inject('/api/report-releases/bad-id/main.docx')).statusCode).toBe(400);
  expect(read).not.toHaveBeenCalled();
  const response = await app.inject('/api/report-releases');
  expect(response.statusCode).toBe(503);
  expect(response.body).not.toContain('private filesystem');
  await app.close();
});

it('distinguishes an unpublished release from an integrity failure', async () => {
  const app = Fastify();
  const read = vi.fn(async () => { throw Object.assign(new Error('missing'), { code: 4 }); });
  await app.register(reportReleaseRoutes, { read });
  expect((await app.inject(`/api/report-releases/REL-${'b'.repeat(64)}/supplement.docx`)).statusCode).toBe(404);
  await app.close();
});

it('passes the selected report date, year and quarter to the frozen reader', async () => {
  const app = Fastify();
  const read = vi.fn(async () => Buffer.from('{"selected":null}'));
  await app.register(reportReleaseRoutes, { read });
  const response = await app.inject('/api/report-releases?date=2026-09-24&year=2026&quarter=3');
  expect(response.statusCode).toBe(200);
  expect(read).toHaveBeenCalledWith('status', undefined, { date: '2026-09-24', year: 2026, quarter: 3 }, expect.any(AbortSignal));
  for (const query of ['date=2026-09-24', 'date=2026-02-30&year=2026&quarter=1',
    'date=2026-09-24&year=2026&quarter=5', 'date=2026-09-24&year=x&quarter=3']) {
    expect((await app.inject(`/api/report-releases?${query}`)).statusCode).toBe(400);
  }
  expect(read).toHaveBeenCalledOnce();
  await app.close();
});

it('prepares only an exact archive context, without accepting files or live fallback', async () => {
  const app = Fastify();
  const prepare = vi.fn(async () => Buffer.from('{"selected":null,"attempt":null,"archive":{"status":"NOT_ISSUED","code":"ARCHIVE_INPUT_INCOMPLETE","message":"Missing archived inputs"}}'));
  const read = vi.fn();
  await app.register(reportReleaseRoutes, { read, prepare });
  const request = { date: '2026-09-24', year: 2025, quarter: 2 };
  const result = await app.inject({ method: 'POST', url: '/api/report-releases/prepare', payload: request });
  expect(result.statusCode).toBe(200);
  expect(result.json().archive.code).toBe('ARCHIVE_INPUT_INCOMPLETE');
  expect(prepare).toHaveBeenCalledWith(request);
  expect(read).not.toHaveBeenCalled();
  expect(result.headers['cache-control']).toBe('private, no-store');
  for (const payload of [{ ...request, source: '/etc/passwd' }, { ...request, date: '2026-02-30' },
    { ...request, quarter: 0 }, { ...request, quarter: true }, { ...request, quarter: '2' }, { ...request, ledger: [] }]) {
    expect((await app.inject({ method: 'POST', url: '/api/report-releases/prepare', payload })).statusCode).toBe(400);
  }
  expect(prepare).toHaveBeenCalledOnce();
  await app.close();
});

it('does not expose private archive paths or stack traces when preparation fails', async () => {
  const app = Fastify();
  const prepare = vi.fn(async () => { throw new Error('private-key private-archive-path'); });
  await app.register(reportReleaseRoutes, { prepare });
  const result = await app.inject({ method: 'POST', url: '/api/report-releases/prepare',
    payload: { date: '2026-09-24', year: 2026, quarter: 3 } });
  expect(result.statusCode).toBe(503);
  expect(result.body).not.toContain('private-');
  await app.close();
});

it('coalesces the same archive request and bounds expensive concurrent builds', async () => {
  const app = Fastify();
  let done!: (data: Buffer) => void;
  const prepare = vi.fn(() => new Promise<Buffer>(resolve => { done = resolve; }));
  await app.register(reportReleaseRoutes, { prepare });
  const payload = { date: '2026-09-24', year: 2026, quarter: 3 };
  await app.ready();
  // Consume both thenables before releasing the build; light-my-request may be lazy.
  const first = app.inject({ method: 'POST', url: '/api/report-releases/prepare', payload }).then(response => response);
  await vi.waitFor(() => expect(done).toBeTypeOf('function'));
  const second = app.inject({ method: 'POST', url: '/api/report-releases/prepare', payload }).then(response => response);
  const other = await app.inject({ method: 'POST', url: '/api/report-releases/prepare', payload: { ...payload, year: 2025 } });
  expect(other.json().archive.code).toBe('ARCHIVE_BUSY');
  expect(prepare).toHaveBeenCalledOnce();
  done(Buffer.from('{"selected":null,"attempt":null}'));
  const replies = await Promise.all([first, second]);
  expect(replies.map(response => response.json())).toEqual([
    { selected: null, attempt: null }, { selected: null, attempt: null },
  ]);
  expect(prepare).toHaveBeenCalledOnce();
  await app.close();
});


it('acknowledges only saved commands and does not wait for capture', async () => {
  const app = Fastify();
  const receipt = { status: 'QUEUED', attempt_id: 'a'.repeat(32), requested_at: '2026-10-20T00:00:00+00:00' };
  let save!: (value: unknown) => void;
  const refresh = vi.fn().mockImplementationOnce(() => new Promise(resolve => { save = resolve; }))
    .mockResolvedValue(receipt);
  const wake = vi.fn(async () => {});
  await app.register(reportReleaseRoutes, { refresh, wake });
  let acknowledged = false;
  const firstRequest = app.inject({ method: 'POST', url: '/api/report-releases/refresh', payload: {} })
    .then(response => { acknowledged = true; return response; });
  await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(acknowledged).toBe(false);
  expect(wake).not.toHaveBeenCalled();
  save(receipt);
  const first = await firstRequest;
  expect(first.statusCode).toBe(202);
  expect(first.json()).toMatchObject({ ...receipt, status: 'STARTED' });
  expect(first.json().message).toContain('не подтверждён');
  const other = await app.inject({ method: 'POST', url: '/api/report-releases/refresh', payload: {} });
  expect(other.statusCode).toBe(202);
  expect(other.json().attempt_id).toBe(receipt.attempt_id);
  expect(refresh).toHaveBeenCalledTimes(2);
  await vi.waitFor(() => expect(wake).toHaveBeenCalledTimes(2));
  await app.close();
});

it('reads a saved command after a new API instance starts', async () => {
  const receipt = { status: 'QUEUED', attempt_id: 'b'.repeat(32) };
  const first = Fastify();
  await first.register(reportReleaseRoutes, { refresh: async () => receipt, wake: async () => {} });
  const accepted = await first.inject({ method: 'POST', url: '/api/report-releases/refresh' });
  await first.close();
  const restarted = Fastify();
  const command = vi.fn(async () => ({ ...receipt, status: 'NOT_ISSUED', error_code: 'REPORT_ATTEMPT_INTERRUPTED' }));
  await restarted.register(reportReleaseRoutes, { command });
  const result = await restarted.inject('/api/report-releases/commands/' + accepted.json().attempt_id);
  expect(result.statusCode).toBe(200);
  expect(result.json()).toMatchObject({ attempt_id: receipt.attempt_id, status: 'NOT_ISSUED' });
  expect(result.headers['cache-control']).toBe('private, no-store');
  expect(command).toHaveBeenCalledWith(receipt.attempt_id);
  expect((await restarted.inject('/api/report-releases/commands/invalid')).statusCode).toBe(400);
  expect(command).toHaveBeenCalledOnce();
  await restarted.close();
});

it('does not replace a persisted acknowledgement with failure when waking the executor fails', async () => {
  const app = Fastify();
  await app.register(reportReleaseRoutes, {
    refresh: async () => ({ status: 'QUEUED', attempt_id: 'c'.repeat(32) }),
    wake: async () => { throw new Error('private wake error'); },
  });
  const response = await app.inject({ method: 'POST', url: '/api/report-releases/refresh' });
  expect(response.statusCode).toBe(202);
  expect(response.json().attempt_id).toBe('c'.repeat(32));
  expect(response.body).not.toContain('private');
  await app.close();
});

it('bounds executor processes while preserving a wake accepted during an active drain', async () => {
  const app = Fastify();
  let done!: () => void;
  const wake = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { done = resolve; }))
    .mockResolvedValue(undefined);
  await app.register(reportReleaseRoutes, {
    refresh: async () => ({ status: 'QUEUED', attempt_id: 'd'.repeat(32) }), wake,
  });
  await app.inject({ method: 'POST', url: '/api/report-releases/refresh' });
  await vi.waitFor(() => expect(wake).toHaveBeenCalledOnce());
  const second = await app.inject({ method: 'POST', url: '/api/report-releases/refresh' });
  expect(second.statusCode).toBe(202);
  expect(wake).toHaveBeenCalledOnce();
  done();
  await vi.waitFor(() => expect(wake).toHaveBeenCalledTimes(2));
  await app.close();
});

it('resumes accepted commands on API startup even without a periodic worker', async () => {
  const { mkdtempSync, mkdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const state = mkdtempSync(join(tmpdir(), 'report-command-resume-'));
  mkdirSync(join(state, 'commands'));
  vi.stubEnv('REPORT_STATE_DIR', state);
  const wake = vi.fn(async () => {});
  const app = Fastify();
  try {
    await app.register(reportReleaseRoutes, { wake });
    await app.listen({ host: '127.0.0.1', port: 0 });
    await vi.waitFor(() => expect(wake).toHaveBeenCalledOnce());
  } finally {
    await app.close();
    vi.unstubAllEnvs();
    rmSync(state, { recursive: true, force: true });
  }
});

it('rejects a receipt for another command and keeps private evidence out of HTTP', async () => {
  const app = Fastify();
  const command = vi.fn().mockResolvedValueOnce({ status: 'RUNNING', attempt_id: 'b'.repeat(32) })
    .mockResolvedValueOnce({ status: 'RUNNING', attempt_id: 'a'.repeat(32), private_evidence: 'SECRET' })
    .mockResolvedValueOnce({ status: 'VERIFIED', attempt_id: 'a'.repeat(32) })
    .mockRejectedValueOnce(Object.assign(new Error('private missing file'), { code: 4 }));
  await app.register(reportReleaseRoutes, { command });
  for (const status of [503, 503, 503, 404]) {
    const response = await app.inject('/api/report-releases/commands/' + 'a'.repeat(32));
    expect(response.statusCode).toBe(status);
    expect(response.body).not.toContain('SECRET');
    expect(response.body).not.toContain('private');
  }
  await app.close();
});

it('rejects user-provided refresh sources, archived dates and credentials', async () => {
  const app = Fastify();
  const refresh = vi.fn(async () => {});
  await app.register(reportReleaseRoutes, { refresh });
  for (const payload of [{ date: '2026-10-09' }, { registry: '/tmp/unsafe' }, { ledger: [] }]) {
    expect((await app.inject({
      method: 'POST', url: '/api/report-releases/refresh', payload,
    })).statusCode).toBe(400);
  }
  expect((await app.inject({ method: 'POST',
    url: '/api/report-releases/refresh?year=2026', payload: {} })).statusCode).toBe(400);
  expect(refresh).not.toHaveBeenCalled();
  await app.close();
});

it('bootstraps a legacy catalog before serving when the report worker is disabled', async () => {
  const module = await import('./report-releases.js');
  expect(module).toHaveProperty('initializePublicationReaders');
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const state = mkdtempSync(join(tmpdir(), 'legacy-reader-startup-'));
  mkdirSync(join(state, 'published'));
  writeFileSync(join(state, 'published/publications.sqlite'), 'legacy catalog');
  vi.stubEnv('REPORT_STATE_DIR', state);
  vi.stubEnv('REPORT_ENGINE_BIN', '/installed/proc-report');
  const run = vi.fn(async () => undefined);
  try {
    await Reflect.get(module, 'initializePublicationReaders')(run);
    expect(run).toHaveBeenCalledWith('/installed/proc-report', ['initialize-publication-readers', '--state', state],
      { timeout: 30_000, maxBuffer: 1024, shell: false });
    run.mockRejectedValueOnce(new Error('private source path and values'));
    await expect(Reflect.get(module, 'initializePublicationReaders')(run)).rejects.toThrow('PUBLICATION_READER_BOOTSTRAP_FAILED');
  } finally {
    vi.unstubAllEnvs();
    rmSync(state, { recursive: true, force: true });
  }
});

it('reads a pinned receipt by exact ID and rejects a context that could silently select another release', async () => {
  const app = Fastify();
  const read = vi.fn(async () => Buffer.from('{"selected":null}'));
  await app.register(reportReleaseRoutes, { read });
  const id = `REL-${'a'.repeat(64)}`;
  expect((await app.inject(`/api/report-releases/${id}/status`)).statusCode).toBe(200);
  expect(read).toHaveBeenCalledWith('status', id, undefined, expect.any(AbortSignal));
  read.mockClear();
  expect((await app.inject('/api/report-releases/bad/status')).statusCode).toBe(400);
  expect((await app.inject(`/api/report-releases/${id}/status?date=2026-09-24&year=2026&quarter=3`)).statusCode).toBe(400);
  expect(read).not.toHaveBeenCalled();
  await app.close();
});
