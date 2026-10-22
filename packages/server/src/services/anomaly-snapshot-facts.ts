import { DEPT_HEADER_ROWS, findDept, type DataSnapshot } from '@aemr/shared';

/** Dataset findings and their addresses must belong to the same captured
 * source. The snapshot stores data rows without the three master header rows.
 * Missing captured rows are not borrowed from a mutable live Google cache.
 */
export function anomalyFactsOfCapturedRows(
  snapshot: Pick<DataSnapshot, 'rowsByDept'>,
  department: string,
): Map<number, unknown[]> {
  const result = new Map<number, unknown[]>();
  const stableDeptId = findDept(department)?.id;
  if (!stableDeptId) return result;
  const matches = Object.entries(snapshot.rowsByDept ?? {})
    .filter(([name]) => findDept(name)?.id === stableDeptId);
  // Missing, legacy-corrupt or ambiguous aliases never borrow a live address.
  if (matches.length !== 1 || !Array.isArray(matches[0][1])) return result;
  const rows = matches[0][1];
  for (let index = 0; index < rows.length; index++) {
    const cells = rows[index];
    if (Array.isArray(cells)) result.set(DEPT_HEADER_ROWS + index + 1, cells);
  }
  return result;
}
