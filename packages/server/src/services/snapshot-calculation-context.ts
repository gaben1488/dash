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

/** Reuse only a captured context under exactly the installed source/rule profiles. */
export function currentCalculationContextMatches(snapshot: DataSnapshot): boolean {
  const context = snapshot.metadata.calculationContext;
  return !!context && context.semantics === calculationSemantics(getActiveRules())
    && context.sources.profiles === calculationDigest({ departments: DEPARTMENT_REGISTRY, reportMap: REPORT_MAP })
    && calculationDigest(context.thresholds) === calculationDigest(freezeThresholds(isoOfDayNumber(context.calendar.productDay)));
}
