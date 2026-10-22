/**
 * C08.02: versioned calculation passport. This is a small attestation carried
 * inside the EXISTING snapshots.data JSON; it is not another history database.
 *
 * One calculation may combine Google sources read at different instants.
 * Hashing is deterministic, but does NOT turn those reads into a transaction.
 * The passport names that limitation instead of claiming replay is verified.
 */
import { createHash } from 'node:crypto';
import type { DataSnapshot, CalculationEvidence } from '@aemr/shared';
import type { PipelineInput } from '@aemr/core';

export interface CalculationSourceReadMeta {
  loadedAt: string;
  rowCount: number;
  sheetName: string;
  error?: string;
}

export interface CalculationEvidenceSources {
  sourceIds: Readonly<Record<string, string>>;
  /** Names of books actually read as primaries, not mirrors. */
  masterNames: readonly string[];
  readMeta: Readonly<Record<string, CalculationSourceReadMeta>>;
  /** A previously observed version can aid investigation, but is NOT an atomic revision proof. */
  observedDriveVersions?: Readonly<Record<string, string | null>>;
  codeCommit?: string | null;
}

const MAX_READ_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Canonical, type-aware JSON serialization; object key insertion order must
 * not change a data or rule fingerprint. Array order remains meaningful.
 */
function canonical(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : { $number: String(value) };
  }
  if (typeof value === 'bigint') return { $bigint: String(value) };
  if (typeof value === 'undefined') return { $undefined: true };
  if (typeof value === 'function') return { $function: String(value) };
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return { $invalidDate: true };
    return { $date: value.toISOString() };
  }
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(obj).sort().map(key => [key, canonical(obj[key])]),
    );
  }
  return { $unsupported: typeof value };
}

export function calculationSha256(value: unknown): string {
  // The existing snapshot is stored through JSON.stringify. Normalize through
  // that exact representation first: undefined properties disappear, Date
  // becomes ISO, and non-finite numbers become null. Otherwise a snapshot
  // could fail its own readback hash immediately after a successful save.
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('CALCULATION_HASH_INPUT_NOT_SERIALIZABLE');
  const normalized = JSON.parse(serialized) as unknown;
  const json = JSON.stringify(canonical(normalized));
  return createHash('sha256').update(json).digest('hex');
}

/** A rule's check function is included, but its imported dependencies require a code commit. */
function ruleVersionInput(rule: PipelineInput['rules'][number]): unknown {
  return {
    id: rule.id, name: rule.name, description: rule.description,
    severity: rule.severity, origin: rule.origin, scope: rule.scope,
    params: rule.params, checkSource: String(rule.check),
  };
}

/**
 * What is hashed at capture: EXACT already loaded pipeline inputs and output,
 * never a fresh Google call (which could read a different revision).
 */
export function calculatedResultInput(snapshot: DataSnapshot): unknown {
  return {
    officialMetrics: snapshot.officialMetrics,
    calculatedMetrics: snapshot.calculatedMetrics,
    deltas: snapshot.deltas,
    trust: snapshot.trust,
    rowCount: snapshot.rowCount,
    unifiedGrid: snapshot.unifiedGrid,
    unifiedReconciliation: snapshot.unifiedReconciliation,
  };
}

