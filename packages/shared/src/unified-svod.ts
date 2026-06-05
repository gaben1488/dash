/**
 * Единая сетка «СВОД» — одна структура для СВОД ТД-ПМ (Q1/Год) + СВОД с месяцами
 * (мес/кв), считаемая CalcEngine из атомов. Оси: ГРБС × активность(4) × метод(КП/ЕП)
 * × период(мес/кв/год) × {кол-во, план, факт, экономия по ФБ/КБ/МБ}.
 *
 * Spec: docs/UNIFIED_SVOD_DESIGN.md.
 */
import type { ActivityScope } from './activity-scope.js';

export type SvodMethod = 'kp' | 'ep';
export const SVOD_METHODS: readonly SvodMethod[] = ['kp', 'ep'] as const;

/** Ключ периода: `m1`..`m12` (месяц), `q1`..`q4` (квартал), `year` (год). */
export type SvodPeriodKey = `m${number}` | `q${number}` | 'year';

export const SVOD_MONTH_KEYS: readonly SvodPeriodKey[] =
  Array.from({ length: 12 }, (_, i) => `m${i + 1}` as SvodPeriodKey);
export const SVOD_QUARTER_KEYS: readonly SvodPeriodKey[] = ['q1', 'q2', 'q3', 'q4'];
export const SVOD_ALL_PERIOD_KEYS: readonly SvodPeriodKey[] = [
  ...SVOD_MONTH_KEYS, ...SVOD_QUARTER_KEYS, 'year',
];

/** Квартал → месяцы. */
export const QUARTER_TO_MONTHS: Record<number, number[]> = {
  1: [1, 2, 3], 2: [4, 5, 6], 3: [7, 8, 9], 4: [10, 11, 12],
};

/** Числа одной ячейки: кол-во план/факт + суммы ФБ/КБ/МБ план/факт/экономия (тыс. руб.). */
export interface UnifiedCell {
  planCount: number;
  factCount: number;
  planFB: number;
  planKB: number;
  planMB: number;
  factFB: number;
  factKB: number;
  factMB: number;
  economyFB: number;
  economyKB: number;
  economyMB: number;
}

export function emptyCell(): UnifiedCell {
  return {
    planCount: 0, factCount: 0,
    planFB: 0, planKB: 0, planMB: 0,
    factFB: 0, factKB: 0, factMB: 0,
    economyFB: 0, economyKB: 0, economyMB: 0,
  };
}

/** Плоский ключ ячейки сетки. */
export function unifiedKey(
  grbsId: string,
  scope: ActivityScope,
  method: SvodMethod,
  period: SvodPeriodKey,
): string {
  return `${grbsId}|${scope}|${method}|${period}`;
}

/** Единая сетка — плоская карта ключ→ячейка + оси для итерации. */
export interface UnifiedGrid {
  /** `${grbsId}|${scope}|${method}|${period}` → UnifiedCell */
  cells: Record<string, UnifiedCell>;
  grbsIds: string[];
  scopes: ActivityScope[];
}

/** Производные одной ячейки (для UI): итоги + проценты. */
export interface UnifiedDerived {
  planTotal: number;
  factTotal: number;
  economyTotal: number;
  /** Исполнение по штукам = факт/план кол-во (0..1) */
  execCountPct: number | null;
  /** Потрачено = факт-сумма/план-сумма (0..1) */
  spentPct: number | null;
  deviationCount: number;
  amountDeviation: number;
}

export function deriveCell(c: UnifiedCell): UnifiedDerived {
  const planTotal = c.planFB + c.planKB + c.planMB;
  const factTotal = c.factFB + c.factKB + c.factMB;
  const economyTotal = c.economyFB + c.economyKB + c.economyMB;
  return {
    planTotal,
    factTotal,
    economyTotal,
    execCountPct: c.planCount !== 0 ? c.factCount / c.planCount : null,
    spentPct: planTotal !== 0 ? factTotal / planTotal : null,
    deviationCount: c.factCount - c.planCount,
    amountDeviation: factTotal - planTotal,
  };
}
