/**
 * Canonical source _ChangeLog adapter. Parse the provider's mixed 8/6-column
 * schemas ONCE at the acquisition boundary. Every consumer (history, plan
 * provenance, workload, author attribution) projects this SAME observation.
 *
 * Spreadsheet row/column coordinates are provenance, not business identity.
 * A missing timestamp, missing row key, or bulk range is an explicit gap.
 * No fabricated cell edits or invented author/time/organization mapping.
 */
import { parseJournalInstant, type ParsedInstant } from '@aemr/core';

export type SourceJournalSchema = 'eight' | 'six';
export interface SourceJournalCell {
  schema: SourceJournalSchema;
  /** Physical row in _ChangeLog; diagnostic only, never event identity. */
  journalRow: number;
  /** Source's own sheet name (legacy six-column entries may not provide it). */
  sheet: string;
  /** A1 address of an individual cell; no ranges enter this collection. */
  cell: string;
  column: unknown;
  /** Source-provided business row label; NEVER substitute the sheet row. */
  rowKey: unknown;
  was: unknown;
  became: unknown;
  at: unknown;
  instant: ParsedInstant | null;
  author: unknown;
}

export interface SourceJournalCoverage {
  /** Number of provider-returned _ChangeLog rows, including headers. */
  rawRows: number;
  headers: number;
  blanks: number;
  /** Valid individual-cell events, including those whose clock is unreadable. */
  cellRows: number;
  exactTime: number;
  minuteTime: number;
  dayOnly: number;
  invalidTime: number;
  sixColumn: number;
  eightColumn: number;
  /** A range/batch/other record which cannot be expanded into cell events. */
  nonCell: number;
  /**
   * Always true: even a fully parsed _ChangeLog cannot prove that an edit or
   * Apps Script/API operation was delivered. Requires snapshot comparison.
   */
  deliveryUnverified: true;
}

export interface SourceJournal {
  cells: SourceJournalCell[];
  coverage: SourceJournalCoverage;
}

function text(raw: unknown): string {
  return String(raw ?? '').trim();
}

function cellAddress(raw: unknown): { sheet: string; cell: string } | null {
  const match = text(raw).match(/^(?:(.+)!)?([A-Z]{1,2}\d+)$/i);
  return match ? { sheet: match[1] ?? '', cell: match[2].toUpperCase() } : null;
}

function headerRow(row: readonly unknown[]): boolean {
  const a = text(row[0]).toLowerCase();
  const b = text(row[1]).toLowerCase();
  return a === 'ячейка' || (a === 'лист' && b === 'ячейка');
}

/** Pure, deterministic; no provider calls, caches, or time-of-read guesses. */
export function normalizeSourceJournal(rows: readonly (readonly unknown[])[]): SourceJournal {
  const cells: SourceJournalCell[] = [];
  const coverage: SourceJournalCoverage = {
    rawRows: rows.length, headers: 0, blanks: 0, cellRows: 0,
    exactTime: 0, minuteTime: 0, dayOnly: 0, invalidTime: 0,
    sixColumn: 0, eightColumn: 0, nonCell: 0, deliveryUnverified: true,
  };
  rows.forEach((raw, index) => {
    if (!Array.isArray(raw) || raw.length === 0 || raw.every(v => text(v) === '')) {
      coverage.blanks++;
      return;
    }
    if (headerRow(raw)) {
      coverage.headers++;
      return;
    }
    const first = cellAddress(raw[0]);
    const second = cellAddress(raw[1]);
    // A six-column legacy source may have an old VALUE that looks like B48.
    // Thus the 8-column detection also needs a present timestamp column.
    const schema: SourceJournalSchema | null =
      second && (raw.length >= 7 || first === null) ? 'eight' :
      first ? 'six' : null;
    if (!schema) {
      coverage.nonCell++;
      return;
    }

    const address = schema === 'eight' ? second! : first!;
    const at = schema === 'eight' ? raw[6] : raw[3];
    const instant = parseJournalInstant(at);
    const item: SourceJournalCell = {
      schema,
      journalRow: index + 1,
      sheet: schema === 'eight' ? text(raw[0]) : address.sheet,
      cell: address.cell,
      column: schema === 'eight' ? raw[2] : '',
      rowKey: schema === 'eight' ? raw[3] : '',
      was: schema === 'eight' ? raw[4] : raw[1],
      became: schema === 'eight' ? raw[5] : raw[2],
      at,
      instant,
      author: schema === 'eight' ? raw[7] : raw[4],
    };
    cells.push(item);
    coverage.cellRows++;
    if (schema === 'eight') coverage.eightColumn++;
    else coverage.sixColumn++;
    if (!instant) coverage.invalidTime++;
    else if (instant.precision === 'day') coverage.dayOnly++;
    else if (instant.precision === 'minute') coverage.minuteTime++;
    else coverage.exactTime++;
  });
  return { cells, coverage };
}
