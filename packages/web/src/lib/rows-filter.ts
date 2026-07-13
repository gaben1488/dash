export interface BudgetRow {
  planFB: number; planKB: number; planMB: number;
  factFB: number; factKB: number; factMB: number;
}

/** Строка проходит, если у неё есть план ИЛИ факт хотя бы в одном из выбранных бюджетов.
 *  Пустой набор = без фильтра. Значения набора — из store BudgetType ('fb' | 'kb' | 'mb'). */
export function filterRowsByBudgets<T extends BudgetRow>(rows: T[], budgets: Set<string>): T[] {
  if (budgets.size === 0) return rows;
  return rows.filter(r =>
    (budgets.has('fb') && (r.planFB > 0 || r.factFB > 0)) ||
    (budgets.has('kb') && (r.planKB > 0 || r.factKB > 0)) ||
    (budgets.has('mb') && (r.planMB > 0 || r.factMB > 0)),
  );
}
