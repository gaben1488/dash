import { useMemo } from 'react';
import { useFilteredData } from './useFilteredData';
import { getFilteredEconomyTotal } from '../lib/economy-metrics';
import { aggregateNodeTotals } from '../lib/selectors/totals-aggregation';

// ────────────────────────────────────────────────────────────────
// useMultiDimMetrics — Universal 6-axis data layer
//
// Sits on top of useFilteredData and enriches every department with:
//   1. _org_itself separated as `orgSelf` (named as dept, NOT "_org_itself")
//   2. Real subordinates array (excluding _org_itself)
//   3. Budget decomposition (ФБ/КБ/МБ) at dept + sub level
//   4. Method breakdown (КП/ЕП) at dept level
//   5. Quarter deltas (current vs previous)
//   6. Execution metrics (count + amount)
//
// All 6 filter axes (dept, subordinate, method, activity, budget, period)
// are already handled by useFilteredData — this hook adds structure.
//
// Context: 44-ФЗ weekly report — every metric answers one of 5 questions:
//   Q1: Plan execution (count + amount)
//   2 кв: Budget decomposition (ФБ/КБ/МБ)
//   Q3: Economy / AD flag
//   4 кв: ЕП vs КП share
//   Q5: Recommendations
// ────────────────────────────────────────────────────────────────

// ── Types ──

export interface BudgetBreakdown {
  planFB: number; planKB: number; planMB: number;
  factFB: number; factKB: number; factMB: number;
  economyFB: number; economyKB: number; economyMB: number;
}

export interface ExecutionMetrics {
  planTotal: number;
  factTotal: number;
  executionPct: number;
  planCount: number;
  factCount: number;
  execCountPct: number;
  economyTotal: number;
  economyPct: number;
  competitiveCount: number;
  epCount: number;
  epSharePct: number;
  budget: BudgetBreakdown;
}

export interface SubordinateEntry {
  name: string;
  displayName: string;
  rowCount: number;
  metrics: ExecutionMetrics;
}

export interface QuarterDelta {
  quarter: string;
  plan: number;
  fact: number;
  execPct: number;
  economy: number;
}

export interface DeptMetrics {
  /** Department short name (e.g. "УО", "УЭР") */
  dept: string;
  /** Department English ID (e.g. "uo", "uer") */
  deptId: string;
  /** Full department name */
  deptName: string;
  /** Aggregate metrics (org itself + all subordinates) */
  total: ExecutionMetrics;
  /** Org-itself metrics (real _org_itself data row, named as dept name) */
  orgSelf: SubordinateEntry | null;
  /** Real subordinates (excluding _org_itself), sorted by planTotal desc */
  realSubs: SubordinateEntry[];
  /** Number of real subordinates */
  realSubCount: number;
  /** Quarterly data for sparklines and deltas */
  quarters: QuarterDelta[];
  /** Delta vs previous quarter */
  delta: {
    execPctChange: number;
    execCountPctChange: number;
    economyChange: number;
  } | null;
  /** Economy conflicts count */
  economyConflicts: number;
  /** Raw department data for advanced use */
  raw: any;
}

export interface MultiDimResult {
  /** Enriched department list */
  departments: DeptMetrics[];
  /** Global aggregates */
  totals: ExecutionMetrics;
  /** Global delta (current quarter vs previous) */
  globalDelta: {
    execPctChange: number;
    execCountPctChange: number;
    economyChange: number;
  } | null;
  /** Quarterly global sparkline data */
  quarterSpark: QuarterDelta[];
  /** All real subordinates flattened (for DataBrowser / subordinate views) */
  allSubs: Array<SubordinateEntry & { dept: string; deptId: string }>;
  /** Passthrough from useFilteredData */
  fd: ReturnType<typeof useFilteredData>;
}

export type FilteredDataResult = ReturnType<typeof useFilteredData>;

// ── Helpers ──

const EMPTY_BUDGET: BudgetBreakdown = {
  planFB: 0, planKB: 0, planMB: 0,
  factFB: 0, factKB: 0, factMB: 0,
  economyFB: 0, economyKB: 0, economyMB: 0,
};

function safePct(num: number, den: number): number {
  return den > 0 ? +((num / den) * 100).toFixed(1) : 0;
}

/** Порядок кварталов — один разделяемый массив, а не новый на каждое управление. */
const QUARTER_KEYS = ['q1', 'q2', 'q3', 'q4'] as const;

/** Год целиком и оба способа — когда период не передан (частичные фикстуры). */
const WHOLE_YEAR = {
  periodKey: 'year' as const,
  coveredQuarters: [] as string[],
  fullQuarters: [] as string[],
  partialMonths: [] as number[],
  useMonthLevel: false,
  hasActiveMonths: false,
};
const BOTH_METHODS = { showKP: true, showEP: true, activeMonths: new Set<number>(), hasMonthData: false };

