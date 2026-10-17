import { createHash } from 'node:crypto';
import { dayNumberOf } from '@aemr/shared';

/**
 * Source-row identity + editable fields. Exclude computed formula columns
 * K, O/P, R/T, Y:AC: background recalculation cannot manufacture a conflict.
 * Preserve content exactly (except empty/absent equivalence), not presentation
 * labels: this revision refers to a single raw Google row, not a human name.
 */
const GUARDED_COLUMN_INDEXES = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 16,
  20, 21, 22, 23, 29, 30, 31, 32, 33,
] as const;

export function rowRevision(row: readonly unknown[]): string {
  const cells = GUARDED_COLUMN_INDEXES.map((index) => {
    const value = row[index];
    if (value === null || value === undefined || value === '') return null;
    return value;
  });
  return createHash('sha256').update(JSON.stringify(cells)).digest('hex');
}


/** Verify the intended result, allowing only date presentation changes by Sheets. */
export function writtenRowMatches(expected: readonly unknown[], observed: readonly unknown[], changedIndexes: readonly number[]): boolean {
  const expectedCells = [...expected], observedCells = [...observed];
  for (const index of changedIndexes) {
    if (index !== 13 && index !== 16) continue;
    const expectedDay = dayNumberOf(expectedCells[index]);
    const observedDay = dayNumberOf(observedCells[index]);
    if (expectedDay !== null && observedDay !== null) {
      expectedCells[index] = expectedDay;
      observedCells[index] = observedDay;
    }
  }
  return rowRevision(expectedCells) === rowRevision(observedCells);
}
