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
