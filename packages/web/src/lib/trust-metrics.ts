import type { DepartmentSummary, TrustComponent, TrustScore } from '@aemr/shared';

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
    return [{
      ...base,
      score: matching.some(component => component.score === null)
        ? null : roundAverage(matching.map((component) => component.score!)),
      issues: matching.reduce((sum, component) => sum + component.issues, 0),
      criticalIssues: matching.reduce((sum, component) => sum + component.criticalIssues, 0),
      details: `Фильтр: ${matching.length} управлений`,
    }];
  });

  return {
    overallScore: components.length > 0 && unavailableComponents.length === 0
      ? weightedTrustOverall(components) : null,
    unavailableComponents,
    components,
  };
}
