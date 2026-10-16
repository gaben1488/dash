import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const original = { ...process.env };
const google = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('./google-sheets.js', () => ({
  batchGetCells: google.read,
  batchGetFormulas: vi.fn(async () => []),
  batchGetSheetValues: vi.fn(async () => ({})),
  getSheetData: vi.fn(async () => []),
  fetchSHDYUSheet: vi.fn(async () => ({ values: [], formulas: [], sheetName: 'monthly' })),
}));
let fixture: Awaited<ReturnType<typeof seed>>;
beforeEach(async () => {
  vi.resetModules(); google.read.mockReset();
  process.env = { ...original, NODE_ENV: 'test', AEMR_API_KEY: '', SQLITE_PATH: ':memory:', LOG_LEVEL: 'silent',
    GOOGLE_SERVICE_ACCOUNT_EMAIL: '', GOOGLE_PRIVATE_KEY: '', GOOGLE_API_KEY: 'synthetic-configured',
    GOOGLE_SHEETS_SPREADSHEET_ID: 'read-model-test' };
  fixture = await seed();
});
afterEach(() => { process.env = { ...original }; });

async function seed() {
  const source = await import('./snapshot.js');
  const { db, schema } = await import('../db/index.js');
  const saved = { id: 'saved-2026', spreadsheetId: 'read-model-test', createdAt: '2026-10-16T01:00:00.000Z',
    officialMetrics: {}, calculatedMetrics: {}, deltas: [], issues: [], rowCount: 0,
    trust: { overall: 100, components: [], grade: 'A' as const, computedAt: '2026-10-16T01:00:00.000Z', basedOnSnapshot: 'saved-2026' },
    metadata: { targetYear: 2026, sheetsRead: [], cellsRead: 0, readDurationMs: 0, pipelineDurationMs: 0 } };
  expect(await source.saveSnapshot(saved)).toBe(true);
  const raw = db.select().from(schema.snapshots).all().map(row => row.data);
  let reject!: (error: Error) => void;
  let resolve!: (value: unknown[]) => void;
  google.read.mockReturnValue(new Promise((yes, no) => { resolve = yes; reject = no; }));
  return { source, db, schema, saved, raw, reject, resolve };
}

it('returns the same-scope persisted model while one slow background import serves all readers', async () => {
  const { source, db, schema, saved, raw, reject } = fixture;
  const scan = vi.spyOn(db.$client, 'prepare');
  const reads = [source.getSnapshot(false, 2026), source.getSnapshot(false, 2026)];
  const force = source.getSnapshot(true, 2026);
  try {
    await new Promise(resolve => setImmediate(resolve));
    const results = [];
    for (const read of reads) results.push(await Promise.race([read, Promise.resolve(null)]));
    expect(results).toEqual([0, 1].map(() => ({ ...saved, metadata: { ...saved.metadata, readModel: { state: 'refreshing' } } })));
    expect(scan.mock.calls.filter(([query]) => query.includes('json_type'))).toHaveLength(1);
    expect(db.select().from(schema.snapshots).all().map(row => row.data)).toEqual(raw);
  } finally { scan.mockRestore(); reject(new Error('synthetic delayed source')); await force; }
  expect(google.read).toHaveBeenCalledTimes(1);
});

it('never substitutes a saved different year for an unmaterialized period', async () => {
  const { source, reject } = fixture;
  const read = source.getSnapshot(false, 2027).then(() => 'WRONG_SCOPE', error => error.code);
  const force = source.getSnapshot(true, 2027).catch(() => undefined);
  try {
    await new Promise(resolve => setImmediate(resolve));
    expect(await Promise.race([read, Promise.resolve(null)])).toBe('SNAPSHOT_NOT_READY');
  }
  finally { reject(new Error('synthetic delayed source')); await force; }
});


it('keeps captured data through repeated invalidation and marks a failed import stale without a new timestamp', async () => {
  const { source, saved, raw, db, schema, reject } = fixture;
  const first = await source.getSnapshot(false, 2026);
  const force = source.getSnapshot(true, 2026);
  try {
    source.invalidateCache(); source.invalidateCache();
    expect(await source.getSnapshot(false, 2026)).toEqual(first);
  } finally { reject(new Error('synthetic source failure')); }
  const failed = await force;
  expect(failed.createdAt).toBe(saved.createdAt);
  expect(failed.metadata.readModel?.state).toBe('stale');
  expect(await source.getSnapshot(false, 2026)).toEqual(failed);
  expect(google.read).toHaveBeenCalledTimes(1);
  expect(db.select().from(schema.snapshots).all().map(row => row.data)).toEqual(raw);
});

