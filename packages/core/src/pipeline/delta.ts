import type { NormalizedMetric, DeltaResult, ReportMapEntry } from '@aemr/shared';

export interface DeltaScope {
  /**
   * Год, по которому построен расчёт. `undefined` = расчёт идёт по всем
   * годам книги (базовый вид продукта, решение req 4).
   */
  calcYear?: number | undefined;
  /**
   * Год официального листа. Лист СВОД считает свой год строго; если он
   * известен и не совпадает с периметром расчёта, стороны несравнимы.
   */
  officialYear?: number | undefined;
}

/**
 * Сравнивает официальные метрики с пересчитанными.
 *
 * Д21: сравнение обязано знать периметр обеих сторон. Расчёт без года
 * суммирует ВСЕ годы книги, а лист СВОД считает строго свой — вычитание
 * таких величин давало «расхождение 150 %» там, где расходятся не числа,
 * а вопросы, на которые они отвечают. Теперь несравнимая пара не
 * превращается в дельту: она честно помечается и объясняет, почему
 * сравнения нет. Молчаливое сравнение разных периметров хуже отсутствия
 * сверки — оно выглядит как измерение.
 */
export function computeDeltas(
  officialMetrics: Map<string, NormalizedMetric>,
  calculatedMetrics: Map<string, NormalizedMetric>,
  reportMap: ReportMapEntry[],
  scope: DeltaScope = {},
): DeltaResult[] {
  const results: DeltaResult[] = [];
  // Периметры расходятся, когда год официала известен, а расчёт либо
  // многолетний, либо построен за другой год.
  const scopeMismatch =
    scope.officialYear !== undefined && scope.calcYear !== scope.officialYear;
  const scopeReason = scopeMismatch
    ? scope.calcYear === undefined
      ? `Сравнение неприменимо: расчёт построен по всем годам книги, а лист СВОД считает только ${scope.officialYear} год. Выберите год, чтобы сверить сопоставимое.`
      : `Сравнение неприменимо: расчёт за ${scope.calcYear} год, лист СВОД — за ${scope.officialYear}.`
    : '';

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

    if (scopeMismatch && officialValue !== null && calculatedValue !== null) {
      // Обе стороны есть, но отвечают на разные вопросы: дельту не считаем.
      // withinTolerance=true, потому что это не расхождение данных —
      // иначе экран покраснел бы там, где сверки просто не было.
      explanation = scopeReason;
    } else if (officialValue !== null && calculatedValue !== null) {
      delta = calculatedValue - officialValue;
      // An official zero has no relative base: "100 %" for ANY non-zero
      // recalculation was an invented number (e.g. 1 and 1_000_000 both 100%).
      deltaPercent = officialValue === 0
        ? (delta === 0 ? 0 : null)
        : (delta / Math.abs(officialValue)) * 100;

      const tolerance = entry.tolerance ?? 0.01;
      withinTolerance = deltaPercent !== null
        ? Math.abs(deltaPercent / 100) <= tolerance
        : false;

      if (withinTolerance) {
        explanation = 'Значения совпадают в пределах допуска';
      } else if (deltaPercent === null) {
        explanation = 'Официальное значение равно нулю: относительный процент расхождения не определён. Смотрите абсолютную разницу.';
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
