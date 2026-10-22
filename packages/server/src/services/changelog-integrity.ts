/**
 * Optional, read-only witness for "Thursday -> current" integrity checks.
 *
 * Drive push notifications carry message numbers, NOT an edit count.
 * The source _ChangeLog also does not record physical row deletion. Therefore
 * journal entries can corroborate a specific current cell value, never prove
 * completeness or suppress a vanished-number signal.
 *
 * Eight-column source rows have a stable A/row-key field in column D; the
 * six-column source rows do not. A historic address such as L178 is not a
 * durable identity after insertions or removals.
 */
import { COL_LETTER_INDEX, DEPT_COLUMNS, DEPT_HEADER_ROWS } from '@aemr/shared';
import { parseJournalInstant, type JournalRecord } from '@aemr/core';

export interface JournalCellWitness {
  rowSeq: string;
  sourceCell: string;
  currentCell: string | null;
  at: string;
  status: 'matches-current' | 'different-current' | 'row-not-found' | 'ambiguous-number' | 'conflicting-log';
}

export interface JournalIntegrityWitness {
  dept: string;
  readAt: string;
  entriesSinceControl: number;
  withoutStableKey: number;
  matchesCurrent: number;
  needsReview: number;
  examples: JournalCellWitness[];
  note: string;
}

const EXAMPLE_LIMIT = 12;

function asText(value: unknown): string {
  return String(value ?? '').trim();
}

function instantMs(value: unknown): number | null {
  const parsed = parseJournalInstant(value);
  if (!parsed) return null;
  const ms = Date.parse(parsed.at + 'Z');
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Correlate only the latest journal transition per stable number + column
 * with a unique current row, and require the recorded NEW value to agree with
 * the actual current cell. Matching a physical address alone is prohibited.
 *
 * Missing logs do not turn a snapshot absence into zero; the 6-column
 * journal without a row-key stays unverified even if its A1 address matches.
 */
export function correlateChangelogWithCurrent(
  dept: string,
  records: readonly JournalRecord[],
  current: readonly unknown[][],
  controlAtMs: number,
  currentAtMs: number,
  journalReadAtMs: number,
  canonicalSheet = 'ВСЕ',
): JournalIntegrityWitness {
  const rowsByNumber = new Map<string, Array<{ row: readonly unknown[]; sheetRow: number }>>();
  current.forEach((row, index) => {
    if (index < DEPT_HEADER_ROWS || !Array.isArray(row)) return;
    const key = asText(row[DEPT_COLUMNS.ID]);
    if (!key) return;
    const list = rowsByNumber.get(key) ?? [];
    list.push({ row, sheetRow: index + 1 });
    rowsByNumber.set(key, list);
  });

  const latest = new Map<string, { rowSeq: string; sourceCell: string; col: number;
    atMs: number; became: string; conflicting: boolean }>();
  let withoutStableKey = 0;
  let entriesSinceControl = 0;

  for (const record of records) {
    const atMs = instantMs(record.at);
    if (atMs === null || atMs < controlAtMs || atMs > currentAtMs) continue;
    const sheet = asText(record.sheet);
    if (sheet && sheet !== canonicalSheet) continue;
    const cell = asText(record.cell).toUpperCase();
    const parsedCell = /^([A-Z]{1,2})([1-9]\d*)$/.exec(cell);
    if (!parsedCell) continue;
    const col = COL_LETTER_INDEX[parsedCell[1]];
    if (col === undefined) continue;
    entriesSinceControl++;

    const rowSeq = asText(record.row);
    if (!rowSeq) {
      withoutStableKey++;
      continue;
    }

    const key = JSON.stringify([rowSeq, col]);
    const became = asText(record.became);
    const prev = latest.get(key);
    if (!prev || atMs > prev.atMs) {
      latest.set(key, { rowSeq, sourceCell: cell, col, atMs, became, conflicting: false });
    } else if (atMs === prev.atMs && prev.became !== became) {
      prev.conflicting = true;
    }
  }

  const examples: JournalCellWitness[] = [];
  let matchesCurrent = 0;
  let needsReview = withoutStableKey;
  for (const witness of latest.values()) {
    const match = rowsByNumber.get(witness.rowSeq) ?? [];
    const currentCell = match.length === 1
      ? witness.sourceCell.match(/^[A-Z]{1,2}/)?.[0] + String(match[0].sheetRow)
      : null;
    const status: JournalCellWitness['status'] = witness.conflicting
      ? 'conflicting-log'
      : match.length === 0 ? 'row-not-found'
      : match.length !== 1 ? 'ambiguous-number'
      : asText(match[0].row[witness.col]) === witness.became
        ? 'matches-current' : 'different-current';
    if (status === 'matches-current') matchesCurrent++;
    else needsReview++;
    if (examples.length < EXAMPLE_LIMIT) {
      examples.push({ rowSeq: witness.rowSeq, sourceCell: witness.sourceCell,
        currentCell, at: new Date(witness.atMs).toISOString(), status });
    }
  }

  return {
    dept,
    readAt: new Date(journalReadAtMs).toISOString(),
    entriesSinceControl, withoutStableKey, matchesCurrent, needsReview, examples,
    note: 'Уведомление Drive не содержит числа правок. Совпавшие № п/п и текущие значения '
      + 'подтверждают только соответствующую ячейку; полноту журнала, автора удаления '
      + 'и физическое удаление строки не доказывают. Пропавшие № определяет четверговая сверка.',
  };
}
