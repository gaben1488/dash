import { findDept, type DataSnapshot } from '@aemr/shared';

/** Do not combine calculations from one snapshot with a separately refreshed
 * Google cache. Preserve the same stable department identity across verified
 * current and historical short names; reject two sources for one department.
 *
 * collectRowsByDept() already removes exactly three header rows. [] means
 * a successfully captured empty master, while absence is unverified.
 */
export function capturedAnalyticsRows(
  snapshot: Pick<DataSnapshot, 'rowsByDept'>,
  departmentShortName: string,
): unknown[][] {
  const department = findDept(departmentShortName);
  if (!department) throw new Error('ANALYTICS_UNKNOWN_DEPARTMENT');

  const matches = Object.entries(snapshot.rowsByDept ?? {})
    .filter(([key]) => findDept(key)?.id === department.id);
  if (matches.length === 0) throw new Error('ANALYTICS_CAPTURE_NOT_AVAILABLE');
  if (matches.length !== 1) throw new Error('ANALYTICS_CAPTURE_AMBIGUOUS_DEPARTMENT');
  const rows = matches[0][1];
  if (!Array.isArray(rows)) throw new Error('ANALYTICS_CAPTURE_NOT_AVAILABLE');
  return rows;
}
