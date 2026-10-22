import { describe, expect, it } from 'vitest';
import type { DataSnapshot } from '@aemr/shared';
import type { PipelineInput } from '@aemr/core';
import {
  calculationSha256,
  makeCalculationEvidence,
  inspectArchivedCalculationEvidence,
} from './calculation-evidence.js';

const AT = '2026-10-22T09:00:00.000Z';
const CODE = 'a'.repeat(40);

const input = (): PipelineInput => ({
  spreadsheetId: 'svod-identity',
  batchGetData: [{ range: 'СВОД ТД-ПМ!A1', values: [[42]] }],
  sheetRows: { УО: [['header'], ['1', 'a']], УЭР: [['header'], ['2', 'b']] },
  reportMap: [{ id: 'metric' }],
  rules: [{
    id: 'rule-1', name: 'Test rule', description: 'Test',
    severity: 'warning', origin: 'runtime_error', scope: 'cell', params: { cutoff: 10 },
    check: () => ({ valid: true }),
  }],
  targetYear: 2026,
  officialYear: 2026,
} as unknown as PipelineInput);

const snapshot = (): DataSnapshot => ({
  id: 'snapshot-x',
  spreadsheetId: 'svod-identity',
  createdAt: AT,
  officialMetrics: {},
  calculatedMetrics: {},
  deltas: [],
  issues: [],
  rowCount: 2,
  trust: { overall: 100, grade: 'A', components: [], computedAt: AT, basedOnSnapshot: 'snapshot-x' } as DataSnapshot['trust'],
  rowsByDept: { УО: [['1', 'a']], УЭР: [['2', 'b']] },
  metadata: { sheetsRead: ['СВОД ТД-ПМ'], cellsRead: 1, readDurationMs: 3, pipelineDurationMs: 4 },
});

const evidenceSources = (overrides = {}) => ({
  sourceIds: { УО: 'book-uo', УЭР: 'book-uer' },
  masterNames: ['УО', 'УЭР'],
  readMeta: {
    УО: { loadedAt: AT, rowCount: 2, sheetName: 'ВСЕ' },
    УЭР: { loadedAt: AT, rowCount: 2, sheetName: 'ВСЕ' },
  },
  observedDriveVersions: { УО: '123', УЭР: '456' },
  codeCommit: CODE,
  ...overrides,
});

