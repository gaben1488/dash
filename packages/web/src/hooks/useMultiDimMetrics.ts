import { useMemo } from 'react';
import { useFilteredData } from './useFilteredData';
import { useStore } from '../store';

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
//   Q2: Budget decomposition (ФБ/КБ/МБ)
//   Q3: Economy / AD flag
//   Q4: ЕП vs КП share
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

// ── Helpers ──

const EMPTY_BUDGET: BudgetBreakdown = {
  planFB: 0, planKB: 0, planMB: 0,
  factFB: 0, factKB: 0, factMB: 0,
  economyFB: 0, economyKB: 0, economyMB: 0,
};

function safePct(num: number, den: number): number {
  return den > 0 ? +((num / den) * 100).toFixed(1) : 0;
}

function buildBudget(src: any): BudgetBreakdown {
  return {
    planFB: src?.planFB ?? 0, planKB: src?.planKB ?? 0, planMB: src?.planMB ?? 0,
    factFB: src?.factFB ?? 0, factKB: src?.factKB ?? 0, factMB: src?.factMB ?? 0,
    economyFB: src?.economyFB ?? 0, economyKB: src?.economyKB ?? 0, economyMB: src?.economyMB ?? 0,
  };
}

function buildExecMetrics(src: any): ExecutionMetrics {
  const planTotal = src?.planTotal ?? 0;
  const factTotal = src?.factTotal ?? 0;
  const planCount = src?.planCount ?? src?.rowCount ?? 0;
  const factCount = src?.factCount ?? 0;
  const economyTotal = src?.economyTotal ?? 0;
  const competitiveCount = src?.competitiveCount ?? 0;
  const epCount = src?.epCount ?? 0;
  const totalProc = competitiveCount + epCount;

  return {
    planTotal,
    factTotal,
    executionPct: safePct(factTotal, planTotal),
    planCount,
    factCount,
    execCountPct: safePct(factCount, planCount),
    economyTotal,
    economyPct: safePct(economyTotal, planTotal),
    competitiveCount,
    epCount,
    epSharePct: safePct(epCount, totalProc),
    budget: buildBudget(src),
  };
}

function buildSubEntry(sub: any, displayName: string): SubordinateEntry {
  return {
    name: sub.name,
    displayName,
    rowCount: sub.rowCount ?? 0,
    metrics: buildExecMetrics(sub),
  };
}

function sumBudgets(a: BudgetBreakdown, b: BudgetBreakdown): BudgetBreakdown {
  return {
    planFB: a.planFB + b.planFB, planKB: a.planKB + b.planKB, planMB: a.planMB + b.planMB,
    factFB: a.factFB + b.factFB, factKB: a.factKB + b.factKB, factMB: a.factMB + b.factMB,
    economyFB: a.economyFB + b.economyFB, economyKB: a.economyKB + b.economyKB, economyMB: a.economyMB + b.economyMB,
  };
}

// ── Hook ──

