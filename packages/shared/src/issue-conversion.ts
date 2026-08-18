/**
 * issue-conversion.ts — словари соответствия legacy-сигналов/правил новым
 * check ID (вынесено из unified-class-system.ts, чанк G, шаг 2).
 *
 * Конвертеры convertLegacyIssue/convertAllIssues удалены 14.08.2026:
 * вызовов не было нигде, а замороженный дефолт year=2026 при оживлении
 * в следующем году молча проставил бы всем issue прошлый год.
 * Словари живые: orchestrator.ts, validate.ts, source-validation.ts.
 */

export const LEGACY_SIGNAL_TO_CHECK: Record<string, string> = {
  // Сигналы из SIGNAL_ISSUE_MAP
  overdue: 'overdue',
  stalledContract: 'stalled_contract',
  factExceedsPlan: 'fact_vs_plan',
  // 18.08: расхождение факт/план по ЕП (канон п.98м + п.102) — отдельная
  // проверка, не fact_vs_plan: по ЕП план обязан равняться факту, и «экономия»
  // (факт < план) там тоже расхождение, а не норма торгов.
  epFactDeviation: 'ep_fact_deviation',
  earlyClosure: 'early_closure',
  highEconomy: 'anti_dumping',
  epRisk: 'ep_risk',
  // budgetMismatch: УДАЛЁН — дубль Rule 1a (budget_sum_plan). Signal всегда false.
  economyConflict: 'economy_conflict',
  factWithoutDate: 'fact_without_date',
  dateWithoutFact: 'date_without_fact',
  dataQuality: 'data_quality',
  // singleParticipant УДАЛЁН из Issue-генерации — ненадёжная текстовая детекция, только badge
  factDateBeforePlan: 'fact_date_before_plan',
  futureFactDate: 'future_fact_date',
  financeDelay: 'finance_delay',
  // Дополнительные сигналы (без Issue, только badge)
  // lowCompetition УДАЛЁН из Issue-генерации — <2% экономия не является надёжным индикатором
  formulaBroken: 'formula_broken',
  // P1: Новые сигналы (аудит 2026-04-13)
  planWithoutExecution: 'plan_without_execution',
  epJustificationMissing: 'ep_justification_missing',
  budgetUnderallocation: 'budget_underallocation',
  budgetSourceMissing: 'budget_source_missing',
  // tdWithProgram УДАЛЁН каноном п.30 (14.08.2026): заполненная графа
  // программы у ТД — норма; сигнал всегда false, Issue из него не рождается.
  // 06.08: счётная строка без года плана — невидима для SUMIFS листа СВОД (сверка лимита УЭР)
  planYearMissing: 'plan_year_missing',
  derivedFormulaBroken: 'derived_formula_broken',
  // 07.08: факт без валидного план-квартала O — выпадает из печатного года
  // отчёта (Σ кварталов) и живёт только в корзине _orphan Пульта (блок А п.2)
  factQuarterMissing: 'fact_quarter_missing',
};

/**
 * Маппинг старых rule ID → новые check ID.
 */
export const LEGACY_RULE_TO_CHECK: Record<string, string> = {
  budget_sum_plan: 'budget_sum_plan',
  budget_sum_fact: 'budget_sum_fact',
  execution_percentage: 'execution_percentage',
  deviation_calc: 'deviation_calc',
  q1_leq_year: 'q1_leq_year',
  fact_leq_plan: 'fact_vs_plan',          // ОБЪЕДИНЁН
  method_validation: 'method_validation',
  type_validation: 'type_validation',
  status_on_data_rows: 'status_on_data_rows',
  economy_sign_check: 'economy_sign_check',
  dept_fact_sum: 'dept_fact_sum',
  dept_economy_sum: 'dept_economy_sum',
  dept_fact_leq_plan: 'fact_vs_plan',     // ОБЪЕДИНЁН
  // formula_continuity УДАЛЁН — дублирует budget_sum_plan + dept_fact_sum
};

