// ── Квартальные ряды страницы «Экономия» (E11-5): тренд, спарклайны,
//    оверлей по ГРБС и дельты «последний ненулевой квартал vs предыдущий».
//    Все ряды учитывают бюджет-фильтр (BudgetSelection).

import type { DepartmentSummary } from '@aemr/shared';
import { deptKeyOf } from './dept-economy';
import { selectTotal } from './budget';
import type { BudgetSelection } from './budget';

export const QUARTER_KEYS = ['q1', 'q2', 'q3', 'q4'] as const;
export type QuarterKey = (typeof QUARTER_KEYS)[number];

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function quarterOf(s: DepartmentSummary, qk: QuarterKey): Record<string, unknown> | undefined {
  return (s.quarters?.[qk] ?? undefined) as Record<string, unknown> | undefined;
}

/** Экономия квартала с учётом бюджет-фильтра; 0 если квартала нет. */
function quarterEconomy(q: Record<string, unknown> | undefined, budgets: BudgetSelection): number {
  if (!q) return 0;
  return selectTotal(budgets, num(q.economyFB), num(q.economyKB), num(q.economyMB), num(q.economyTotal));
}

/** Точка квартального тренда: суммы по всем ГРБС набора. */
export interface QuarterTrendPoint {
  /** 'Q1'…'Q4'. */
  name: string;
  /** Экономия (бюджет-фильтр применён). */
  economy: number;
  /** % снижения = экономия/план; 0 при нулевом плане. Не округлён. */
  pct: number;
  /** Компоненты экономии по бюджетам — всегда полные (для стеков ФБ/КБ/МБ). */
  fb: number;
  kb: number;
  mb: number;
}

export function buildQuarterlyTrend(
  summaries: DepartmentSummary[],
  budgets: BudgetSelection,
): QuarterTrendPoint[] {
  return QUARTER_KEYS.map(qk => {
    let economy = 0, plan = 0, fb = 0, kb = 0, mb = 0;
    for (const s of summaries) {
      const q = quarterOf(s, qk);
      if (!q) continue;
      fb += num(q.economyFB); kb += num(q.economyKB); mb += num(q.economyMB);
      economy += quarterEconomy(q, budgets);
      plan += selectTotal(budgets, num(q.planFB), num(q.planKB), num(q.planMB), num(q.planTotal));
    }
    return { name: qk.toUpperCase(), economy, pct: plan > 0 ? (economy / plan) * 100 : 0, fb, kb, mb };
  });
}

/** Спарклайн суммарной экономии по кварталам (ось hero-метрики «Экономия»). */
export function economySpark(trend: QuarterTrendPoint[]): number[] {
  return trend.map(t => t.economy);
}

/** Спарклайн % снижения по кварталам, округлён до 0.1 (hero-метрика «Снижение»). */
export function pctSpark(trend: QuarterTrendPoint[]): number[] {
  return trend.map(t => +t.pct.toFixed(1));
}

/** Цвета оверлей-линий ГРБС на квартальном тренде. */
const DEPT_LINE_COLORS = ['#3b82f6', '#8b5cf6', '#06b6d4', '#f59e0b', '#10b981', '#ef4444'];

export interface PerDeptSeries {
  id: string;
  /** Экономия по кварталам q1…q4. */
  data: number[];
  color: string;
}

/**
 * Поквартальные линии отдельных ГРБС — только при выборке 2–6 управлений
 * (одно — избыточно, больше шести — нечитаемо). Иначе null.
 */
export function buildPerDeptQuarterly(
  summaries: DepartmentSummary[],
  budgets: BudgetSelection,
): PerDeptSeries[] | null {
  if (summaries.length <= 1 || summaries.length > 6) return null;
  return summaries.map((s, idx) => ({
    id: deptKeyOf(s),
    data: QUARTER_KEYS.map(qk => quarterEconomy(quarterOf(s, qk), budgets)),
    color: DEPT_LINE_COLORS[idx % DEPT_LINE_COLORS.length],
  }));
}

/** Точка тренда, дополненная полями-линиями отдельных ГРБС (для recharts). */
export interface TrendChartPoint extends QuarterTrendPoint {
  [key: string]: number | string;
}

/** Точки тренда с дописанными полями-линиями отдельных ГРБС. */
export function mergeTrendWithDepts(
  trend: QuarterTrendPoint[],
  perDept: PerDeptSeries[] | null,
): TrendChartPoint[] {
  return trend.map((point, i) => {
    const merged: TrendChartPoint = {
      name: point.name, economy: point.economy, pct: point.pct,
      fb: point.fb, kb: point.kb, mb: point.mb,
    };
    if (perDept) for (const dept of perDept) merged[dept.id] = dept.data[i];
    return merged;
  });
}

/** Квартальные мини-спарклайны по каждому ГРБС (ключ — deptKey). */
export function buildDeptSparks(
  summaries: DepartmentSummary[],
  budgets: BudgetSelection,
): Record<string, number[]> {
  const map: Record<string, number[]> = {};
  for (const s of summaries) {
    map[deptKeyOf(s)] = QUARTER_KEYS.map(qk => quarterEconomy(quarterOf(s, qk), budgets));
  }
  return map;
}

/** Дельты hero-метрик: последний ненулевой квартал против предыдущего. */
export interface QuarterDeltas {
  economy: number;
  pct: number;
  /** 'Q2 vs Q1'; пусто, когда предыдущего квартала нет. */
  label: string;
}

export function quarterDeltas(economyByQ: number[], pctByQ: number[]): QuarterDeltas {
  const lastQ = economyByQ.reduce((last, v, i) => (v !== 0 ? i : last), -1);
  const prevQ = lastQ > 0 ? lastQ - 1 : -1;
  if (prevQ < 0) return { economy: 0, pct: 0, label: '' };
  return {
    economy: economyByQ[lastQ] - economyByQ[prevQ],
    pct: pctByQ[lastQ] - pctByQ[prevQ],
    label: `Q${lastQ + 1} vs Q${prevQ + 1}`,
  };
}