it('keeps a completed build invalidated if a newer source event arrived while it was building', async () => {
  const { source, saved, resolve } = fixture;
  await source.getSnapshot(false, 2026);
  const force = source.getSnapshot(true, 2026);
  source.invalidateCache();
  resolve([]);
  const built = await force;
  expect(built.id).not.toBe(saved.id);
  expect(built.metadata.readModel?.state).toBe('refreshing');
  google.read.mockResolvedValue([]);
  expect((await source.getSnapshot(false, 2026)).metadata.readModel?.state).toBe('refreshing');
  const next = await source.getSnapshot(true, 2026);
  expect(next.metadata.readModel).toBeUndefined();
  expect((await source.getSnapshot(false, 2026)).id).toBe(next.id);
  expect(google.read).toHaveBeenCalledTimes(2);
});

it('bounds retained scope models while still sharing each in-flight import after eviction', async () => {
  const { source, saved, reject, db } = fixture;
  const years = [2022, 2023, 2024, 2025, 2026];
  for (const year of years.slice(0, -1)) {
    expect(await source.saveSnapshot({ ...saved, id: `saved-${year}`, metadata: { ...saved.metadata, targetYear: year } })).toBe(true);
  }
  const scan = vi.spyOn(db.$client, 'prepare');
  const forces: Promise<unknown>[] = [];
  try {
    for (const year of years) {
      expect((await source.getSnapshot(false, year)).id).toBe(`saved-${year}`);
      forces.push(source.getSnapshot(true, year));
    }
    expect((await source.getSnapshot(false, 2022)).id).toBe('saved-2022');
    expect(scan.mock.calls.filter(([query]) => query.includes('json_type'))).toHaveLength(6);
    expect(google.read).toHaveBeenCalledTimes(5);
  } finally { scan.mockRestore(); reject(new Error('synthetic source failure')); await Promise.all(forces); }
});


it('propagates actual snapshot freshness through the metrics projection without waiting for Google', async () => {
  const { source, reject, saved } = fixture;
  const { default: Fastify } = await import('fastify');
  const { registerSnapshotReadState } = await import('../plugins/snapshot-read-state.js');
  const { metricsRoutes } = await import('../routes/metrics.js');
  const app = Fastify();
  registerSnapshotReadState(app);
  await app.register(metricsRoutes);
  // Metrics use the all-years scope; an explicitly scoped all-years fixture is required.
  await source.saveSnapshot({ ...saved, id: 'saved-all', metadata: { ...saved.metadata, targetYear: null } });
  const read = app.inject('/api/metrics').then(response => response);
  await app.ready();
  await new Promise(resolve => setImmediate(resolve));
  const force = source.getSnapshot(true);
  try {
    const response = await Promise.race([read, Promise.resolve(null)]);
    expect(response?.statusCode).toBe(200);
    expect(response?.headers['x-aemr-data-state']).toBe('refreshing');
    expect(response?.headers['x-aemr-data-captured-at']).toBe(saved.createdAt);
    expect(response?.json()).toEqual({ official: {}, calculated: {}, deltas: [] });
  } finally { reject(new Error('synthetic source failure')); await force; await app.close(); }
});


it('rechecks materialized storage once after invalidation so newly persisted decisions use the latest source address', async () => {
  const { source, saved, reject } = fixture;
  await source.getSnapshot(false, 2026);
  const force = source.getSnapshot(true, 2026);
  try {
    const newer = { ...saved, id: 'newer-materialized', createdAt: '2026-10-16T02:00:00.000Z' };
    await source.saveSnapshot(newer);
    source.invalidateCache();
    expect((await source.getSnapshot(false, 2026)).id).toBe(newer.id);
    expect((await source.getSnapshot(false, 2026)).id).toBe(newer.id);
  } finally { reject(new Error('synthetic source failure')); await force; }
});
