/**
 * Типы buildReport-проекции — сердце страницы «Отчёт» (спека
 * docs/superpowers/specs/2026-07-13-report-2-0-product-design.md §5-6:
 * проекция = материализованное чтение над снапшотом, чистая, без БД).
 *
 * Двухисточниковость (D1, qa/dual_source.md): каждое число несёт origin —
 * 'calc' (пересчёт из строк-атомов ГРБС-книг каноническим CalcEngine) или
 * 'svod' (ячейки официального листа СВОД ТД-ПМ через parseSvodGrid).
 * Проекция НЕ подменяет один источник другим — расхождение видно читателю.
 */

import type { QuarterExecutionResult } from '../metrics/quarter-execution.js';
import type { IssueSeverity } from '@aemr/shared';

/** Происхождение числа: пересчёт из атомов или официальный лист СВОД. */
export type ReportOrigin = 'calc' | 'svod';

/**
 * Деньги в бюджетном трёхсрезе ФБ/КБ/МБ + итого (тыс. руб., как в листах).
 * Инвариант кросс-фута (делта-спека §5.1): fb + kb + mb = total.
 */
export interface BudgetMoney {
  fb: number;
  kb: number;
  mb: number;
  total: number;
  origin: ReportOrigin;
}

/**
 * План/факт по количеству процедур + исполнение G = E/D в процентах
 * (канон quarterExecution: D = 0 → pct = null, «нет плана», не 0 и не 100).
 */
export interface PlanFactCounts {
  planCount: number;
  doneCount: number;
  pct: number | null;
  origin: ReportOrigin;
}

/** Разрез по способу: КП (конкурентные ЭА/ЭЗК/ЭК) и ЕП (единственный поставщик). */
export interface MethodSplit {
  kp: PlanFactCounts;
  ep: PlanFactCounts;
}

/** Квартальный срез блока ГРБС. */
export interface GrbsQuarterSlice {
  /** G = E/D отчётного квартала (канон quarterExecution, отчёт 20.03.2026). */
  execution: QuarterExecutionResult;
  /** КП/ЕП-разрез квартала (та же квартальная группировка CalcEngine). */
  methods: MethodSplit;
  /**
   * Незаключённые процедуры квартала: план есть, факта нет (D − E).
   * Канон — колонка F листа СВОД (отклонение = план − факт).
   */
  pendingCount: number;
  /** Официальные счётчики того же квартала из листа СВОД (если лист передан). */
  svod?: MethodSplit;
  /**
   * ТОТ ЖЕ расчёт без гейта среза — «как в СВОДе, на сейчас».
   *
   * Формулы листа СВОД (проверено на живых ячейках 27.07.2026: E268 УО,
   * E44 УЭР) дату факта ни с чем НЕ сравнивают — официал всегда «на сейчас».
   * Наши отчётные числа — на дату среза. Сравнивать их напрямую нельзя: у УО
   * это давало «мнимое» расхождение в 12 процедур, у УЭР — в одну, хотя обе
   * стороны считали верно. Сверка ведётся по этому полю (сравнимые моменты),
   * а разница live − methods = «заключено после среза» и объясняется читателю.
   */
  live: MethodSplit;
}

/** Годовой срез блока ГРБС. */
export interface GrbsYearSlice {
  counts: PlanFactCounts;
  methods: MethodSplit;
  /** Незаключённые за год: план − факт (та же семантика, что в квартале). */
  pendingCount: number;
}

/** Топ-сигнал блока ГРБС — свёртка Issue снапшота для шапки секции. */
export interface ReportSignal {
  id: string;
  severity: IssueSeverity;
  title: string;
}

/** Блок отчёта по одному ГРБС (секция страницы «Отчёт»). */
export interface GrbsReportBlock {
  /** Ключ входа rowsByDept (короткое имя или latinId из DEPARTMENT_REGISTRY). */
  dept: string;
  /** Полное наименование управления из реестра (ключ, если ГРБС не распознан). */
  deptLabel: string;
  quarter: GrbsQuarterSlice;
  year: GrbsYearSlice;
  /** Деньги года: лимиты (H..K) и факт (V..Y) в бюджетном трёхсрезе. */
  money: { plan: BudgetMoney; fact: BudgetMoney };
  /** Утверждённая экономия года (гейт AD='да' + дата факта — канон approvedEconomy). */
  economy: BudgetMoney;
  /** Топ-сигналы ГРБС по критичности (свёрнуто из issues снапшота). */
  topSignals: ReportSignal[];
}

/** Интегральная сводка (шапка отчёта): КП+ЕП план/факт год и квартал. */
export interface IntegralSummary {
  year: { kp: PlanFactCounts; ep: PlanFactCounts; total: PlanFactCounts };
  quarter: { kp: PlanFactCounts; ep: PlanFactCounts; total: PlanFactCounts };
  money: { plan: BudgetMoney; fact: BudgetMoney; economy: BudgetMoney };
  /** Официальный интеграл квартала — блоки scope «ВСЕ» листа СВОД (если передан). */
  svodQuarter?: MethodSplit;
}

/** Отчётный период. Никакого Date.now — детерминизм задаётся параметрами. */
export interface ReportPeriod {
  year: number;
  quarter: 1 | 2 | 3 | 4;
  /** Номер суток среза (dayNumberOf-совместимый). Срез — ось еженедельной
   *  системы отчётов (канон: четверг), поэтому обязателен, не опционален. */
  asOfDay: number;
}

/** Результат buildReport — упорядоченная проекция для страницы «Отчёт». */
export interface Report {
  period: ReportPeriod;
  integralSummary: IntegralSummary;
  grbsBlocks: GrbsReportBlock[];
  /** Честные плашки (русские фразы): чего в отчёте нет и почему. */
  notes: string[];
}
