// ── Строки экономии по ГРБС (E11-5): чистые вычисления из pages/Economy.tsx.
//    Вход — DepartmentSummary (quarters/subordinates нетипизированы в shared),
//    выход — DeptEconomy с гарантированными number-полями.

import type { DepartmentSummary } from '@aemr/shared';
import { HIGH_ECONOMY_PCT, ORG_ITSELF } from './types';
import type { BudgetData, DeptEconomy, SortDir, SortField, SubEconomy, SubordinateFlat } from './types';
import { selectTotal, sumSelected } from './budget';
import type { BudgetSelection } from './budget';

/** Конечное число либо 0 (undefined/null/NaN из нетипизированных quarters). */
function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Конечное число либо фолбэк (сохраняет семантику `q?.x ?? s.x ?? 0`). */
function numOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Ключ ГРБС для строк экономии: короткое имя, иначе id, иначе '?'. */
export function deptKeyOf(s: DepartmentSummary): string {
  return s.department?.nameShort ?? s.department?.id ?? '?';
}

/**
 * Доля экономии от лимита, %. `null` при неположительном лимите — считать
 * не от чего, и подставлять ноль нельзя: «0 %» читатель понимает как
 * «экономии не было», а это другое утверждение.
 */
export function pctOf(economy: number, plan: number): number | null {
  return plan > 0 ? (economy / plan) * 100 : null;
}

function readBudget(src: Record<string, unknown>): BudgetData {
  return {
    planFB: num(src.planFB), planKB: num(src.planKB), planMB: num(src.planMB),
    factFB: num(src.factFB), factKB: num(src.factKB), factMB: num(src.factMB),
    economyFB: num(src.economyFB), economyKB: num(src.economyKB), economyMB: num(src.economyMB),
  };
}

function buildSubordinates(
  rawSubs: unknown[],
  budgets: BudgetSelection,
): SubEconomy[] {
  const subs: SubEconomy[] = [];
  for (const rawSub of rawSubs) {
    const sub = (rawSub ?? {}) as Record<string, unknown>;
    const name = typeof sub.name === 'string' ? sub.name : '';
    // ORG_ITSELF держим всегда (даже нулевой) — это данные самого управления;
    // прочие строки без экономии и плана — шум, скрываем.
    const keep = name === ORG_ITSELF || num(sub.economyTotal) !== 0 || num(sub.planTotal) > 0;
    if (!keep) continue;
    const budget = readBudget(sub);
    const planTotal = selectTotal(budgets, budget.planFB, budget.planKB, budget.planMB, num(sub.planTotal));
    const factTotal = selectTotal(budgets, budget.factFB, budget.factKB, budget.factMB, num(sub.factTotal));
    const economy = selectTotal(budgets, budget.economyFB, budget.economyKB, budget.economyMB, num(sub.economyTotal));
    subs.push({ name, planTotal, factTotal, economy, pct: pctOf(economy, planTotal), budget });
  }
  return subs.sort((a, b) => b.economy - a.economy);
}

export interface BuildDeptEconomyInput {
  summaries: DepartmentSummary[];
  /** Ключ квартала ('q1'…'q4') либо 'year'. */
  periodKey: string;
  budgets: BudgetSelection;
  /** ГРБС в режиме «только управление» — подведы не разворачиваются. */
  deptOnlyMode: ReadonlySet<string>;
}

/**
 * Строки экономии по ГРБС с учётом бюджет-фильтра и deptOnly-режима.
 * Экономия — только утверждённые (AD="да") Z/AA/AB; план−факт НЕ является
 * экономией (METRICS_CONTRACT.md:11).
 */
export function buildDeptEconomy(input: BuildDeptEconomyInput): DeptEconomy[] {
  const { summaries, periodKey, budgets, deptOnlyMode } = input;
  if (!Array.isArray(summaries) || summaries.length === 0) return [];

  return summaries.map((s) => {
    const deptKey = deptKeyOf(s);
    const q = (s.quarters?.[periodKey] ?? undefined) as Record<string, unknown> | undefined;
    const budget = readBudget(q ?? {});

    // При пустом фильтре — официальные totals (квартальный, иначе годовой).
    const limit = budgets.filtered
      ? sumSelected(budgets, budget.planFB, budget.planKB, budget.planMB)
      : numOr(q?.planTotal, num(s.planTotal));
    const price = budgets.filtered
      ? sumSelected(budgets, budget.factFB, budget.factKB, budget.factMB)
      : numOr(q?.factTotal, num(s.factTotal));
    const economy = budgets.filtered
      ? sumSelected(budgets, budget.economyFB, budget.economyKB, budget.economyMB)
      : numOr(q?.economyTotal, num(s.economyTotal));
    const pct = pctOf(economy, limit);

    const deptOnly = deptOnlyMode.has(deptKey);
    const subordinates = deptOnly ? [] : buildSubordinates(s.subordinates ?? [], budgets);

    return {
      dept: deptKey,
      deptId: deptKey,
      limit, price, economy,
      economyOfficial: s.economyTotal ?? null,
      pct,
      highEconomy: pct !== null && pct > HIGH_ECONOMY_PCT,
      conflicts: s.economyConflicts ?? s.signalCounts?.economyConflict ?? 0,
      budget,
      subordinates,
      realSubCount: subordinates.filter(sub => sub.name !== ORG_ITSELF).length,
      deptOnly,
    };
  });
}

/**
 * Стабильная сортировка строк ГРБС по колонке таблицы (не мутирует вход).
 * Строки без доли (лимита нет) всегда уходят вниз в обоих направлениях:
 * «нет плана» — это отсутствие величины, ему нечего делать ни в голове
 * списка «самых больших», ни в голове списка «самых маленьких».
 */
