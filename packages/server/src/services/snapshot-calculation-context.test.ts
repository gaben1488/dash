import { describe, expect, it } from 'vitest';
import type { CalculationContext, DataSnapshot } from '@aemr/shared';
import {
  calculationDigest, inspectArchivedCalculationContext, sealSnapshotCalculationContext,
} from './snapshot-calculation-context.js';

const AT = '2026-10-22T08:00:00.000Z';
function snapshot(): DataSnapshot {
  const identity: Omit<CalculationContext, 'id' | 'archiveSeal'> = {
    contract: 'aemr-calculation-context-v1',
    sources: { content: 'source-exact-read', profiles: 'profile-pinned' },
    semantics: 'rules-from-installed-source', thresholds: {},
    calendar: { asOf: AT, productDay: 20748, utcOffsetHours: 12, weeklyCutoffHour: 18 },
    scope: { targetYear: 2026, officialYear: 2026 },
    decisions: 'not-applied', access: 'full-dataset',
  };
  return {
    id: 'snap-1', spreadsheetId: 'master-svod', createdAt: AT,
    officialMetrics: {}, calculatedMetrics: {}, deltas: [], issues: [],
    rowCount: 1,
    trust: { overall: 80, grade: 'B', components: [], computedAt: AT,
      basedOnSnapshot: 'snap-1' } as DataSnapshot['trust'],
    rowsByDept: { УО: [['first']] },
    metadata: { sheetsRead: [], cellsRead: 1, readDurationMs: 1, pipelineDurationMs: 1,
      calculationContext: { ...identity, id: calculationDigest(identity) },
      sourceReceipt: null },
  };
}

describe('one existing CalculationContext owns archive proof', () => {
  it('seals exactly stored results/atoms/context with explicit partial coverage', () => {
    const s = snapshot();
    expect(sealSnapshotCalculationContext(s)).toBe(true);
    expect(s.metadata.calculationContext!.archiveSeal).toMatchObject({
      contract: 'aemr-calculation-archive-seal-v1', scope: 'partial',
      blockers: ['source_receipt_unverified', 'source_revision_unverified',
        'source_coverage_incomplete'], fullReplayVerified: false,
    });
    expect(inspectArchivedCalculationContext(s).status).toBe('matching');
    const roundtrip = JSON.parse(JSON.stringify(s)) as DataSnapshot;
    expect(inspectArchivedCalculationContext(roundtrip).status).toBe('matching');
  });

  it('does not let corrupt outputs, source binding, rules or weekly data masquerade as verified', () => {
    const s = snapshot(); sealSnapshotCalculationContext(s);
    const mutations: Array<[string, (value: DataSnapshot) => void]> = [
      ['archive_outputs', x => { x.rowCount++; }],
      ['archive_rows', x => { x.rowsByDept!.УО[0][0] = 'other'; }],
      ['source_receipt', x => { x.metadata.sourceReceipt = 'fabricated'; }],
      ['source_revision', x => { x.metadata.sourceRevision = 'SRC-unproven'; }],
      ['source_coverage', x => { x.metadata.sourceCoverage = { complete: true } as DataSnapshot['metadata']['sourceCoverage']; }],
      ['context_id', x => { x.metadata.calculationContext!.semantics = 'changed'; }],
      ['weekly_context', x => { x.weeklyTableContext = {
        contract: 'dash-weekly-table-context-v1', sealedAt: AT,
        masters: {}, monitoring: { readAt: AT, version: 1, sheets: {} },
      }; }],
    ];
    for (const [expected, mutate] of mutations) {
      const changed = JSON.parse(JSON.stringify(s)) as DataSnapshot;
      mutate(changed);
      expect(inspectArchivedCalculationContext(changed).mismatches, expected).toContain(expected);
      expect(() => sealSnapshotCalculationContext(changed)).toThrow();
    }
  });

  it('does not silently certify old snapshots lacking a context', () => {
    const s = snapshot(); delete s.metadata.calculationContext;
    expect(sealSnapshotCalculationContext(s)).toBe(false);
    expect(inspectArchivedCalculationContext(s).status).toBe('unverified');
  });

  it('forbids claiming full replay merely from hashes', () => {
    const s = snapshot(); sealSnapshotCalculationContext(s);
    s.metadata.calculationContext!.archiveSeal!.fullReplayVerified = true as false;
    expect(inspectArchivedCalculationContext(s).mismatches).toContain('unsupported_replay_claim');
  });
});
