import { QUARTER_MONTHS, type PeriodScope } from '../../store';

/**
 * Резолюция эффективного периода из legacy-полей store (`period` + `activeMonths`).
 *
 * Извлечено move-only из useFilteredData.ts §6 «Period / month resolution»
 * (бывшие строки 251–283, разрез E11-1).
 *
 * ВНИМАНИЕ (спека filter-system-target-2026-07-16 §3.4): сама механика
 * «periodKey из четырёх полей store» помечена на смерть — при переходе на
 * FilterContext.period (discriminated union PeriodSel, §3.3) этот резолвер
 * заменяется единственной период-осью. До той резки — переходная чистая форма.
 */
export interface PeriodResolution {
  /** Эффективный ключ периода для доступа к quarters{} / summaryByPeriod{} */
  periodKey: PeriodScope;
  /** Кварталы, затронутые выбранными месяцами (полностью или частично) */
  coveredQuarters: string[];
  /** Кварталы, где выбраны все 3 месяца (агрегировать quarter-level — точнее) */
  fullQuarters: string[];
  /** Месяцы частично выбранных кварталов (суммировать month-level) */
  partialMonths: number[];
  /** Использовать month-level данные (месяцы выбраны И month-данные есть) */
  useMonthLevel: boolean;
  hasActiveMonths: boolean;
}

export function resolvePeriodSelection(
  period: PeriodScope,
  activeMonths: Set<number>,
  hasMonthData: boolean,
): PeriodResolution {
  const hasActiveMonths = activeMonths.size > 0;

  let periodKey = period; // 'year' | 'q1' | 'q2' | 'q3' | 'q4'
  const coveredQuarters: string[] = [];
  const fullQuarters: string[] = [];
  const partialMonths: number[] = [];
  const useMonthLevel = hasActiveMonths && hasMonthData;

  if (hasActiveMonths) {
    for (const [qKey, months] of Object.entries(QUARTER_MONTHS)) {
      const selectedInQ = months.filter((m: number) => activeMonths.has(m));
      if (selectedInQ.length > 0) {
        coveredQuarters.push(qKey);
        if (selectedInQ.length === 3) {
          // All 3 months of this quarter selected → use quarter-level data
          fullQuarters.push(qKey);
        } else {
          // Only some months selected → sum month-level data for those months
          partialMonths.push(...selectedInQ);
        }
      }
    }
    if (coveredQuarters.length === 1) {
      periodKey = coveredQuarters[0] as PeriodScope;
    }
  }

  return { periodKey, coveredQuarters, fullQuarters, partialMonths, useMonthLevel, hasActiveMonths };
}

/**
 * Ключи периодов для агрегации: покрытые кварталы, если выбраны месяцы,
 * иначе одиночный periodKey. Выражение повторялось в useFilteredData
 * в §9b/§9c/§10 дословно — вынесено в одну точку.
 */
export function activePeriodKeys(
  r: Pick<PeriodResolution, 'hasActiveMonths' | 'coveredQuarters' | 'periodKey'>,
): string[] {
  return r.hasActiveMonths && r.coveredQuarters.length > 0 ? r.coveredQuarters : [r.periodKey];
}
