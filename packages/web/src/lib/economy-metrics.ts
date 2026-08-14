// ── Утверждённая экономия за выбранный период: один обход для всех
//    потребителей (карточка «Обзора», итог страницы, слой mdm).
//
//    Экономия здесь — только AD-подтверждённая (Z+AA+AB при флаге «да»),
//    никогда не «план − факт»: последнее считает неосвоенный лимит, а не
//    экономию (METRICS_CONTRACT.md, строки 10-11 и 47).

const QUARTER_KEYS = ['q1', 'q2', 'q3', 'q4'] as const;

export interface EconomyMetricSource {
  economyTotal?: number | null;
  economyFB?: number | null;
  economyKB?: number | null;
  economyMB?: number | null;
}

export interface EconomyDepartmentSource extends EconomyMetricSource {
  quarters?: Partial<Record<string, EconomyMetricSource | null>>;
  /** Помесячная разбивка (1..12) — нужна месячной ветви (баг #10). */
  months?: Partial<Record<number | string, EconomyMetricSource | null>>;
  /** Короткое имя управления — нужно, чтобы честно назвать пропущенные. */
  dept?: string;
}

export interface EconomyTotalInput {
  depts: EconomyDepartmentSource[];
  periodKey?: string;
  coveredQuarters?: string[];
  /**
   * Месячная ветвь (баг #10 реестра охоты 08.08): экономия за выбранный месяц
   * считалась за весь покрытый квартал. Частично выбранные кварталы должны
   * идти month-level — тем же правилом, что aggregateNodeTotals (смешанная
   * агрегация: полные кварталы quarter-level + частичные месяцы month-level).
   */
  fullQuarters?: string[];
  partialMonths?: number[];
  /** Есть ли в датасете помесячные данные — без них резолюция падает на кварталы. */
  hasMonthData?: boolean;
  selectedBudgets?: Set<string>;
}

/** Разбор итога: сколько сложено, откуда и что в итог не попало. */
export interface EconomyTotalBreakdown {
  /** Итог, который выводится на экран. */
  total: number;
  /** Часть итога, сложенная из квартальных строк. */
  fromQuarters: number;
  /** Часть, взятая с уровня управления (у него нет квартальной разбивки). */
  fromDeptLevel: number;
  /**
   * Управления, чья экономия в итог не вошла: квартальной разбивки нет, а
   * период уже сужен, и годовое число подставить нельзя — оно относится к
   * другому отрезку времени. Пустой массив = итог полон.
   */
  missingDepts: string[];
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

/**
 * Итог с разбором происхождения.
 *
 * Решение принимается ПО КАЖДОМУ управлению отдельно. Раньше флаг «нашлись
 * квартальные данные» был общим на весь обход: стоило одному управлению
 * иметь разбивку по кварталам, как все остальные молча давали ноль — итог
 * страницы оказывался меньше суммы карточек, и объяснить разницу было нечем.
 *
 * Управление без квартальной разбивки попадает в итог только когда выбран
 * весь год: тогда годовое число и есть число за период. При суженном
 * периоде подставить годовое нельзя — это было бы приписанное число, — и
 * управление называется в `missingDepts`, чтобы экран сказал о пропуске
 * вслух, а не сделал вид, что экономии не было.
 */
export function getEconomyTotalBreakdown(input: EconomyTotalInput): EconomyTotalBreakdown {
  const quarterKeys = selectedQuarterKeys(input);
  const wholeYearSelected = quarterKeys.length === QUARTER_KEYS.length;
  // Месячная ветвь активна тем же условием, что смешанная агрегация в
  // aggregateNodeTotals (баг #10): месяцы выбраны частично И month-данные есть.
  // Иначе экономия месяца бралась за весь квартал, и на одном экране тоталы
  // сужались месяцем, а экономия — нет (интервью, кластер А).
  const partialMonths = input.hasMonthData ? (input.partialMonths ?? []) : [];
  const fullQuarters = input.fullQuarters ?? [];
  const useMixed = partialMonths.length > 0;

  let fromQuarters = 0;
  let fromDeptLevel = 0;
  const missingDepts: string[] = [];

  input.depts.forEach((dept, index) => {
    let deptHasQuarterData = false;
    let deptSum = 0;

    if (useMixed) {
      // Полные кварталы quarter-level + частичные месяцы month-level —
      // ровно периметр aggregateNodeTotals для того же выбора.
      for (const mi of partialMonths) {
        const month = dept?.months?.[mi];
        if (!month) continue;
        deptHasQuarterData = true;
        deptSum += selectedEconomy(month, input.selectedBudgets);
      }
      for (const qk of fullQuarters) {
        const quarter = dept?.quarters?.[qk];
        if (!quarter) continue;
        deptHasQuarterData = true;
        deptSum += selectedEconomy(quarter, input.selectedBudgets);
      }
      if (deptHasQuarterData) {
        fromQuarters += deptSum;
        return;
      }
      // Периодной базы под выбранные месяцы нет: годовое число подставить
      // нельзя (другой отрезок времени) — честно называем пропуск.
      if (selectedEconomy(dept, input.selectedBudgets) !== 0) {
        missingDepts.push(dept?.dept ?? `управление ${index + 1}`);
      }
      return;
    }

    for (const qk of quarterKeys) {
      const quarter = dept?.quarters?.[qk];
      if (!quarter) continue;
      deptHasQuarterData = true;
      deptSum += selectedEconomy(quarter, input.selectedBudgets);
    }

    if (deptHasQuarterData) {
      fromQuarters += deptSum;
      return;
    }

    if (wholeYearSelected) {
      fromDeptLevel += selectedEconomy(dept, input.selectedBudgets);
      return;
    }

    // Экономия у управления есть, но отнести её к выбранному отрезку нечем.
    if (selectedEconomy(dept, input.selectedBudgets) !== 0) {
      missingDepts.push(dept?.dept ?? `управление ${index + 1}`);
    }
  });

  return {
    total: fromQuarters + fromDeptLevel,
    fromQuarters,
    fromDeptLevel,
    missingDepts,
  };
}

/** Итог одним числом — для потребителей, которым разбор не нужен. */
export function getFilteredEconomyTotal(input: EconomyTotalInput): number {
  return getEconomyTotalBreakdown(input).total;
}
