import type { NormalizedMetric, DeltaResult, ReportMapEntry } from '@aemr/shared';

/**
 * Сравнивает официальные метрики с пересчитанными
 */
export function computeDeltas(
  officialMetrics: Map<string, NormalizedMetric>,
  calculatedMetrics: Map<string, NormalizedMetric>,
  reportMap: ReportMapEntry[],
): DeltaResult[] {
  const results: DeltaResult[] = [];

  for (const entry of reportMap) {
    const official = officialMetrics.get(entry.metricKey);
    const calculated = calculatedMetrics.get(entry.metricKey);

    if (!official && !calculated) continue;

    const officialValue = official?.numericValue ?? null;
    const calculatedValue = calculated?.numericValue ?? null;

    let delta: number | null = null;
    let deltaPercent: number | null = null;
    let withinTolerance = true;
    let explanation = '';

    if (officialValue !== null && calculatedValue !== null) {
      delta = calculatedValue - officialValue;
      deltaPercent = officialValue !== 0
        ? (delta / Math.abs(officialValue)) * 100
        : (delta === 0 ? 0 : 100);

      const tolerance = entry.tolerance ?? 0.01;
      withinTolerance = Math.abs(deltaPercent / 100) <= tolerance;

      if (withinTolerance) {
        explanation = 'Значения совпадают в пределах допуска';
      } else {
        explanation = `Расхождение ${deltaPercent.toFixed(2)}% (допуск: ${(tolerance * 100).toFixed(1)}%)`;
      }
    } else if (officialValue !== null && calculatedValue === null) {
      explanation = 'Пересчитанное значение отсутствует';
      withinTolerance = false;
    } else if (officialValue === null && calculatedValue !== null) {
      explanation = 'Официальное значение отсутствует';
      withinTolerance = false;
    }

    results.push({
      metricKey: entry.metricKey,
      label: entry.label,
      officialValue,
      calculatedValue,
      delta,
      deltaPercent,
      withinTolerance,
      explanation,
    });
  }

  return results;
}
