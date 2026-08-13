/**
 * Shared metric result-shape types + getMonthFromDate helper.
 *
 * The legacy row-by-row recalculateFromRows() engine was RETIRED 2026-06-15
 * (SSOT chunk A): CalcEngine (calc-engine.ts) is the single production calc
 * engine; equivalence was proven by calc-engine-regression before removal.
 * Only the result-shape interfaces (consumed via calc-engine-adapter) and
 * getMonthFromDate (used by unified-svod.ts) remain.
 */

import type { NoYearRemainder } from './calc-engine.js';

// ── Interfaces ────────────────────────────────────────────────────

export interface QuarterMetrics {
  planCount: number;
  factCount: number;
  planFB: number;
  planKB: number;
  planMB: number;
  planTotal: number;
  factFB: number;
  factKB: number;
  factMB: number;
  factTotal: number;
  /** Economy total (ФБ+КБ+МБ) — formerly misnamed economyMB */
  economyTotal: number;
  /** Economy per-budget breakdown */
  economyFB: number;
  economyKB: number;
  economyMB: number;
  /**
   * Доли периода. `null` = знаменателя нет (плана нет вовсе) — лист печатает
   * в такой ячейке прочерк, и продукт обязан отличать «плана нет» от «план
   * есть, факта нет» (реестр расхождений 08.08 §2). Ноль здесь означал бы
   * второе и приносил бы штраф за несуществующее отставание.
   */
  executionPct: number | null;
  /** Execution % by count: fact_count / plan_count (ГЛАВНЫЙ KPI — G-column СВОД) */
  execCountPct: number | null;
  /** Competitive execution by count: comp_fact_count / competitive_count */
  compExecCountPct: number | null;
  /** EP execution by count: ep_fact_count / ep_count */
  epExecCountPct: number | null;

  competitive: {
    plan: number; fact: number; planSum: number; factSum: number;
    planFB: number; planKB: number; planMB: number;
    factFB: number; factKB: number; factMB: number;
    economyTotal: number;
    economyFB: number; economyKB: number; economyMB: number;
  };
  ep: {
    plan: number; fact: number; planSum: number; factSum: number;
    planFB: number; planKB: number; planMB: number;
    factFB: number; factKB: number; factMB: number;
    economyTotal: number;
    economyFB: number; economyKB: number; economyMB: number;
  };
}

/** Per-activity metrics with per-budget breakdown */
export interface ActivityMetrics {
  planCount: number;
  factCount: number;
  planTotal: number;
  factTotal: number;
  planFB: number;
  planKB: number;
  planMB: number;
  factFB: number;
  factKB: number;
  factMB: number;
  economyFB: number;
  economyKB: number;
  economyMB: number;
  economyTotal: number;
  /** `null` = плана нет (см. QuarterMetrics.executionPct). */
  execCountPct: number | null;
}

/** Activity-type breakdown: program / current_program / current_non_program */
export interface ActivityBreakdown {
  program: ActivityMetrics;
  current_program: ActivityMetrics;
  current_non_program: ActivityMetrics;
}

/** Period-level metrics for subordinate drill-down (quarter/month/method) */
export interface SubPeriodMetrics {
  planCount: number;
  factCount: number;
  planTotal: number;
  factTotal: number;
  planFB: number;
  planKB: number;
  planMB: number;
  factFB: number;
  factKB: number;
  factMB: number;
  economyTotal: number;
  economyFB: number;
  economyKB: number;
  economyMB: number;
  /** `null` = плана нет (см. QuarterMetrics.executionPct). */
  executionPct: number | null;
  execCountPct: number | null;
}

/** Subordinate organization summary metrics */
export interface SubordinateMetrics {
  name: string;
  rowCount: number;
  planTotal: number;
  factTotal: number;
  planFB: number;
  planKB: number;
  planMB: number;
  factFB: number;
  factKB: number;
  factMB: number;
  /** `null` = плана нет (см. QuarterMetrics.executionPct). */
  executionPct: number | null;
  /** Execution by count: fact_count / plan_count */
  execCountPct: number | null;
  competitiveCount: number;
  epCount: number;
  economyTotal: number;
  economyFB: number;
  economyKB: number;
  economyMB: number;
  /** Per-quarter breakdown (q1..q4) */
  quarters: Record<string, SubPeriodMetrics>;
  /** Per-month breakdown (1..12) */
  months: Record<number, SubPeriodMetrics>;
  /** By method (competitive / ep) */
  byMethod: { competitive: SubPeriodMetrics; ep: SubPeriodMetrics };
  /** By activity type */
  byActivity: { program: SubPeriodMetrics; current_program: SubPeriodMetrics; current_non_program: SubPeriodMetrics };
}

