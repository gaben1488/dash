import type { PeriodResolution } from './period-resolution';

/**
 * Агрегация тоталов (КП/ЕП, план/факт, счётчики, бюджет, экономия) со смешанной
 * логикой периодов: полные кварталы quarter-level + частичные месяцы
 * month-level + подвед-оверрайд короткого замыкания.
 *
 * Извлечено move-only из useFilteredData.ts §8 (:333–462), разрез E11-1.
 * «Выживший» по спеке filter-system-target-2026-07-16 §3.4 (смешанная агрегация
 * полных кварталов + частичных месяцев).
 *
 * 05.08.2026 — ядро вынесено на ОДИН узел (`aggregateNodeTotals`). Раньше
 * период применялся только к сумме по всем управлениям, а разрезы (управление,
 * подведомственная, укрупнённая сводка) читали годовые поля объекта напрямую:
 * при выборе квартала целое и части расходились. Теперь и итог, и каждый узел
 * считаются одной и той же функцией с одним и тем же периодом.
 */

export interface NodeBudget {
  planFB: number; planKB: number; planMB: number;
  factFB: number; factKB: number; factMB: number;
  economyFB: number; economyKB: number; economyMB: number;
}

export interface NodeTotals {
  kp: number;
  ep: number;
  planTotal: number;
  factTotal: number;
  planCount: number;
  factCount: number;
  economyTotal: number;
  budget: NodeBudget;
  /** false — у узла нет квартальной/месячной базы, значения взяты годовыми. */
  periodApplied: boolean;
}

export interface AggregatedTotals {
  totalKP: number;
  totalEP: number;
  totalPlan: number;
  totalFact: number;
  /** count-based исполнение: totalFactCount / totalPlanCount */
  totalPlanCount: number;
  totalFactCount: number;
}

export interface AggregateOpts {
  /** Способ (КП/ЕП): пустой selectedMethods = показывать оба */
  showKP: boolean;
  showEP: boolean;
  activeMonths: Set<number>;
  hasMonthData: boolean;
}

const EMPTY_BUDGET: NodeBudget = {
  planFB: 0, planKB: 0, planMB: 0,
  factFB: 0, factKB: 0, factMB: 0,
  economyFB: 0, economyKB: 0, economyMB: 0,
};

function addBudget(acc: NodeBudget, src: any): void {
  if (!src) return;
  acc.planFB += src.planFB ?? 0;
  acc.planKB += src.planKB ?? 0;
  acc.planMB += src.planMB ?? 0;
  acc.factFB += src.factFB ?? 0;
  acc.factKB += src.factKB ?? 0;
  acc.factMB += src.factMB ?? 0;
  acc.economyFB += src.economyFB ?? 0;
  acc.economyKB += src.economyKB ?? 0;
  acc.economyMB += src.economyMB ?? 0;
}

function emptyTotals(): NodeTotals {
  return {
    kp: 0, ep: 0, planTotal: 0, factTotal: 0, planCount: 0, factCount: 0,
    economyTotal: 0, budget: { ...EMPTY_BUDGET }, periodApplied: true,
  };
}

/**
 * Метрики ОДНОГО узла (управление, подведомственная) за выбранный период.
 * Узел обязан нести `quarters` и/или `months`; если базы нет — возвращаются
 * годовые поля с `periodApplied: false`, чтобы вызывающий мог сказать правду.
 */
