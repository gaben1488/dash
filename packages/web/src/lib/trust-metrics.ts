import type { DepartmentSummary, TrustComponent, TrustScore } from '@aemr/shared';

export interface TrustViewModel {
  overallScore: number;
  components: TrustComponent[];
}

function roundAverage(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function weightedTrustOverall(components: TrustComponent[]): number {
  const totalWeight = components.reduce((sum, component) => sum + component.weight, 0);
  if (totalWeight <= 0) return 0;

  const weighted = components.reduce(
    (sum, component) => sum + component.score * component.weight,
    0,
  );
  return Math.round(weighted / totalWeight);
}

export function buildTrustViewModel(
  trustData: TrustScore | null | undefined,
  filteredDepartments: DepartmentSummary[] = [],
): TrustViewModel {
  const globalComponents = trustData?.components ?? [];
  if (filteredDepartments.length === 0) {
    return {
      overallScore: trustData?.overall ?? 0,
      components: globalComponents,
    };
  }

  const componentNames = [
    ...globalComponents.map((component) => component.name),
    ...filteredDepartments.flatMap((department) =>
      (department.trustComponents ?? []).map((component) => component.name),
    ),
  ].filter((name, index, names) => names.indexOf(name) === index);

  const components = componentNames.map((name): TrustComponent => {
    const globalComponent = globalComponents.find((component) => component.name === name);
    const matching = filteredDepartments
      .flatMap((department) => department.trustComponents ?? [])
      .filter((component) => component.name === name);

    if (matching.length === 0) {
      return globalComponent ?? {
        name,
        label: name,
        weight: 0,
        score: 0,
        issues: 0,
        criticalIssues: 0,
        details: 'Нет данных по выбранному фильтру',
      };
    }

    const base = globalComponent ?? matching[0];
    return {
      ...base,
      score: roundAverage(matching.map((component) => component.score)),
      issues: matching.reduce((sum, component) => sum + component.issues, 0),
      criticalIssues: matching.reduce((sum, component) => sum + component.criticalIssues, 0),
      details: `Фильтр: ${matching.length} управлений`,
    };
  });

  return {
    overallScore: weightedTrustOverall(components),
    components,
  };
}
