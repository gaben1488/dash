import { describe, expect, it } from 'vitest';
import type { DataSnapshot } from '@aemr/shared';
import type { PipelineInput } from '@aemr/core';
import {
  snapshotCalculationContext, sealSnapshotCalculationResult,
  inspectSnapshotCalculationResult,
} from './snapshot-calculation-context.js';

const when = '2026-10-22T09:00:00.000Z';

function fixture(): DataSnapshot {
  const input = {
    spreadsheetId: 'primary-svod',
    batchGetData: [{ range: 'СВОД ТД-ПМ!A1', values: [[42]] }],
    sheetRows: { УО: [['header'], ['test', 12]] },
    reportMap: [],
    rules: [],
    targetYear: 2026,
  } as unknown as PipelineInput;
  const original = {
    id: 'sealed-x',
    spreadsheetId: input.spreadsheetId,
    createdAt: when,
    officialMetrics: {},
    calculatedMetrics: { amount: { numericValue: 42 } },
    deltas: [],
    issues: [],
    trust: { overall: 99 },
    rowCount: 1,
    rowsByDept: { УО: [['test', 12]] },
    metadata: {
      sheetsRead: ['СВОД ТД-ПМ', 'УО'],
      cellsRead: 1, readDurationMs: 0, pipelineDurationMs: 0,
      targetYear: 2026,
      sourceReceipt: 'accepted-receipt',
      calculationContext: snapshotCalculationContext(input, new Date(when)),
    },
  };
  return original as unknown as DataSnapshot;
}

describe('C08.02: one attested CalculationContext, no additional passport store', () => {
  it('roundtrips the same persisted output and does not claim a full replay', () => {
    const snap = fixture();
    const originalId = snap.metadata.calculationContext!.id;
    sealSnapshotCalculationResult(snap, 'A'.repeat(40));
    expect(snap.metadata.calculationContext?.id).toBe(originalId);
    expect(snap.metadata.calculationContext?.output).toMatchObject({
      contract: 'aemr-calculation-output-v1',
      sourceReceipt: 'accepted-receipt',
      sourceRevision: null,
      sourceCoverageComplete: false,
      codeCommit: 'a'.repeat(40),
      fullReplayVerified: false,
    });
    expect(inspectSnapshotCalculationResult(snap).status).toBe('matching');
    const restored = JSON.parse(JSON.stringify(snap)) as DataSnapshot;
    expect(inspectSnapshotCalculationResult(restored).status).toBe('matching');
    restored.rowsByDept!.УО[0][1] = 999;
    expect(inspectSnapshotCalculationResult(restored).mismatches).toContain('archived_department_rows');
    expect(inspectSnapshotCalculationResult({ ...restored, calculatedMetrics: {
      ...restored.calculatedMetrics, amount: { numericValue: 99 } as never,
    } }).mismatches).toContain('output_hash');
  });

  it('does not mistake another source receipt, coverage, or tampered rule context for matching evidence', () => {
    const s = fixture();
    sealSnapshotCalculationResult(s);
    s.metadata.sourceReceipt = 'another-source';
    expect(inspectSnapshotCalculationResult(s).mismatches).toContain('source_receipt');
    s.metadata.sourceReceipt = 'accepted-receipt';
    s.metadata.calculationContext!.semantics = 'altered';
    expect(inspectSnapshotCalculationResult(s).mismatches).toContain('input_context');
  });

  it('leaves historical unsealed snapshots as unverified without rewriting them', () => {
    const old = fixture();
    const before = JSON.stringify(old);
    expect(inspectSnapshotCalculationResult(old)).toEqual({
      status: 'unverified', mismatches: ['legacy_output_not_attested'],
    });
    expect(JSON.stringify(old)).toBe(before);
  });

  it('fails closed when the input context was already altered before sealing', () => {
    const s = fixture();
    s.metadata.calculationContext!.sources.content = 'unrelated';
    expect(() => sealSnapshotCalculationResult(s)).toThrow('CALCULATION_INPUT_CONTEXT_INVALID');
  });
});
