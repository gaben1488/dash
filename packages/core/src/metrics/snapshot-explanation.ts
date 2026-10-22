import { CalcEngine, combineMetricSlices, explainMetric, standardRowFilter } from '../pipeline/calc-engine.js';
import { DEPT_HEADER_ROWS, findDept, productCalendarDay, PRODUCT_UTC_OFFSET_HOURS, resolvePublishedMetricKey, executableFormula, type DataSnapshot } from '@aemr/shared';
import { byPeriod } from './published-projection.js';

/** Recompute solely to verify evidence for immutable historical snapshots. */
export function explainSnapshotMetric(snapshot: DataSnapshot, key: string) {
  const address = resolvePublishedMetricKey(key);
  if (!address) return { status: 'unavailable', reason: 'UNMAPPED_METRIC' } as const;
  const department = address.departmentId ?? undefined;
  const method = address.method;
  const period = address.period;
  const sources = Object.entries(snapshot.rowsByDept ?? {})
    .filter(([sheet]) => department ? findDept(sheet)?.latinId === department : !!findDept(sheet));
  if (sources.length === 0) return { status: 'unavailable', reason: 'SOURCE_ROWS_NOT_RETAINED' } as const;
  const context = snapshot.metadata.calculationContext;
  const asOf = new Date(snapshot.createdAt);
  if (!Number.isFinite(asOf.getTime())) return { status: 'unavailable', reason: 'SNAPSHOT_TIME_UNKNOWN' } as const;
  // Keep each source sheet's own row index. Concatenating multiple books and
  // applying the row classifier only once loses the original coordinates and
  // can make the same row number point to another department's evidence.
  const sheetCalculations = sources.map(([sheet, rows]) => ({
    sheet,
    rows,
    grouped: new CalcEngine().compute(rows, standardRowFilter, 0,
      snapshot.metadata.targetYear ?? undefined,
      { asOfDay: productCalendarDay(asOf, PRODUCT_UTC_OFFSET_HOURS) }),
  }));
  const selected = sheetCalculations.map(({ sheet, rows, grouped }) => ({
    sheet,
    rows,
    values: byPeriod(grouped, period, method ?? undefined),
  }));
  const offsets: Array<{ sheet: string; start: number; end: number }> = [];
  let total = 0;
  for (const item of selected) {
    offsets.push({ sheet: item.sheet, start: total, end: total + item.rows.length });
    total += item.rows.length;
  }
  const values = combineMetricSlices(selected.map((item, i) => ({
    values: item.values, rowOffset: offsets[i]!.start,
  })));
  // Reproduction is not a substitute for captured historical rule provenance.
  // A legacy snapshot can be numerically equal under today's rules without
  // having been calculated with those rules.

  const explanation = explainMetric(address.definitionKey, values);
  if (!explanation) return { status: 'unavailable', reason: 'UNMAPPED_METRIC' } as const;
  const savedValue = snapshot.calculatedMetrics[key]?.numericValue;
  // Historical snapshots may use another rule version. Never attach new evidence
  // to a saved number that it does not reproduce.
  if (savedValue === undefined || savedValue !== explanation.value) {
    return { status: 'unavailable', reason: 'SAVED_RESULT_NOT_REPRODUCED' } as const;
  }
  const sourceAddress = (index: number) => {
    const source = offsets.find(item => index >= item.start && index < item.end);
    if (!source) throw new Error('SOURCE_ROW_INDEX_OUT_OF_RANGE');
    return { sheet: source.sheet, row: index - source.start + DEPT_HEADER_ROWS + 1 };
  };
  return {
    status: 'available', evidenceKind: 'reproduced_from_retained_rows',
    snapshotId: snapshot.id, asOf: snapshot.createdAt,
    period, year: snapshot.metadata.targetYear ?? null, department: department ?? null,
    definition: explanation.definition, value: savedValue,
    resultContext: {
      grain: 'department_sheet_row',
      scope: {
        sourceSheets: sources.map(([sheet]) => sheet),
        department: department ?? null,
        method,
        period, year: snapshot.metadata.targetYear ?? null,
      },
      dependencies: explanation.operands.map(operand => operand.key),
      formula: executableFormula(address.definitionKey)!,
      version: {
        snapshotId: snapshot.id,
        calculationContextId: context?.id ?? null,
        semanticsHash: context?.semantics ?? null,
        sourceContentHash: context?.sources.content ?? null,
        sourceProfilesHash: context?.sources.profiles ?? null,
        status: context ? 'captured' : 'legacy_without_context',
      },
    },
    rows: explanation.contributingRows.map(sourceAddress),
    operands: explanation.operands.map(operand => {
      const definition = explainMetric(operand.key, values)?.definition;
      return { key: operand.key, label: definition?.label ?? operand.key, unit: definition?.unit ?? null,
        value: operand.value, rows: operand.contributingRows.map(sourceAddress) };
    }),
  } as const;
}