export interface RecalculatedMetrics {
  department: string;

  /** Competitive-method count (ЭА + ЭК + ЭЗК) for the year */
  totalCompetitive: number;
  /** Sole-source count (ЕП) for the year */
  totalEP: number;

  quarters: {
    q1: QuarterMetrics;
    q2: QuarterMetrics;
    q3: QuarterMetrics;
    q4: QuarterMetrics;
  };

  /** Monthly metrics (1-12). Derived from plan date (column N). */
  months: Record<number, QuarterMetrics>;

  year: {
    planCount: number;
    factCount: number;
    planFB: number;
    planKB: number;
    planMB: number;
    planTotal: number;
    factFB: number;
    factKB: number;
    factMB: number;
    factTotal: number;
    economyTotal: number;
    economyFB: number;
    economyKB: number;
    economyMB: number;
    executionPct: number | null;
    execCountPct: number | null;
    compExecCountPct: number | null;
    epExecCountPct: number | null;
  };

  /**
   * Корзина «факт без планового квартала»: строка заключена, но столбец O у
   * неё пуст, поэтому лечь ни в один квартал она не может.
   *
   * ПОЧЕМУ ОТДЕЛЬНО (реестр расхождений 08.08 §2 «Корзина _orphan втекает в
   * годовой факт Пульта»). Раньше её факт добавлялся в год, а её план — нет:
   * числитель исполнения оказывался шире знаменателя, и Пульт с Отчётом
   * показывали разный год на одних данных (замер 07.08: одна строка УДТХ на
   * 67 666,68 тыс. руб. давала всё расхождение годовых денег). Теперь год —
   * строго сумма плановых кварталов, а корзина видна строкой остатка.
   */
  orphanFact: {
    factCount: number;
    factFB: number;
    factKB: number;
    factMB: number;
    factTotal: number;
    economyTotal: number;
    economyFB: number;
    economyKB: number;
    economyMB: number;
  };

  /**
   * Корзина «без года плана»: счётные строки, которые не входят в годовой
   * срез, потому что столбец P пуст (`emptyYearPolicy: 'bucket'`). Показывать
   * строкой «без года плана: N позиций на X тыс. руб.» — молчаливой потери
   * здесь больше нет (реестр 08.08 §2, волна 0 п.1). `null` — таких строк нет.
   */
  noYearRows: NoYearRemainder | null;

  /** ЕП share as % of total procedures. `null` = процедур нет вовсе. */
  epSharePct: number | null;

  /** Number of data rows that passed the classification filter */
  dataRowCount: number;

  /** Breakdown by activity type (Программная / Текущая) per quarter */
  byActivity: Record<string, ActivityBreakdown>;

  /** Breakdown by subordinate organization (column C) */
  bySubordinate: SubordinateMetrics[];

  /** Economy conflict count: AD flag disagrees with actual economy data */
  conflicts: number;

  /** Mathematical economy (ungated by AD flag) for hybrid audit */
  economyTotalMath: number;
}

/**
 * Extract month (1-12) from a date cell value.
 * Handles: Date objects, "DD.MM.YYYY" strings, ISO strings, Excel serial numbers.
 */
export function getMonthFromDate(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    const m = v.getMonth() + 1;
    return m >= 1 && m <= 12 ? m : null;
  }
  const s = String(v).trim();
  // DD.MM.YYYY or DD/MM/YYYY
  const dotMatch = s.match(/^\d{1,2}[./](\d{1,2})[./]\d{2,4}$/);
  if (dotMatch) {
    const m = parseInt(dotMatch[1], 10);
    return m >= 1 && m <= 12 ? m : null;
  }
  // ISO: YYYY-MM-DD
  const isoMatch = s.match(/^\d{4}-(\d{2})/);
  if (isoMatch) {
    const m = parseInt(isoMatch[1], 10);
    return m >= 1 && m <= 12 ? m : null;
  }
  // Excel serial date (number > 40000)
  const n = parseFloat(s);
  if (!isNaN(n) && n > 40000 && n < 60000) {
    const date = new Date((n - 25569) * 86400000);
    const m = date.getMonth() + 1;
    return m >= 1 && m <= 12 ? m : null;
  }
  return null;
}
