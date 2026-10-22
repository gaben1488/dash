import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ getSnapshot: vi.fn(), getSHDYURawRowCount: vi.fn() }));
vi.mock('../services/snapshot.js', () => ({
  getSnapshot: h.getSnapshot,
  getDeptLoadMeta: () => ({}),
  getSHDYURawRowCount: h.getSHDYURawRowCount,
}));
const health = vi.hoisted(() => ({ report: vi.fn() }));
vi.mock('./health.js', () => ({ buildHealthReport: health.report }));

describe('source passport reads the shared source state without collecting data', () => {
  const previousPath = process.env.SQLITE_PATH;
  const app = Fastify({ logger: false });
  let names: string[];

  beforeAll(async () => {
    process.env.SQLITE_PATH = ':memory:';
    const { DEPARTMENT_SPREADSHEETS } = await import('../config.js');
    const { SVOD_SHEET_NAME, SHDYU_MONTHLY_SHEET_NAME } = await import('@aemr/shared');
    names = [SVOD_SHEET_NAME, ...Object.keys(DEPARTMENT_SPREADSHEETS), SHDYU_MONTHLY_SHEET_NAME];
    const { journalRoutes } = await import('./journal.js');
    await app.register(journalRoutes);
  });
  beforeEach(() => {
    h.getSnapshot.mockReset();
    h.getSHDYURawRowCount.mockReset().mockReturnValue(0);
    health.report.mockReset().mockReturnValue({ sources: { items: names.map(name => ({
      name, state: 'ok', loadedAt: '2026-10-13T01:00:00Z', checkedAt: '2026-10-13T01:00:00Z', rowCount: 2,
    })) } });
  });
  afterAll(async () => {
    await app.close();
    if (previousPath === undefined) delete process.env.SQLITE_PATH;
    else process.env.SQLITE_PATH = previousPath;
  });

  it('does not trigger a full snapshot to display source reading status', async () => {
    h.getSnapshot.mockRejectedValue(new Error('source unavailable'));
    const response = await app.inject({ method: 'GET', url: '/api/sources' });
    expect(response.statusCode).toBe(200);
    expect(h.getSnapshot).not.toHaveBeenCalled();
    const monthly = response.json().sources.find((source: { type: string }) => source.type === 'sheet');
    expect(monthly.lastSuccess).toBe('2026-10-13T01:00:00Z');
  });

  it('keeps all counts and per-source reading times from the shared source state', async () => {
    h.getSnapshot.mockResolvedValue({
      id: 'real-snapshot', createdAt: '2026-10-13T01:00:00Z',
      metadata: { sheetsRead: [], perSheetRowCount: {} },
      shdyuData: { first: {}, second: {} },
    });
    const response = await app.inject({ method: 'GET', url: '/api/sources' });
    expect(response.statusCode).toBe(200);
    expect(h.getSnapshot).not.toHaveBeenCalled();
    const monthly = response.json().sources.find((source: { type: string }) => source.type === 'sheet');
    expect(monthly.rowCount).toBe(2);
    expect(monthly.lastSuccess).toBe('2026-10-13T01:00:00Z');
    expect(response.json().onlineCount).toBe(names.length);
  });

  it('preserves a known empty sheet instead of replacing zero by missing data', async () => {
    const report = health.report();
    report.sources.items.at(-1).rowCount = 0;
    const response = await app.inject({ method: 'GET', url: '/api/sources' });
    const monthly = response.json().sources.find((source: { type: string }) => source.type === 'sheet');
    expect(monthly.rowCount).toBe(0);
    expect(monthly.statusLabel).toContain('прочитан пустым');
  });

  it('does not count a failed source as online even with an earlier successful reading', async () => {
    const item = health.report().sources.items[0];
    item.state = 'failed'; item.reason = 'нет доступа'; item.rowCount = null;
    const response = await app.inject({ method: 'GET', url: '/api/sources' });
    expect(response.json().errorCount).toBe(1);
    expect(response.json().onlineCount).toBe(names.length - 1);
    expect(response.json().sources[0].lastSuccess).toBe('2026-10-13T01:00:00Z');
  });

  it('rejects incomplete passport metadata instead of returning an empty successful list', async () => {
    health.report.mockReturnValue({ sources: { items: [] } });
    const response = await app.inject({ method: 'GET', url: '/api/sources' });
    expect(response.statusCode).toBe(503);
  });
});