export function aggregateNodeTotals(
  node: any,
  resolution: PeriodResolution,
  opts: AggregateOpts,
): NodeTotals {
  const { periodKey, coveredQuarters, fullQuarters, partialMonths, useMonthLevel, hasActiveMonths } = resolution;
  const { showKP, showEP, activeMonths, hasMonthData } = opts;
  const t = emptyTotals();

  // ── Подвед-оверрайд: значения на узле уже являются срезом подведа (год) ──
  // Квартальная разбивка объекта при этом описывает управление целиком.
  if (node?._subFiltered) {
    if (showKP) t.kp += node.competitiveCount ?? 0;
    if (showEP) t.ep += node.soleCount ?? 0;
    t.planTotal += node.planTotal ?? 0;
    t.factTotal += node.factTotal ?? 0;
    t.economyTotal += node.economyTotal ?? 0;
    for (const qk of ['q1', 'q2', 'q3', 'q4']) {
      const sq = node.quarters?.[qk];
      if (sq) { t.planCount += sq.planCount ?? 0; t.factCount += sq.factCount ?? 0; addBudget(t.budget, sq); }
    }
    t.periodApplied = false;
    return t;
  }

  const hasQuarters = node?.quarters && Object.keys(node.quarters).length > 0;
  const hasMonths = node?.months && Object.keys(node.months).length > 0;
  if (!hasQuarters && !hasMonths) {
    // Базы периодов нет — отдаём годовое и честно помечаем.
    if (showKP) t.kp += node?.competitiveCount ?? 0;
    if (showEP) t.ep += node?.epCount ?? node?.soleCount ?? 0;
    t.planTotal += node?.planTotal ?? 0;
    t.factTotal += node?.factTotal ?? 0;
    t.planCount += node?.planCount ?? node?.rowCount ?? 0;
    t.factCount += node?.factCount ?? 0;
    t.economyTotal += node?.economyTotal ?? 0;
    addBudget(t.budget, node);
    t.periodApplied = false;
    return t;
  }

  const addMoney = (src: any): void => {
    const kpPlan = src?.kpPlanTotal ?? 0;
    const epPlan = src?.epPlanTotal ?? 0;
    if (kpPlan > 0 || epPlan > 0) {
      if (showKP) { t.planTotal += kpPlan; t.factTotal += src?.kpFactTotal ?? 0; }
      if (showEP) { t.planTotal += epPlan; t.factTotal += src?.epFactTotal ?? 0; }
    } else {
      t.planTotal += src?.planTotal ?? 0;
      t.factTotal += src?.factTotal ?? 0;
    }
  };

  const addCommon = (src: any): void => {
    if (showKP) t.kp += src?.kpCount ?? 0;
    if (showEP) t.ep += src?.epCount ?? 0;
    t.planCount += src?.planCount ?? 0;
    t.factCount += src?.factCount ?? 0;
    t.economyTotal += src?.economyTotal ?? 0;
    addBudget(t.budget, src);
  };

  // ── Смешанный выбор: полные кварталы quarter-level + частичные месяцы month-level ──
  const hasMixed = hasActiveMonths && (fullQuarters.length > 0 || partialMonths.length > 0);

  if (hasMixed && hasMonthData && partialMonths.length > 0) {
    for (const monthNum of partialMonths) {
      const m = node.months?.[monthNum];
      if (!m) continue;
      addCommon(m);
      addMoney(m);
    }
    for (const qKey of fullQuarters) {
      const q = node.quarters?.[qKey];
      if (!q) continue;
      addCommon(q);
      addMoney(q);
    }
    return t;
  }

  if (useMonthLevel) {
    for (const monthNum of activeMonths) {
      const m = node.months?.[monthNum];
      if (!m) continue;
      addCommon(m);
      addMoney(m);
    }
    return t;
  }

  // ── Кварталы (или год как один ключ) ──
  const aggregateQuarters = hasActiveMonths && coveredQuarters.length > 0 ? coveredQuarters : [periodKey];
  for (const qKey of aggregateQuarters) {
    const q = node.quarters?.[qKey];
    // Один ключ и нет квартального среза — падаем на годовые поля узла
    // (иначе управление показало бы нули там, где движок отдал только год).
    const single = aggregateQuarters.length === 1;
    if (!q) {
      if (single) {
        if (showKP) t.kp += node.competitiveCount ?? 0;
        if (showEP) t.ep += node.epCount ?? node.soleCount ?? 0;
        t.planTotal += node.planTotal ?? 0;
        t.factTotal += node.factTotal ?? 0;
        t.planCount += node.planCount ?? node.rowCount ?? 0;
        t.factCount += node.factCount ?? 0;
        t.economyTotal += node.economyTotal ?? 0;
        addBudget(t.budget, node);
        t.periodApplied = false;
      }
      continue;
    }
    if (showKP) t.kp += q.kpCount ?? (single ? (node.competitiveCount ?? 0) : 0);
    if (showEP) t.ep += q.epCount ?? (single ? (node.soleCount ?? 0) : 0);
    t.planCount += q.planCount ?? 0;
    t.factCount += q.factCount ?? 0;
    t.economyTotal += q.economyTotal ?? 0;
    addBudget(t.budget, q);
    const kpPlan = q.kpPlanTotal ?? 0;
    const epPlan = q.epPlanTotal ?? 0;
    if (kpPlan > 0 || epPlan > 0) {
      if (showKP) { t.planTotal += kpPlan; t.factTotal += q.kpFactTotal ?? 0; }
      if (showEP) { t.planTotal += epPlan; t.factTotal += q.epFactTotal ?? 0; }
    } else {
      t.planTotal += q.planTotal ?? (single ? (node.planTotal ?? 0) : 0);
      t.factTotal += q.factTotal ?? (single ? (node.factTotal ?? 0) : 0);
    }
  }

  return t;
}

/** Итог по всем управлениям = сумма узлов, посчитанных тем же правилом периода. */
export function aggregateTotals(
  depts: any[],
  resolution: PeriodResolution,
  opts: AggregateOpts,
): AggregatedTotals {
  let totalKP = 0, totalEP = 0;
  let totalPlan = 0, totalFact = 0;
  let totalPlanCount = 0, totalFactCount = 0;

  for (const d of depts) {
    const n = aggregateNodeTotals(d, resolution, opts);
    totalKP += n.kp;
    totalEP += n.ep;
    totalPlan += n.planTotal;
    totalFact += n.factTotal;
    totalPlanCount += n.planCount;
    totalFactCount += n.factCount;
  }

  return { totalKP, totalEP, totalPlan, totalFact, totalPlanCount, totalFactCount };
}
