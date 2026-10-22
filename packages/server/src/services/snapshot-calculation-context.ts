import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { productCalendarDay, PRODUCT_UTC_OFFSET_HOURS, WEEKLY_CUTOFF_HOUR,
  freezeThresholds, isoOfDayNumber, DEPARTMENT_REGISTRY, getActiveRules, REPORT_MAP, type DataSnapshot, type CalculationContext, type CalculationArchiveSeal } from '@aemr/shared';
import type { PipelineInput } from '@aemr/core';

/** Canonical object keys; array order, formula text and scalar types remain evidence. */
export function calculationDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value, (_key, item) => {
    if (typeof item === 'function' || item instanceof RegExp) return String(item);
    return item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item;
  })).digest('hex');
}

let semantics: string | undefined;
function semanticRevision(): string {
  if (semantics) return semantics;
  const hash = createHash('sha256');
  function visit(directory: URL, prefix: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (entry.isDirectory()) visit(new URL(entry.name + '/', directory), prefix + entry.name + '/');
      else if (entry.isFile() && /\.(ts|json)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) {
        hash.update(prefix + entry.name + '\0').update(readFileSync(new URL(entry.name, directory)));
      }
    }
  }
  visit(new URL('../../../shared/src/', import.meta.url), 'shared/');
  visit(new URL('../../../core/src/', import.meta.url), 'core/');
  visit(new URL('./', import.meta.url), 'server/services/');
  hash.update(readFileSync(new URL('../../../report-engine/src/procurement_engine/department_directory.json', import.meta.url)));
  semantics = hash.digest('hex');
  return semantics;
}

export function snapshotCalculationContext(input: PipelineInput, asOf: Date): CalculationContext {
  const context: Omit<CalculationContext, 'id'> = {
    contract: 'aemr-calculation-context-v1',
    thresholds: freezeThresholds(isoOfDayNumber(productCalendarDay(asOf, PRODUCT_UTC_OFFSET_HOURS))),
    sources: {
      content: calculationDigest({ spreadsheetId: input.spreadsheetId, batch: input.batchGetData,
        rows: input.sheetRows, formulas: input.sheetFormulas ?? null, bindings: input.sourceBindings ?? null }),
      profiles: calculationDigest({ departments: DEPARTMENT_REGISTRY, reportMap: input.reportMap }),
    },
    semantics: calculationSemantics(input.rules),
    calendar: { asOf: asOf.toISOString(), productDay: productCalendarDay(asOf, PRODUCT_UTC_OFFSET_HOURS),
      utcOffsetHours: PRODUCT_UTC_OFFSET_HOURS, weeklyCutoffHour: WEEKLY_CUTOFF_HOUR },
    scope: { targetYear: input.targetYear ?? null, officialYear: input.officialYear ?? null },
    decisions: 'not-applied', access: 'full-dataset',
  };
  return { ...context, id: calculationDigest(context) };
}


function calculationSemantics(rules: PipelineInput['rules']): string {
  return calculationDigest({ implementation: semanticRevision(),
    rules: rules.map(({ check: _check, ...definition }) => definition) });
}

/** Reuse only a captured context under exactly the installed source/rule profiles. */
export function currentCalculationContextMatches(snapshot: DataSnapshot): boolean {
  const context = snapshot.metadata.calculationContext;
  return !!context && context.semantics === calculationSemantics(getActiveRules())
    && context.sources.profiles === calculationDigest({ departments: DEPARTMENT_REGISTRY, reportMap: REPORT_MAP })
    && calculationDigest(context.thresholds) === calculationDigest(freezeThresholds(isoOfDayNumber(context.calendar.productDay)));
}


/**
 * The original CalculationContext is the only owner of input/rules identity.
 * This seal binds archived outputs to THAT context, in the SAME snapshots.data.
 * No new store, second Google fetch, source digest or background worker.
 *
 * The semantic hash is a consistency proof for the stored content, NOT a
 * cryptographic external signature or a successful frozen pipeline replay.
 */
function archivedOutputs(snapshot: DataSnapshot): unknown {
  return {
    officialMetrics: snapshot.officialMetrics,
    calculatedMetrics: snapshot.calculatedMetrics,
    deltas: snapshot.deltas,
    issues: snapshot.issues,
    trust: snapshot.trust,
    rowCount: snapshot.rowCount,
    recalcResults: snapshot.recalcResults ?? null,
    shdyuData: snapshot.shdyuData ?? null,
    unifiedGrid: snapshot.unifiedGrid ?? null,
    unifiedReconciliation: snapshot.unifiedReconciliation ?? null,
    perSheetRowCount: snapshot.metadata.perSheetRowCount ?? null,
  };
}

function archivedRows(snapshot: DataSnapshot): unknown | null {
  if (!snapshot.rowsByDept && !snapshot.svodGrid) return null;
  return { rowsByDept: snapshot.rowsByDept ?? null, svodGrid: snapshot.svodGrid ?? null };
}

