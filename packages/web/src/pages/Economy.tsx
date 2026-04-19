import { useState, useMemo, useCallback, Fragment, useRef } from 'react';
import { useStore } from '../store';
import { useFilteredData } from '../hooks/useFilteredData';
// HeroKPICard removed — Economy uses custom dense hero strip
import { KBTooltip } from '../components/ui/kb-tooltip';
import {
  Inbox, Download, ChevronDown, ChevronUp, ChevronRight,
  AlertTriangle, Users, BarChart3, TrendingUp, TrendingDown,
  Minus, ArrowRight, FileText, CircleDot, Filter, Sparkles,
  Building2, Layers, ArrowUpDown, Zap, Shield, Eye, EyeOff,
  ExternalLink, Hash, Percent, DollarSign, Activity,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip,
  ResponsiveContainer, Legend, CartesianGrid, LineChart, Line,
  Cell, ComposedChart, Area,
} from 'recharts';
import clsx from 'clsx';

// ────────────────────────────────────────────────────────────────
// Economy Page — Premium Redesign v2
//
// Design direction (frontend-design skill):
//   TONE: Refined utilitarian — Linear precision meets gov BI
//   DIFFERENTIATION: Dense data-first, oversized hero numbers,
//   budget tricolor woven through every element
//
// Viewport: 1240×480 — compact, no wasted vertical space
//
// Report methodology (Q3 + Q5):
//   "Где экономия?" → Hero strip + budget chart
//   "Какой ГРБС больше?" → Dense rating with inline sparklines
//   "Расхождения?" → Conflict indicators + recommendations
//   "Что делать?" → Inline actions per dept
// ────────────────────────────────────────────────────────────────

type SortField = 'dept' | 'limit' | 'price' | 'economy' | 'pct' | 'conflicts' | 'subCount';
type SortDir = 'asc' | 'desc';

interface BudgetData {
  planFB: number; planKB: number; planMB: number;
  factFB: number; factKB: number; factMB: number;
  economyFB: number; economyKB: number; economyMB: number;
}

interface SubEconomy {
  name: string;
  planTotal: number;
  factTotal: number;
  economy: number;
  pct: number;
  budget?: BudgetData;
}

interface DeptEconomy {
  dept: string;
  deptId: string;
  limit: number;
  price: number;
  economy: number;
  economyOfficial: number | null;
  pct: number;
  highEconomy: boolean;
  conflicts: number;
  budget: BudgetData;
  subordinates: SubEconomy[];
  /** Real subordinate count (excludes _org_itself) */
  realSubCount: number;
}

// ── Budget color tokens ──
const BT = {
  fb: { fill: '#3b82f6', bg: 'bg-blue-500/8', text: 'text-blue-500', dot: 'bg-blue-500', label: 'ФБ' },
  kb: { fill: '#10b981', bg: 'bg-emerald-500/8', text: 'text-emerald-500', dot: 'bg-emerald-500', label: 'КБ' },
  mb: { fill: '#f59e0b', bg: 'bg-amber-500/8', text: 'text-amber-500', dot: 'bg-amber-500', label: 'МБ' },
} as const;

// ── Pct badge with semantic color ──
function PctBadge({ pct, compact }: { pct: number; compact?: boolean }) {
  const cls =
    pct > 25 ? 'bg-red-500/10 text-red-400 ring-red-500/20'
    : pct >= 5 && pct <= 15 ? 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/20'
    : pct < 2 ? 'bg-amber-500/10 text-amber-400 ring-amber-500/20'
    : 'bg-zinc-500/8 text-zinc-400 ring-zinc-500/10';
  return (
    <span className={clsx(
      'inline-flex items-center rounded-md ring-1 ring-inset tabular-nums font-semibold',
      compact ? 'px-1 py-px text-[9px]' : 'px-1.5 py-0.5 text-[10px]',
      cls,
    )}>
      {pct.toFixed(1)}%
    </span>
  );
}

// ── Economy progress bar: visual limit → fact → economy ──
function EconomyProgress({ limit, fact, className }: { limit: number; fact: number; className?: string }) {
  if (limit <= 0) return null;
  const factPct = Math.min((fact / limit) * 100, 100);
  const ecoPct = 100 - factPct;
  return (
    <div className={clsx('relative h-1 rounded-full bg-zinc-800/40 overflow-hidden', className)} title={`Факт ${factPct.toFixed(1)}% / Экономия ${ecoPct.toFixed(1)}%`}>
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-700"
        style={{ width: `${factPct}%` }}
      />
      {ecoPct > 2 && (
        <div
          className="absolute inset-y-0 right-0 rounded-full bg-emerald-500/40 transition-all duration-700"
          style={{ width: `${ecoPct}%` }}
        />
      )}
    </div>
  );
}

