import type { KBEntry } from '../components/ui/kb-tooltip';

// ────────────────────────────────────────────────────────────────
// STANDARD_METRICS — Единый реестр метрик АЕМР
//
// Для каждой метрики: формула, источник, ячейка СВОД, пороги, закон.
// Используется KBTooltip для hover-подсказок на КАЖДОМ элементе UI.
// ────────────────────────────────────────────────────────────────

export const STANDARD_METRICS: Record<string, KBEntry> = {
  // ─── Hero KPI ───
  exec_count_pct: {
    description: 'Исполнение закупок — по кол-ву (главный) + по сумме (вторичный)',
    formula: 'Кол-во: fact_count / plan_count × 100\nСумма: fact_total / plan_total × 100',
    source: 'CalcEngine → totals.exec_count_pct + totals.execution_pct',
    cell: 'СВОД ТД-ПМ!G14 (кол-во), СВОД!G9+G21 (сумма)',
    thresholds: '≥90% зелёный, 70–89% синий, 50–69% жёлтый, <50% красный',
    law: '44-ФЗ ст.72 — планирование закупок',
  },
  execution_pct: {
    description: 'Исполнение по сумме (₽)',
    formula: 'fact_total / plan_total × 100',
    source: 'CalcEngine → totals.execution_pct',
    cell: 'СВОД!G9 (КП) + СВОД!G21 (ЕП)',
    thresholds: '≥90% зелёный, 70–89% синий, 50–69% жёлтый, <50% красный',
    law: '44-ФЗ ст.72',
  },
  critical_issues: {
    description: 'Количество критических замечаний',
    formula: 'count(issues WHERE severity = critical)',
    source: 'snapshot.issues → filter severity',
    thresholds: '0 зелёный, 1–3 жёлтый, >3 красный',
  },
  economy_rate: {
    description: 'Средняя экономия от лимита',
    formula: '(plan_total − fact_total) / plan_total × 100',
    source: 'CalcEngine → totals.savings_pct',
    cell: 'СВОД!столбец P (лимит) − столбец Y (факт)',
    thresholds: '0–10% нормально, 10–25% внимание, >25% подозрительно',
    law: '44-ФЗ ст.22 — начальная цена',
  },
  trust_binary: {
    description: 'Можно ли доверять данным (бинарный)',
    formula: 'trust_score ≥ 75 → "✓ Можно доверять", иначе "✗ Расхождения"',
    source: 'TrustScorer → overall_score',
    thresholds: '≥75 = доверие, <75 = расхождения',
  },

  // ─── RatingTable columns ───
  dept_exec_count_pct: {
    description: 'Исполнение по кол-ву для управления',
    formula: 'dept.factCount / dept.planCount × 100',
    source: 'CalcEngine → byDept[id].exec_count_pct',
    thresholds: '≥90% зелёный, 70–89% синий, 50–69% жёлтый, <50% красный',
  },
  dept_exec_amount_pct: {
    description: 'Исполнение по сумме для управления',
    formula: 'dept.factTotal / dept.planTotal × 100',
    source: 'CalcEngine → byDept[id].execution_pct',
    thresholds: '≥90% зелёный, 70–89% синий, 50–69% жёлтый, <50% красный',
  },
  dept_fb_pct: {
    description: 'Исполнение по ФБ (федеральный бюджет)',
    formula: 'dept.factFB / dept.planFB × 100',
    source: 'CalcEngine → byDept[id].fb_execution_pct',
    cell: 'СВОД!столбцы H,I (план ФБ) / столбцы U,V (факт ФБ)',
    thresholds: '≥90% зелёный, <50% красный',
    law: '44-ФЗ — федеральный бюджет = приоритет контроля',
  },
  dept_trust: {
    description: 'Уровень доверия к данным управления',
    formula: 'TrustScorer(dept) → A/B/C/D/F',
    source: 'TrustScorer → byDept[id].score',
    thresholds: 'A(≥90) зелёный, B(75–89) синий, C(60–74) жёлтый, D(40–59) оранжевый, F(<40) красный',
  },
  dept_issues: {
    description: 'Количество замечаний по управлению',
    formula: 'count(issues WHERE dept = id)',
    source: 'snapshot.issues → group by dept',
  },

  // ─── Economy ───
  total_economy: {
    description: 'Общая экономия (сумма)',
    formula: 'Σ(plan_limit − fact_price) WHERE fact > 0',
    source: 'CalcEngine → totals.economy_total',
    cell: 'СВОД!P − СВОД!Y (агрегат)',
    law: '44-ФЗ ст.22',
  },
  avg_reduction_pct: {
    description: 'Средний процент снижения от лимита',
    formula: 'avg((limit − price) / limit × 100)',
    source: 'CalcEngine → totals.avg_reduction',
    thresholds: '0–10% нормально, >25% подозрительно',
  },
  high_economy_count: {
    description: 'Закупки с экономией > 25%',
    formula: 'count(rows WHERE (limit − price) / limit > 0.25)',
    source: 'signals.highEconomy count',
    thresholds: '0 зелёный, >5 жёлтый, >10 красный',
    law: '44-ФЗ — обоснование начальной цены',
  },
  economy_conflicts: {
    description: 'Конфликты флага экономии',
    formula: 'count(rows WHERE economyConflict signal)',
    source: 'signals.economyConflict count',
    thresholds: '0 зелёный, >0 красный',
  },

  // ─── Charts ───
  plan_fact_quarterly: {
    description: 'План/Факт по кварталам',
    formula: 'КП_plan + ЕП_plan (stacked) vs fact line',
    source: 'CalcEngine → summaryByPeriod[q1..q4]',
    cell: 'СВОД!G строки кварталов',
  },
  execution_by_dept: {
    description: 'Исполнение по управлениям',
    formula: 'dept.factTotal / dept.planTotal × 100 (bar) + exec_count_pct (line)',
    source: 'CalcEngine → barData',
  },
  pie_procurement: {
    description: 'Распределение по способу закупки',
    formula: 'count КП vs count ЕП',
    source: 'CalcEngine → totalKP, totalEP',
  },
  pie_budget: {
    description: 'Распределение по бюджетам',
    formula: 'planFB + planKB + planMB',
    source: 'CalcEngine → depts[].quarters[].planFB/KB/MB',
    law: '44-ФЗ — бюджетная классификация',
  },

  // ─── Blind spots / Signals ───
  signal_overdue: {
    description: 'Просрочка: план-дата прошла, факт отсутствует',
    formula: 'planDate < today AND factDate = null AND factSum = 0',
    source: 'signals.overdue',
    thresholds: '0 зелёный, >0 красный',
    law: '44-ФЗ ст.21 — план-график',
  },
  signal_economy_conflict: {
    description: 'Экономия есть, но AD-флаг ≠ "да"',
    formula: 'limit > price AND AD ≠ "да"',
    source: 'signals.economyConflict',
    law: '44-ФЗ — учёт экономии',
  },
  signal_high_economy: {
    description: 'Снижение от лимита > 25%',
    formula: '(limit − price) / limit > 0.25',
    source: 'signals.highEconomy',
    thresholds: '>25% подозрительно',
    law: '44-ФЗ ст.22 — обоснование цены',
  },
  signal_stalled_contract: {
    description: 'Контракт подписан > 30 дней назад, факт = 0',
    formula: 'signedDate < today − 30d AND factSum = 0',
    source: 'signals.stalledContract',
  },
  signal_fact_exceeds_plan: {
    description: 'Факт превышает план',
    formula: 'factSum > planSum (при planSum > 0)',
    source: 'signals.factExceedsPlan',
    thresholds: '>0% срабатывание, >10% критично',
  },
  signal_fact_date_before_plan: {
    description: 'Дата факта раньше даты плана',
    formula: 'factDate < planDate',
    source: 'signals.factDateBeforePlan',
  },
  signal_plan_without_execution: {
    description: 'План есть, факт нет (год идёт)',
    formula: 'planSum > 0 AND planDate set AND factSum = 0 AND month ≥ April',
    source: 'signals.planWithoutExecution',
    law: '44-ФЗ ст.72 — своевременность',
  },
  signal_ep_justification_missing: {
    description: 'ЕП без обоснования',
    formula: 'method = ЕП AND justification (col M) = empty',
    source: 'signals.epJustificationMissing',
    law: '44-ФЗ ст.93 — обоснование ЕП',
  },
  signal_budget_underallocation: {
    description: 'Факт без плана (бюджетная аномалия)',
    formula: 'factSum > 0 AND planSum = 0',
    source: 'signals.budgetUnderallocation',
  },

  // ─── Trust components ───
  trust_data_quality: {
    description: 'Качество данных (30% веса)',
    formula: '100 − Σ(penalties по severity для data_quality issues)',
    source: 'TrustScorer → data_quality component',
    thresholds: '≥90 отлично, ≥70 хорошо, <50 плохо',
  },
  trust_formula_integrity: {
    description: 'Целостность формул (25% веса)',
    formula: '100 − Σ(penalties по severity для formula issues)',
    source: 'TrustScorer → formula_integrity component',
    thresholds: '≥90 отлично, ≥70 хорошо, <50 плохо',
  },
  trust_rule_compliance: {
    description: 'Соответствие правилам (20% веса)',
    formula: '100 − Σ(penalties по severity для compliance issues)',
    source: 'TrustScorer → rule_compliance component',
    thresholds: '≥90 отлично, ≥70 хорошо, <50 плохо',
    law: '44-ФЗ',
  },
  trust_mapping_consistency: {
    description: 'Консистентность маппинга (15% веса)',
    formula: '100 − Σ(penalties для mapping issues)',
    source: 'TrustScorer → mapping_consistency component',
  },
  trust_operational_risk: {
    description: 'Операционные риски (10% веса)',
    formula: '100 − Σ(penalties для operational issues)',
    source: 'TrustScorer → operational_risk component',
  },
};

