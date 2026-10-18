import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { buildCellDict, type DataSnapshot, type Issue } from '@aemr/shared';
import { computeTrustScore, issueIdentity, ruleIssueIdentityParts } from '@aemr/core';
vi.mock('../config.js', () => ({ config: { database: { url: ':memory:' } } }));
import { db, schema } from '../db/index.js';
import { overlayPersistedStatus } from './issue-decisions.js';

let scans = 0;
db.$client.function('instr', { deterministic: true }, (haystack: unknown, needle: unknown) => {
  scans++;
  return haystack == null || needle == null ? null : String(haystack).indexOf(String(needle)) + 1;
});
beforeEach(() => { db.delete(schema.issues).run(); db.delete(schema.snapshots).run(); scans = 0; });
afterAll(() => db.$client.close());

function row(org = 'Учреждение'): unknown[] {
  const raw = Array<unknown>(34).fill('');
  raw[0] = '173/18'; raw[1] = '42'; raw[2] = org; raw[6] = 'Поставка';
  return raw;
}
function rule(raw: unknown[], legacy = false): Issue {
  return { id: issueIdentity([...ruleIssueIdentityParts('budget_sum_plan', 'УКСиМП', 'K4', buildCellDict(raw), legacy), 0]),
    checkId: 'budget_sum_plan', detectedBy: 'rule:budget_sum_plan', category: 'budget_sum_plan',
    sheet: 'УКСиМП', row: 4, cell: 'K4', status: 'open', severity: 'critical',
    origin: 'spreadsheet_rule', title: 'Синтетическая проверка', description: '', detectedAt: '2026-10-17T00:00:00Z' };
}
function snapshot(id: string, issues: Issue[], raw = row()): DataSnapshot {
  return { id, spreadsheetId: 'synthetic-book', createdAt: '2026-10-17T00:00:00Z',
    officialMetrics: {}, calculatedMetrics: {}, deltas: [], issues, rowCount: 1,
    trust: computeTrustScore(new Map(), issues, [], id), rowsByDept: { УКСиМП: [raw] },
    metadata: { sheetsRead: ['УКСиМП'], cellsRead: 34, readDurationMs: 1, pipelineDurationMs: 1 } };
}
function store(value: DataSnapshot): void {
  db.insert(schema.snapshots).values({ id: value.id, spreadsheetId: value.spreadsheetId,
    createdAt: value.createdAt, data: JSON.stringify(value) }).run();
}

it('does not reread raw identities when every persisted status is already open', () => {
  const issue = rule(row());
  db.insert(schema.issues).values({ ...issue, status: 'open' }).run();
  let rawReads = 0;
  const current = snapshot('current', [issue]);
  const rows = current.rowsByDept!['УКСиМП'];
  current.rowsByDept!['УКСиМП'] = new Proxy(rows, {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) rawReads++;
      return Reflect.get(target, key, receiver);
    },
  });
  expect(overlayPersistedStatus(current.issues, current)).toEqual([issue]);
  expect(rawReads).toBe(0);
});

it('still rejects a persisted closed status when the current raw identity is duplicated', () => {
  const issue = rule(row());
  db.insert(schema.issues).values({ ...issue, status: 'false_positive' }).run();
  const current = snapshot('current', [issue]);
  current.rowsByDept!['УКСиМП'].push(row());
  expect(overlayPersistedStatus(current.issues, current)[0].status).toBe('open');
  expect(db.select().from(schema.issues).get()?.status).toBe('false_positive');
});

it('does not scan historical payloads for a saved signal that cannot match a current rule', () => {
  const signal: Issue = { ...rule(row()), id: issueIdentity(['signal', 'data_quality', 'synthetic', 0]),
    detectedBy: 'pipeline:signal:dataQuality', origin: 'bi_heuristic', category: 'signal:dataQuality' };
  const old = snapshot('old', [signal]); store(old);
  db.insert(schema.issues).values({ ...signal, snapshotId: old.id, status: 'false_positive', comment: 'Решение сохранено' }).run();
  const current = snapshot('current', [rule(row())]); scans = 0;
  expect(overlayPersistedStatus(current.issues, current)).toEqual(current.issues);
  expect(scans).toBe(0);
  expect(db.select().from(schema.issues).get()).toMatchObject({ id: signal.id, status: 'false_positive', comment: 'Решение сохранено' });
});

it('still applies the saved decision when the same pipeline signal is currently present', () => {
  const signal: Issue = { ...rule(row()), id: 'same-signal', detectedBy: 'pipeline:signal:dataQuality',
    origin: 'bi_heuristic', category: 'signal:dataQuality' };
  db.insert(schema.issues).values({ ...signal, status: 'false_positive' }).run();
  const current = snapshot('current', [signal]); scans = 0;
  expect(overlayPersistedStatus(current.issues, current)[0]).toMatchObject({ id: signal.id, status: 'false_positive' });
  expect(scans).toBe(0);
  expect(current.issues[0].status).toBe('open');
});

it.each([null, 'legacy-validator'])('still proves an eligible legacy rule with uncertain saved detector metadata %s', detectedBy => {
  const previous = rule(row(), true); const old = snapshot('old', [previous]); store(old);
  db.insert(schema.issues).values({ ...previous, detectedBy, snapshotId: old.id, status: 'false_positive' }).run();
  const current = snapshot('current', [rule(row())]); scans = 0;
  expect(overlayPersistedStatus(current.issues, current)[0]).toMatchObject({ id: previous.id, status: 'false_positive' });
  expect(scans).toBeGreaterThan(0);
});

it('preserves a legacy decision after the row moved even when detector metadata is absent', () => {
  const previous = rule(row(), true); const old = snapshot('old', [previous]); store(old);
  db.insert(schema.issues).values({ ...previous, detectedBy: null, snapshotId: old.id, status: 'false_positive' }).run();
  const moved = { ...rule(row()), cell: 'K5', row: 5 };
  const current = snapshot('current', [moved]);
  current.rowsByDept = { УКСиМП: [row('Другое учреждение'), row()] };
  expect(overlayPersistedStatus(current.issues, current)[0]).toMatchObject({ id: previous.id, status: 'false_positive', cell: 'K5' });
});

it('keeps every historical version in an admitted legacy proof instead of trusting the latest snapshot ID', () => {
  const previous = rule(row(), true); const old = snapshot('old', [previous]); store(old);
  const foreign = row('Другое учреждение'); store(snapshot('conflicting', [rule(foreign, true)], foreign));
  db.insert(schema.issues).values({ ...previous, detectedBy: null, snapshotId: old.id, status: 'false_positive' }).run();
  const current = snapshot('current', [rule(row())]);
  expect(overlayPersistedStatus(current.issues, current)).toEqual(current.issues);
});
