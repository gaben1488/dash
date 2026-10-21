import { CalcEngine, explainMetric, sliceResults, standardRowFilter } from '@aemr/core';
import { DEPT_HEADER_ROWS, findDept, productCalendarDay, PRODUCT_UTC_OFFSET_HOURS, type DataSnapshot } from '@aemr/shared';

// Names in the published Svod contract; formulas remain owned by CalcEngine.
const ALIASES: Record<string, string> = {
  count: 'plan_count', fact: 'fact_count', percent: 'exec_count_pct',
  total_plan: 'plan_total', total_fact: 'fact_total', amount_dev: 'amount_deviation',
  fb_plan: 'plan_fb', kb_plan: 'plan_kb', mb_plan: 'plan_mb',
  fb_fact: 'fact_fb', kb_fact: 'fact_kb', mb_fact: 'fact_mb',
};

/** Requested drill-down uses the retained snapshot only, never a new Sheets read. */
export function metricExplanation(snapshot: DataSnapshot, key: string) {
  const match = /^grbs\.([^.]+)\.(?:(kp|ep)\.)?(q[1-4]|year)\.([a-z_]+)$/.exec(key);
  if (!match) return { status: 'unavailable', reason: 'UNMAPPED_METRIC' } as const;
  const [, department, method, period, name] = match;
  const source = Object.entries(snapshot.rowsByDept ?? {})
    .find(([sheet]) => findDept(sheet)?.latinId === department);
  if (!source) return { status: 'unavailable', reason: 'SOURCE_ROWS_NOT_RETAINED' } as const;
  const asOf = new Date(snapshot.createdAt);
  if (!Number.isFinite(asOf.getTime())) return { status: 'unavailable', reason: 'SNAPSHOT_TIME_UNKNOWN' } as const;
  const [sheet, rows] = source;
  const grouped = new CalcEngine().compute(rows, standardRowFilter, 0,
    snapshot.metadata.targetYear ?? undefined,
    { asOfDay: productCalendarDay(asOf, PRODUCT_UTC_OFFSET_HOURS) });
  const values = sliceResults(grouped, {
    quarters: period === 'year' ? ['q1', 'q2', 'q3', 'q4'] : [period!],
    ...(method ? { methods: [method === 'kp' ? 'competitive' : 'ep'] } : {}),
  });
  const explanation = explainMetric(ALIASES[name!] ?? name!, values);
  if (!explanation) return { status: 'unavailable', reason: 'UNMAPPED_METRIC' } as const;
  const savedValue = snapshot.calculatedMetrics[key]?.numericValue;
  // Historical snapshots may use another rule version. Never attach new evidence
  // to a saved number that it does not reproduce.
  if (savedValue === undefined || savedValue !== explanation.value) {
    return { status: 'unavailable', reason: 'SAVED_RESULT_NOT_REPRODUCED' } as const;
  }
  const address = (index: number) => ({ sheet, row: index + DEPT_HEADER_ROWS + 1 });
  return {
    status: 'available', evidenceKind: 'reproduced_from_retained_rows',
    snapshotId: snapshot.id, asOf: snapshot.createdAt,
    period, year: snapshot.metadata.targetYear ?? null, department,
    definition: explanation.definition, value: savedValue,
    rows: explanation.contributingRows.map(address),
    operands: explanation.operands.map(operand => ({
      key: operand.key, value: operand.value, rows: operand.contributingRows.map(address),
    })),
  } as const;
}