// ── Tricolor bar — inline budget split ──
function TriBar({ fb, kb, mb, h = 'h-1' }: { fb: number; kb: number; mb: number; h?: string }) {
  const total = fb + kb + mb;
  if (total <= 0) return <span className="text-zinc-600 text-[10px]">--</span>;
  const pFB = (fb / total) * 100;
  const pKB = (kb / total) * 100;
  return (
    <div className={clsx('w-full rounded-full overflow-hidden flex', h, 'bg-zinc-800/40')}>
      {pFB > 0 && <div className="h-full bg-blue-500 transition-all duration-500" style={{ width: `${pFB}%` }} />}
      {pKB > 0 && <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${pKB}%` }} />}
      {(100 - pFB - pKB) > 0.1 && <div className="h-full bg-amber-500 transition-all duration-500" style={{ width: `${100 - pFB - pKB}%` }} />}
    </div>
  );
}

// ── Micro sparkline (SVG, no recharts overhead) ──
function MiniSpark({ data, color = '#10b981', w = 48, h = 16 }: { data: number[]; color?: string; w?: number; h?: number }) {
  if (!data || data.length < 2 || data.every(v => v === 0)) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`).join(' ');
  return (
    <svg width={w} height={h} className="shrink-0 opacity-60 group-hover/row:opacity-100 transition-opacity">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Sort chevron ──
function SortChevron({ field, active, dir }: { field: SortField; active: SortField; dir: SortDir }) {
  if (field !== active) return <ArrowUpDown size={9} className="text-zinc-600 ml-0.5 opacity-40" />;
  return dir === 'desc'
    ? <ChevronDown size={9} className="text-blue-400 ml-0.5" />
    : <ChevronUp size={9} className="text-blue-400 ml-0.5" />;
}

// ── Budget detail row (inside expanded dept) ──
function BudgetRow({ label, plan, fact, economy, fmt, tk }: {
  label: string; plan: number; fact: number; economy: number;
  fmt: (v: number) => string; tk: 'fb' | 'kb' | 'mb';
}) {
  const t = BT[tk];
  const pct = plan > 0 ? (economy / plan) * 100 : 0;
  return (
    <tr className="text-[10px] border-t border-white/[0.03]">
      <td className="pl-10 pr-2 py-1">
        <span className={clsx('flex items-center gap-1.5 font-medium', t.text)}>
          <span className={clsx('w-1.5 h-1.5 rounded-full', t.dot)} />
          {label}
        </span>
      </td>
      <td className="px-2 py-1 text-right tabular-nums text-zinc-500">{fmt(plan)}</td>
      <td className="px-2 py-1 text-right tabular-nums text-zinc-500">{fmt(fact)}</td>
      <td className="px-2 py-1 text-right tabular-nums text-emerald-400 font-medium">{fmt(economy)}</td>
      <td className="px-2 py-1 text-right"><PctBadge pct={pct} compact /></td>
      <td colSpan={3} />
    </tr>
  );
}

// ── Subordinate row ──
function SubRow({ sub, fmt, onNav }: {
  sub: SubEconomy; fmt: (v: number) => string; onNav?: () => void;
}) {
  return (
    <tr className="text-[10px] border-t border-white/[0.02] hover:bg-white/[0.02] transition-colors group/sub">
      <td className="pl-10 pr-2 py-1">
        <button
          onClick={onNav}
          className="text-zinc-400 hover:text-blue-400 transition-colors text-left truncate max-w-[180px] flex items-center gap-1.5"
          title={sub.name}
        >
          <CircleDot size={7} className="shrink-0 text-zinc-600" />
          <span className="truncate">{sub.name}</span>
          <ExternalLink size={7} className="shrink-0 opacity-0 group-hover/sub:opacity-60 transition-opacity" />
        </button>
      </td>
      <td className="px-2 py-1 text-right tabular-nums text-zinc-500">{fmt(sub.planTotal)}</td>
      <td className="px-2 py-1 text-right tabular-nums text-zinc-500">{fmt(sub.factTotal)}</td>
      <td className="px-2 py-1 text-right tabular-nums text-emerald-400/80">{fmt(sub.economy)}</td>
      <td className="px-2 py-1 text-right"><PctBadge pct={sub.pct} compact /></td>
      <td className="px-2 py-1">
        {sub.budget && <TriBar fb={sub.budget.economyFB} kb={sub.budget.economyKB} mb={sub.budget.economyMB} />}
      </td>
      <td colSpan={2} />
    </tr>
  );
}

// ── Card shell (Linear-style: subtle border, no heavy shadows) ──
function Card({ children, className, accent }: {
  children: React.ReactNode; className?: string;
  accent?: 'emerald' | 'blue' | 'amber' | 'red' | 'purple';
}) {
  const accentGrad = accent
    ? `from-${accent}-500/30 via-${accent}-400/10 to-transparent`
    : 'from-white/[0.06] via-transparent to-transparent';
  return (
    <div className={clsx(
      'relative rounded-xl border border-white/[0.06] bg-white/[0.02]',
      'backdrop-blur-sm overflow-hidden',
      className,
    )}>
      <div className={clsx('absolute top-0 inset-x-0 h-px bg-gradient-to-r', accentGrad)} />
      {children}
    </div>
  );
}

// ── Section header ──
function SectionHead({ icon, title, right }: {
  icon: React.ReactNode; title: string; right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.04]">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-xs font-semibold text-zinc-200 tracking-tight">{title}</span>
      </div>
      {right}
    </div>
  );
}

// ── Custom chart tooltip with dept-own vs subs breakdown ──
function EconomyChartTooltip({ active, payload, formatMoney: fmt }: {
  active?: boolean; payload?: any[]; label?: string; formatMoney: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className="rounded-lg border border-white/[0.08] bg-zinc-900/95 backdrop-blur-sm shadow-2xl px-3 py-2 text-[10px] min-w-[160px]">
      <div className="font-bold text-zinc-200 text-[11px] mb-1.5">{d.name}</div>
      <div className="space-y-1 mb-1.5">
        <div className="flex justify-between gap-4"><span className="text-blue-400">ФБ</span><span className="tabular-nums text-zinc-300">{fmt(d.fb)}</span></div>
        <div className="flex justify-between gap-4"><span className="text-emerald-400">КБ</span><span className="tabular-nums text-zinc-300">{fmt(d.kb)}</span></div>
        <div className="flex justify-between gap-4"><span className="text-amber-400">МБ</span><span className="tabular-nums text-zinc-300">{fmt(d.mb)}</span></div>
      </div>
      <div className="border-t border-white/[0.06] pt-1.5 flex justify-between gap-4">
        <span className="text-zinc-400">Итого</span>
        <span className="font-bold tabular-nums text-emerald-400">{fmt(d.total)}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-zinc-500">Снижение</span>
        <span className="tabular-nums text-purple-400">{d.pct.toFixed(1)}%</span>
      </div>
      {d.subCount > 0 && (
        <div className="border-t border-white/[0.06] mt-1.5 pt-1.5">
          <div className="flex justify-between gap-4 text-zinc-500">
            <span className="flex items-center gap-1"><Building2 size={7} />{d.name} (само)</span>
            <span className="tabular-nums text-blue-300">{fmt(d.ownEco)}</span>
          </div>
          <div className="flex justify-between gap-4 text-zinc-500">
            <span className="flex items-center gap-1"><Layers size={7} />Подведы ({d.subCount})</span>
            <span className="tabular-nums text-zinc-400">{fmt(d.subsEco)}</span>
          </div>
          {d.topSubs?.length > 0 && (
            <div className="mt-1 space-y-px">
              {d.topSubs.map((s: { name: string; eco: number }) => (
                <div key={s.name} className="flex justify-between gap-2 text-[9px]">
                  <span className="text-zinc-600 truncate max-w-[120px]">{s.name}</span>
                  <span className="tabular-nums text-zinc-500">{fmt(s.eco)}</span>
                </div>
              ))}
              {d.subCount > 3 && <div className="text-[8px] text-zinc-700">...ещё {d.subCount - 3}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ════════════════════════════════════════════════════════════════

export function EconomyPage() {
  const { formatMoney, toggleDepartment, toggleSubordinate, navigateTo, period, activeMonths,
    selectedBudgets, selectedMethods, deptOnlyMode, selectedDepartments } = useStore();
  const fd = useFilteredData();

  const [expandedDepts, setExpandedDepts] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<SortField>('economy');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [showBudgetBreakdown, setShowBudgetBreakdown] = useState(false);
  const [tableView, setTableView] = useState<'departments' | 'subordinates'>('departments');
  const [heroMetric, setHeroMetric] = useState<'economy' | 'pct' | 'high' | 'conflicts'>('economy');

  const toggleExpand = useCallback((dept: string) => {
    setExpandedDepts(prev => {
      const next = new Set(prev);
      next.has(dept) ? next.delete(dept) : next.add(dept);
      return next;
    });
  }, []);

  // toggleKPI removed — hero strip uses inline metric selector

  const handleSort = useCallback((field: SortField) => {
    setSortDir(prev => sortField === field ? (prev === 'desc' ? 'asc' : 'desc') : 'desc');
    setSortField(field);
  }, [sortField]);

  // ── Budget filter helpers ──
  const isBudgetFiltered = selectedBudgets.size > 0;
  const bFB = !isBudgetFiltered || selectedBudgets.has('fb');
  const bKB = !isBudgetFiltered || selectedBudgets.has('kb');
  const bMB = !isBudgetFiltered || selectedBudgets.has('mb');

  // ── Method filter helpers ──
  const isMethodFiltered = selectedMethods.size > 0;
  const mKP = !isMethodFiltered || selectedMethods.has('competitive');
  const mEP = !isMethodFiltered || selectedMethods.has('single');

  /** Sum selected budget components */
  const sumBudget = useCallback((fb: number, kb: number, mb: number) =>
    (bFB ? fb : 0) + (bKB ? kb : 0) + (bMB ? mb : 0),
  [bFB, bKB, bMB]);

  // ── Build dept economy data (filter-aware: budget + method + deptOnly) ──
  const deptEconomy: DeptEconomy[] = useMemo(() => {
    const summaries = fd.depts;
    if (!summaries || !Array.isArray(summaries) || summaries.length === 0) return [];

    const periodKey = activeMonths.size > 0
      ? (() => {
          const qMap: Record<string, number[]> = { q1: [1,2,3], q2: [4,5,6], q3: [7,8,9], q4: [10,11,12] };
          const covered = Object.entries(qMap).filter(([, ms]) => ms.some(m => activeMonths.has(m))).map(([q]) => q);
          return covered.length === 1 ? covered[0] : 'year';
        })()
      : (period !== 'year' ? period : 'year');

    return summaries.map((s: any) => {
      const deptKey = s.department?.nameShort ?? s.department?.id ?? '?';
      const isDeptOnly = deptOnlyMode.has(deptKey);

      const q = s.quarters?.[periodKey];
      // Raw budget components
      const planFB = q?.planFB ?? 0, planKB = q?.planKB ?? 0, planMB = q?.planMB ?? 0;
      const factFB = q?.factFB ?? 0, factKB = q?.factKB ?? 0, factMB = q?.factMB ?? 0;
      const rawEcoFB = q?.economyFB ?? (planFB - factFB);
      const rawEcoKB = q?.economyKB ?? (planKB - factKB);
      const rawEcoMB = q?.economyMB ?? (planMB - factMB);

      // Apply budget filter: use only selected budget components
      const limit = isBudgetFiltered
        ? sumBudget(planFB, planKB, planMB)
        : (q?.planTotal ?? s.planTotal ?? 0);
      const price = isBudgetFiltered
        ? sumBudget(factFB, factKB, factMB)
        : (q?.factTotal ?? s.factTotal ?? 0);
      const economy = isBudgetFiltered
        ? sumBudget(rawEcoFB, rawEcoKB, rawEcoMB)
        : (q?.economyTotal ?? s.economyTotal ?? (limit - price));
      const pct = limit > 0 ? (economy / limit) * 100 : 0;

      // Subordinates (respect budget filter + deptOnly mode)
      // Always keep _org_itself even if zeros — it's the dept's own data
      const subs: SubEconomy[] = isDeptOnly ? [] : (s.subordinates ?? [])
        .filter((sub: any) => sub.name === '_org_itself' || (sub.economyTotal ?? 0) !== 0 || (sub.planTotal ?? 0) > 0)
        .map((sub: any) => {
          const sPlanFB = sub.planFB ?? 0, sPlanKB = sub.planKB ?? 0, sPlanMB = sub.planMB ?? 0;
          const sFactFB = sub.factFB ?? 0, sFactKB = sub.factKB ?? 0, sFactMB = sub.factMB ?? 0;
          const sEcoFB = sPlanFB - sFactFB, sEcoKB = sPlanKB - sFactKB, sEcoMB = sPlanMB - sFactMB;
          const sp = isBudgetFiltered ? sumBudget(sPlanFB, sPlanKB, sPlanMB) : (sub.planTotal ?? 0);
          const sf = isBudgetFiltered ? sumBudget(sFactFB, sFactKB, sFactMB) : (sub.factTotal ?? 0);
          const se = isBudgetFiltered ? sumBudget(sEcoFB, sEcoKB, sEcoMB) : (sub.economyTotal ?? (sp - sf));
          return {
            name: sub.name,
            planTotal: sp, factTotal: sf, economy: se,
            pct: sp > 0 ? (se / sp) * 100 : 0,
            budget: {
              planFB: sPlanFB, planKB: sPlanKB, planMB: sPlanMB,
              factFB: sFactFB, factKB: sFactKB, factMB: sFactMB,
              economyFB: sEcoFB, economyKB: sEcoKB, economyMB: sEcoMB,
            },
          };
        })
        .sort((a: SubEconomy, b: SubEconomy) => b.economy - a.economy);

      return {
        dept: deptKey,
        deptId: deptKey,
        limit, price, economy,
        economyOfficial: s.economyTotal ?? null,
        pct,
        highEconomy: pct > 25,
        conflicts: s.economyConflicts ?? s.signalCounts?.economyConflict ?? 0,
        budget: { planFB, planKB, planMB, factFB, factKB, factMB, economyFB: rawEcoFB, economyKB: rawEcoKB, economyMB: rawEcoMB },
        subordinates: subs,
        realSubCount: subs.filter(s => s.name !== '_org_itself').length,
      };
    });
  }, [fd.depts, period, activeMonths, isBudgetFiltered, sumBudget, deptOnlyMode]);

  // ── Sorted ──
  const sortedDeptEconomy = useMemo(() => {
    const sorted = [...deptEconomy];
    const mul = sortDir === 'desc' ? -1 : 1;
    sorted.sort((a, b) => {
      switch (sortField) {
        case 'dept': return mul * a.dept.localeCompare(b.dept, 'ru');
        case 'limit': return mul * (a.limit - b.limit);
        case 'price': return mul * (a.price - b.price);
        case 'economy': return mul * (a.economy - b.economy);
        case 'pct': return mul * (a.pct - b.pct);
        case 'conflicts': return mul * (a.conflicts - b.conflicts);
        case 'subCount': return mul * (a.realSubCount - b.realSubCount);
        default: return 0;
      }
    });
    return sorted;
  }, [deptEconomy, sortField, sortDir]);

  // ── All subs flat (exclude _org_itself) ──
  const allSubordinates = useMemo(() => {
    return deptEconomy.flatMap(d =>
      d.subordinates
        .filter(s => s.name !== '_org_itself')
        .map(s => ({ ...s, deptName: d.dept, deptId: d.deptId }))
    ).sort((a, b) => b.economy - a.economy);
  }, [deptEconomy]);

  // ── Quarterly data (budget-filter-aware) ──
  const quarterlyTrend = useMemo(() => {
    return (['q1', 'q2', 'q3', 'q4'] as const).map(qk => {
      const label = qk.toUpperCase();
      let totalEco = 0, totalPlan = 0, fbEco = 0, kbEco = 0, mbEco = 0;
      for (const s of fd.depts) {
        const q = (s as any).quarters?.[qk];
        if (q) {
          const eFB = q.economyFB ?? 0, eKB = q.economyKB ?? 0, eMB = q.economyMB ?? 0;
          const pFB = q.planFB ?? 0, pKB = q.planKB ?? 0, pMB = q.planMB ?? 0;
          fbEco += eFB; kbEco += eKB; mbEco += eMB;
          totalEco += isBudgetFiltered ? sumBudget(eFB, eKB, eMB) : (q.economyTotal ?? ((q.planTotal ?? 0) - (q.factTotal ?? 0)));
          totalPlan += isBudgetFiltered ? sumBudget(pFB, pKB, pMB) : (q.planTotal ?? 0);
        }
      }
      return { name: label, economy: totalEco, pct: totalPlan > 0 ? (totalEco / totalPlan) * 100 : 0, fb: fbEco, kb: kbEco, mb: mbEco };
    });
  }, [fd.depts, isBudgetFiltered, sumBudget]);

  // ── Per-dept quarterly trend (for chart overlay when multiple depts) ──
  const perDeptQuarterly = useMemo(() => {
    if (fd.depts.length <= 1 || fd.depts.length > 6) return null; // Only show when 2-6 depts
    const DEPT_COLORS_CHART = ['#3b82f6', '#8b5cf6', '#06b6d4', '#f59e0b', '#10b981', '#ef4444'];
    return fd.depts.map((s: any, idx: number) => {
      const id = s.department?.nameShort ?? s.department?.id ?? '?';
      const data = (['q1','q2','q3','q4'] as const).map(qk => {
        const q = s.quarters?.[qk];
        if (!q) return 0;
        return isBudgetFiltered
          ? sumBudget(q.economyFB ?? 0, q.economyKB ?? 0, q.economyMB ?? 0)
          : (q.economyTotal ?? ((q.planTotal ?? 0) - (q.factTotal ?? 0)));
      });
      return { id, data, color: DEPT_COLORS_CHART[idx % DEPT_COLORS_CHART.length] };
    });
  }, [fd.depts, isBudgetFiltered, sumBudget]);

  // Merge per-dept data into quarterly trend for chart
  const quarterlyTrendEnhanced = useMemo(() => {
    if (!perDeptQuarterly) return quarterlyTrend;
    return quarterlyTrend.map((qt, i) => {
      const enhanced: any = { ...qt };
      for (const dept of perDeptQuarterly) {
        enhanced[dept.id] = dept.data[i];
      }
      return enhanced;
    });
  }, [quarterlyTrend, perDeptQuarterly]);

  // ── Per-dept quarterly sparkline data (budget-aware) ──
  const deptSparks = useMemo(() => {
    const map: Record<string, number[]> = {};
    for (const s of fd.depts as any[]) {
      const id = s.department?.nameShort ?? s.department?.id ?? '?';
      map[id] = (['q1','q2','q3','q4'] as const).map(qk => {
        const q = s.quarters?.[qk];
        if (!q) return 0;
        if (isBudgetFiltered) return sumBudget(q.economyFB ?? 0, q.economyKB ?? 0, q.economyMB ?? 0);
        return q.economyTotal ?? ((q.planTotal ?? 0) - (q.factTotal ?? 0));
      });
    }
    return map;
  }, [fd.depts, isBudgetFiltered, sumBudget]);

  // ── Sparklines for KPIs (budget-aware) ──
  const economySpark = useMemo(() =>
    (['q1', 'q2', 'q3', 'q4'] as const).map(qk => {
      let eco = 0;
      for (const s of fd.depts) {
        const q = (s as any).quarters?.[qk];
        if (q) {
          eco += isBudgetFiltered
            ? sumBudget(q.economyFB ?? 0, q.economyKB ?? 0, q.economyMB ?? 0)
            : (q.economyTotal ?? ((q.planTotal ?? 0) - (q.factTotal ?? 0)));
        }
      }
      return eco;
    }), [fd.depts, isBudgetFiltered, sumBudget]);

  const pctSpark = useMemo(() =>
    (['q1', 'q2', 'q3', 'q4'] as const).map(qk => {
      let plan = 0, eco = 0;
      for (const s of fd.depts) {
        const q = (s as any).quarters?.[qk];
        if (q) {
          if (isBudgetFiltered) {
            plan += sumBudget(q.planFB ?? 0, q.planKB ?? 0, q.planMB ?? 0);
            eco += sumBudget(q.economyFB ?? 0, q.economyKB ?? 0, q.economyMB ?? 0);
          } else {
            plan += q.planTotal ?? 0;
            eco += q.economyTotal ?? ((q.planTotal ?? 0) - (q.factTotal ?? 0));
          }
        }
      }
      return plan > 0 ? +(eco / plan * 100).toFixed(1) : 0;
    }), [fd.depts, isBudgetFiltered, sumBudget]);

  // ── Aggregates (must be before any early return) ──
  const totalEconomy = deptEconomy.reduce((s, d) => s + d.economy, 0);
  const totalPlan = deptEconomy.reduce((s, d) => s + d.limit, 0);
  const totalFact = deptEconomy.reduce((s, d) => s + d.price, 0);
  const avgPct = deptEconomy.length > 0 ? deptEconomy.reduce((s, d) => s + d.pct, 0) / deptEconomy.length : 0;
  const totalHighEconomy = deptEconomy.filter(d => d.highEconomy).length;
  const totalConflicts = deptEconomy.reduce((s, d) => s + d.conflicts, 0);
  const totalSubs = deptEconomy.reduce((s, d) => s + d.realSubCount, 0);
  const totalFbEco = deptEconomy.reduce((s, d) => s + d.budget.economyFB, 0);
  const totalKbEco = deptEconomy.reduce((s, d) => s + d.budget.economyKB, 0);
  const totalMbEco = deptEconomy.reduce((s, d) => s + d.budget.economyMB, 0);

  const ecoTrend = economySpark.length >= 2
    ? economySpark[3] > economySpark[2] ? 'up' as const
      : economySpark[3] < economySpark[2] ? 'down' as const
      : 'stable' as const
    : undefined;

  // ── Deltas: compare last non-zero quarter vs previous ──
  const lastQIdx = economySpark.reduce((last, v, i) => v !== 0 ? i : last, -1);
  const prevQIdx = lastQIdx > 0 ? lastQIdx - 1 : -1;
  const deltaEconomy = prevQIdx >= 0 ? economySpark[lastQIdx] - economySpark[prevQIdx] : 0;
  const deltaPct = prevQIdx >= 0 ? pctSpark[lastQIdx] - pctSpark[prevQIdx] : 0;
  const deltaLabel = lastQIdx >= 0 ? `Q${lastQIdx + 1} vs Q${prevQIdx + 1}` : '';

  // ── CSV ──
  const downloadCSV = useCallback(() => {
    const headers = [
      'Управление', 'Лимит', 'Факт', 'Экономия', 'СВОД', '%',
      'Лимит ФБ', 'Факт ФБ', 'Эко ФБ', 'Лимит КБ', 'Факт КБ', 'Эко КБ',
      'Лимит МБ', 'Факт МБ', 'Эко МБ', '>25%', 'Конфликты', 'Подведы',
    ];
    const rows = deptEconomy.flatMap(d => {
      const b = d.budget;
      const main = [
        d.dept, d.limit.toFixed(2), d.price.toFixed(2), d.economy.toFixed(2),
        d.economyOfficial != null ? d.economyOfficial.toFixed(2) : '',
        d.pct.toFixed(1),
        b.planFB.toFixed(2), b.factFB.toFixed(2), b.economyFB.toFixed(2),
        b.planKB.toFixed(2), b.factKB.toFixed(2), b.economyKB.toFixed(2),
        b.planMB.toFixed(2), b.factMB.toFixed(2), b.economyMB.toFixed(2),
        d.highEconomy ? 'Да' : 'Нет', d.conflicts, d.realSubCount,
      ].join(';');
      const subRows = d.subordinates.map(s =>
        [`  ${s.name}`, s.planTotal.toFixed(2), s.factTotal.toFixed(2), s.economy.toFixed(2),
         '', s.pct.toFixed(1), '', '', '', '', '', '', '', '', '', '', '', ''].join(';')
      );
      return [main, ...subRows];
    });
    const bom = '\uFEFF';
    const csv = bom + headers.join(';') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `economy_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  }, [deptEconomy]);

  const handleBarClick = useCallback((data: any) => {
    if (data?.activePayload?.[0]?.payload?.deptId) {
      toggleDepartment(data.activePayload[0].payload.deptId);
    }
  }, [toggleDepartment]);

  const navigateToSub = useCallback((deptId: string, subName?: string) => {
    if (subName) toggleSubordinate(subName);
    toggleDepartment(deptId);
    navigateTo('data');
  }, [toggleDepartment, toggleSubordinate, navigateTo]);

  const barChartData = useMemo(() =>
    sortedDeptEconomy.map(d => {
      const orgItself = d.subordinates.find(s => s.name === '_org_itself');
      const realSubs = d.subordinates.filter(s => s.name !== '_org_itself');
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
    }),
  [sortedDeptEconomy]);

  // ── Empty state (after all hooks) ──
  if (deptEconomy.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center mx-auto">
            <Inbox className="text-emerald-500/60" size={24} />
          </div>
          <p className="text-sm font-medium text-zinc-400">Нет данных по экономии</p>
          <p className="text-[11px] text-zinc-600 max-w-xs leading-relaxed">
            Экономия = лимит программы - цена контракта. Данные появятся после загрузки из Google Sheets.
          </p>
        </div>
      </div>
    );
  }

  // ── Sortable column header ──
  const TH = ({ label, field, metric, align = 'right', w }: {
    label: string; field: SortField; metric?: string; align?: 'left' | 'right' | 'center'; w?: string;
  }) => (
    <th
      className={clsx(
        'px-2 py-1.5 text-[9px] font-bold uppercase tracking-widest cursor-pointer select-none whitespace-nowrap',
        'text-zinc-500 hover:text-zinc-300 transition-colors',
        align === 'left' ? 'text-left' : align === 'center' ? 'text-center' : 'text-right',
        w,
      )}
      onClick={() => handleSort(field)}
    >
      {metric ? (
        <KBTooltip metric={metric} side="top" showIcon>
          <span className="inline-flex items-center gap-0.5">
            {label}<SortChevron field={field} active={sortField} dir={sortDir} />
          </span>
        </KBTooltip>
      ) : (
        <span className="inline-flex items-center gap-0.5">
          {label}<SortChevron field={field} active={sortField} dir={sortDir} />
        </span>
      )}
    </th>
  );

  return (
    <div className="space-y-2.5">
      {/* Assertion banner — anti-slop: insight drives the page */}
      {(() => {
        const highEconomyCount = deptEconomy.filter(d => d.highEconomy).length;
        const budgetTag = isBudgetFiltered
          ? ` [${[bFB && 'ФБ', bKB && 'КБ', bMB && 'МБ'].filter(Boolean).join('+')}]`
          : '';
        const methodTag = isMethodFiltered
          ? ` (${[mKP && 'КП', mEP && 'ЕП'].filter(Boolean).join('+')})`
          : '';
        const deptOnlyTag = deptOnlyMode.size > 0
          ? ` • только упр.: ${[...deptOnlyMode].join(', ')}`
          : '';
        const suffix = `${budgetTag}${methodTag}${deptOnlyTag}`;
        if (highEconomyCount > 0) {
          return (
            <div className="px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 text-xs text-amber-700 dark:text-amber-300 font-medium">
              {formatMoney(totalEconomy)} экономии{suffix} • {highEconomyCount} {highEconomyCount === 1 ? 'строка' : 'строк'} &gt;25% — требуют проверки по ст.37 44-ФЗ
            </div>
          );
        }
        return (
          <div className="px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700/40 text-xs text-emerald-700 dark:text-emerald-300 font-medium">
            {formatMoney(totalEconomy)} экономии{suffix} • Все показатели в норме
          </div>
        );
      })()}

      {/* ═══ HERO COMMAND STRIP — dense, multidimensional, zero wasted space ═══ */}
      <Card accent="emerald" className="animate-[slideUp_400ms_ease-out]">
        <div className="grid grid-cols-[1fr_1px_auto] lg:grid-cols-[2fr_1px_auto_1px_auto]">

          {/* ── LEFT: 4 metrics as clickable selectors ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4">
            {([
              { key: 'economy' as const, label: 'Экономия', value: formatMoney(totalEconomy),
                sub: `${formatMoney(totalPlan)} → ${formatMoney(totalFact)}`,
                delta: deltaEconomy !== 0 ? formatMoney(Math.abs(deltaEconomy)) : null,
                deltaUp: deltaEconomy > 0, deltaLabel,
                color: 'text-emerald-400', metric: 'total_economy',
                status: totalEconomy < 0 ? 'border-red-500/40' : '',
                spark: economySpark },
              { key: 'pct' as const, label: 'Снижение', value: `${avgPct.toFixed(1)}%`,
                sub: `мин ${Math.min(...deptEconomy.map(d => d.pct)).toFixed(1)}% / макс ${Math.max(...deptEconomy.map(d => d.pct)).toFixed(1)}%`,
                delta: deltaPct !== 0 ? `${Math.abs(deltaPct).toFixed(1)}%` : null,
                deltaUp: deltaPct > 0, deltaLabel,
                color: avgPct > 25 ? 'text-red-400' : 'text-blue-400', metric: 'avg_reduction_pct',
                status: avgPct > 25 ? 'border-red-500/40' : '',
                spark: pctSpark },
              { key: 'high' as const, label: '>25%', value: String(totalHighEconomy),
                sub: totalHighEconomy > 0 ? deptEconomy.filter(d => d.highEconomy).map(d => d.dept).join(', ') : 'норма',
                delta: null, deltaUp: false, deltaLabel: '',
                color: totalHighEconomy > 0 ? 'text-red-400' : 'text-emerald-400', metric: 'high_economy_count',
                status: totalHighEconomy > 0 ? 'border-red-500/40' : '',
                spark: null },
              { key: 'conflicts' as const, label: 'Расхождения', value: String(totalConflicts),
                sub: totalConflicts > 0 ? deptEconomy.filter(d => d.conflicts > 0).map(d => `${d.dept}(${d.conflicts})`).join(', ') : 'УФБП/ГРБС ОК',
                delta: null, deltaUp: false, deltaLabel: '',
                color: totalConflicts > 0 ? 'text-amber-400' : 'text-emerald-400', metric: 'economy_conflicts',
                status: totalConflicts > 3 ? 'border-red-500/40' : totalConflicts > 0 ? 'border-amber-500/40' : '',
                spark: null },
            ]).map((m, i) => (
              <button
                key={m.key}
                onClick={() => setHeroMetric(m.key)}
                className={clsx(
                  'relative px-3 py-2 text-left transition-all group/metric',
                  heroMetric === m.key
                    ? 'bg-white/[0.04]'
                    : 'hover:bg-white/[0.02]',
                  i > 0 && 'border-l border-white/[0.04]',
                  m.status,
                )}
              >
                {heroMetric === m.key && (
                  <div className="absolute bottom-0 inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent" />
                )}
                <KBTooltip metric={m.metric} side="bottom" showIcon>
                  <div className="min-w-0">
                    <div className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-0.5">{m.label}</div>
                    <div className="flex items-baseline gap-1">
                      <span className={clsx('text-sm font-black tabular-nums leading-none tracking-tight', m.color)}>{m.value}</span>
                      {m.delta && (
                        <span className={clsx(
                          'inline-flex items-center gap-px text-[7px] font-bold tabular-nums whitespace-nowrap',
                          m.deltaUp ? 'text-emerald-400' : 'text-red-400',
                        )} title={m.deltaLabel}>
                          {m.deltaUp ? '↑' : '↓'}{m.delta}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      {m.spark && <MiniSpark data={m.spark} w={40} h={10} color={m.color.includes('red') ? '#ef4444' : '#10b981'} />}
                      <span className="text-[8px] text-zinc-600 truncate" title={m.sub}>{m.sub}</span>
                    </div>
                  </div>
                </KBTooltip>
              </button>
            ))}
          </div>

          {/* ── Divider ── */}
          <div className="bg-white/[0.06] hidden lg:block" />

          {/* ── CENTER: Budget breakdown — compact vertical stack ── */}
          <div className="hidden lg:flex flex-col justify-center px-3 py-1.5 gap-1 min-w-[140px]">
            <div className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">Бюджеты</div>
            <TriBar fb={totalFbEco} kb={totalKbEco} mb={totalMbEco} h="h-1.5" />
            <div className="flex flex-col gap-px">
              {([
                { label: 'ФБ', val: totalFbEco, color: 'text-blue-400', dot: 'bg-blue-500' },
                { label: 'КБ', val: totalKbEco, color: 'text-emerald-400', dot: 'bg-emerald-500' },
                { label: 'МБ', val: totalMbEco, color: 'text-amber-400', dot: 'bg-amber-500' },
              ]).map(b => (
                <div key={b.label} className="flex items-center gap-1">
                  <span className={clsx('w-1 h-1 rounded-full shrink-0', b.dot)} />
                  <span className="text-[8px] text-zinc-500 w-4">{b.label}</span>
                  <span className={clsx('text-[9px] font-bold tabular-nums', b.color)}>{formatMoney(b.val)}</span>
                  <span className="text-[8px] text-zinc-600 ml-auto">{totalEconomy > 0 ? `${((b.val / totalEconomy) * 100).toFixed(0)}%` : ''}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Divider ── */}
          <div className="bg-white/[0.06] hidden lg:block" />

          {/* ── RIGHT: Top dept mini-ranking ── */}
          <div className="hidden lg:block px-3 py-1.5 min-w-[140px] max-w-[170px]">
            <div className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Топ по экономии</div>
            {sortedDeptEconomy.slice(0, 4).map((d, i) => (
              <button
                key={d.deptId}
                onClick={() => toggleDepartment(d.deptId)}
                className="w-full flex items-center gap-1.5 py-0.5 hover:bg-white/[0.03] rounded transition-colors group/rank"
              >
                <span className="text-[9px] font-bold text-zinc-600 w-3">{i + 1}</span>
                <span className="text-[10px] text-zinc-400 group-hover/rank:text-blue-400 transition-colors truncate flex-1 text-left">{d.dept}</span>
                <span className="text-[10px] font-bold tabular-nums text-emerald-400">{formatMoney(d.economy)}</span>
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* ═══ AUTO-INSIGHT: one-sentence smart summary ═══ */}
      <div className="flex items-center gap-2 px-1 animate-[fadeIn_500ms_ease-out_200ms_both]">
        <Activity size={10} className="text-emerald-500/60 shrink-0" />
        <p className="text-[10px] text-zinc-500 leading-relaxed">
          {(() => {
            const topDept = sortedDeptEconomy[0];
            const parts: string[] = [];
            parts.push(`Экономия ${formatMoney(totalEconomy)} (${(totalPlan > 0 ? (totalEconomy / totalPlan) * 100 : 0).toFixed(1)}% от лимита).`);
            if (topDept) parts.push(`Лидер — ${topDept.dept} (${formatMoney(topDept.economy)}).`);
            const mbShare = totalEconomy > 0 ? ((totalMbEco / totalEconomy) * 100).toFixed(0) : '0';
            parts.push(`МБ = ${mbShare}% экономии.`);
            if (totalHighEconomy > 0) parts.push(`${totalHighEconomy} ГРБС с экономией >25% — проверить ст.37 44-ФЗ.`);
            if (totalConflicts > 0) parts.push(`${totalConflicts} расхождений УФБП/ГРБС.`);
            return parts.join(' ');
          })()}
        </p>
      </div>

      {/* ═══ CHARTS: Budget chart (always visible) + Trend ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-2">

        {/* ── Budget Chart (3/5) ── */}
        <Card className="lg:col-span-3" accent="emerald">
          <SectionHead
            icon={<BarChart3 size={13} className="text-emerald-400" />}
            title="Экономия по бюджетам"
            right={
              <div className="flex items-center gap-3">
                {(['fb','kb','mb'] as const).map(k => (
                  <span key={k} className="flex items-center gap-1 text-[9px] text-zinc-500">
                    <span className={clsx('w-1.5 h-1.5 rounded-sm', BT[k].dot)} />
                    {BT[k].label}
                  </span>
                ))}
                <span className="text-[8px] text-zinc-700">клик = фильтр</span>
              </div>
            }
          />
          <div className="p-3 h-48">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={barChartData}
                margin={{ top: 4, right: 8, bottom: 0, left: 8 }}
                onClick={handleBarClick}
                className="cursor-pointer"
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#71717a' }} axisLine={false} tickLine={false} interval={0} angle={-30} textAnchor="end" height={35} />
                <YAxis yAxisId="left" tick={{ fontSize: 9, fill: '#52525b' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : String(v)} width={42} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9, fill: '#52525b' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v.toFixed(0)}%`} width={30} />
                <RechartsTooltip
                  content={<EconomyChartTooltip formatMoney={formatMoney} />}
                  cursor={{ fill: 'rgba(59, 130, 246, 0.04)' }}
                />
                <Bar yAxisId="left" dataKey="fb" name="ФБ" stackId="eco" fill={BT.fb.fill} radius={[0,0,0,0]} />
                <Bar yAxisId="left" dataKey="kb" name="КБ" stackId="eco" fill={BT.kb.fill} radius={[0,0,0,0]} />
                <Bar yAxisId="left" dataKey="mb" name="МБ" stackId="eco" fill={BT.mb.fill} radius={[2,2,0,0]} />
                <Line yAxisId="right" type="monotone" dataKey="pct" name="% снижения" stroke="#a855f7" strokeWidth={1.5} strokeDasharray="4 2" dot={{ r: 2, fill: '#a855f7', strokeWidth: 0 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* ── Quarterly Trend (2/5) ── */}
        <Card className="lg:col-span-2" accent="blue">
          <SectionHead
            icon={<TrendingUp size={13} className="text-blue-400" />}
            title="Тренд по кварталам"
            right={
              <button
                onClick={() => setShowBudgetBreakdown(!showBudgetBreakdown)}
                className={clsx(
                  'text-[9px] font-semibold px-2 py-0.5 rounded-md transition-all',
                  showBudgetBreakdown ? 'bg-emerald-500/10 text-emerald-400' : 'text-zinc-600 hover:text-zinc-300 hover:bg-white/[0.04]',
                )}
              >
                ФБ/КБ/МБ
              </button>
            }
          />
          <div className="p-3 h-48">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={quarterlyTrendEnhanced} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#71717a' }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="left" tick={{ fontSize: 9, fill: '#52525b' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : String(v)} width={42} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9, fill: '#52525b' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v.toFixed(0)}%`} width={28} />
                <RechartsTooltip
                  formatter={(value: number, name: string) => name === '% снижения' ? `${(+value).toFixed(1)}%` : formatMoney(value)}
                  contentStyle={{ fontSize: 10, borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 8px 32px rgba(0,0,0,0.4)', background: '#18181b', color: '#e4e4e7', padding: '6px 10px' }}
                />
                {showBudgetBreakdown ? (
                  <>
                    <Bar yAxisId="left" dataKey="fb" name="ФБ" stackId="b" fill={BT.fb.fill} radius={[0,0,0,0]} />
                    <Bar yAxisId="left" dataKey="kb" name="КБ" stackId="b" fill={BT.kb.fill} radius={[0,0,0,0]} />
                    <Bar yAxisId="left" dataKey="mb" name="МБ" stackId="b" fill={BT.mb.fill} radius={[2,2,0,0]} />
                  </>
                ) : (
                  <Area yAxisId="left" type="monotone" dataKey="economy" name="Экономия" fill="rgba(16,185,129,0.1)" stroke="#10b981" strokeWidth={2} />
                )}
                {/* Per-dept overlay lines when 2-6 depts filtered */}
                {perDeptQuarterly && perDeptQuarterly.map(dept => (
                  <Line key={dept.id} yAxisId="left" type="monotone" dataKey={dept.id} name={dept.id}
                    stroke={dept.color} strokeWidth={1.2} strokeDasharray="3 2"
                    dot={{ r: 2, fill: dept.color, strokeWidth: 0 }} />
                ))}
                <Line yAxisId="right" type="monotone" dataKey="pct" name="% снижения" stroke="#3b82f6" strokeWidth={1.5} strokeDasharray="4 2" dot={{ r: 2.5, fill: '#3b82f6', strokeWidth: 0 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* ═══ ECONOMY TABLE — the hero element ═══ */}
      <Card accent="blue">
        <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.04]">
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-zinc-200 tracking-tight">Экономия по управлениям</span>

            {/* View switcher — pill style */}
            <div className="flex items-center bg-white/[0.04] rounded-lg p-0.5 border border-white/[0.04]">
              {([
                { key: 'departments' as const, icon: Building2, label: 'ГРБС' },
                { key: 'subordinates' as const, icon: Layers, label: `Подведы (${totalSubs})` },
              ]).map(v => (
                <button
                  key={v.key}
                  onClick={() => setTableView(v.key)}
                  className={clsx(
                    'flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold rounded-md transition-all uppercase tracking-wider',
                    tableView === v.key
                      ? 'bg-white/[0.08] text-zinc-200 shadow-sm'
                      : 'text-zinc-600 hover:text-zinc-400',
                  )}
                >
                  <v.icon size={9} />{v.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[9px] text-zinc-600 tabular-nums">
              {tableView === 'departments' ? `${deptEconomy.length} упр.` : `${allSubordinates.length} орг.`}
            </span>
            <button
              onClick={downloadCSV}
              className="flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-zinc-500 hover:text-zinc-300 rounded-lg hover:bg-white/[0.04] transition-all border border-white/[0.04]"
            >
              <Download size={9} /> CSV
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          {tableView === 'departments' ? (
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <TH label="Управление" field="dept" align="left" w="w-[180px]" />
                  <TH label="Лимит" field="limit" metric="plan_total" />
                  <TH label="Факт" field="price" metric="fact_total" />
                  <TH label="Экономия" field="economy" metric="total_economy" />
                  <TH label="%" field="pct" metric="avg_reduction_pct" />
                  <th className="px-2 py-1.5 text-[9px] font-bold uppercase tracking-widest text-zinc-500 text-center w-20">
                    <KBTooltip metric="total_economy" side="top">
                      <span>ФБ/КБ/МБ</span>
                    </KBTooltip>
                  </th>
                  <TH label="AD" field="conflicts" metric="economy_conflicts" align="center" />
                  <TH label="Орг." field="subCount" align="center" />
                </tr>
              </thead>
              <tbody>
                {sortedDeptEconomy.map((d) => {
                  const isExp = expandedDepts.has(d.dept);
                  const b = d.budget;
                  const spark = deptSparks[d.dept];
                  return (
                    <Fragment key={d.dept}>
                      <tr
                        className={clsx(
                          'transition-all duration-150 cursor-pointer group/row border-b',
                          isExp
                            ? 'bg-blue-500/[0.04] border-blue-500/10'
                            : 'border-white/[0.03] hover:bg-white/[0.02]',
                        )}
                        onClick={() => toggleExpand(d.dept)}
                      >
                        <td className="px-2 py-1.5">
                          <div className="flex items-center gap-1.5">
                            <ChevronRight
                              size={11}
                              className={clsx(
                                'text-zinc-600 transition-transform duration-200 shrink-0',
                                isExp && 'rotate-90 text-blue-400',
                              )}
                            />
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleDepartment(d.deptId); }}
                              className="text-[11px] font-bold text-zinc-300 hover:text-blue-400 transition-colors truncate max-w-[140px]"
                              title={d.dept}
                            >
                              {d.dept}
                            </button>
                            {d.highEconomy && (
                              <span className="inline-flex items-center gap-0.5 px-1 py-px rounded bg-red-500/10 text-[8px] font-black text-red-400 tracking-wider">
                                <Zap size={7} />&gt;25%
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-right text-[11px] tabular-nums text-zinc-400">{formatMoney(d.limit)}</td>
                        <td className="px-2 py-1.5 text-right text-[11px] tabular-nums text-zinc-400">{formatMoney(d.price)}</td>
                        <td className="px-2 py-1.5 text-right">
                          <div className="space-y-0.5">
                            <div className="flex items-center justify-end gap-1.5">
                              <MiniSpark data={spark} color={d.economy >= 0 ? '#10b981' : '#ef4444'} />
                              <span className="text-[11px] font-bold tabular-nums text-emerald-400">{formatMoney(d.economy)}</span>
                            </div>
                            <EconomyProgress limit={d.limit} fact={d.price} className="w-full" />
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-right"><PctBadge pct={d.pct} /></td>
                        <td className="px-2 py-1.5 w-20">
                          <TriBar fb={b.economyFB} kb={b.economyKB} mb={b.economyMB} />
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          {d.conflicts > 0 ? (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-400">
                              <AlertTriangle size={9} />{d.conflicts}
                            </span>
                          ) : (
                            <span className="text-[10px] text-emerald-500/60">--</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          {d.realSubCount > 0 ? (
                            <span className={clsx(
                              'text-[10px] tabular-nums font-semibold',
                              isExp ? 'text-blue-400' : 'text-zinc-500',
                            )}>
                              {d.realSubCount}
                            </span>
                          ) : (
                            <span className="text-zinc-700">--</span>
                          )}
                        </td>
                      </tr>

                      {/* Expanded detail */}
                      {isExp && (
                        <>
                          {/* Budget breakdown */}
                          <BudgetRow label="ФБ (федеральный)" plan={b.planFB} fact={b.factFB} economy={b.economyFB} fmt={formatMoney} tk="fb" />
                          <BudgetRow label="КБ (краевой)" plan={b.planKB} fact={b.factKB} economy={b.economyKB} fmt={formatMoney} tk="kb" />
                          <BudgetRow label="МБ (муниципальный)" plan={b.planMB} fact={b.factMB} economy={b.economyMB} fmt={formatMoney} tk="mb" />

                          {/* Dept own + Subordinates drill-down */}
                          {d.subordinates.length > 0 && (() => {
                            // _org_itself = real dept-own data from source (column C = "X"/empty)
                            const orgItself = d.subordinates.find(s => s.name === '_org_itself');
                            const realSubs = d.subordinates.filter(s => s.name !== '_org_itself');
                            return (
                              <>
                                {/* Dept structure header */}
                                <tr className="border-t border-white/[0.03]">
                                  <td colSpan={8} className="pl-8 pr-4 pt-1.5 pb-0.5">
                                    <span className="text-[9px] font-black text-zinc-600 uppercase tracking-[0.15em] flex items-center gap-1.5">
                                      <Building2 size={8} />
                                      Структура расходов
                                    </span>
                                  </td>
                                </tr>

                                {/* Dept own row — from _org_itself data */}
                                {orgItself && (
                                  <tr className="text-[10px] border-t border-white/[0.02] bg-blue-500/[0.03]">
                                    <td className="pl-10 pr-2 py-1">
                                      <span className="flex items-center gap-1.5 font-semibold text-blue-300">
                                        <Building2 size={7} className="shrink-0" />
                                        {d.dept} (само)
                                      </span>
                                    </td>
                                    <td className="px-2 py-1 text-right tabular-nums text-zinc-400">{formatMoney(orgItself.planTotal)}</td>
                                    <td className="px-2 py-1 text-right tabular-nums text-zinc-400">{formatMoney(orgItself.factTotal)}</td>
                                    <td className="px-2 py-1 text-right tabular-nums text-emerald-400 font-medium">{formatMoney(orgItself.economy)}</td>
                                    <td className="px-2 py-1 text-right"><PctBadge pct={orgItself.pct} compact /></td>
                                    <td className="px-2 py-1">
                                      {orgItself.budget && <TriBar fb={orgItself.budget.economyFB} kb={orgItself.budget.economyKB} mb={orgItself.budget.economyMB} />}
                                    </td>
                                    <td colSpan={2} />
                                  </tr>
                                )}

                                {/* Subordinates header */}
                                {realSubs.length > 0 && (
                                  <>
                                    <tr className="border-t border-white/[0.03]">
                                      <td colSpan={8} className="pl-8 pr-4 py-1">
                                        <span className="text-[9px] font-black text-zinc-600 uppercase tracking-[0.15em] flex items-center gap-1.5">
                                          <Layers size={8} />
                                          Подведомственные ({realSubs.length})
                                          <span className="ml-auto text-[8px] font-medium normal-case tracking-normal text-zinc-700">
                                            клик = DataBrowser
                                          </span>
                                        </span>
                                      </td>
                                    </tr>
                                    {realSubs.map(sub => (
                                      <SubRow
                                        key={sub.name}
                                        sub={sub}
                                        fmt={formatMoney}
                                        onNav={() => navigateToSub(d.deptId, sub.name)}
                                      />
                                    ))}
                                  </>
                                )}
                              </>
                            );
                          })()}

                          {/* Inline recommendation */}
                          {(d.highEconomy || d.conflicts > 0) && (
                            <tr className="border-t border-amber-500/10">
                              <td colSpan={8} className="px-8 py-1.5">
                                <div className="flex items-start gap-2 text-[10px]">
                                  <Sparkles size={10} className="text-amber-400 mt-0.5 shrink-0" />
                                  <div className="text-amber-300/80 space-y-0.5">
                                    {d.highEconomy && (
                                      <p>Экономия {d.pct.toFixed(1)}% -- запросить обоснование НМЦК (ст.22) и проверить антидемпинг (ст.37, 44-ФЗ).</p>
                                    )}
                                    {d.conflicts > 0 && (
                                      <p>{d.conflicts} расхождени{d.conflicts === 1 ? 'е' : d.conflicts < 5 ? 'я' : 'й'} УФБП/ГРБС -- направить запрос финансовому органу.</p>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>

              {/* Footer totals */}
              <tfoot>
                <tr className="border-t border-white/[0.08] bg-white/[0.02]">
                  <td className="px-2 py-2 text-[11px] font-black text-zinc-300 uppercase tracking-wider">Итого</td>
                  <td className="px-2 py-2 text-right text-[11px] tabular-nums font-bold text-zinc-300">{formatMoney(totalPlan)}</td>
                  <td className="px-2 py-2 text-right text-[11px] tabular-nums font-bold text-zinc-300">{formatMoney(totalFact)}</td>
                  <td className="px-2 py-2 text-right text-[11px] tabular-nums font-black text-emerald-400">{formatMoney(totalEconomy)}</td>
                  <td className="px-2 py-2 text-right"><PctBadge pct={totalPlan > 0 ? (totalEconomy / totalPlan) * 100 : 0} /></td>
                  <td className="px-2 py-2">
                    <TriBar fb={totalFbEco} kb={totalKbEco} mb={totalMbEco} h="h-1.5" />
                  </td>
                  <td className="px-2 py-2 text-center text-[10px] font-bold text-amber-400">{totalConflicts || '--'}</td>
                  <td className="px-2 py-2 text-center text-[10px] tabular-nums text-zinc-400">{totalSubs}</td>
                </tr>
              </tfoot>
            </table>
          ) : (
            /* ── Subordinates flat view ── */
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <th className="px-2 py-1.5 text-left text-[9px] font-bold uppercase tracking-widest text-zinc-500">Организация</th>
                  <th className="px-2 py-1.5 text-left text-[9px] font-bold uppercase tracking-widest text-zinc-500">ГРБС</th>
                  <th className="px-2 py-1.5 text-right text-[9px] font-bold uppercase tracking-widest text-zinc-500">Лимит</th>
                  <th className="px-2 py-1.5 text-right text-[9px] font-bold uppercase tracking-widest text-zinc-500">Факт</th>
                  <th className="px-2 py-1.5 text-right text-[9px] font-bold uppercase tracking-widest text-zinc-500">Экономия</th>
                  <th className="px-2 py-1.5 text-right text-[9px] font-bold uppercase tracking-widest text-zinc-500">%</th>
                  <th className="px-2 py-1.5 text-center text-[9px] font-bold uppercase tracking-widest text-zinc-500 w-16">Бюджет</th>
                </tr>
              </thead>
              <tbody>
                {allSubordinates.slice(0, 60).map((sub, i) => (
                  <tr
                    key={`${sub.deptId}-${sub.name}-${i}`}
                    className="border-b border-white/[0.02] hover:bg-white/[0.02] transition-colors cursor-pointer group/subrow"
                    onClick={() => navigateToSub(sub.deptId, sub.name)}
                  >
                    <td className="px-2 py-1.5 text-[10px] text-zinc-300 truncate max-w-[200px]" title={sub.name}>
                      <div className="flex items-center gap-1">
                        <span className="truncate">{sub.name}</span>
                        <ExternalLink size={8} className="shrink-0 opacity-0 group-hover/subrow:opacity-40 transition-opacity" />
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      <span className="text-[9px] font-bold text-zinc-500 bg-white/[0.04] px-1.5 py-0.5 rounded">
                        {sub.deptName}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right text-[10px] tabular-nums text-zinc-500">{formatMoney(sub.planTotal)}</td>
                    <td className="px-2 py-1.5 text-right text-[10px] tabular-nums text-zinc-500">{formatMoney(sub.factTotal)}</td>
                    <td className="px-2 py-1.5 text-right text-[10px] tabular-nums font-bold text-emerald-400">{formatMoney(sub.economy)}</td>
                    <td className="px-2 py-1.5 text-right"><PctBadge pct={sub.pct} compact /></td>
                    <td className="px-2 py-1.5 w-16">
                      {sub.budget && <TriBar fb={sub.budget.economyFB} kb={sub.budget.economyKB} mb={sub.budget.economyMB} />}
                    </td>
                  </tr>
                ))}
                {allSubordinates.length > 60 && (
                  <tr>
                    <td colSpan={7} className="px-2 py-2 text-center text-[10px] text-zinc-600">
                      Показано 60 из {allSubordinates.length}. Выберите ГРБС для детализации.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </div>
  );
}