/** Helper: get metric entry or empty object */
export function getMetricKB(key: string): KBEntry {
  return STANDARD_METRICS[key] ?? {};
}

/** Helper: get threshold color class based on value and metric */
export function getThresholdColor(metricKey: string, value: number): string {
  switch (metricKey) {
    case 'exec_count_pct':
    case 'execution_pct':
    case 'dept_exec_count_pct':
    case 'dept_exec_amount_pct':
    case 'dept_fb_pct':
      if (value >= 90) return 'text-emerald-600 dark:text-emerald-400';
      if (value >= 70) return 'text-blue-600 dark:text-blue-400';
      if (value >= 50) return 'text-amber-600 dark:text-amber-400';
      return 'text-red-600 dark:text-red-400';

    case 'economy_rate':
    case 'avg_reduction_pct':
      if (value <= 10) return 'text-emerald-600 dark:text-emerald-400';
      if (value <= 25) return 'text-amber-600 dark:text-amber-400';
      return 'text-red-600 dark:text-red-400';

    case 'critical_issues':
    case 'economy_conflicts':
      if (value === 0) return 'text-emerald-600 dark:text-emerald-400';
      if (value <= 3) return 'text-amber-600 dark:text-amber-400';
      return 'text-red-600 dark:text-red-400';

    case 'dept_trust':
      if (value >= 90) return 'text-emerald-600 dark:text-emerald-400';
      if (value >= 75) return 'text-blue-600 dark:text-blue-400';
      if (value >= 60) return 'text-amber-600 dark:text-amber-400';
      if (value >= 40) return 'text-orange-600 dark:text-orange-400';
      return 'text-red-600 dark:text-red-400';

    default:
      return 'text-zinc-700 dark:text-zinc-200';
  }
}

/** Get threshold background for badges/chips */
export function getThresholdBg(metricKey: string, value: number): string {
  switch (metricKey) {
    case 'exec_count_pct':
    case 'execution_pct':
    case 'dept_exec_count_pct':
    case 'dept_exec_amount_pct':
    case 'dept_fb_pct':
      if (value >= 90) return 'bg-emerald-500/10';
      if (value >= 70) return 'bg-blue-500/10';
      if (value >= 50) return 'bg-amber-500/10';
      return 'bg-red-500/10';

    case 'dept_trust':
      if (value >= 90) return 'bg-emerald-500/10';
      if (value >= 75) return 'bg-blue-500/10';
      if (value >= 60) return 'bg-amber-500/10';
      if (value >= 40) return 'bg-orange-500/10';
      return 'bg-red-500/10';

    default:
      return 'bg-zinc-500/10';
  }
}
