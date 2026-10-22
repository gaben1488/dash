import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { productCalendarDay, PRODUCT_UTC_OFFSET_HOURS, WEEKLY_CUTOFF_HOUR,
  freezeThresholds, isoOfDayNumber, DEPARTMENT_REGISTRY, getActiveRules, REPORT_MAP, type DataSnapshot, type CalculationContext } from '@aemr/shared';
import type { PipelineInput } from '@aemr/core';

/** Canonical object keys; array order, formula text and scalar types remain evidence. */
export function calculationDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value, (_key, item) => {
    if (typeof item === 'function' || item instanceof RegExp) return String(item);
    return item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item;
  })).digest('hex');
}

let semantics: string | undefined;
function semanticRevision(): string {
  if (semantics) return semantics;
  const hash = createHash('sha256');
  function visit(directory: URL, prefix: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (entry.isDirectory()) visit(new URL(entry.name + '/', directory), prefix + entry.name + '/');
      else if (entry.isFile() && /\.(ts|json)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) {
        hash.update(prefix + entry.name + '\0').update(readFileSync(new URL(entry.name, directory)));
      }
    }
  }
  visit(new URL('../../../shared/src/', import.meta.url), 'shared/');
  visit(new URL('../../../core/src/', import.meta.url), 'core/');
  visit(new URL('./', import.meta.url), 'server/services/');
  hash.update(readFileSync(new URL('../../../report-engine/src/procurement_engine/department_directory.json', import.meta.url)));
  semantics = hash.digest('hex');
  return semantics;
}

export function snapshotCalculationContext(input: PipelineInput, asOf: Date): CalculationContext {
  const context: Omit<CalculationContext, 'id'> = {
    contract: 'aemr-calculation-context-v1',
    thresholds: freezeThresholds(isoOfDayNumber(productCalendarDay(asOf, PRODUCT_UTC_OFFSET_HOURS))),
    sources: {
      content: calculationDigest({ spreadsheetId: input.spreadsheetId, batch: input.batchGetData,
        rows: input.sheetRows, formulas: input.sheetFormulas ?? null, bindings: input.sourceBindings ?? null }),
      profiles: calculationDigest({ departments: DEPARTMENT_REGISTRY, reportMap: input.reportMap }),
    },
    semantics: calculationSemantics(input.rules),
    calendar: { asOf: asOf.toISOString(), productDay: productCalendarDay(asOf, PRODUCT_UTC_OFFSET_HOURS),
      utcOffsetHours: PRODUCT_UTC_OFFSET_HOURS, weeklyCutoffHour: WEEKLY_CUTOFF_HOUR },
    scope: { targetYear: input.targetYear ?? null, officialYear: input.officialYear ?? null },
    decisions: 'not-applied', access: 'full-dataset',
  };
  return { ...context, id: calculationDigest(context) };
}


function calculationSemantics(rules: PipelineInput['rules']): string {
  return calculationDigest({ implementation: semanticRevision(),
    rules: rules.map(({ check: _check, ...definition }) => definition) });
}

/** Verify the recorded *base calculation* before calling a live cache entry ready.
 *
 * This is not a user-specific authorization check: access and human decisions
 * are deliberately represented by request-local projections, not baked into
 * the sealed input hash. A saved historical result remains readable unchanged.
 * The caller must also compare its real source-state receipt before reuse.
 */
export function currentCalculationContextMatches(snapshot: DataSnapshot, now: Date = new Date()): boolean {
  const context = snapshot.metadata?.calculationContext;
  if (!context || context.contract !== 'aemr-calculation-context-v1'
    || !context.sources?.content || !context.sources.profiles
    || !context.thresholds || !context.calendar || !context.scope
    || context.decisions !== 'not-applied' || context.access !== 'full-dataset') return false;
  if (typeof context.calendar.asOf !== 'string' || !Number.isFinite(now.getTime())) return false;

  const captured = new Date(context.calendar.asOf);
  if (!Number.isFinite(captured.getTime())
    || captured.toISOString() !== context.calendar.asOf
    || snapshot.createdAt !== context.calendar.asOf
    || captured.getTime() > now.getTime()
    || context.calendar.utcOffsetHours !== PRODUCT_UTC_OFFSET_HOURS
    || context.calendar.weeklyCutoffHour !== WEEKLY_CUTOFF_HOUR
    || context.calendar.productDay !== productCalendarDay(captured, PRODUCT_UTC_OFFSET_HOURS)
    || context.calendar.productDay !== productCalendarDay(now, PRODUCT_UTC_OFFSET_HOURS)
    || context.scope.targetYear !== (snapshot.metadata.targetYear ?? null)) return false;

  // The digest protects the context from partial/accidental rewrites. It is not
  // an authentication signature; source provenance is independently checked.
  const { id, ...evidence } = context;
  return id === calculationDigest(evidence)
    && context.semantics === calculationSemantics(getActiveRules())
    && context.sources.profiles === calculationDigest({ departments: DEPARTMENT_REGISTRY, reportMap: REPORT_MAP })
    && calculationDigest(context.thresholds) === calculationDigest(freezeThresholds(isoOfDayNumber(context.calendar.productDay)));
}
