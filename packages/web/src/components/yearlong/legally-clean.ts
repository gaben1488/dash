/**
 * legally-clean.ts — вычет «выплат физлицам» и «платежей без договора» из
 * счёта ЕП для тумблера «как в листе ↔ без выплат и платежей» (канон п.82).
 *
 * Слова владельца: «иметь возможность включать и выключать их, чтобы было и
 * как правильно, и как считает свод — убьём двух зайцев». Исключаются строки
 * стадии «в течение года» подклассов выплат и платежей (п.81) — там договора
 * не будет по природе статьи, и в «юридически чистой» доле ЕП они шум.
 *
 * Источник исключения — разметка стадии: стартовые 46 строк (@aemr/shared,
 * анализ 14.08.2026) плюс оверрайды владельца. Отнесение к периоду — тем же
 * правилом смешанной агрегации, что sumEpKp (полные кварталы — кварталом,
 * частичные месяцы — месяцем): вычет обязан жить в том же периметре, что и
 * уменьшаемое. Деньги плана/факта в ОБЩИХ итогах тумблер не трогает (п.82).
 */
import {
  YEARLONG_START_ROWS,
  resolveYearlongKind,
  yearlongSubclassForKind,
  isExcludedFromLegallyClean,
  type YearlongKindId,
} from '@aemr/shared';
import { toCanonicalDeptId } from '../../lib/dept-key';
import type { PeriodSel } from '../competition/primitives';

/** Вычет из счёта ЕП: сколько строк и плановых денег исключает чистый режим. */
export interface ExcludedEpTotals {
  count: number;
  /** Плановые деньги исключаемых строк, тыс. руб. */
  plan: number;
}

/**
 * Считает вычет по периметру: управления (любая форма ключа) + период в
 * терминах PeriodSel. Оверрайды видов меняют подкласс строки — переразметка
 * владельцем строки в «серию договоров» выводит её из вычета.
 */
export function excludedEpTotals(
  deptIds: readonly string[],
  sel: PeriodSel,
  overrides?: ReadonlyMap<string, YearlongKindId> | null,
): ExcludedEpTotals {
  const deptSet = new Set(deptIds.map(toCanonicalDeptId));

  // Периметр периода — зеркало sumEpKp (см. primitives.tsx).
  let quarterKeys: string[];
  let monthKeys: number[] = [];
  if (!sel.hasActiveMonths) {
    quarterKeys = sel.periodKey === 'year' ? ['year'] : [sel.periodKey];
  } else if (sel.useMonthLevel) {
    quarterKeys = sel.fullQuarters;
    monthKeys = sel.partialMonths;
  } else {
    quarterKeys = sel.coveredQuarters;
  }
  const wholeYear = quarterKeys.includes('year');

  const out: ExcludedEpTotals = { count: 0, plan: 0 };
  for (const row of YEARLONG_START_ROWS) {
    if (!deptSet.has(row.dept)) continue;
    const kind = resolveYearlongKind(row.dept, row.ppNum, overrides);
    const subclass = yearlongSubclassForKind(kind);
    if (!subclass || !isExcludedFromLegallyClean(subclass)) continue;
    const inPeriod = wholeYear
      || quarterKeys.includes(`q${row.planQuarter}`)
      || monthKeys.includes(row.planMonth);
    if (!inPeriod) continue;
    out.count += 1;
    out.plan += row.planSum;
  }
  return out;
}

/** Вычет одного квартала — для строк динамики по кварталам. */
export function excludedEpTotalsQuarter(
  deptIds: readonly string[],
  qk: string,
  overrides?: ReadonlyMap<string, YearlongKindId> | null,
): ExcludedEpTotals {
  return excludedEpTotals(deptIds, {
    periodKey: qk,
    hasActiveMonths: false,
    coveredQuarters: [],
    fullQuarters: [],
    partialMonths: [],
    useMonthLevel: false,
  }, overrides);
}
