import Fastify from 'fastify';
import { expect, it, vi } from 'vitest';
import { reportReleaseRoutes } from './report-releases.js';

it('returns the stored projection and pinned documents without recalculating live data', async () => {
  const app = Fastify();
  const read = vi.fn(async (view: string) => Buffer.from(view === 'main' ? 'DOCX' : '{"snapshot_id":"frozen"}'));
  await app.register(reportReleaseRoutes, { read });
  const id = `REL-${'a'.repeat(64)}`;
  const response = await app.inject(`/api/report-releases/${id}/dashboard`);
  expect(response.json()).toEqual({ snapshot_id: 'frozen' });
  expect(read).toHaveBeenLastCalledWith('dashboard', id);
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
  expect(read).toHaveBeenCalledWith('status', undefined, { date: '2026-09-24', year: 2026, quarter: 3 });
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
