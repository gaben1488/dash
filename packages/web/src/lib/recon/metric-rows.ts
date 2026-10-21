// ── Маппинг метрик-дельт (fd.deltas) в строки таблицы «По метрикам» + фильтры/счёты.
//    Извлечено move-only из pages/Recon.tsx (разрез E11-4).

import { findDept, productLabel, REPORT_MAP } from '@aemr/shared';
import type { MetricAssessment, MetricReconRow, ReconMetricDelta } from './types';

/** Оценка метрики: в допуске → ok; |Δ%| > 5 → critical; иначе warning */
export function deriveAssessment(withinTolerance: boolean, deltaPercent: number | null): MetricAssessment {
  if (withinTolerance) return 'ok';
  if (deltaPercent != null && Math.abs(deltaPercent) > 5) return 'critical';
  return 'warning';
}

/**
 * Дельты API → строки таблицы метрик. Дельты без обоих значений (official и
 * calculated == null) отбрасываются; Δ% берётся из API либо считается от official.
 */
export function buildMetricRows(deltas: ReconMetricDelta[]): MetricReconRow[] {
  return deltas
    .filter((d) => d.officialValue != null || d.calculatedValue != null)
    .map((d) => {
      const official = d.officialValue;
      const calculated = d.calculatedValue;
      const known = official != null && calculated != null;
      const deltaAbs = known ? Math.abs(official - calculated) : null;
      const deltaPct = !known || official === 0 ? null : d.deltaPercent != null
        ? Math.abs(d.deltaPercent)
        : Math.abs(((official - calculated) / official) * 100);
      return {
        metric: d.metricKey,
        metricLabel: d.label ?? productLabel(d.metricKey),
        official,
        calculated,
        deltaAbs,
        deltaPct,
        assessment: known ? deriveAssessment(d.withinTolerance, deltaPct) : 'unknown',
      };
    });
}

/** A selected department excludes district-wide and unidentified metrics. */
export function filterActiveMetricRows(rows: MetricReconRow[], selectedDepartments: ReadonlySet<string>): MetricReconRow[] {
  if (selectedDepartments.size === 0) return rows;
  const selected = new Set<string | undefined>([...selectedDepartments].map(id => findDept(id)?.latinId).filter(Boolean));
  return rows.filter(row => {
    const department = /^grbs\.([^.]+)\./.exec(row.metric)?.[1];
    return department !== undefined && selected.has(department);
  });
}

/** The chosen period never inherits annual metrics when its own data is absent. */
export function filterMetricPeriod(deltas: ReconMetricDelta[], period: string): ReconMetricDelta[] {
  return deltas.filter(delta => {
    const registered = REPORT_MAP.find(entry => entry.metricKey === delta.metricKey)?.period;
    return registered ? registered === (period === 'year' ? 'annual' : period)
      : delta.metricKey.split('.').includes(period);
  });
}

/** Счёт строк метрик по оценкам (для бейджей-саммари) */
export function countMetricAssessments(rows: MetricReconRow[]): Record<MetricAssessment, number> {
  const counts: Record<MetricAssessment, number> = { ok: 0, warning: 0, critical: 0, unknown: 0 };
  for (const r of rows) counts[r.assessment]++;
  return counts;
}
