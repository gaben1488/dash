import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEPARTMENTS, DEPT_HEADER_ROWS } from '@aemr/shared';

// Two real calculation workers took 9.6s on the CPU-bounded release runner.
// Freshness and queue ordering are asserted below, independently of startup time.
vi.setConfig({ testTimeout: 30_000 });

const original = { ...process.env };
const google = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('./google-sheets.js', () => ({
  batchGetCells: async (...args: unknown[]) => {
    // A slow reader may return a genuinely empty *set of values*, but a
    // successfully read required A1 range must still be present in the reply.
    const values = await google.read(...args);
    if (Array.isArray(values) && values.length) return values;
    const { getAllCellAddresses } = await import('@aemr/shared');
    return getAllCellAddresses().map(range => ({ range, values: [[]] }));
  },
  batchGetFormulas: vi.fn(async () => {
    const { getAllCellAddresses } = await import('@aemr/shared');
    return getAllCellAddresses().map(range => ({ range, formulas: [[]] }));
  }),
  batchGetSheetValues: vi.fn(async (names: readonly string[]) =>
    Object.fromEntries(names.map(name => [name, []]))),
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
afterEach(() => { fixture?.db.$client.close(); process.env = { ...original }; });

async function seed() {
  const source = await import('./snapshot.js');
  const { db, schema } = await import('../db/index.js');
  const { config, DEPARTMENT_SPREADSHEETS } = await import('../config.js');
  const { saveWatermark, SVOD_WATERMARK_KEY } = await import('./book-watermark.js');
  const { sheetFingerprint } = await import('./sheet-fingerprint.js');
  const { departmentCoverage } = await import('@aemr/shared');
  // The read-model test is not permitted to create a successful calculation
  // from missing masters. Seed a fully accepted local input (with an intentionally
  // older saved calculation) so latency/retention tests are still meaningful.
  const values = Array.from({ length: DEPT_HEADER_ROWS }, () => [] as unknown[]);
  const books = Object.fromEntries(Object.entries(DEPARTMENT_SPREADSHEETS).map(([name, id]) => {
    saveWatermark(name, sheetFingerprint(values), '2026-10-16T01:00:00.000Z',
      { version: 'fixture-v1', modifiedTime: null }, { fileId: id, values });
    return [name, { values, formulas: [], sheetName: 'ВСЕ', formulasRead: true }];
  }));
  source.setDeptSheetCache(books);
  source.setSvodGridCache([]);
  saveWatermark(SVOD_WATERMARK_KEY, sheetFingerprint([]), '2026-10-16T01:00:00.000Z',
    { version: 'fixture-main-v1', modifiedTime: null },
    { fileId: config.google.spreadsheetId, values: [] });
  const saved = { id: 'saved-2026', spreadsheetId: 'read-model-test', createdAt: '2026-10-16T01:00:00.000Z',
    officialMetrics: {}, calculatedMetrics: {}, deltas: [], issues: [], rowCount: 0,
    trust: { overall: 100, components: [], grade: 'A' as const, computedAt: '2026-10-16T01:00:00.000Z', basedOnSnapshot: 'saved-2026' },
    metadata: { targetYear: 2026, sheetsRead: [], cellsRead: 0, readDurationMs: 0,
      pipelineDurationMs: 0, sourceCoverage: departmentCoverage(Object.keys(books), Object.keys(books)),
      sourceReceipt: 'older-than-current-accepted-source' } };
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
    expect(results).toEqual([0, 1].map(() => ({ ...saved,
      trust: expect.objectContaining({ overall: null, grade: null, basedOnSnapshot: saved.id }),
      metadata: { ...saved.metadata, readModel: { state: 'refreshing' } } })));
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

it('does not revive a legacy perfect trust grade while serving saved data during a source outage', async () => {
  const { source, saved, raw, db, schema, reject } = fixture;
  const current = await source.getSnapshot(false, 2026);
  const force = source.getSnapshot(true, 2026);
  try {
    expect(current.trust).toMatchObject({ overall: null, grade: null, basedOnSnapshot: saved.id });
    expect(current.id).toBe(saved.id);
    expect(current.createdAt).toBe(saved.createdAt);
    expect(db.select().from(schema.snapshots).all().map(row => row.data)).toEqual(raw);
    expect(source.getStoredSnapshotById(saved.id)?.trust.overall).toBe(100);
  } finally { reject(new Error('synthetic source failure')); await force; }
});


it('keeps captured data through repeated invalidation and marks a failed import stale without a new timestamp', async () => {
  const { source, saved, raw, db, schema, reject } = fixture;
  const first = await source.getSnapshot(false, 2026);
  const force = source.getSnapshot(true, 2026);
  try {
    source.invalidateCache(); source.invalidateCache();
    expect(await source.getSnapshot(false, 2026)).toEqual({ ...first,
      // Reassessment time may change; the captured source time and all data may not.
      trust: { ...first.trust, computedAt: expect.any(String) } });
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

it('keeps an unchanged accepted generation across two idle days without Google or another snapshot', async () => {
  const { source, db, schema } = fixture;
  source.setDeptSheetCache(Object.fromEntries(DEPARTMENTS.map(dept => [dept.nameShort, {
    values: Array.from({ length: DEPT_HEADER_ROWS }, () => []), formulas: [], sheetName: dept.nameShort,
  }])));
  google.read.mockResolvedValue([]);
  const snapshot = await source.getSnapshot(true, 2026);
  expect(snapshot.metadata.sourceCoverage?.complete).toBe(true);
  const stored = db.select().from(schema.snapshots).all().map(row => row.id);
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2 * 86400_000);
  try {
    expect((await source.getSnapshot(false, 2026)).id).toBe(snapshot.id);
    expect((await source.getSnapshot(false, 2026)).createdAt).toBe(snapshot.createdAt);
    expect(google.read).toHaveBeenCalledTimes(1);
    expect(db.select().from(schema.snapshots).all().map(row => row.id)).toEqual(stored);
  } finally { clock.mockRestore(); }
});

it('bounds retained scope models and serializes different scopes without delaying saved readers', async () => {
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
    // Five scopes still share their own work, but only one full import may run.
    expect(google.read).toHaveBeenCalledTimes(1);
  } finally { scan.mockRestore(); reject(new Error('synthetic source failure')); await Promise.all(forces); }
  expect(google.read).toHaveBeenCalledTimes(5);
});

it('continues the materialization queue after an uncaught failure in a different scope', async () => {
  const { source, saved } = fixture;
  google.read.mockRejectedValueOnce(new Error('synthetic missing scope')).mockResolvedValue([]);
  const missing = source.getSnapshot(true, 2028);
  const next = source.getSnapshot(true, 2026);
  await expect(missing).rejects.toThrow('synthetic missing scope');
  expect((await next).id).not.toBe(saved.id);
  expect(google.read).toHaveBeenCalledTimes(2);
});

it('captures invalidation generation when queued work actually starts', async () => {
  const { source } = fixture;
  let release!: (value: unknown[]) => void;
  google.read.mockReturnValueOnce(new Promise(resolve => { release = resolve; })).mockResolvedValue([]);
  const first = source.getSnapshot(true, 2028);
  const queued = source.getSnapshot(true, 2026);
  await new Promise(resolve => setImmediate(resolve));
  expect(google.read).toHaveBeenCalledTimes(1);
  source.invalidateCache();
  release([]);
  expect((await first).metadata.readModel?.state).toBe('refreshing');
  const result = await queued;
  expect(result.metadata.readModel).toBeUndefined();
  expect((await source.getSnapshot(false, 2026)).id).toBe(result.id);
  expect(google.read).toHaveBeenCalledTimes(2);
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

it.each([[2026, true], [2027, true], [undefined, true], [2027, false]] as const)(
  'reads scope %s without decoding historical JSON when metadata is indexed=%s', async (year, indexed) => {
    const { source, db, reject } = fixture;
    if (!indexed) db.$client.exec('DROP INDEX idx_snapshots_read_scope');
    // Count real SQLite expression evaluations, independent of EXPLAIN output wording.
    // These functions are never needed on an indexed lookup; the no-index control
    // proves that the detector actually catches historical JSON evaluation.
    const decode = vi.fn((_payload: unknown, _path: unknown) => null);
    db.$client.function('json_type', { deterministic: true }, decode);
    db.$client.function('json_extract', { deterministic: true }, decode);
    const read = source.getSnapshot(false, year).catch(() => undefined);
    const force = source.getSnapshot(true, year).catch(() => undefined);
    try {
      const result = await read;
      if (indexed) expect(decode).not.toHaveBeenCalled();
      else expect(decode).toHaveBeenCalled();
      if (year === 2026) expect(result?.id).toBe('saved-2026');
    } finally { reject(new Error('synthetic source failure')); await force; }
  });

it('builds the metadata index over old malformed payloads without changing them or accepting a string year', async () => {
  const { source, db, schema, saved, reject } = fixture;
  db.$client.exec('DROP INDEX idx_snapshots_read_scope');
  for (const [id, data] of [['bad-json', '{'], ['string-year', JSON.stringify({ ...saved, id: 'string-year', metadata: { targetYear: '2026' } })]]) {
    db.insert(schema.snapshots).values({ id, data, spreadsheetId: 'read-model-test', createdAt: '2026-10-17T00:00:00Z' }).run();
  }
  const before = db.select({ id: schema.snapshots.id, data: schema.snapshots.data }).from(schema.snapshots).all();
  const { SCHEMA_DDL } = await import('../db/ddl.js');
  db.$client.exec(SCHEMA_DDL);
  expect(db.select({ id: schema.snapshots.id, data: schema.snapshots.data }).from(schema.snapshots).all()).toEqual(before);
  const read = await source.getSnapshot(false, 2026);
  const force = source.getSnapshot(true, 2026);
  try { expect(read.id).toBe(saved.id); }
  finally { reject(new Error('synthetic source failure')); await force; }
});

it.each([true, false])('enumerates weekly candidate metadata without rescanning payloads when indexed=%s', async (indexed) => {
  const { source, db, schema } = fixture;
  for (const [id, data] of [['weekly-b', '{"weeklyTableContext":{}}'], ['weekly-a', '{"weeklyTableContext":'], ['ordinary', '{}']]) {
    db.insert(schema.snapshots).values({ id, data, spreadsheetId: 'read-model-test', createdAt: '2026-10-16T02:00:00Z' }).run();
  }
  const original = db.select({ id: schema.snapshots.id, data: schema.snapshots.data }).from(schema.snapshots).all();
  const expected = [...source.iterateWeeklySnapshotHistory()];
  expect(expected.map((row) => row.id)).toEqual(['weekly-b', 'weekly-a']);
  if (!indexed) db.$client.exec('DROP INDEX IF EXISTS idx_snapshots_weekly_evidence');
  const scan = vi.fn((payload: string, needle: string) => payload.indexOf(needle) + 1);
  db.$client.function('instr', { deterministic: true }, scan);
  expect([...source.iterateWeeklySnapshotHistory()]).toEqual(expected);
  if (indexed) expect(scan).not.toHaveBeenCalled();
  else expect(scan).toHaveBeenCalled();
  expect(db.select({ id: schema.snapshots.id, data: schema.snapshots.data }).from(schema.snapshots).all()).toEqual(original);
});


it('reuses a fully accepted saved calculation after restart without a Google read or new snapshot', async () => {
  const { source, db, schema } = fixture;
  const { config, DEPARTMENT_SPREADSHEETS } = await import('../config.js');
  const { saveWatermark, sourceStateReceipt, SVOD_WATERMARK_KEY } = await import('./book-watermark.js');
  const { sheetFingerprint } = await import('./sheet-fingerprint.js');
  const { calculateSnapshot } = await import('./snapshot-calculation.js');
  const { REPORT_MAP, DEPT_COLUMNS, DEPT_HEADER_LABELS, departmentCoverage } = await import('@aemr/shared');
  const header: string[] = [];
  for (const [key, index] of Object.entries(DEPT_COLUMNS)) header[index] = DEPT_HEADER_LABELS[key as keyof typeof DEPT_COLUMNS];
  const rows = Object.fromEntries(Object.entries(DEPARTMENT_SPREADSHEETS).map(([book, fileId]) => {
    const values = [[], [], [...header]];
    saveWatermark(book, sheetFingerprint(values), '2026-10-21T00:00:00Z', { version: 'fixture-v1', modifiedTime: null }, { fileId, values });
    return [book, values];
  }));
  saveWatermark(SVOD_WATERMARK_KEY, sheetFingerprint([]), '2026-10-21T00:00:00Z',
    { version: 'fixture-main-v1', modifiedTime: null }, { fileId: config.google.spreadsheetId, values: [] });
  const saved = calculateSnapshot({ spreadsheetId: config.google.spreadsheetId, asOf: new Date('2026-10-21T00:00:00Z'),
    sheetRows: rows, batchGetData: [], reportMap: REPORT_MAP, targetYear: 2026, officialYear: 2026 });
  saved.metadata.sourceReceipt = sourceStateReceipt(DEPARTMENT_SPREADSHEETS, config.google.spreadsheetId);
  saved.metadata.sourceCoverage = departmentCoverage(Object.keys(rows), Object.keys(rows));
  await source.saveSnapshot(saved);
  const count = db.select().from(schema.snapshots).all().length;
  google.read.mockClear();
  for (let n = 0; n < 2; n++) {
    const result = await source.getSnapshot(false, 2026);
    expect(result.id).toBe(saved.id); expect(result.createdAt).toBe(saved.createdAt);
    expect(result.metadata.readModel).toBeUndefined();
  }
  await new Promise(resolve => setImmediate(resolve));
  expect(google.read).not.toHaveBeenCalled();
  expect(db.select().from(schema.snapshots).all()).toHaveLength(count);
});
