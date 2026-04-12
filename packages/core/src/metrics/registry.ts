/**
 * STANDARD_METRICS_KB — Knowledge Base registry for every metric in AEMR.
 *
 * Maps metric keys to human-readable KB entries used by <KBTooltip>.
 * Each entry contains: formula, source, cell reference, thresholds, law, note.
 *
 * Design: single source of truth for all metric documentation across UI.
 * Every KPI card, table header, chart legend, and badge MUST reference this registry.
 */

import type { KBEntryData } from './types.js';

// ── Base Metrics (accumulated from department rows) ────────────────

export const METRIC_KB: Record<string, KBEntryData> = {
  // ── Counts ──
  plan_count: {
    label: 'План (кол-во)',
    formula: 'COUNT(rows) — количество строк закупок в плане',
    source: 'CalcEngine → total.plan_count',
    cell: 'СВОД ТД-ПМ!D{dept_row}',
    thresholds: 'Информационный показатель, пороги не применяются',
    law: '44-ФЗ ст.16 — планирование закупок',
    unit: 'count',
    category: 'execution',
  },
  fact_count: {
    label: 'Факт (кол-во)',
    formula: 'COUNT(rows WHERE fact_date IS NOT EMPTY)',
    source: 'CalcEngine → total.fact_count (gate: FACT_DATE notEmpty)',
    cell: 'СВОД ТД-ПМ!E{dept_row}',
    thresholds: 'Информационный показатель',
    law: '44-ФЗ ст.94 — исполнение контракта',
    unit: 'count',
    category: 'execution',
  },
  competitive_count: {
    label: 'КП (кол-во)',
    formula: 'COUNT(rows WHERE method IN {ЭА, ЭК, ЭЗК})',
    source: 'CalcEngine → total.competitive_count',
    cell: 'СВОД ТД-ПМ!D{dept_row} (filtered)',
    thresholds: 'Информационный показатель',
    law: '44-ФЗ ст.24 — способы определения поставщиков',
    unit: 'count',
    category: 'method',
  },
  ep_count: {
    label: 'ЕП (кол-во)',
    formula: 'COUNT(rows WHERE method = "ЕП")',
    source: 'CalcEngine → total.ep_count',
    cell: 'СВОД ТД-ПМ!D{dept_row} (EP only)',
    thresholds: 'Доля ЕП >10% — повышенный контроль',
    law: '44-ФЗ ст.93 — закупка у единственного поставщика',
    unit: 'count',
    category: 'method',
  },
  comp_fact_count: {
    label: 'Факт КП (кол-во)',
    formula: 'COUNT(rows WHERE method IN {ЭА,ЭК,ЭЗК} AND fact_date NOT EMPTY)',
    source: 'CalcEngine → total.comp_fact_count',
    cell: 'СВОД ТД-ПМ!G{dept_row}',
    thresholds: 'Исполнение КП ≥90% зелёный, ≥70% жёлтый, <70% красный',
    law: '44-ФЗ ст.24 — конкурентные способы',
    unit: 'count',
    category: 'execution',
  },
  ep_fact_count: {
    label: 'Факт ЕП (кол-во)',
    formula: 'COUNT(rows WHERE method = "ЕП" AND fact_date NOT EMPTY)',
    source: 'CalcEngine → total.ep_fact_count',
    cell: 'СВОД ТД-ПМ!G{dept_row} (EP)',
    thresholds: 'Исполнение ЕП ≥90% зелёный, ≥70% жёлтый, <70% красный',
    law: '44-ФЗ ст.93',
    unit: 'count',
    category: 'execution',
  },

  // ── Plan sums (budget limits) ──
  plan_fb: {
    label: 'Лимит ФБ',
    formula: 'SUM(col_H) — федеральный бюджет, лимит на закупки',
    source: 'CalcEngine → total.plan_fb (column H)',
    cell: 'СВОД ТД-ПМ!H{dept_row}',
    thresholds: 'Информационный показатель',
    law: '44-ФЗ ст.72 — планирование бюджетных обязательств',
    unit: 'currency',
    category: 'budget',
  },
  plan_kb: {
    label: 'Лимит КБ',
    formula: 'SUM(col_I) — краевой бюджет, лимит на закупки',
    source: 'CalcEngine → total.plan_kb (column I)',
    cell: 'СВОД ТД-ПМ!I{dept_row}',
    thresholds: 'Информационный показатель',
    law: '44-ФЗ ст.72',
    unit: 'currency',
    category: 'budget',
  },
  plan_mb: {
    label: 'Лимит МБ',
    formula: 'SUM(col_J) — муниципальный бюджет, лимит на закупки',
    source: 'CalcEngine → total.plan_mb (column J)',
    cell: 'СВОД ТД-ПМ!J{dept_row}',
    thresholds: 'Информационный показатель',
    law: '44-ФЗ ст.72',
    unit: 'currency',
    category: 'budget',
  },
  plan_total: {
    label: 'Лимит ИТОГО',
    formula: 'SUM(col_K) или SUM(H+I+J) если K пуст — общий лимит',
    source: 'CalcEngine → total.plan_total (column K, fallback H+I+J)',
    cell: 'СВОД ТД-ПМ!K{dept_row}',
    thresholds: 'Информационный показатель',
    law: '44-ФЗ ст.72 — планирование закупок',
    unit: 'currency',
    category: 'budget',
  },

  // ── Fact sums (contract prices) ──
  fact_fb: {
    label: 'Факт ФБ',
    formula: 'SUM(col_V WHERE fact_date NOT EMPTY) — цена контрактов ФБ',
    source: 'CalcEngine → total.fact_fb (column V, gate: FACT_DATE)',
    cell: 'СВОД ТД-ПМ!V{dept_row}',
    thresholds: 'Информационный показатель',
    law: '44-ФЗ ст.34 — цена контракта',
    unit: 'currency',
    category: 'budget',
  },
  fact_kb: {
    label: 'Факт КБ',
    formula: 'SUM(col_W WHERE fact_date NOT EMPTY) — цена контрактов КБ',
    source: 'CalcEngine → total.fact_kb (column W, gate: FACT_DATE)',
    cell: 'СВОД ТД-ПМ!W{dept_row}',
    thresholds: 'Информационный показатель',
    law: '44-ФЗ ст.34',
    unit: 'currency',
    category: 'budget',
  },
  fact_mb: {
    label: 'Факт МБ',
    formula: 'SUM(col_X WHERE fact_date NOT EMPTY) — цена контрактов МБ',
    source: 'CalcEngine → total.fact_mb (column X, gate: FACT_DATE)',
    cell: 'СВОД ТД-ПМ!X{dept_row}',
    thresholds: 'Информационный показатель',
    law: '44-ФЗ ст.34',
    unit: 'currency',
    category: 'budget',
  },
  fact_total: {
    label: 'Факт ИТОГО',
    formula: 'SUM(col_Y WHERE fact_date NOT EMPTY) или SUM(V+W+X)',
    source: 'CalcEngine → total.fact_total (column Y, fallback V+W+X)',
    cell: 'СВОД ТД-ПМ!Y{dept_row}',
    thresholds: 'Информационный показатель',
    law: '44-ФЗ ст.34 — цена контракта',
    unit: 'currency',
    category: 'budget',
  },

  // ── Economy (savings) ──
  economy_fb: {
    label: 'Экономия ФБ',
    formula: 'SUM(col_Z WHERE fact_date NOT EMPTY AND AD="да")',
    source: 'CalcEngine → total.economy_fb (column Z, gates: FACT_DATE + AD)',
    cell: 'СВОД ТД-ПМ!Z{dept_row}',
    thresholds: '>25% от лимита — подозрительно, требует обоснования',
    law: '44-ФЗ ст.34 п.1.1 — обоснование экономии',
    note: 'Только при AD="да" (утверждённая экономия)',
    unit: 'currency',
    category: 'economy',
  },
  economy_kb: {
    label: 'Экономия КБ',
    formula: 'SUM(col_AA WHERE fact_date NOT EMPTY AND AD="да")',
    source: 'CalcEngine → total.economy_kb (column AA, gates: FACT_DATE + AD)',
    cell: 'СВОД ТД-ПМ!AA{dept_row}',
    thresholds: '>25% от лимита — подозрительно',
    law: '44-ФЗ ст.34 п.1.1',
    note: 'Только при AD="да"',
    unit: 'currency',
    category: 'economy',
  },
  economy_mb: {
    label: 'Экономия МБ',
    formula: 'SUM(col_AB WHERE fact_date NOT EMPTY AND AD="да")',
    source: 'CalcEngine → total.economy_mb (column AB, gates: FACT_DATE + AD)',
    cell: 'СВОД ТД-ПМ!AB{dept_row}',
    thresholds: '>25% от лимита — подозрительно',
    law: '44-ФЗ ст.34 п.1.1',
    note: 'Только при AD="да"',
    unit: 'currency',
    category: 'economy',
  },

  // ── Method-specific plan totals ──
  comp_plan_total: {
    label: 'Лимит КП ИТОГО',
    formula: 'SUM(col_K WHERE method IN {ЭА, ЭК, ЭЗК})',
    source: 'CalcEngine → total.comp_plan_total',
    thresholds: 'Информационный показатель',
    law: '44-ФЗ ст.24 — конкурентные способы',
    unit: 'currency',
    category: 'method',
  },
  ep_plan_total: {
    label: 'Лимит ЕП ИТОГО',
    formula: 'SUM(col_K WHERE method = "ЕП")',
    source: 'CalcEngine → total.ep_plan_total',
    thresholds: 'Информационный показатель',
    law: '44-ФЗ ст.93 — единственный поставщик',
    unit: 'currency',
    category: 'method',
  },

  // ── Derived Metrics ──

  deviation: {
    label: 'Отклонение (кол-во)',
    formula: 'plan_count − fact_count',
    source: 'CalcEngine → derived.deviation',
    cell: 'СВОД ТД-ПМ!F{dept_row}',
    thresholds: '0 = выполнено, >0 = не завершены, <0 = перевыполнение',
    law: '44-ФЗ ст.16 — план-график',
    unit: 'count',
    category: 'execution',
  },
  amount_deviation: {
    label: 'Отклонение (сумма)',
    formula: 'plan_total − fact_total',
    source: 'CalcEngine → derived.amount_deviation',
    thresholds: '>0 = экономия/не освоено, <0 = перерасход',
    law: '44-ФЗ ст.34',
    unit: 'currency',
    category: 'execution',
  },
  execution_pct: {
    label: '% исполнения (сумма)',
    formula: 'fact_total / plan_total × 100',
    source: 'CalcEngine → derived.execution_pct',
    cell: 'СВОД ТД-ПМ!G{dept_row} (sum)',
    thresholds: '≥90% зелёный, 70-89% синий, 50-69% жёлтый, <50% красный',
    law: '44-ФЗ ст.72 — контроль исполнения',
    unit: 'percent',
    category: 'execution',
  },
  exec_count_pct: {
    label: '% исполнения (кол-во)',
    formula: 'fact_count / plan_count × 100',
    source: 'CalcEngine → derived.exec_count_pct',
    cell: 'СВОД ТД-ПМ!G{dept_row} (count)',
    thresholds: '≥90% зелёный, 70-89% синий, 50-69% жёлтый, <50% красный',
    law: '44-ФЗ ст.72 — ГЛАВНЫЙ ПОКАЗАТЕЛЬ',
    note: 'Основной KPI руководства: исполнение по количеству процедур',
    unit: 'percent',
    category: 'execution',
  },
  comp_exec_count_pct: {
    label: '% исполнения КП (кол-во)',
    formula: 'comp_fact_count / competitive_count × 100',
    source: 'CalcEngine → derived.comp_exec_count_pct',
    cell: 'СВОД ТД-ПМ!G{dept_row} (КП)',
    thresholds: '≥90% зелёный, 70-89% синий, 50-69% жёлтый, <50% красный',
    law: '44-ФЗ ст.24 — конкурентные закупки',
    unit: 'percent',
    category: 'execution',
  },
  ep_exec_count_pct: {
    label: '% исполнения ЕП (кол-во)',
    formula: 'ep_fact_count / ep_count × 100',
    source: 'CalcEngine → derived.ep_exec_count_pct',
    thresholds: '≥90% зелёный, 70-89% синий, 50-69% жёлтый, <50% красный',
    law: '44-ФЗ ст.93 — единственный поставщик',
    unit: 'percent',
    category: 'execution',
  },
  savings_pct: {
    label: '% экономии',
    formula: '(plan_total − fact_total) / plan_total × 100',
    source: 'CalcEngine → derived.savings_pct',
    thresholds: '>25% подозрительно (требует AD-обоснования), 5-15% норма',
    law: '44-ФЗ ст.34 п.1.1 — обоснование НМЦК',
    unit: 'percent',
    category: 'economy',
  },
  economy_total: {
    label: 'Экономия ИТОГО',
    formula: 'economy_fb + economy_kb + economy_mb',
    source: 'CalcEngine → derived.economy_total',
    cell: 'СВОД ТД-ПМ!AC{dept_row}',
    thresholds: '>25% лимита → AD-контроль обязателен',
    law: '44-ФЗ ст.34 п.1.1',
    note: 'Только утверждённая экономия (AD="да")',
    unit: 'currency',
    category: 'economy',
  },
  total_procedures: {
    label: 'Всего процедур',
    formula: 'competitive_count + ep_count',
    source: 'CalcEngine → derived.total_procedures',
    thresholds: 'Информационный показатель',
    law: '44-ФЗ ст.24',
    unit: 'count',
    category: 'execution',
  },
  ep_share_pct: {
    label: 'Доля ЕП %',
    formula: 'ep_count / total_procedures × 100',
    source: 'CalcEngine → derived.ep_share_pct',
    thresholds: '>10% — повышенный контроль (рекомендация), >30% — критично',
    law: '44-ФЗ ст.93 — ограничение закупок у ЕП',
    note: 'Высокая доля ЕП = риск снижения конкуренции',
    unit: 'percent',
    category: 'method',
  },

  // ── Trust Components ──

  trust_overall: {
    label: 'Общая надёжность',
    formula: 'Σ(component_score × weight) → grade A-F',
    source: 'TrustScorer → overall',
    thresholds: 'A(≥90) зелёный, B(75-89) синий, C(60-74) жёлтый, D(40-59) оранжевый, F(<40) красный',
    law: 'Внутренний стандарт АЕМР — контроль достоверности данных',
    unit: 'percent',
    category: 'trust',
  },
  trust_data_quality: {
    label: 'Качество данных',
    formula: '100 − (missing_values_count + invalid_format_count) / total_cells × 100',
    source: 'TrustScorer → components[data_quality] (вес 30%)',
    thresholds: '≥90 хорошо, 70-89 внимание, <70 критично',
    unit: 'percent',
    category: 'trust',
  },
  trust_formula_integrity: {
    label: 'Целостность формул',
    formula: '100 − formula_errors / formula_cells × 100',
    source: 'TrustScorer → components[formula_integrity] (вес 25%)',
    thresholds: '≥95 хорошо, 85-94 внимание, <85 критично',
    unit: 'percent',
    category: 'trust',
  },
  trust_rule_compliance: {
    label: 'Соблюдение правил',
    formula: '100 − rule_violations / total_rules × 100',
    source: 'TrustScorer → components[rule_compliance] (вес 20%)',
    thresholds: '≥90 хорошо, 75-89 внимание, <75 критично',
    law: '44-ФЗ — правила ведения плана-графика',
    unit: 'percent',
    category: 'trust',
  },
  trust_mapping_consistency: {
    label: 'Согласованность маппинга',
    formula: '100 − mapping_mismatches / total_mappings × 100',
    source: 'TrustScorer → components[mapping_consistency] (вес 15%)',
    thresholds: '≥95 хорошо, 85-94 внимание, <85 критично',
    unit: 'percent',
    category: 'trust',
  },
  trust_operational_risk: {
    label: 'Операционный риск',
    formula: '100 − (overdue_count × 3 + economy_conflict_count × 2) / total_rows × 100',
    source: 'TrustScorer → components[operational_risk] (вес 10%)',
    thresholds: '≥85 хорошо, 70-84 внимание, <70 критично',
    unit: 'percent',
    category: 'trust',
  },

  // ── Dashboard-specific composite metrics ──

  critical_issues: {
    label: 'Критические замечания',
    formula: 'COUNT(issues WHERE severity IN {critical, error})',
    source: 'snapshot.issues → filter(severity)',
    thresholds: '0 = норма, ≥1 красный баннер',
    law: '44-ФЗ — нарушения планирования и исполнения',
    unit: 'count',
    category: 'quality',
  },
  economy_rate: {
    label: 'Уровень экономии',
    formula: 'economy_total / plan_total × 100',
    source: 'CalcEngine → economy_total / plan_total',
    thresholds: '5-15% норма, >25% подозрительно, 0% — нет экономии',
    law: '44-ФЗ ст.34 п.1.1 — НМЦК',
    unit: 'percent',
    category: 'economy',
  },
  trust_binary: {
    label: 'Доверие (бинарный)',
    formula: 'trust_overall ≥ 75 → "✓ Можно доверять" / "✗ Расхождения"',
    source: 'TrustScorer → overall ≥ B-grade threshold',
    thresholds: '✓ ≥75 (grade A/B), ✗ <75 (grade C/D/F)',
    note: 'Упрощённый индикатор для быстрого восприятия на Dashboard',
    unit: 'count',
    category: 'trust',
  },

  // ── RatingTable column metrics ──

  fb_execution_pct: {
    label: '% исполнения ФБ',
    formula: 'fact_fb / plan_fb × 100',
    source: 'CalcEngine → fact_fb / plan_fb',
    thresholds: '≥90% зелёный, 70-89% жёлтый, <70% красный',
    law: '44-ФЗ ст.72 — контроль ФБ (приоритет)',
    note: 'ФБ = федеральный бюджет, приоритет контроля',
    unit: 'percent',
    category: 'budget',
  },
};

// ── Helpers ──

/** Get KB entry for a metric key. Returns undefined if not found. */
export function getMetricKB(key: string): KBEntryData | undefined {
  return METRIC_KB[key];
}

/** Get KB entry formatted for KBTooltip component. */
export function getMetricTooltip(key: string): {
  formula?: string;
  source?: string;
  cell?: string;
  thresholds?: string;
  law?: string;
  note?: string;
} | undefined {
  const entry = METRIC_KB[key];
  if (!entry) return undefined;
  return {
    formula: entry.formula,
    source: entry.source,
    cell: entry.cell,
    thresholds: entry.thresholds,
    law: entry.law,
    note: entry.note,
  };
}

/** Get all metrics in a category. */
export function getMetricsByCategory(category: KBEntryData['category']): Array<{ key: string } & KBEntryData> {
  return Object.entries(METRIC_KB)
    .filter(([, v]) => v.category === category)
    .map(([key, v]) => ({ key, ...v }));
}

/** List of all available metric keys. */
export const ALL_METRIC_KEYS = Object.keys(METRIC_KB);
