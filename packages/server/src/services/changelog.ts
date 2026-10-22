/**
 * Project canonical source _ChangeLog cells into read-only change records.
 *
 * Owner of format/schema: journal-source-format.ts.
 * Owner of timestamp grammar: @aemr/core parseJournalInstant.
 * Owner of journal reads, revisions and in-flight dedup: changelog-source.ts.
 * This module owns only presentation attributes, event identity and coverage.
 */
import { createHash } from 'node:crypto';
import { parseJournalInstant } from '@aemr/core';
import { COL_LETTER_INDEX, DEPT_COLUMNS, DEPT_HEADER_LABELS } from '@aemr/shared';
import { decodeSourceJournal, sourceTimestampPrecision } from './journal-source-format.js';

export interface ChangeRecord {
  dept: string;
  sheet: string;
  cell: string;
  attribute: string;
  oldValue: string;
  newValue: string;
  /**
   * Source-local calendar/clock encoded as UTC components, for backwards
   * compatibility with the existing SQLite at_ms and web UTC formatter.
   * NOT an absolute UTC instant; source books use Asia/Kamchatka.
   */
  atMs: number;
  author: string;
  /** No clock time exists in a date-only source row. */
  timePrecision?: 'day' | 'unknown';
  /** 0-based count among identical source events, stable under unrelated reordering. */
  sourceOccurrence?: number;
}

export interface ChangeLogCoverage {
  rawRows: number;
  parsed: number;
  dayOnly: number;
  unparsed: number;
  nonCell: number;
  invalidTime: number;
  /** Entries with the SAME content and timestamp cannot be uniquely identified. */
  indistinguishableDuplicates: number;
}
export interface ParsedChangeLog {
  records: ChangeRecord[];
  coverage: ChangeLogCoverage;
}

function attributeOf(cell: string): string {
  const letter = cell.match(/^([A-Z]{1,2})\d+$/i)?.[1]?.toUpperCase();
  if (!letter) return '';
  const idx = COL_LETTER_INDEX[letter];
  if (idx === undefined) return '';
  const key = (Object.keys(DEPT_COLUMNS) as Array<keyof typeof DEPT_COLUMNS>)
    .find(k => DEPT_COLUMNS[k] === idx);
  return key ? DEPT_HEADER_LABELS[key] : '';
}

function sha(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function eventSignature(r: ChangeRecord): string {
  return JSON.stringify([r.dept, r.sheet, r.cell, r.atMs, r.author, r.oldValue, r.newValue]);
}

/**
 * Exact-time IDs keep the already-deployed value-aware form.
 * Day-only IDs avoid fake midnight precision and mutable journal-row indexes.
 * Identical events are not distinguishable without a real source event ID:
 * occurrence ordinals preserve multiplicity, not the identity of each copy.
 */
export function changeEntryIdentity(r: ChangeRecord): string {
  const legacyValueId = [
    r.dept, r.sheet, r.cell, r.atMs, r.author,
    'values:' + sha(JSON.stringify([r.oldValue, r.newValue])),
  ].join('|');
  const occurrence = r.sourceOccurrence ?? 0;
  if (!Number.isSafeInteger(occurrence) || occurrence < 0) {
    throw new Error('Journal event needs a non-negative source occurrence');
  }
  if (r.timePrecision === 'day') {
    return 'journal-day-v2:' + sha(eventSignature(r)) + ':' + occurrence;
  }
  return occurrence === 0 ? legacyValueId : legacyValueId + '|occurrence:' + occurrence;
}

export function parseChangeLogDetailed(rows: unknown[][], dept: string): ParsedChangeLog {
  const source = decodeSourceJournal(rows);
  const coverage: ChangeLogCoverage = {
    rawRows: source.rawRows, parsed: 0, dayOnly: 0, nonCell: source.nonCell,
    unparsed: source.nonCell, invalidTime: 0, indistinguishableDuplicates: 0,
  };
  const records: ChangeRecord[] = [];
  const occurrences = new Map<string, number>();

  for (const cell of source.cells) {
    const stamp = parseJournalInstant(cell.at);
    if (!stamp) {
      coverage.invalidTime++;
      coverage.unparsed++;
      continue;
    }
    const atMs = Date.parse(stamp.at + 'Z');
    if (!Number.isFinite(atMs)) {
      coverage.invalidTime++;
      coverage.unparsed++;
      continue;
    }
    const sheet = cell.sheet || 'ВСЕ';
    const record: ChangeRecord = {
      dept, sheet, cell: cell.cell, attribute: attributeOf(cell.cell),
      oldValue: String(cell.was ?? '').trim(), newValue: String(cell.became ?? '').trim(),
      author: String(cell.author ?? '').trim(), atMs,
    };
    if (sourceTimestampPrecision(cell.at) === 'day') {
      record.timePrecision = 'day';
      coverage.dayOnly++;
    }
    const signature = eventSignature(record);
    const occurrence = occurrences.get(signature) ?? 0;
    occurrences.set(signature, occurrence + 1);
    record.sourceOccurrence = occurrence;
    if (occurrence > 0) coverage.indistinguishableDuplicates++;
    records.push(record);
    coverage.parsed++;
  }
  return { records, coverage };
}

export function parseChangeLog(rows: unknown[][], dept: string): ChangeRecord[] {
  return parseChangeLogDetailed(rows, dept).records;
}

/**
 * Day-only edits belong to the selected local date but may be before OR after
 * a same-day clock cutoff. Include as uncertain rather than silently drop.
 */
export function changesSince(records: ChangeRecord[], sinceSourceLocalMs: number): ChangeRecord[] {
  const DAY = 86400000;
  return records
    .filter(r => r.atMs >= sinceSourceLocalMs ||
      ((r.timePrecision === 'day' || r.timePrecision === 'unknown') && r.atMs + DAY > sinceSourceLocalMs))
    .sort((a, b) => b.atMs - a.atMs);
}
