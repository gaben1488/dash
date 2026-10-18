import { createServer, get } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DataSnapshot, Issue } from '@aemr/shared';

vi.mock('./google-sheets.js', () => ({ getSheetDataFromSpreadsheet: vi.fn(async () => []) }));
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'snapshot-storage-'));
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('SQLITE_PATH', join(dir, 'state.sqlite'));
  vi.resetModules();
});
afterEach(async () => {
  const { db } = await import('../db/index.js');
  db.$client.close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});
function snapshot(id: string): DataSnapshot {
  return { id, spreadsheetId: 'synthetic', createdAt: id === 'old' ? '2026-10-11T00:00:00.000Z' : '2026-10-18T00:00:00.000Z',
    officialMetrics: {}, calculatedMetrics: {}, issues: [], deltas: [], rowCount: 0,
    trust: { overall: 100, components: [], grade: 'A', computedAt: '', basedOnSnapshot: id },
    metadata: { targetYear: null, sheetsRead: [], cellsRead: 0, readDurationMs: 0, pipelineDurationMs: 0 } };
}
it('реальный HTTP читает прежний полный срез, пока SQLite записывает новый', async () => {
  const { db, schema } = await import('../db/index.js');
  const { saveSnapshot } = await import('./snapshot.js');
  const { setSourceLogger } = await import('./source-log.js');
  expect(await saveSnapshot(snapshot('old'))).toBe(true);
  // Real SQLite work on the writer connection; no mocked timer or worker.
  db.$client.exec(`CREATE TRIGGER slow_snapshot BEFORE INSERT ON snapshots
    WHEN NEW.id = 'heavy' BEGIN
    SELECT sum(n) FROM (WITH RECURSIVE work(n) AS
      (SELECT 0 UNION ALL SELECT n+1 FROM work WHERE n<5000000) SELECT n FROM work);
    END`);
  const server = createServer((_request, response) => {
    response.end(JSON.stringify(db.select({ id: schema.snapshots.id }).from(schema.snapshots).all()));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('TEST_ADDRESS_REQUIRED');
  let reading!: Promise<string>;
  setSourceLogger({ info: fields => {
    if (fields.snapshotId !== 'heavy' || !fields.bytes) return;
    reading = new Promise((resolve, reject) => {
      get(`http://127.0.0.1:${address.port}`, response => {
        let body = ''; response.setEncoding('utf8');
        response.on('data', chunk => { body += chunk; });
        response.once('end', () => resolve(body));
      }).once('error', reject);
    });
  }, warn: () => {}, error: () => {} });
  try {
    const saving = saveSnapshot(snapshot('heavy'));
    expect(await saving).toBe(true);
    expect(JSON.parse(await reading)).toEqual([{ id: 'old' }]);
    expect(db.select({ id: schema.snapshots.id }).from(schema.snapshots).all()).toHaveLength(2);
  } finally {
    setSourceLogger(null);
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}, 15000);

it('file-worker сохраняет атомы, метрики и решения вместе; сбой атомов откатывает весь новый снимок', async () => {
  const { db, schema } = await import('../db/index.js');
  const { saveSnapshot, buildProcurementRowValues } = await import('./snapshot.js');
  const { eq } = await import('drizzle-orm');
  const first = snapshot('old');
  const row: unknown[] = Array(34).fill('');
  Object.assign(row, { 0: '173/1', 1: 'УЭР', 2: 'Школа', 3: 'Программа', 4: 'Подпрограмма', 5: 'ТД',
    6: 'Учебный предмет', 10: 100, 11: 'ЭА', 13: '12.10.2026', 24: 90, 26: 10, 29: 'да' });
  first.rowsByDept = { УЭР: [row] };
  const issue: Issue = { id: 'stable', severity: 'warning', status: 'open',
    origin: 'spreadsheet_rule', category: 'data', title: 'Учебный сигнал', description: '', detectedAt: first.createdAt, detectedBy: 'synthetic' };
  first.issues = [issue];
  first.officialMetrics = { plan: { metricKey: 'plan', value: 100, numericValue: 100, displayValue: '100',
    origin: 'official', period: 'annual', unit: 'thousand_rubles', sourceSheet: 'СВОД', sourceCell: 'K4',
    formula: null, confidence: 1, readAt: first.createdAt, warnings: [] } };
  expect(await saveSnapshot(first)).toBe(true);
  expect(db.select().from(schema.metricHistory).all()).toMatchObject([{ snapshotId: 'old', numericValue: 100 }]);
  const actual = db.select().from(schema.procurementRows).all()[0];
  const { id: _generated, ...stored } = actual;
  expect(stored).toEqual(buildProcurementRowValues(first)[0]);
  db.update(schema.issues).set({ status: 'resolved', comment: 'Решение сохранено' }).where(eq(schema.issues.id, 'stable')).run();
  const second = { ...first, id: 'second', createdAt: '2026-10-18T00:00:00.000Z' };
  expect(await saveSnapshot(second)).toBe(true);
  expect(db.select().from(schema.issues).get()).toMatchObject({ snapshotId: 'second', status: 'resolved', comment: 'Решение сохранено' });
  db.$client.exec(`CREATE TRIGGER reject_atoms BEFORE INSERT ON procurement_rows
    WHEN NEW.snapshot_id = 'rejected' BEGIN SELECT RAISE(ABORT, 'synthetic'); END`);
  expect(await saveSnapshot({ ...second, id: 'rejected' })).toBe(false);
  expect(db.select().from(schema.snapshots).where(eq(schema.snapshots.id, 'rejected')).get()).toBeUndefined();
  expect(db.select().from(schema.procurementRows).where(eq(schema.procurementRows.snapshotId, 'rejected')).all()).toEqual([]);
  expect(db.select().from(schema.metricHistory).where(eq(schema.metricHistory.snapshotId, 'rejected')).all()).toEqual([]);
  expect(db.select().from(schema.issues).get()).toMatchObject({ snapshotId: 'second', status: 'resolved', comment: 'Решение сохранено' });
});

it('file-worker даёт прочитать полный commit перед retention; отказ удаления не отменяет запись', async () => {
  const { db, schema } = await import('../db/index.js');
  const { saveSnapshot } = await import('./snapshot.js');
  const { setSourceLogger } = await import('./source-log.js');
  const old = { ...snapshot('old'), createdAt: '2026-10-12T00:00:00.000Z', rowsByDept: { УЭР: [[1, 'УЭР', '', '', '', '', 'Предмет']] } };
  expect(await saveSnapshot(old)).toBe(true);
  let committedRead: Promise<string[]> | undefined;
  setSourceLogger({ info: fields => {
    if (fields.snapshotId === 'new' && fields.rows) committedRead = new Promise(resolve => setImmediate(() => {
      resolve(db.select({ id: schema.snapshots.id }).from(schema.snapshots).all().map(row => row.id).sort());
    }));
  }, warn: () => {}, error: () => {} });
  try {
    expect(await saveSnapshot({ ...old, id: 'new', createdAt: '2026-10-15T00:00:00.000Z' })).toBe(true);
    expect(await committedRead).toEqual(['new', 'old']);
    expect(db.select({ id: schema.snapshots.id }).from(schema.snapshots).all()).toEqual([{ id: 'new' }]);
    db.$client.exec(`CREATE TRIGGER reject_prune BEFORE DELETE ON snapshots BEGIN SELECT RAISE(ABORT, 'synthetic'); END`);
    expect(await saveSnapshot({ ...old, id: 'latest', createdAt: '2026-10-16T00:00:00.000Z' })).toBe(true);
    expect(db.select({ id: schema.snapshots.id }).from(schema.snapshots).all().map(row => row.id).sort()).toEqual(['latest', 'new']);
    expect(db.select().from(schema.procurementRows).all()).toHaveLength(2);
  } finally { setSourceLogger(null); }
});

it('потерянная квитанция не отменяет commit; существующий ID и несовпавший payload не выдаются за новую запись', async () => {
  const { db, schema } = await import('../db/index.js');
  const { saveSnapshot } = await import('./snapshot.js');
  const { saveSnapshotToDb } = await import('./snapshot-storage.js');
  const worker = await import('./snapshot-calculation.js');
  vi.spyOn(worker, 'runSnapshotStorage').mockImplementationOnce(async input => {
    saveSnapshotToDb(input.snapshot, db, input.today);
    throw new Error('SNAPSHOT_STORAGE_EXITED_WITHOUT_RESULT');
  });
  const accepted = snapshot('committed');
  expect(await saveSnapshot(accepted)).toBe(true);
  expect(db.select().from(schema.snapshots).get()?.data).toBe(JSON.stringify(accepted));
  expect(await saveSnapshot(accepted)).toBe(false);
  vi.spyOn(worker, 'runSnapshotStorage').mockImplementationOnce(async input => {
    saveSnapshotToDb({ ...input.snapshot, spreadsheetId: 'other' }, db, input.today);
    throw new Error('SNAPSHOT_STORAGE_EXITED_WITHOUT_RESULT');
  });
  expect(await saveSnapshot(snapshot('different'))).toBe(false);
});
