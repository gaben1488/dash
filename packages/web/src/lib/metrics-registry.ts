/**
 * Metrics registry for web — delegates to @aemr/core KB (single source of truth).
 * UI-specific helpers (threshold colors) remain here.
 *
 * Previously: 286-line duplicate of core/metrics/registry.ts
 * Now: thin wrapper importing from @aemr/core + UI color helpers
 */

import { METRIC_KB, getMetricKB as coreGetMetricKB } from '@aemr/core';
import type { KBEntry } from '../components/ui/kb-tooltip';

// ── Re-export KB as STANDARD_METRICS (backward compatibility) ──

/** Convert core KBEntryData → web KBEntry for KBTooltip component */
function toKBEntry(key: string): KBEntry {
  const entry = METRIC_KB[key];
  if (!entry) return {};
  return {
    description: entry.label,
    formula: entry.formula,
    source: entry.source,
    cell: entry.cell,
    thresholds: entry.thresholds,
    law: entry.law,
    // 10-block literary Russian
    whatIs: entry.whatIs,
    howCalc: entry.howCalc,
    dataSource: entry.dataSource,
    engine: entry.engine,
    thresholdsFull: entry.thresholdsFull,
    lawFull: entry.lawFull,
    example: entry.example,
    pitfalls: entry.pitfalls,
    actions: entry.actions,
    related: entry.related,
  };
}

/** Proxy that lazily converts core entries to web KBEntry format */
export const STANDARD_METRICS: Record<string, KBEntry> = new Proxy(
  {} as Record<string, KBEntry>,
  {
    get(_target, key: string) {
      return toKBEntry(key);
    },
    has(_target, key: string) {
      return key in METRIC_KB;
    },
    ownKeys() {
      return Object.keys(METRIC_KB);
    },
    getOwnPropertyDescriptor(_target, key: string) {
      if (key in METRIC_KB) {
        return { configurable: true, enumerable: true, value: toKBEntry(key) };
      }
      return undefined;
    },
  },
);

/** Helper: get metric entry or empty object */
export function getMetricKB(key: string): KBEntry {
  return toKBEntry(key);
}

// ── UI-specific helpers (Tailwind classes, not applicable to core) ──

/** Get threshold text color class based on value and metric */
export function getThresholdColor(metricKey: string, value: number): string {
  switch (metricKey) {
    case 'exec_count_pct':
    case 'execution_pct':
    case 'dept_exec_count_pct':
    case 'dept_exec_amount_pct':
    case 'dept_fb_pct':
      if (value >= 90) return 'text-emerald-600 dark:text-emerald-400';
      if (value >= 70) return 'text-blue-600 dark:text-blue-400';
      if (value >= 50) return 'text-amber-600 dark:text-amber-400';
      return 'text-red-600 dark:text-red-400';

    case 'economy_rate':
    case 'avg_reduction_pct':
      if (value <= 10) return 'text-emerald-600 dark:text-emerald-400';
      if (value <= 25) return 'text-amber-600 dark:text-amber-400';
      return 'text-red-600 dark:text-red-400';

    case 'critical_issues':
    case 'economy_conflicts':
      if (value === 0) return 'text-emerald-600 dark:text-emerald-400';
      if (value <= 3) return 'text-amber-600 dark:text-amber-400';
      return 'text-red-600 dark:text-red-400';

    case 'dept_trust':
      if (value >= 90) return 'text-emerald-600 dark:text-emerald-400';
      if (value >= 75) return 'text-blue-600 dark:text-blue-400';
      if (value >= 60) return 'text-amber-600 dark:text-amber-400';
      if (value >= 40) return 'text-orange-600 dark:text-orange-400';
      return 'text-red-600 dark:text-red-400';

    default:
      return 'text-zinc-700 dark:text-zinc-200';
  }
}

/** Get threshold background for badges/chips */
export function getThresholdBg(metricKey: string, value: number): string {
  switch (metricKey) {
    case 'exec_count_pct':
    case 'execution_pct':
    case 'dept_exec_count_pct':
    case 'dept_exec_amount_pct':
    case 'dept_fb_pct':
      if (value >= 90) return 'bg-emerald-500/10';
      if (value >= 70) return 'bg-blue-500/10';
      if (value >= 50) return 'bg-amber-500/10';
      return 'bg-red-500/10';

    case 'dept_trust':
      if (value >= 90) return 'bg-emerald-500/10';
      if (value >= 75) return 'bg-blue-500/10';
      if (value >= 60) return 'bg-amber-500/10';
      if (value >= 40) return 'bg-orange-500/10';
      return 'bg-red-500/10';

    default:
      return 'bg-zinc-500/10';
  }
}