/** Метрики узла за ВЫБРАННЫЙ период (одно правило с итогами страницы). */
function buildExecMetricsForPeriod(node: any, fd: FilteredDataResult): ExecutionMetrics {
  const n = aggregateNodeTotals(node, fd.periodResolution ?? WHOLE_YEAR, fd.nodeAggregateOpts ?? BOTH_METHODS);
  const totalProc = n.kp + n.ep;
  return {
    planTotal: n.planTotal,
    factTotal: n.factTotal,
    executionPct: safePct(n.factTotal, n.planTotal),
    planCount: n.planCount,
    factCount: n.factCount,
    execCountPct: safePct(n.factCount, n.planCount),
    economyTotal: n.economyTotal,
    economyPct: safePct(n.economyTotal, n.planTotal),
    competitiveCount: n.kp,
    epCount: n.ep,
    epSharePct: safePct(n.ep, totalProc),
    budget: n.budget,
  };
}

function buildSubEntry(sub: any, displayName: string, fd: FilteredDataResult): SubordinateEntry {
  return {
    name: sub.name,
    displayName,
    rowCount: sub.rowCount ?? 0,
    // Подвед считается за выбранный период. Раньше здесь брались годовые поля,
    // из-за чего сумма подведов не сходилась с управлением при выборе квартала.
    metrics: buildExecMetricsForPeriod(sub, fd),
  };
}

function sumBudgets(a: BudgetBreakdown, b: BudgetBreakdown): BudgetBreakdown {
  return {
    planFB: a.planFB + b.planFB, planKB: a.planKB + b.planKB, planMB: a.planMB + b.planMB,
    factFB: a.factFB + b.factFB, factKB: a.factKB + b.factKB, factMB: a.factMB + b.factMB,
    economyFB: a.economyFB + b.economyFB, economyKB: a.economyKB + b.economyKB, economyMB: a.economyMB + b.economyMB,
  };
}

// ── Builder ──

