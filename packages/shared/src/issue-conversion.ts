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
  // factWithoutDate УДАЛЁН из генерации замечаний 21.08.2026 — решение
  // владельца п.137(1), дословно: «закупка в течение года — ТОЛЬКО СТАДИЯ».
  // Ключ сигнала жив и по-прежнему ложится в снимок, паспорт fact_without_date
  // остаётся в CHECK_REGISTRY для чтения старых снимков — но нового замечания,
  // дела на Дисциплине, строки в Отчёте и вычета из счёта качества по нему
  // больше нет. Дом класса — вкладка «В течение года».
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
  // 21.08: два признака ЕП, живших одними чипами Реестра (инвентаризация
  // сигналов 20.08.2026, §4 п.10). Паспорта заведены в CHECK_REGISTRY —
  // отсюда конвейер берёт их имя, строгость и рекомендацию, и замечание
  // доезжает до Контроля и Отчёта вместе с адресом строки.
  methodReasonMismatch: 'method_reason_mismatch',
  unmappedReasonEP: 'unmapped_reason_ep',
  // 07.08: факт без валидного план-квартала O — выпадает из печатного года
  // отчёта (Σ кварталов) и живёт только в корзине _orphan Пульта (блок А п.2)
  factQuarterMissing: 'fact_quarter_missing',
};

/**
 * Гасит ли класс самой строки замечание по другому её признаку.
 *
 * Дом правила один — здесь: замечания рождаются в двух местах (конвейер
 * @aemr/core orchestrator.ts и проверка источника на сервере), и подавление,
 * записанное только в одном, разъехалось бы на следующем снимке.
 *
 * Сегодня правило одно. Инициативная заявка (маркер «хотелки» в примечании
 * ГРБС, канон п.76) не получает замечания «не обеспечена финансированием» —
 * решение владельца п.137(3) от 21.08.2026, дословно: «отмечаться должны, но
 * не в риск-списки»; «хотелки как класс оставляем». Признак строки при этом
 * остаётся истинным и виден на экране: гасится претензия, а не факт. До правки
 * бейдж обещал читателю ровно это («план виден, но в риск-списки не шумит»), а
 * код обещания не исполнял — все 88 таких строк несли замечание, дело на
 * Дисциплине и строку в отчёте руководству.
 */
export function issueSuppressedByRowClass(
  signalKey: string,
  signals: Readonly<Record<string, boolean>>,
): boolean {
  return signalKey === 'planYearMissing' && signals.initiativeRequest === true;
}

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

