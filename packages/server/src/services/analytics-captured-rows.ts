import type { DataSnapshot } from '@aemr/shared';

/** A derived score must not combine one snapshot's aggregates with rows from a
 * separately refreshed Google source cache.
 *
 * collectRowsByDept() already removes the three master header rows and keeps
 * known-empty books as empty arrays. The route adds physical row numbers.
 * Absence is not an empty procurement book and must fail closed.
 */
export function capturedAnalyticsRows(
  snapshot: Pick<DataSnapshot, 'rowsByDept'>,
  departmentShortName: string,
): unknown[][] {
  const rows = snapshot.rowsByDept?.[departmentShortName];
  if (!Array.isArray(rows)) throw new Error('ANALYTICS_CAPTURE_NOT_AVAILABLE');
  return rows;
}