describe('calculation evidence: deterministic capture', () => {
  it('canonicalizes object key order but never spreadsheet row order', () => {
    expect(calculationSha256({ b: 2, a: { y: 3, x: 4 } }))
      .toBe(calculationSha256({ a: { x: 4, y: 3 }, b: 2 }));
    expect(calculationSha256([['1'], ['2']]))
      .not.toBe(calculationSha256([['2'], ['1']]));
  });

  it('matches the exact JSON storage roundtrip for undefined values, dates and non-finite numbers', () => {
    const value = { date: new Date('2026-10-22T08:00:00Z'), omitted: undefined, amount: NaN };
    const stored = JSON.parse(JSON.stringify(value)) as unknown;
    expect(calculationSha256(value)).toBe(calculationSha256(stored));
  });

  it('captures source IDs, dates, rules and full input hashes without duplicating rows', () => {
    const evidence = makeCalculationEvidence(input(), snapshot(), evidenceSources());
    expect(evidence).toMatchObject({
      contract: 'dash-calculation-evidence-v1',
      capturedAt: AT,
      snapshotId: 'snapshot-x',
      codeCommit: CODE,
      targetYear: 2026,
      officialYear: 2026,
      rulesCount: 1,
      scope: 'all-masters-observed',
      blockers: [],
      fullReplayVerified: false,
    });
    expect(evidence.books.УО).toMatchObject({
      fileId: 'book-uo', loadedAt: AT, origin: 'master',
      lastObservedDriveVersion: '123',
    });
    expect(evidence.books.УО.archivedRowsSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(evidence.inputSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(evidence)).not.toContain('"1","a"');
  });

  it('responds to changes in values, rule parameters, rule functions, and the calculation period', () => {
    const base = makeCalculationEvidence(input(), snapshot(), evidenceSources());
    const changedInput = input();
    changedInput.sheetRows.УО[1][1] = 'modified';
    expect(makeCalculationEvidence(changedInput, snapshot(), evidenceSources()).inputSha256)
      .not.toBe(base.inputSha256);

    const changedRule = input();
    changedRule.rules[0].params.cutoff = 11;
    expect(makeCalculationEvidence(changedRule, snapshot(), evidenceSources()).rulesSha256)
      .not.toBe(base.rulesSha256);

    const changedFunction = input();
    changedFunction.rules[0].check = () => ({ valid: false });
    expect(makeCalculationEvidence(changedFunction, snapshot(), evidenceSources()).rulesSha256)
      .not.toBe(base.rulesSha256);

    const changedPeriod = input();
    changedPeriod.targetYear = 2027;
    expect(makeCalculationEvidence(changedPeriod, snapshot(), evidenceSources()).inputSha256)
      .not.toBe(base.inputSha256);
  });
});

describe('calculation evidence: fail-closed archive checks', () => {
  it('checks saved atoms and the calculated output without network access', () => {
    const snap = snapshot();
    snap.calculationEvidence = makeCalculationEvidence(input(), snap, evidenceSources());
    expect(inspectArchivedCalculationEvidence(snap)).toEqual({ status: 'matching', mismatches: [] });
    snap.rowsByDept!.УО[0][1] = 'corrupted';
    expect(inspectArchivedCalculationEvidence(snap))
      .toMatchObject({ status: 'invalid', mismatches: ['archived_rows:УО'] });
  });

  it('rejects a passport with a silently omitted archived department', () => {
    const snap = snapshot();
    snap.calculationEvidence = makeCalculationEvidence(input(), snap, evidenceSources());
    delete snap.calculationEvidence.books.УЭР;
    const checked = inspectArchivedCalculationEvidence(snap);
    expect(checked.status).toBe('invalid');
    expect(checked.mismatches).toContain('archived_book_unlisted:УЭР');
  });

  it('does not treat an attested full scope with missing source version as matching', () => {
    const snap = snapshot();
    snap.calculationEvidence = makeCalculationEvidence(input(), snap, evidenceSources());
    snap.calculationEvidence.books.УЭР.lastObservedDriveVersion = null;
    const checked = inspectArchivedCalculationEvidence(snap);
    expect(checked.status).toBe('invalid');
    expect(checked.mismatches).toContain('scope_inconsistent');
  });

  it('detects mutated outputs while never treating legacy snapshots as verified', () => {
    const legacy = snapshot();
    expect(inspectArchivedCalculationEvidence(legacy).status).toBe('unverified');
    legacy.calculationEvidence = makeCalculationEvidence(input(), legacy, evidenceSources());
    legacy.calculatedMetrics = { changed: { value: 5 } } as unknown as DataSnapshot['calculatedMetrics'];
    expect(inspectArchivedCalculationEvidence(legacy).mismatches).toContain('output_hash');
  });

  it('keeps missing, mirrored, stale and unversioned sources explicitly partial', () => {
    const noCode = makeCalculationEvidence(input(), snapshot(), evidenceSources({ codeCommit: null }));
    expect(noCode.scope).toBe('partial');
    expect(noCode.blockers).toContain('code_commit_unknown');

    const missing = makeCalculationEvidence(input(), snapshot(), evidenceSources({
      masterNames: ['УО'], readMeta: { УО: { loadedAt: AT, rowCount: 2, sheetName: 'ВСЕ' } },
    }));
    expect(missing.blockers).toContain('master_unconfirmed:УЭР');
    expect(missing.blockers).toContain('source_read_time_unknown:УЭР');

    const stale = makeCalculationEvidence(input(), snapshot(), evidenceSources({
      readMeta: { УО: { loadedAt: '2026-09-01T00:00:00Z', rowCount: 2, sheetName: 'ВСЕ' },
        УЭР: { loadedAt: AT, rowCount: 2, sheetName: 'ВСЕ' } },
    }));
    expect(stale.blockers).toContain('source_read_stale_or_future:УО');

    const unversioned = makeCalculationEvidence(input(), snapshot(), evidenceSources({
      observedDriveVersions: { УО: '123', УЭР: null },
    }));
    expect(unversioned.scope).toBe('partial');
    expect(unversioned.blockers).toContain('source_revision_unobserved:УЭР');

    const rowMismatch = makeCalculationEvidence(input(), snapshot(), evidenceSources({
      readMeta: { УО: { loadedAt: AT, rowCount: 99, sheetName: 'ВСЕ' },
        УЭР: { loadedAt: AT, rowCount: 2, sheetName: 'ВСЕ' } },
    }));
    expect(rowMismatch.scope).toBe('partial');
    expect(rowMismatch.blockers).toContain('source_row_count_mismatch:УО');
  });
});
