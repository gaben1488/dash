import Fastify from 'fastify';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEPARTMENTS, departmentCoverage } from '@aemr/shared';

const state = vi.hoisted(() => ({ key: 'v1', generation: 0, read: vi.fn(), reset: vi.fn() }));
vi.mock('../services/changelog-source.js', () => ({ changelogInputKey: () => state.key }));
vi.mock('../services/snapshot.js', () => ({ getSnapshotGeneration: () => state.generation }));
vi.mock('../services/provenance-journal.js', () => ({
  readAllBookJournals: state.read, resetProvenanceJournalCache: state.reset,
}));
vi.mock('../services/dept-rows.js', () => ({
  readDeptRowsById: async () => ({
    rows: Object.fromEntries(DEPARTMENTS.map(d => [d.id, []])), source: 'live', asOf: '2026-10-20',
    coverage: departmentCoverage(DEPARTMENTS.map(d => d.nameShort), DEPARTMENTS.map(d => d.nameShort)),
  }),
}));
const { workloadRoutes, resetWorkloadCache } = await import('./workload.js');
let app: ReturnType<typeof Fastify>;
const journals = () => DEPARTMENTS.map(d => ({
  dept: d.nameShort, available: true, records: [], rowKeyless: 0, rawRows: 0, readAt: 1000,
}));
beforeEach(async () => {
  resetWorkloadCache(); state.key = 'v1'; state.generation = 0;
  state.read.mockReset().mockResolvedValue(journals()); state.reset.mockReset();
  app = Fastify(); await app.register(workloadRoutes);
});
afterEach(async () => { vi.restoreAllMocks(); await app.close(); });

it('keeps the accepted timestamp over two idle days and invalidates either input independently', async () => {
  const first = (await app.inject('/api/workload')).json();
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2 * 86400_000);
  expect((await app.inject('/api/workload')).json()).toEqual(first);
  expect(state.read).toHaveBeenCalledOnce();
  state.key = 'v2';
  await app.inject('/api/workload');
  state.generation++;
  await app.inject('/api/workload');
  expect(state.read).toHaveBeenCalledTimes(3);
});

it('manual refresh clears the underlying journal rather than only rebuilding its summary', async () => {
  await app.inject('/api/workload');
  await app.inject('/api/workload?refresh=true');
  expect(state.reset).toHaveBeenCalledOnce();
  expect(state.read).toHaveBeenCalledTimes(2);
});

it('does not retain a failed book as a successful zero-result cache', async () => {
  state.read.mockResolvedValueOnce(journals().map(j => ({ ...j, available: false })));
  await app.inject('/api/workload');
  const recovered = (await app.inject('/api/workload')).json();
  expect(recovered.booksSilent).toEqual([]);
  expect(state.read).toHaveBeenCalledTimes(2);
});

it('coalesces simultaneous views into one calculation', async () => {
  const responses = await Promise.all(Array.from({ length: 5 }, () => app.inject('/api/workload')));
  expect(responses.every(r => r.statusCode === 200)).toBe(true);
  expect(state.read).toHaveBeenCalledOnce();
});
