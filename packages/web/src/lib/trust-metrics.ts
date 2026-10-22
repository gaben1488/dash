import { summarizeCheckCoverage } from '@aemr/shared';
import type { DepartmentSummary, TrustComponent, TrustScore } from '@aemr/shared';


/** Server's confirmed formula observations are a live read model, not a weekly snapshot. */
export interface LiveFormulaAssessment {
  expectedBooks: number;
  checkedBooks: number;
  checkedAt: string | null;
  score: number | null;
  checks: { expected: number; checked: number; failed: number } | null;
  books: Array<{
    book: string;
    checkedAt: string | null;
    score: number | null;
    checks: { expected: number; checked: number; failed: number } | null;
    defects: number | null;
  }>;
}

export function currentFormulaScope(
  evidence: LiveFormulaAssessment,
  selectedBooks?: readonly string[],
): { expectedBooks: number; checkedBooks: number; checkedAt: string | null; score: number | null;
  checks: { expected: number; checked: number; failed: number } | null } {
  if (selectedBooks === undefined) return evidence;
  const chosen = [...new Set(selectedBooks)];
  const byBook = new Map(evidence.books.map(book => [book.book, book]));
  const checked = chosen.map(book => byBook.get(book)).filter(
    (book): book is LiveFormulaAssessment['books'][number] =>
      book !== undefined && book.score !== null && book.checks !== null,
  );
  const combined = chosen.length > 0 && checked.length === chosen.length
    ? summarizeCheckCoverage(checked.map(book => book.checks!)) : null;
  return {
    expectedBooks: chosen.length,
    checkedBooks: checked.length,
    checkedAt: checked.length > 0 ? checked.map(book => book.checkedAt!).sort().at(-1)! : null,
    score: combined?.score ?? null,
    checks: combined ? { expected: combined.expected, checked: combined.checked, failed: combined.failed } : null,
  };
}

/** Recalculate visible trust without rewriting the preserved source snapshot.
 * Other component scores stay on their original snapshot; incomplete latest
 * formula reads must *lower confidence*, not revive a historical 100%.
 */
export function withCurrentFormulaAssessment(
  view: TrustViewModel,
  evidence: LiveFormulaAssessment,
  selectedBooks?: readonly string[],
): TrustViewModel {
  if (!view.components.some(c => c.name === 'formula_integrity')) return view;
  const scope = currentFormulaScope(evidence, selectedBooks);
  const components = view.components.map(component => component.name === 'formula_integrity'
    ? {
      ...component,
      score: scope.score,
      ...(scope.checks ? { checks: scope.checks } : { checks: undefined }),
      details: scope.score === null
        ? `Подтверждён результат ${scope.checkedBooks} из ${scope.expectedBooks} книг. Полное покрытие формульных граф не доказано.`
        : `По последним чтениям книг проверено ${scope.checks!.checked} из ${scope.checks!.expected} ячеек; дефектов: ${scope.checks!.failed}.`,
    }
    : component);
  return {
    ...view,
    components,
    overallScore: view.unavailableComponents.length === 0 ? weightedTrustOverall(components) : null,
  };
}

export interface TrustViewModel {
  overallScore: number | null;
  unavailableComponents: string[];
  components: TrustComponent[];
}

function roundAverage(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function weightedTrustOverall(components: TrustComponent[]): number | null {
  if (components.some(c => c.weight > 0 && (c.score === null || !Number.isFinite(c.score)))) return null;
  const assessed = components.filter((c): c is TrustComponent & { score: number } => c.score !== null && c.weight > 0);
  const totalWeight = assessed.reduce((sum, component) => sum + component.weight, 0);
  if (totalWeight <= 0) return null;

  const weighted = assessed.reduce(
    (sum, component) => sum + component.score * component.weight,
    0,
  );
  return Math.round(weighted / totalWeight);
}

export function buildTrustViewModel(
  trustData: TrustScore | null | undefined,
  filteredDepartments?: DepartmentSummary[],
): TrustViewModel {
  const globalComponents = trustData?.components ?? [];
  if (filteredDepartments === undefined) {
    return {
      overallScore: trustData?.overall ?? null,
      unavailableComponents: [],
      components: globalComponents,
    };
  }

  if (filteredDepartments.length === 0) {
    return { overallScore: null, components: [], unavailableComponents: [] };
  }

  const componentNames = [
    ...globalComponents.map((component) => component.name),
    ...filteredDepartments.flatMap((department) =>
      (department.trustComponents ?? []).map((component) => component.name),
    ),
  ].filter((name, index, names) => names.indexOf(name) === index);

  const unavailableComponents: string[] = [];
  const components = componentNames.flatMap((name): TrustComponent[] => {
    const globalComponent = globalComponents.find((component) => component.name === name);
    const matching = filteredDepartments
      .flatMap((department) => department.trustComponents ?? [])
      .filter((component) => component.name === name);

    if (matching.length !== filteredDepartments.length) {
      unavailableComponents.push(globalComponent?.label ?? matching[0]?.label ?? name);
      return [];
    }

    const base = globalComponent ?? matching[0];
    const counts = matching.flatMap(c => c.checks ? [c.checks] : []);
    const coverage = counts.length === matching.length ? summarizeCheckCoverage(counts) : null;
    return [{
      ...base,
      score: matching.some(component => component.score === null)
        ? null : coverage ? coverage.score : roundAverage(matching.map((component) => component.score!)),
      ...(coverage ? { checks: { expected: coverage.expected, checked: coverage.checked, failed: coverage.failed } } : {}),
      issues: matching.reduce((sum, component) => sum + component.issues, 0),
      criticalIssues: matching.reduce((sum, component) => sum + component.criticalIssues, 0),
      details: matching.some(component => component.score === null)
        ? `Фильтр: ${matching.length} управлений. Полнота проверки не подтверждена; оценка недоступна.`
        : coverage ? `Выполнено ${coverage.checked} из ${coverage.expected} проверок; выявлено ${coverage.failed} расхождений.`
          : `Фильтр: ${matching.length} управлений`,
    }];
  });

  return {
    overallScore: components.length > 0 && unavailableComponents.length === 0
      ? weightedTrustOverall(components) : null,
    unavailableComponents,
    components,
  };
}
