// ── Маппинг метрик-дельт (fd.deltas) в строки таблицы «По метрикам» + фильтры/счёты.
//    Извлечено move-only из pages/Recon.tsx (разрез E11-4).

import { LATIN_TO_CYRILLIC, productLabel } from '@aemr/shared';
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
      const official = d.officialValue ?? 0;
      const calculated = d.calculatedValue ?? 0;
      const deltaAbs = Math.abs(official - calculated);
      const deltaPct = d.deltaPercent != null
        ? Math.abs(d.deltaPercent)
        : (official !== 0 ? Math.abs(((official - calculated) / official) * 100) : 0);
      return {
        metric: d.metricKey,
        metricLabel: d.label ?? productLabel(d.metricKey),
        official,
        calculated,
        deltaAbs,
        deltaPct,
        assessment: deriveAssessment(d.withinTolerance, d.deltaPercent),
      };
    });
}

/**
 * Активные строки метрик:
 * 1) обе величины 0 → пустая метрика, отбрасывается всегда;
 * 2) фильтр по выбранным ГРБС через паттерн ключа `grbs.{deptId}.` — пустой
 *    выбор = всё проходит; метрики без ГРБС-паттерна проходят всегда.
 */
export function filterActiveMetricRows(rows: MetricReconRow[], selectedDepartments: ReadonlySet<string>): MetricReconRow[] {
  const DEPT_ID_TO_RU: Record<string, string> = { ...LATIN_TO_CYRILLIC };
  return rows.filter(r => {
    if (r.official === 0 && r.calculated === 0) return false;
    if (selectedDepartments.size === 0) return true;
    const match = r.metric.match(/^grbs\.(\w+)\./);
    if (!match) return true;
    const ruName = DEPT_ID_TO_RU[match[1]];
    return ruName ? selectedDepartments.has(ruName) : true;
  });
}

/** Счёт строк метрик по оценкам (для бейджей-саммари) */
export function countMetricAssessments(rows: MetricReconRow[]): { ok: number; warning: number; critical: number } {
  return {
    ok: rows.filter(r => r.assessment === 'ok').length,
    warning: rows.filter(r => r.assessment === 'warning').length,
    critical: rows.filter(r => r.assessment === 'critical').length,
  };
}