export function useMultiDimMetrics(): MultiDimResult {
  const fd = useFilteredData();
  const { selectedBudgets } = useStore();

  return useMemo(() => {
    const departments: DeptMetrics[] = fd.depts.map((d: any) => {
      const deptShort = d.department?.nameShort ?? d.department?.id ?? '?';
      const deptId = d.department?.id ?? '';
      const deptName = d.department?.name ?? deptShort;

      // ── Separate _org_itself from real subordinates ──
      const allSubs: any[] = d.subordinates ?? [];
      const orgSelfRaw = allSubs.find((s: any) => s.name === '_org_itself');
      const realSubsRaw = allSubs.filter((s: any) => s.name !== '_org_itself');

      const orgSelf = orgSelfRaw
        ? buildSubEntry(orgSelfRaw, deptShort) // Named as dept, NOT "_org_itself"
        : null;

      const realSubs = realSubsRaw
        .map((s: any) => buildSubEntry(s, s.name))
        .sort((a, b) => b.metrics.planTotal - a.metrics.planTotal);

      // ── Dept-level total metrics ──
      // Use dept-level data (already aggregated by useFilteredData with sub filter, activity filter etc.)
      const deptOverride = fd.deptCardOverrides[deptId];
      const totalPlan = deptOverride?.planTotal ?? d.planTotal ?? 0;
      const totalFact = deptOverride?.factTotal ?? d.factTotal ?? 0;
      const totalExecPct = deptOverride?.executionPercent ?? d.executionPercent ?? safePct(totalFact, totalPlan);

      const competitiveCount = d.competitiveCount ?? 0;
      const epCount = d.soleCount ?? 0;
      const totalProc = competitiveCount + epCount;
      const economyTotal = d.economyTotal ?? 0;

      // Budget from dept quarters (sum q1-q4)
      let deptBudget: BudgetBreakdown = { ...EMPTY_BUDGET };
      for (const qk of ['q1', 'q2', 'q3', 'q4']) {
        const q = d.quarters?.[qk];
        if (q) deptBudget = sumBudgets(deptBudget, buildBudget(q));
      }

      // Count-based execution from barData
      const barEntry = fd.barData.find((b: any) => b.id === deptId);
      const execCountPct = barEntry?.execCountPct ?? (fd.execCountPctByDeptId[deptId] ?? 0);

      // Plancount/factcount from quarters
      let planCount = 0, factCount = 0;
      for (const qk of ['q1', 'q2', 'q3', 'q4']) {
        const q = d.quarters?.[qk];
        if (q) { planCount += q.planCount ?? 0; factCount += q.factCount ?? 0; }
      }

      const total: ExecutionMetrics = {
        planTotal: totalPlan,
        factTotal: totalFact,
        executionPct: typeof totalExecPct === 'number' ? totalExecPct : safePct(totalFact, totalPlan),
        planCount,
        factCount,
        execCountPct: typeof execCountPct === 'number' ? execCountPct : safePct(factCount, planCount),
        economyTotal,
        economyPct: safePct(economyTotal, totalPlan),
        competitiveCount,
        epCount,
        epSharePct: safePct(epCount, totalProc),
        budget: deptBudget,
      };

      // ── Quarterly data ──
      const quarters: QuarterDelta[] = ['q1', 'q2', 'q3', 'q4'].map(qk => {
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
      const qOrder = ['q1', 'q2', 'q3', 'q4'];
      const curIdx = fd.periodKey.startsWith('q') ? qOrder.indexOf(fd.periodKey) : qOrder.length - 1;
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

    const totals: ExecutionMetrics = {
      planTotal: fd.totalPlan,
      factTotal: fd.totalFact,
      executionPct: fd.totalPlan > 0 ? safePct(fd.totalFact, fd.totalPlan) : 0,
      planCount: fd.totalPlanCount,
      factCount: fd.totalFactCount,
      execCountPct: fd.overallExecCountPct ?? 0,
      economyTotal: fd.totalPlan - fd.totalFact,
      economyPct: fd.totalPlan > 0 ? safePct(fd.totalPlan - fd.totalFact, fd.totalPlan) : 0,
      competitiveCount: fd.totalKP,
      epCount: fd.totalEP,
      epSharePct: safePct(fd.totalEP, fd.totalKP + fd.totalEP),
      budget: gBudget,
    };

    // ── Global quarterly spark ──
    const quarterSpark: QuarterDelta[] = ['q1', 'q2', 'q3', 'q4'].map(qk => {
      let plan = 0, fact = 0, eco = 0;
      for (const d of fd.depts) {
        const q = d.quarters?.[qk];
        if (q) { plan += q.planTotal ?? 0; fact += q.factTotal ?? 0; eco += q.economyTotal ?? 0; }
      }
      return { quarter: qk, plan, fact, execPct: safePct(fact, plan), economy: eco };
    });

    // ── Global delta ──
    const qOrder = ['q1', 'q2', 'q3', 'q4'];
    const curIdx = fd.periodKey.startsWith('q') ? qOrder.indexOf(fd.periodKey) : qOrder.length - 1;
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

    return { departments, totals, globalDelta, quarterSpark, allSubs, fd };
  }, [fd, selectedBudgets]);
}
