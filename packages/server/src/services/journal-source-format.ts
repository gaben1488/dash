/**
 * One source-schema decoder for the existing _ChangeLog. No API, SQLite,
 * calculation or human-facing interpretation belongs here.
 *
 * The eight-column and legacy six-column formats coexist in real books.
 * A range/batch/structural operation is NOT a sequence of cell edits.
 * Keep source row coordinates only as evidence, never as an event identity.
 */
export interface SourceJournalCell {
  readonly schema: 'eight' | 'six';
  readonly journalRow: number;
  readonly sheet: string;
  readonly cell: string;
  readonly column: unknown;
  readonly rowKey: unknown;
  readonly was: unknown;
  readonly became: unknown;
  readonly at: unknown;
  readonly author: unknown;
}

export interface SourceJournalFormat {
  readonly cells: SourceJournalCell[];
  readonly rawRows: number;
  readonly rowKeyless: number;
  readonly nonCell: number;
  readonly emptyOrHeader: number;
}

const value = (raw: unknown): string => String(raw ?? '').trim();

/** Normalize only verified single-cell addresses; preserve other raw values. */
function address(raw: unknown): { sheet: string; cell: string } | null {
  const match = value(raw).match(/^(?:(.+)!)?([A-Z]{1,2}[1-9]\d*)$/i);
  if (!match) return null;
  return { sheet: match[1] ?? '', cell: match[2].toUpperCase() };
}

/**
 * Decode once per consumer input using the SAME grammar, even when the 6/8
 * formats appear together. Empty/headers are not errors, but any other
 * unrecognised entry remains visible to coverage.
 */
export function decodeSourceJournal(rows: readonly (readonly unknown[])[]): SourceJournalFormat {
  const cells: SourceJournalCell[] = [];
  let rowKeyless = 0;
  let nonCell = 0;
  let emptyOrHeader = 0;
  rows.forEach((row, index) => {
    const s = (col: number): string => value(row?.[col]);
    if (!Array.isArray(row) || row.every(v => value(v) === '') ||
        (s(0) === 'Лист' && s(1) === 'Ячейка') ||
        (s(0) === 'Ячейка' && s(3) === 'Время')) {
      emptyOrHeader++;
      return;
    }

    // In six-column history an OLD VALUE may itself resemble "B48".
    // Prefer the explicitly located source address in the first column;
    // otherwise an old cell-looking value would rewrite event identity.
    const six = address(row[0]);
    if (six && row.length >= 5) {
      rowKeyless++;
      cells.push({
        schema: 'six', journalRow: index + 1,
        sheet: six.sheet, cell: six.cell,
        column: '', rowKey: '', was: row[1], became: row[2],
        at: row[3], author: row[4],
      });
      return;
    }

    const eight = address(row[1]);
    if (eight && row.length >= 6) {
      cells.push({
        schema: 'eight', journalRow: index + 1,
        sheet: eight.sheet || s(0), cell: eight.cell,
        column: row[2], rowKey: row[3], was: row[4], became: row[5],
        at: row[6], author: row[7],
      });
      return;
    }

    nonCell++;
  });
  return { cells, rawRows: rows.length, rowKeyless, nonCell, emptyOrHeader };
}

/** A date is not a clock time. Calendar precision must survive DB -> UI. */
export function sourceTimestampPrecision(raw: unknown): 'day' | 'exact' {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Number.isInteger(raw) ? 'day' : 'exact';
  }
  const s = value(raw);
  return /^(?:\d{1,2}\.\d{1,2}\.\d{4}|\d{4}-\d{2}-\d{2})$/.test(s)
    ? 'day' : 'exact';
}
