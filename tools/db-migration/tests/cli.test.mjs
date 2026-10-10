import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const cli = resolve('tools/db-migration/compare-snapshots.mjs');
const base = {
  sourceFileId: 'PRIVATE-SOURCE-ID-TEST-ONLY',
  sheetId: 1, sourceRow: 5, rowClass: 'data',
  displayNumber: '173/1', organizationId: 'ORG', subject: 'Synthetic purchase',
  payloadHash: 'a'.repeat(64),
};
function run(args) { return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 5000 }); }
function workspace(runTest) {
  const dir = mkdtempSync(join(tmpdir(), 'dash-id-audit-'));
  try {
    const old = join(dir, 'old.json'), fresh = join(dir, 'new.json');
    return runTest({ dir, old, fresh });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('CLI writes a protected, non-overwriting report and prints counts only', () => workspace(({ dir, old, fresh }) => {
  writeFileSync(old, JSON.stringify([{ ...base, snapshotId: 'old', entityId: 'UUID' }]));
  writeFileSync(fresh, JSON.stringify([{ ...base, snapshotId: 'new', sourceRow: 9, entityId: 'UUID' }]));
  const decisions = join(dir, 'decisions.json');
  writeFileSync(decisions, '[]');
  const report = join(dir, 'report.json');
  const first = run([old, fresh, decisions, report]);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(JSON.parse(first.stdout).confirmedLinks, 1);
  assert.ok(!first.stdout.includes(base.sourceFileId), 'sensitive source ID in standard output');
  assert.equal(JSON.parse(readFileSync(report, 'utf8')).matched.length, 1);
  if (process.platform !== 'win32') assert.equal(statSync(report).mode & 0o777, 0o600);
  const second = run([old, fresh, decisions, report]);
  assert.equal(second.status, 2, 'existing report must never be overwritten');
}));

test('CLI unresolved case has status 1 without exposing locators to stdout', () => workspace(({ old, fresh }) => {
  writeFileSync(old, JSON.stringify([{ ...base, snapshotId: 'old' }]));
  writeFileSync(fresh, JSON.stringify([{ ...base, snapshotId: 'new' }]));
  const output = run([old, fresh]);
  assert.equal(output.status, 1, output.stderr);
  assert.equal(JSON.parse(output.stdout).reviewCandidates, 1);
  assert.equal(JSON.parse(output.stdout).confirmedLinks, 0);
  assert.ok(!output.stdout.includes(base.sourceFileId));
}));

test('CLI malformed or missing JSON fails closed with code 2', () => workspace(({ old, fresh }) => {
  writeFileSync(old, '{this is not json');
  writeFileSync(fresh, '[]');
  const output = run([old, fresh]);
  assert.equal(output.status, 2);
  assert.match(output.stderr, /Migration audit input error/);
}));