export function makeCalculationEvidence(
  input: PipelineInput,
  snapshot: DataSnapshot,
  sources: CalculationEvidenceSources,
): CalculationEvidence {
  const blockers: string[] = [];
  const masterNames = new Set(sources.masterNames);
  const capturedMs = Date.parse(snapshot.createdAt);
  if (!Number.isFinite(capturedMs)) blockers.push('snapshot_time_invalid');
  const codeCommit = /^[a-f0-9]{40}$/i.test(sources.codeCommit ?? '')
    ? sources.codeCommit!.toLowerCase() : null;
  if (!codeCommit) blockers.push('code_commit_unknown');

  if (input.batchGetData.length === 0) blockers.push('official_cells_missing');
  if (input.reportMap.length === 0) blockers.push('report_map_missing');
  if (input.rules.length === 0) blockers.push('rules_missing');
  const rulesVersion = input.rules.map(ruleVersionInput);

  const books: CalculationEvidence['books'] = {};
  for (const dept of Object.keys(sources.sourceIds).sort()) {
    const fileId = sources.sourceIds[dept];
    const raw = input.sheetRows[dept];
    const archived = snapshot.rowsByDept?.[dept];
    const metadata = sources.readMeta[dept];
    const fromMaster = masterNames.has(dept) && raw !== undefined && raw.length > 0;
    const readAt = metadata?.loadedAt ?? null;

    books[dept] = {
      fileId,
      inputSha256: raw === undefined ? null : calculationSha256(raw),
      archivedRowsSha256: archived === undefined ? null : calculationSha256(archived),
      loadedAt: readAt,
      origin: fromMaster ? 'master' : 'mirror-or-unconfirmed',
      lastObservedDriveVersion: sources.observedDriveVersions?.[dept] ?? null,
    };

    if (!fromMaster) blockers.push('master_unconfirmed:' + dept);
    if (!archived) blockers.push('archive_rows_missing:' + dept);
    if (metadata?.error) blockers.push('source_read_error:' + dept);
    const loadedMs = Date.parse(readAt ?? '');
    if (!Number.isFinite(loadedMs)) blockers.push('source_read_time_unknown:' + dept);
    else if (!Number.isFinite(capturedMs) || loadedMs > capturedMs + 60_000 ||
             capturedMs - loadedMs > MAX_READ_AGE_MS) {
      blockers.push('source_read_stale_or_future:' + dept);
    }
  }

  return {
    contract: 'dash-calculation-evidence-v1',
    snapshotId: snapshot.id,
    capturedAt: snapshot.createdAt,
    targetYear: input.targetYear ?? null,
    officialYear: input.officialYear ?? null,
    spreadsheetId: input.spreadsheetId,
    inputSha256: calculationSha256({
      batchGetData: input.batchGetData,
      sheetRows: input.sheetRows,
      sheetFormulas: input.sheetFormulas ?? null,
      spreadsheetId: input.spreadsheetId,
      targetYear: input.targetYear ?? null,
      officialYear: input.officialYear ?? null,
      reportMap: input.reportMap,
      rules: rulesVersion,
    }),
    rulesSha256: calculationSha256(rulesVersion),
    rulesCount: input.rules.length,
    reportMapSha256: calculationSha256(input.reportMap),
    outputSha256: calculationSha256(calculatedResultInput(snapshot)),
    books,
    codeCommit,
    scope: blockers.length === 0 ? 'all-masters-observed' : 'partial',
    blockers,
    fullReplayVerified: false,
  };
}

export interface EvidenceArchiveCheck {
  status: 'matching' | 'invalid' | 'unverified';
  mismatches: string[];
}

/**
 * Check only bytes that are ALREADY in the archive; do not re-read live Google.
 * A matching hash is not proof of full deterministic replay of the original
 * pipeline or external reports.
 */
export function inspectArchivedCalculationEvidence(snapshot: DataSnapshot): EvidenceArchiveCheck {
  const evidence = snapshot.calculationEvidence;
  if (!evidence) return { status: 'unverified', mismatches: ['legacy_snapshot_no_evidence'] };
  const mismatches: string[] = [];
  if (evidence.contract !== 'dash-calculation-evidence-v1') mismatches.push('contract');
  if (evidence.snapshotId !== snapshot.id) mismatches.push('snapshot_id');
  if (evidence.capturedAt !== snapshot.createdAt) mismatches.push('captured_at');
  if (evidence.spreadsheetId !== snapshot.spreadsheetId) mismatches.push('spreadsheet_id');
  if (evidence.outputSha256 !== calculationSha256(calculatedResultInput(snapshot))) {
    mismatches.push('output_hash');
  }
  for (const [dept, item] of Object.entries(evidence.books)) {
    const archived = snapshot.rowsByDept?.[dept];
    if (item.archivedRowsSha256 !==
        (archived === undefined ? null : calculationSha256(archived))) {
      mismatches.push('archived_rows:' + dept);
    }
  }
  return mismatches.length > 0
    ? { status: 'invalid', mismatches }
    : { status: 'matching', mismatches: [] };
}