export function buildMultiDimMetricsFromFilteredData(fd: FilteredDataResult): Omit<MultiDimResult, 'fd'> {
    const departments: DeptMetrics[] = fd.depts.map((d: any) => {
      const deptShort = d.department?.nameShort ?? d.department?.id ?? '?';
      const deptId = d.department?.id ?? '';
      const deptName = d.department?.name ?? deptShort;

      // ── Separate _org_itself from real subordinates ──
      const allSubs: any[] = d.subordinates ?? [];
      const orgSelfRaw = allSubs.find((s: any) => s.name === '_org_itself');
      const realSubsRaw = allSubs.filter((s: any) => s.name !== '_org_itself');

      const orgSelf = orgSelfRaw
        ? buildSubEntry(orgSelfRaw, deptShort, fd) // Named as dept, NOT "_org_itself"
        : null;

      const realSubs = realSubsRaw
        .map((s: any) => buildSubEntry(s, s.name, fd))
        .sort((a, b) => b.metrics.planTotal - a.metrics.planTotal);

      // ── Метрики управления за ВЫБРАННЫЙ период ──
      // Было: брались годовые поля d.planTotal / d.factTotal / competitiveCount /
      // soleCount, а бюджет суммировался по q1..q4 независимо от выбора. Итог
      // страницы при этом считался за период — целое и части расходились.
      // Стало: то же ядро, что и у итогов (aggregateNodeTotals).
      const periodTotals = buildExecMetricsForPeriod(d, fd);

      // Оверрайд активен при фильтре по подведомственным или виду деятельности:
      // useFilteredData уже сузил суммы управления, и это сужение главнее.
      const deptOverride = fd.deptCardOverrides[deptId];
      const totalPlan = deptOverride?.planTotal ?? periodTotals.planTotal;
      const totalFact = deptOverride?.factTotal ?? periodTotals.factTotal;
      const totalExecPct = deptOverride?.executionPercent ?? safePct(totalFact, totalPlan);

      const competitiveCount = periodTotals.competitiveCount;
      const epCount = periodTotals.epCount;
      const economyTotal = periodTotals.economyTotal;
      const deptBudget: BudgetBreakdown = periodTotals.budget;
      const planCount = periodTotals.planCount;
      const factCount = periodTotals.factCount;

      const total: ExecutionMetrics = {
        planTotal: totalPlan,
        factTotal: totalFact,
        executionPct: typeof totalExecPct === 'number' ? totalExecPct : safePct(totalFact, totalPlan),
        planCount,
        factCount,
        execCountPct: periodTotals.execCountPct,
        economyTotal,
        economyPct: safePct(economyTotal, totalPlan),
        competitiveCount,
        epCount,
        epSharePct: periodTotals.epSharePct,
        budget: deptBudget,
      };

      // ── Quarterly data ──
      const quarters: QuarterDelta[] = QUARTER_KEYS.map(qk => {
        const q = d.quarters?.[qk];
        return {
          quarter: qk,
          plan: q?.planTotal ?? 0,
          fact: q?.factTotal ?? 0,
          execPct: q?.executionPct ?? 0,
          economy: q?.economyTotal ?? 0,
        };
      });

      // ── Delta (current quarter vs previous) ──
      const curIdx = fd.periodKey.startsWith('q')
        ? QUARTER_KEYS.indexOf(fd.periodKey as typeof QUARTER_KEYS[number])
        : QUARTER_KEYS.length - 1;
      const prevIdx = curIdx > 0 ? curIdx - 1 : -1;
      let delta: DeptMetrics['delta'] = null;
      if (prevIdx >= 0) {
        const cur = quarters[curIdx];
        const prev = quarters[prevIdx];
        if (cur && prev && (prev.plan > 0 || cur.plan > 0)) {
          delta = {
            execPctChange: cur.execPct - prev.execPct,
            execCountPctChange: 0, // No quarterly count-pct available at dept level
            economyChange: cur.economy - prev.economy,
          };
        }
      }

      return {
        dept: deptShort,
        deptId,
        deptName,
        total,
        orgSelf,
        realSubs,
        realSubCount: realSubs.length,
        quarters,
        delta,
        economyConflicts: d.economyConflicts ?? 0,
        raw: d,
      } satisfies DeptMetrics;
    });

    // ── Global totals ──
    const gBudget: BudgetBreakdown = departments.reduce(
      (acc, d) => sumBudgets(acc, d.total.budget),
      { ...EMPTY_BUDGET },
    );
    const globalEconomyTotal = getFilteredEconomyTotal(fd);

    const totals: ExecutionMetrics = {
      planTotal: fd.totalPlan,
      factTotal: fd.totalFact,
      executionPct: fd.totalPlan > 0 ? safePct(fd.totalFact, fd.totalPlan) : 0,
      planCount: fd.totalPlanCount,
      factCount: fd.totalFactCount,
      execCountPct: fd.overallExecCountPct ?? 0,
      economyTotal: globalEconomyTotal,
      economyPct: fd.totalPlan > 0 ? safePct(globalEconomyTotal, fd.totalPlan) : 0,
      competitiveCount: fd.totalKP,
      epCount: fd.totalEP,
      epSharePct: safePct(fd.totalEP, fd.totalKP + fd.totalEP),
      budget: gBudget,
    };

    // ── Global quarterly spark ──
    const quarterSpark: QuarterDelta[] = QUARTER_KEYS.map(qk => {
      let plan = 0, fact = 0, eco = 0;
      for (const d of fd.depts) {
        const q = d.quarters?.[qk];
        if (q) { plan += q.planTotal ?? 0; fact += q.factTotal ?? 0; eco += q.economyTotal ?? 0; }
      }
      return { quarter: qk, plan, fact, execPct: safePct(fact, plan), economy: eco };
    });

    // ── Global delta ──
    const curIdx = fd.periodKey.startsWith('q')
      ? QUARTER_KEYS.indexOf(fd.periodKey as typeof QUARTER_KEYS[number])
      : QUARTER_KEYS.length - 1;
    const prevIdx = curIdx > 0 ? curIdx - 1 : -1;
    let globalDelta: MultiDimResult['globalDelta'] = null;
    if (prevIdx >= 0 && quarterSpark[curIdx] && quarterSpark[prevIdx]) {
      const cur = quarterSpark[curIdx];
      const prev = quarterSpark[prevIdx];
      globalDelta = {
        execPctChange: cur.execPct - prev.execPct,
        execCountPctChange: 0,
        economyChange: cur.economy - prev.economy,
      };
    }

    // ── All subordinates flattened (excludes _org_itself) ──
    const allSubs: MultiDimResult['allSubs'] = [];
    for (const d of departments) {
      for (const s of d.realSubs) {
        allSubs.push({ ...s, dept: d.dept, deptId: d.deptId });
      }
    }

    return { departments, totals, globalDelta, quarterSpark, allSubs };
}

// ── Hook ──

export function useMultiDimMetrics(): MultiDimResult {
  const fd = useFilteredData();
  return useMemo(() => ({ ...buildMultiDimMetricsFromFilteredData(fd), fd }), [fd]);
}
