import { isOrgItself, ORG_ITSELF_SENTINEL, type LimitComparisonPoint } from '@aemr/shared';
import { buildDrill } from './drill';

/**
 * Open the row behind a scatter point, rather than widening every click to
 * the entire department. A point is a plan position, not a stable procurement
 * identity: retain its source month, year, institution, method and subject.
 * This narrows the register but does not uniquely identify a physical row;
 * identical subjects require provenance/row-index verification in the source.
 * Unknown method must never silently inherit an older competitive filter.
 */
export function scatterPointDrill(point: LimitComparisonPoint) {
  const method = point.procurementType === 'ЕП'
    ? 'ЕП' as const
    : point.procurementType === 'unknown'
      ? undefined
      : 'КП' as const;
  const activity = point.activityType === 'program'
    || point.activityType === 'current_non_program'
    || point.activityType === 'current_program'
    ? point.activityType : undefined;
  const target = buildDrill({
    dept: point.department,
    subordinate: isOrgItself(point.subordinate) ? ORG_ITSELF_SENTINEL : point.subordinate,
    year: point.planYear,
    month: point.month,
    method,
    activity,
    search: point.subject,
  }, 'data');
  // An unknown method must reset any previous method filter; omitting this
  // field would preserve e.g. a former competitive-only selection in store.
  return method === undefined
    ? { ...target, filters: { ...target.filters, procurement: 'all' as const } }
    : target;
}

/** Recharts can deliver either a source point or a wrapper with payload. */
export function scatterClickDrill(input: unknown) {
  if (!input || typeof input !== 'object') return null;
  const wrapper = input as { payload?: unknown };
  const candidate = wrapper.payload ?? input;
  if (!candidate || typeof candidate !== 'object') return null;
  const point = candidate as Partial<LimitComparisonPoint>;
  if (typeof point.department !== 'string' || !point.department
    || typeof point.subject !== 'string' || !point.subject.trim()
    || !Number.isInteger(point.planYear) || (point.planYear ?? 0) < 2000
    || !Number.isInteger(point.month) || (point.month ?? 0) < 1 || (point.month ?? 0) > 12
    || typeof point.procurementType !== 'string') return null;
  return scatterPointDrill(point as LimitComparisonPoint);
}
