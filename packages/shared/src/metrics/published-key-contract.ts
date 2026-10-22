/**
 * Contract between historical public metric keys and the executable catalog.
 *
 * The persisted names (grbs.uo.kp.q1.count, competitive.year.total_plan, ...)
 * are an adapter at the product boundary, not a second metric definition.
 * Every consumer resolves these names here; a new name never introduces a
 * private calculation. Unmapped names are explicit instead of guessed.
 */
import { EXECUTABLE_METRICS } from './calculation-definitions.js';

export type PublishedMetricPeriod = 'year' | 'q1' | 'q2' | 'q3' | 'q4'
  | 'm1' | 'm2' | 'm3' | 'm4' | 'm5' | 'm6'
  | 'm7' | 'm8' | 'm9' | 'm10' | 'm11' | 'm12';

export interface PublishedMetricAddress {
  readonly publishedKey: string;
  /** Executable key in STANDARD_METRICS / STANDARD_DERIVED. */
  readonly definitionKey: string;
  readonly grain: 'department_sheet_row';
  readonly departmentId: string | null;
  readonly method: 'competitive' | 'ep' | null;
  readonly period: PublishedMetricPeriod;
}

const ALIASES: Readonly<Record<string, string>> = {
  // Official SVOD/legacy wire names (not new formulas).
  count: 'plan_count',
  fact: 'fact_count',
  percent: 'exec_count_pct',
  total_plan: 'plan_total',
  total_fact: 'fact_total',
  amount_dev: 'amount_deviation',
  fb_plan: 'plan_fb',
  kb_plan: 'plan_kb',
  mb_plan: 'plan_mb',
  fb_fact: 'fact_fb',
  kb_fact: 'fact_kb',
  mb_fact: 'fact_mb',
};
const PERIOD = '(q[1-4]|m(?:[1-9]|1[0-2])|year)';
const DEPARTMENT_KEY = new RegExp('^grbs\\.([a-z0-9_-]+)\\.(?:(kp|ep)\\.)?' + PERIOD + '\\.([a-z_]+)$');
const SUMMARY_KEY = new RegExp('^(competitive|sole)\\.' + PERIOD + '\\.([a-z_]+)$');

/**
 * A pure identifier adapter. Deliberately excludes special/diagnostic
 * indicators until they have a first-class executable definition.
 * Unsupported keys must not inherit evidence from a vaguely similar metric.
 */
export function resolvePublishedMetricKey(key: string): PublishedMetricAddress | null {
  const dept = DEPARTMENT_KEY.exec(key);
  const summary = SUMMARY_KEY.exec(key);
  if (!dept && !summary) return null;
  const publishedName = (dept ? dept[4] : summary![3])!;
  const definitionKey = ALIASES[publishedName] ?? publishedName;
  if (!EXECUTABLE_METRICS.has(definitionKey)) return null;
  const method = dept
    ? dept[2] === 'kp' ? 'competitive' : dept[2] === 'ep' ? 'ep' : null
    : summary![1] === 'competitive' ? 'competitive' : 'ep';
  return {
    publishedKey: key,
    definitionKey,
    grain: 'department_sheet_row',
    departmentId: dept?.[1] ?? null,
    method,
    period: (dept ? dept[3] : summary![2]) as PublishedMetricPeriod,
  };
}
