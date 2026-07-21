// ── Помесячная сверка (лист «СВОД с месяцами»): рендер-классы ячеек по статусу,
//    подпись no_calc, сбор бюджетных расхождений (ФБ/КБ/МБ).
//    Извлечено move-only из pages/Recon.tsx (разрез E11-4).
//
//    ФИКС «враньё класса»: статус 'no_calc' существует в DTO (@aemr/core
//    reconcile.ts:272,459 — «расчётный слой за срез не построен»), но раньше
//    не был известен локальному типу и падал в дефолтный (пустой) стиль,
//    неотличимый от обычной ячейки. Теперь у него честный нейтральный стиль
//    и подпись «расчёт не построен».

import clsx from 'clsx';
import type { ReconBudget, ReconCell } from './types';

/** Короткие имена месяцев, индекс = номер месяца (1-12); [0] — заглушка */
export const MONTH_NAMES_SHORT = ['', 'Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];

/** Подпись для ячеек со статусом no_calc */
export const NO_CALC_NOTE = 'расчёт не построен';

/** CSS-класс td-ячейки таблицы помесячной сверки по статусу */
export function monthlyCellClass(cell: ReconCell | undefined): string {
  return clsx(
    'px-2 py-2 text-right tabular-nums',
    cell?.status === 'ok' && 'text-emerald-600 dark:text-emerald-400',
    cell?.status === 'warning' && 'text-amber-600 dark:text-amber-400 bg-amber-50/50 dark:bg-amber-950/20',
    cell?.status === 'high' && 'text-red-600 dark:text-red-400 bg-red-50/50 dark:bg-red-950/20',
    cell?.status === 'empty' && 'text-zinc-300 dark:text-zinc-600',
    // no_calc: нейтрально-приглушённый курсив — «сравнение неприменимо», не ошибка
    cell?.status === 'no_calc' && 'text-zinc-400 dark:text-zinc-500 italic',
  );
}

/** title-подсказка ячейки: для no_calc — честная подпись, иначе undefined */
export function monthlyCellTitle(cell: ReconCell | undefined): string | undefined {
  return cell?.status === 'no_calc' ? NO_CALC_NOTE : undefined;
}

/** CSS-класс значения Δ в развёрнутых money-строках */
export function monthlyDeltaClass(cell: ReconCell | undefined): string {
  return clsx(
    'font-semibold tabular-nums',
    cell?.status === 'ok' && 'text-emerald-600 dark:text-emerald-400',
    cell?.status === 'warning' && 'text-amber-600 dark:text-amber-400',
    cell?.status === 'high' && 'text-red-600 dark:text-red-400',
    // no_calc — тот же нейтральный, что и empty (раньше выпадал вовсе без цвета)
    (!cell || cell?.status === 'empty' || cell?.status === 'no_calc') && 'text-zinc-400 dark:text-zinc-500',
  );
}

/** Русская подпись достоверности root-cause */
export function confidenceLabel(confidence: 'low' | 'medium' | 'high'): string {
  return confidence === 'high' ? 'высокая' : confidence === 'medium' ? 'средняя' : 'низкая';
}

/**
 * Сбор проблемных ячеек бюджетной разбивки (ФБ/КБ/МБ) КП+ЕП:
 * возвращаются только ячейки со статусом warning|high, с человекочитаемой меткой.
 * Пустой результат = разбивка сходится.
 */
export function collectBudgetDiscrepancies(
  compBudget: ReconBudget | undefined,
  epBudget: ReconBudget | undefined,
): Array<[string, ReconCell]> {
  const budgetRows: Array<[string, ReconCell]> = [];
  const collect = (tag: string, b: ReconBudget | undefined) => {
    if (!b) return;
    const defs: Array<[string, string]> = [
      ['план ФБ', 'planFB'], ['план КБ', 'planKB'], ['план МБ', 'planMB'],
      ['факт ФБ', 'factFB'], ['факт КБ', 'factKB'], ['факт МБ', 'factMB'],
      ['эконом. ФБ', 'economyFB'], ['эконом. КБ', 'economyKB'], ['эконом. МБ', 'economyMB'],
    ];
    for (const [lab, fk] of defs) {
      const c = b[fk];
      if (c && (c.status === 'warning' || c.status === 'high')) budgetRows.push([`${tag} ${lab}`, c]);
    }
  };
  collect('КП', compBudget);
  collect('ЕП', epBudget);
  return budgetRows;
}