export function sortDeptEconomy(rows: DeptEconomy[], field: SortField, dir: SortDir): DeptEconomy[] {
  const mul = dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    switch (field) {
      case 'dept': return mul * a.dept.localeCompare(b.dept, 'ru');
      case 'limit': return mul * (a.limit - b.limit);
      case 'price': return mul * (a.price - b.price);
      case 'economy': return mul * (a.economy - b.economy);
      case 'pct': {
        if (a.pct === null && b.pct === null) return 0;
        if (a.pct === null) return 1;
        if (b.pct === null) return -1;
        return mul * (a.pct - b.pct);
      }
      case 'conflicts': return mul * (a.conflicts - b.conflicts);
      case 'subCount': return mul * (a.realSubCount - b.realSubCount);
    }
  });
}

/** Плоский список всех подведов (без ORG_ITSELF), по экономии убыв. */
export function flattenSubordinates(rows: DeptEconomy[]): SubordinateFlat[] {
  return rows
    .flatMap(d => d.subordinates
      .filter(s => s.name !== ORG_ITSELF)
      .map(s => ({ ...s, deptName: d.dept, deptId: d.deptId })))
    .sort((a, b) => b.economy - a.economy);
}

/** Агрегаты по отфильтрованному набору ГРБС (низ таблицы + hero-полоса). */
export interface EconomyTotals {
  economy: number;
  plan: number;
  fact: number;
  /**
   * Доля экономии района: сумма экономии ÷ сумма лимитов × 100.
   * Это ЕДИНСТВЕННОЕ число, которое можно назвать «доля экономии» без
   * оговорок, — оно взвешено объёмом. `null`, когда суммарного лимита нет.
   */
  share: number | null;
  /**
   * Среднее арифметическое долей по управлениям — НЕ доля района.
   * Управление с лимитом в тысячу и управление с лимитом в миллиард входят
   * сюда с одинаковым весом, поэтому подписывать это «долей района» нельзя.
   * `null`, когда ни у одного управления нет лимита.
   */
  avgPct: number | null;
  /** Сколько управлений вообще имеют лимит (знаменатель avgPct). */
  ratedCount: number;
  /** Минимальная/максимальная доля среди управлений с лимитом; null — таких нет. */
  pctMin: number | null;
  pctMax: number | null;
  highCount: number;
  conflicts: number;
  /** Реальные подведы (без ORG_ITSELF). */
  subCount: number;
  /** Управления в режиме «только само управление» — их подведы не сосчитаны. */
  deptOnlyCount: number;
  fbEco: number;
  kbEco: number;
  mbEco: number;
}

export function computeEconomyTotals(rows: DeptEconomy[]): EconomyTotals {
  const t: EconomyTotals = {
    economy: 0, plan: 0, fact: 0,
    share: null, avgPct: null, ratedCount: 0,
    pctMin: null, pctMax: null,
    highCount: 0, conflicts: 0, subCount: 0, deptOnlyCount: 0,
    fbEco: 0, kbEco: 0, mbEco: 0,
  };
  if (rows.length === 0) return t;
  let pctSum = 0;
  for (const d of rows) {
    t.economy += d.economy;
    t.plan += d.limit;
    t.fact += d.price;
    if (d.pct !== null) {
      t.ratedCount += 1;
      pctSum += d.pct;
      t.pctMin = t.pctMin === null ? d.pct : Math.min(t.pctMin, d.pct);
      t.pctMax = t.pctMax === null ? d.pct : Math.max(t.pctMax, d.pct);
    }
    if (d.highEconomy) t.highCount += 1;
    t.conflicts += d.conflicts;
    t.subCount += d.realSubCount;
    if (d.deptOnly) t.deptOnlyCount += 1;
    t.fbEco += d.budget.economyFB;
    t.kbEco += d.budget.economyKB;
    t.mbEco += d.budget.economyMB;
  }
  t.share = pctOf(t.economy, t.plan);
  t.avgPct = t.ratedCount > 0 ? pctSum / t.ratedCount : null;
  return t;
}

/** Точка бар-чарта «Экономия по бюджетам» с разрезом «само/подведы». */
export interface EconomyBarDatum {
  name: string;
  deptId: string;
  fb: number;
  kb: number;
  mb: number;
  total: number;
  /** Доля экономии от лимита, %; null — лимита нет (точка на линии пропускается). */
  pct: number | null;
  /** Экономия самого управления (строка ORG_ITSELF). */
  ownEco: number;
  /** Суммарная экономия реальных подведов. */
  subsEco: number;
  subCount: number;
  /** Топ-3 подведа для тултипа. */
  topSubs: Array<{ name: string; eco: number }>;
}

export function buildBarChartData(rows: DeptEconomy[]): EconomyBarDatum[] {
  return rows.map(d => {
    const orgItself = d.subordinates.find(s => s.name === ORG_ITSELF);
    const realSubs = d.subordinates.filter(s => s.name !== ORG_ITSELF);
    return {
      name: d.dept,
      deptId: d.deptId,
      fb: d.budget.economyFB,
      kb: d.budget.economyKB,
      mb: d.budget.economyMB,
      total: d.economy,
      pct: d.pct,
      ownEco: orgItself?.economy ?? 0,
      subsEco: realSubs.reduce((s, sub) => s + sub.economy, 0),
      subCount: realSubs.length,
      topSubs: realSubs.slice(0, 3).map(s => ({ name: s.name, eco: s.economy })),
    };
  });
}
