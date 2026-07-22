// ── Бюджет-фильтр страницы «Экономия»: выбор компонент ФБ/КБ/МБ.
//    Отличие от lib/economy-metrics.selectedEconomy (канон KPI): здесь фильтр
//    применяется к ЛЮБОЙ тройке (план/факт/экономия), а при пустом выборе
//    берётся официальный total с фолбэком — семантика таблицы, не карточки.

/** Развёрнутое состояние фильтра бюджетов (selectedBudgets из store). */
export interface BudgetSelection {
  /** Фильтр активен (выбран хотя бы один бюджет). */
  filtered: boolean;
  fb: boolean;
  kb: boolean;
  mb: boolean;
}

/** Пустой выбор = фильтра нет = включены все три бюджета. */
export function budgetSelection(selected: ReadonlySet<string>): BudgetSelection {
  const filtered = selected.size > 0;
  return {
    filtered,
    fb: !filtered || selected.has('fb'),
    kb: !filtered || selected.has('kb'),
    mb: !filtered || selected.has('mb'),
  };
}

/** Сумма выбранных компонент тройки ФБ/КБ/МБ. */
export function sumSelected(sel: BudgetSelection, fb: number, kb: number, mb: number): number {
  return (sel.fb ? fb : 0) + (sel.kb ? kb : 0) + (sel.mb ? mb : 0);
}

/**
 * Итог с учётом фильтра: при активном фильтре — сумма выбранных компонент,
 * иначе официальный total (компоненты могут не сходиться с ним копейка в
 * копейку — официальная колонка первична, METRICS_CONTRACT).
 */
export function selectTotal(
  sel: BudgetSelection,
  fb: number,
  kb: number,
  mb: number,
  official: number,
): number {
  return sel.filtered ? sumSelected(sel, fb, kb, mb) : official;
}
