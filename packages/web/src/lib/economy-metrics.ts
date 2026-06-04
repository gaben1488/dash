const QUARTER_KEYS = ['q1', 'q2', 'q3', 'q4'] as const;

export interface EconomyMetricSource {
  economyTotal?: number | null;
  economyFB?: number | null;
  economyKB?: number | null;
  economyMB?: number | null;
}

export interface EconomyDepartmentSource extends EconomyMetricSource {
  quarters?: Partial<Record<string, EconomyMetricSource | null>>;
}

export interface EconomyTotalInput {
  depts: EconomyDepartmentSource[];
  periodKey?: string;
  coveredQuarters?: string[];
  selectedBudgets?: Set<string>;
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function selectedEconomy(src: EconomyMetricSource | null | undefined, selectedBudgets?: Set<string>): number {
  if (!src) return 0;
  if (!selectedBudgets || selectedBudgets.size === 0) return asNumber(src.economyTotal);

  let total = 0;
  let sawBudgetField = false;

  if (selectedBudgets.has('fb') && typeof src.economyFB === 'number') {
    total += asNumber(src.economyFB);
    sawBudgetField = true;
  }
  if (selectedBudgets.has('kb') && typeof src.economyKB === 'number') {
    total += asNumber(src.economyKB);
    sawBudgetField = true;
  }
  if (selectedBudgets.has('mb') && typeof src.economyMB === 'number') {
    total += asNumber(src.economyMB);
    sawBudgetField = true;
  }

  return sawBudgetField ? total : asNumber(src.economyTotal);
}

function selectedQuarterKeys(input: EconomyTotalInput): string[] {
  const covered = Array.isArray(input.coveredQuarters)
    ? input.coveredQuarters.filter(q => (QUARTER_KEYS as readonly string[]).includes(q))
    : [];
  if (covered.length > 0) return covered;
  if (input.periodKey && input.periodKey !== 'year') return [input.periodKey];
  return [...QUARTER_KEYS];
}

export function getFilteredEconomyTotal(input: EconomyTotalInput): number {
  const quarterKeys = selectedQuarterKeys(input);
  let fromQuarters = 0;
  let sawQuarterData = false;

  for (const dept of input.depts) {
    for (const qk of quarterKeys) {
      const quarter = dept?.quarters?.[qk];
      if (!quarter) continue;
      sawQuarterData = true;
      fromQuarters += selectedEconomy(quarter, input.selectedBudgets);
    }
  }

  if (sawQuarterData) return fromQuarters;

  return input.depts.reduce(
    (sum, dept) => sum + selectedEconomy(dept, input.selectedBudgets),
    0,
  );
}
