import { isOrgItself, ORG_ITSELF_SENTINEL, type LimitComparisonPoint } from '@aemr/shared';
import { buildDrill } from './drill';

/**
 * Open the row behind a scatter point, rather than widening every click to
 * the entire department. A point is a plan position, not a stable procurement
 * identity: keep its source month, year, institution, method and exact subject.
 * Unknown method must never be silently labelled a competitive procedure.
 */
export function scatterPointDrill(point: LimitComparisonPoint) {
  const method = point.procurementType === 'ЕП'
    ? 'ЕП' as const
    : point.procurementType === 'unknown'
      ? undefined
      : 'КП' as const;
  return buildDrill({
    dept: point.department,
    subordinate: isOrgItself(point.subordinate) ? ORG_ITSELF_SENTINEL : point.subordinate,
    year: point.planYear,
    month: point.month,
    method,
    search: point.subject,
  }, 'data');
}
