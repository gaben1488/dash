/**
 * Published cell-history projection of the ONE normalized source journal.
 *
 * This module owns business-facing labels and stable read-model IDs, NOT
 * source schema detection, timestamp parsing, provider I/O or another cache.
 * The same normalized observations feed plan provenance and change-story.
 */
import { createHash } from 'node:crypto';
import { COL_LETTER_INDEX, DEPT_COLUMNS, DEPT_HEADER_LABELS } from '@aemr/shared';
import { normalizeSourceJournal, type SourceJournal, type SourceJournalCoverage } from './source-journal.js';
import type { JournalTimePrecision } from '@aemr/core';

export interface ChangeRecord {
  dept: string;
  sheet: string;
  cell: string;
  attribute: string;
  oldValue: string;
  newValue: string;
  /** LEGACY numerical wall-clock sorting key, not a UTC event instant. */
  atMs: number;
  author: string;
  /** Precision comes from the actual source. Date-only is not 00:00. */
  timePrecision?: JournalTimePrecision | 'unknown';
  sourceTimeRaw?: string;
  /** Diagnostic position; never used for stable identity. */
  journalRow?: number;
  /** Stable content+occurrence key only where source time lacks seconds. */
  eventId?: string;
}

export type ChangeLogCoverage = SourceJournalCoverage;

function attributeOf(cell: string): string {
  const letter = cell.match(/^([A-Z]{1,2})\d+$/i)?.[1]?.toUpperCase();
  if (!letter) return '';
  const idx = COL_LETTER_INDEX[letter];
  if (idx === undefined) return '';
  const key = (Object.keys(DEPT_COLUMNS) as Array<keyof typeof DEPT_COLUMNS>)
    .find((k) => DEPT_COLUMNS[k] === idx);
  return key ? DEPT_HEADER_LABELS[key] : '';
}

function text(v: unknown): string {
  return String(v ?? '').trim();
}

/** A deterministic signature; position in _ChangeLog does not enter this key. */
function contentSignature(r: ChangeRecord): string {
  return createHash('sha256').update(JSON.stringify([
    r.dept, r.sheet, r.cell, r.atMs, r.author, r.oldValue, r.newValue,
    r.sourceTimeRaw, r.timePrecision,
  ])).digest('hex');
}

export function changeRecordsFromJournal(
  journal: SourceJournal,
  dept: string,
): { records: ChangeRecord[]; coverage: ChangeLogCoverage } {
  const records: ChangeRecord[] = [];
  const duplicates = new Map<string, number>();
  for (const item of journal.cells) {
    // Do not fabricate an ordering or an author for unreadable timestamps.
    // The coverage diagnostics still report these rows.
    if (!item.instant) continue;

    // Preserve the current API/SQLite wall-clock key and visual formatting.
    // UTC-conversion requires a separate migration with old data re-keying.
    const atMs = Date.parse(item.instant.at + 'Z');
    if (!Number.isFinite(atMs)) continue;
    const record: ChangeRecord = {
      dept, sheet: item.sheet || 'ВСЕ', cell: item.cell,
      attribute: attributeOf(item.cell),
      oldValue: text(item.was), newValue: text(item.became),
      atMs, author: text(item.author),
      timePrecision: item.instant.precision,
      sourceTimeRaw: text(item.at),
      journalRow: item.journalRow,
    };

    if (item.instant.precision !== 'second') {
      const hash = contentSignature(record);
      const ordinal = duplicates.get(hash) ?? 0;
      duplicates.set(hash, ordinal + 1);
      // Identical undated/undertime-stamped rows have no provider event ID.
      // Occurrence counting preserves multiplicity and survives unrelated
      // inserts/reorderings, but cannot prove identity of identical events.
      record.eventId = 'journal-clock-v3:' + hash + ':' + String(ordinal);
    }
    records.push(record);
  }
  return { records, coverage: journal.coverage };
}

/** Compatibility pure read; live readers use the already-normalized snapshot. */
export function parseChangeLogDetailed(rows: readonly (readonly unknown[])[], dept: string): {
  records: ChangeRecord[];
  coverage: ChangeLogCoverage;
} {
  return changeRecordsFromJournal(normalizeSourceJournal(rows), dept);
}

export function parseChangeLog(rows: unknown[][], dept: string): ChangeRecord[] {
  return parseChangeLogDetailed(rows, dept).records;
}

/** Legacy public helper: numeric wall-clock threshold, newest first. */
export function changesSince(records: ChangeRecord[], sinceMs: number): ChangeRecord[] {
  return records.filter(r => r.atMs >= sinceMs).sort((a, b) => b.atMs - a.atMs);
}

/**
 * A precise local cut-off and an un-timed edit from the same day overlap
 * ambiguously. Include the un-timed edit only with its 'day' precision label,
 * never falsely claim it happened after the cut-off.
 */
export function changesSinceLocalClock(
  records: readonly ChangeRecord[], dayStartMs: number, localCutoffMs: number,
): ChangeRecord[] {
  return records
    .filter(r => r.atMs >= localCutoffMs ||
      (r.timePrecision === 'day' && r.atMs >= dayStartMs))
    .sort((a, b) => b.atMs - a.atMs);
}
