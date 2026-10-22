import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { productCalendarDay, PRODUCT_UTC_OFFSET_HOURS, WEEKLY_CUTOFF_HOUR,
  freezeThresholds, isoOfDayNumber, DEPARTMENT_REGISTRY, getActiveRules, REPORT_MAP, type DataSnapshot, type CalculationContext } from '@aemr/shared';
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
 * C08.02: seal output bytes in the SAME CalculationContext whose ID names
 * input source/rule/threshold semantics. The hash is not a second receipt DB
 * and cannot prove that separate Google reads formed an atomic transaction.
 */
function snapshotOutputForDigest(snapshot: DataSnapshot): unknown {
  return {
    officialMetrics: snapshot.officialMetrics,
    calculatedMetrics: snapshot.calculatedMetrics,
    deltas: snapshot.deltas,
    issues: snapshot.issues,
    trust: snapshot.trust,
    rowCount: snapshot.rowCount,
    recalcResults: snapshot.recalcResults ?? null,
    unifiedGrid: snapshot.unifiedGrid ?? null,
    unifiedReconciliation: snapshot.unifiedReconciliation ?? null,
    datasetAnalyses: snapshot.datasetAnalyses ?? null,
    shdyuData: snapshot.shdyuData ?? null,
  };
}

function unsealedInputContext(context: CalculationContext): Omit<CalculationContext, 'id' | 'output'> {
  return {
    contract: context.contract,
    sources: context.sources,
    semantics: context.semantics,
    thresholds: context.thresholds,
    calendar: context.calendar,
    scope: context.scope,
    decisions: context.decisions,
    access: context.access,
  };
}

function validCommit(raw: string | null | undefined): string | null {
  return typeof raw === 'string' && /^[a-f0-9]{40}$/i.test(raw)
    ? raw.toLowerCase() : null;
}

export function sealSnapshotCalculationResult(
  snapshot: DataSnapshot,
  codeCommit: string | null = null,
): void {
  const ctx = snapshot.metadata?.calculationContext;
  if (!ctx || ctx.contract !== 'aemr-calculation-context-v1' ||
      ctx.id !== calculationDigest(unsealedInputContext(ctx))) {
    throw new Error('CALCULATION_INPUT_CONTEXT_INVALID');
  }
  ctx.output = {
    contract: 'aemr-calculation-output-v1',
    sha256: calculationDigest(snapshotOutputForDigest(snapshot)),
    sourceReceipt: snapshot.metadata.sourceReceipt ?? null,
    sourceRevision: snapshot.metadata.sourceRevision ?? null,
    sourceCoverageComplete: snapshot.metadata.sourceCoverage?.complete === true,
    codeCommit: validCommit(codeCommit),
    fullReplayVerified: false,
  };
}

export interface CalculationOutputInspection {
  status: 'matching' | 'invalid' | 'unverified';
  mismatches: string[];
}

/**
 * Inspect only saved bytes, with zero Google I/O. Old snapshots remain
 * readable but unverified. A snapshot carrying attestation MUST match it.
 * Never infer replay success from one local checksum verification.
 */
export function inspectSnapshotCalculationResult(snapshot: DataSnapshot): CalculationOutputInspection {
  const context = snapshot.metadata?.calculationContext;
  if (!context || !context.output) {
    return { status: 'unverified', mismatches: ['legacy_output_not_attested'] };
  }
  const evidence = context.output;
  const mismatches: string[] = [];
  if (context.contract !== 'aemr-calculation-context-v1' ||
      context.id !== calculationDigest(unsealedInputContext(context))) mismatches.push('input_context');
  if (evidence.contract !== 'aemr-calculation-output-v1') mismatches.push('output_contract');
  if (typeof evidence.sha256 !== 'string' ||
      evidence.sha256 !== calculationDigest(snapshotOutputForDigest(snapshot))) mismatches.push('output_hash');
  if (evidence.sourceReceipt !== (snapshot.metadata.sourceReceipt ?? null)) mismatches.push('source_receipt');
  if (evidence.sourceRevision !== (snapshot.metadata.sourceRevision ?? null)) mismatches.push('source_revision');
  if (evidence.sourceCoverageComplete !== (snapshot.metadata.sourceCoverage?.complete === true)) mismatches.push('source_coverage');
  if (evidence.fullReplayVerified !== false) mismatches.push('unproven_replay_claim');
  return mismatches.length
    ? { status: 'invalid', mismatches }
    : { status: 'matching', mismatches: [] };
}