/** The ID was computed on the original fields, before a persistence seal exists. */
function calculationContextBody(context: CalculationContext): Omit<CalculationContext, 'id' | 'archiveSeal'> {
  const { id: _id, archiveSeal: _archiveSeal, ...body } = context;
  return body;
}

function createArchiveSeal(snapshot: DataSnapshot, context: CalculationContext): CalculationArchiveSeal {
  const coverage = snapshot.metadata.sourceCoverage;
  const receipt = snapshot.metadata.sourceReceipt ?? null;
  const revision = snapshot.metadata.sourceRevision ?? null;
  const rows = archivedRows(snapshot);
  const blockers: string[] = [];
  if (!receipt) blockers.push('source_receipt_unverified');
  if (!revision) blockers.push('source_revision_unverified');
  if (!coverage?.complete) blockers.push('source_coverage_incomplete');
  if (!rows) blockers.push('archived_source_rows_unavailable');
  if (calculationDigest(calculationContextBody(context)) !== context.id) {
    blockers.push('calculation_context_corrupted');
  }

  return {
    contract: 'aemr-calculation-archive-seal-v1',
    contextId: context.id,
    snapshotId: snapshot.id,
    outputSha256: calculationDigest(archivedOutputs(snapshot)),
    rowsSha256: rows === null ? null : calculationDigest(rows),
    weeklySha256: snapshot.weeklyTableContext === undefined
      ? null : calculationDigest(snapshot.weeklyTableContext),
    sourceReceipt: receipt,
    sourceRevision: revision,
    sourceCoverageSha256: coverage === undefined ? null : calculationDigest(coverage),
    scope: blockers.length === 0 ? 'source-bound' : 'partial',
    blockers,
    // Re-executing a frozen pipeline and checking the Word release is a
    // separate explicit acceptance step. No checksum sets this flag true.
    fullReplayVerified: false,
  };
}

export interface ArchivedCalculationCheck {
  status: 'matching' | 'invalid' | 'unverified';
  mismatches: string[];
}

/**
 * Legacy snapshots remain readable but UNVERIFIED; a malformed present seal
 * fails closed, never silently falling back to "legacy".
 */
export function inspectArchivedCalculationContext(snapshot: DataSnapshot): ArchivedCalculationCheck {
  const context = snapshot.metadata?.calculationContext;
  const seal = context?.archiveSeal;
  if (!seal) return { status: 'unverified', mismatches: ['archive_seal_absent'] };
  const mismatches: string[] = [];
  if (context.contract !== 'aemr-calculation-context-v1') mismatches.push('context_contract');
  if (calculationDigest(calculationContextBody(context)) !== context.id) mismatches.push('context_id');
  if (seal.contract !== 'aemr-calculation-archive-seal-v1') mismatches.push('archive_contract');
  if (seal.contextId !== context.id) mismatches.push('archive_context_id');
  if (seal.snapshotId !== snapshot.id) mismatches.push('archive_snapshot_id');

  const expected = createArchiveSeal(snapshot, context);
  if (seal.outputSha256 !== expected.outputSha256) mismatches.push('archive_outputs');
  if (seal.rowsSha256 !== expected.rowsSha256) mismatches.push('archive_rows');
  if (seal.weeklySha256 !== expected.weeklySha256) mismatches.push('weekly_context');
  if (seal.sourceReceipt !== expected.sourceReceipt) mismatches.push('source_receipt');
  if (seal.sourceRevision !== expected.sourceRevision) mismatches.push('source_revision');
  if (seal.sourceCoverageSha256 !== expected.sourceCoverageSha256) mismatches.push('source_coverage');
  if (seal.scope !== expected.scope || calculationDigest(seal.blockers) !== calculationDigest(expected.blockers)) {
    mismatches.push('source_scope');
  }
  if (seal.fullReplayVerified !== false) mismatches.push('unsupported_replay_claim');
  return mismatches.length > 0
    ? { status: 'invalid', mismatches }
    : { status: 'matching', mismatches: [] };
}

/**
 * Apply on the finalized normal snapshot and again when its weekly child
 * context is attached. Reject a mutated previously sealed snapshot first:
 * re-sealing is not a means to legitimize corruption.
 */
export function sealSnapshotCalculationContext(snapshot: DataSnapshot): boolean {
  const context = snapshot.metadata?.calculationContext;
  if (!context) return false; // historical/demo snapshots are unverified
  if (context.archiveSeal) {
    const before = inspectArchivedCalculationContext(snapshot);
    if (before.status !== 'matching') {
      throw new Error('CALCULATION_ARCHIVE_SEAL_INVALID:' + before.mismatches.join(','));
    }
  }
  if (calculationDigest(calculationContextBody(context)) !== context.id) {
    throw new Error('CALCULATION_CONTEXT_ID_MISMATCH');
  }
  context.archiveSeal = createArchiveSeal(snapshot, context);
  return true;
}
