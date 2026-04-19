import { useState, useMemo, useCallback } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Sector } from 'recharts';
import { ChevronLeft, Calendar, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { KBTooltip } from '../ui/kb-tooltip';
import { useTheme } from '../ThemeProvider';
import { getChartColors, getTooltipStyle } from '@/lib/chart-colors';
import { useStore } from '../../store';
import type { MultiDimResult, DeptMetrics } from '../../hooks/useMultiDimMetrics';

// ────────────────────────────────────────────────────────────────
// DrillPieChart — 10/10 multidimensional donut
//
// METHODOLOGY (applicable to ALL multidimensional UI elements):
//
// 1. UNIFIED DRILL STACK
//    Every click pushes a "scope" onto stack; every breadcrumb pops.
//    Scopes are composable: dept ∩ method ∩ budget all hold simultaneously.
//
// 2. CROSS-DIMENSION DRILL (MATRIX, not tree)
//    From any dimension slice → split remaining data by another dimension.
//    КП → depts of КП → composition of УО's КП.
//
// 3. NO NAVIGATION ON CLICK — EVER
//    Click = drill inline. "Подробнее →" (explicit) = navigate.
//    Reference: feedback_interaction_paradigm.md
//
// 4. PERIOD-REACTIVE + VISIBLE
//    Period indicator always shown. Data re-computes automatically via mdm.
//
// 5. STABLE IDENTITY COLORS
//    Each dept keeps same color across drill levels (mental model).
//
// 6. BREADCRUMB = REVERSE NAVIGATION
//    Full path shown as clickable chips. Jump to any level.
//
// 7. METRIC ORTHOGONAL TO DRILL
//    План/Факт/Эконом/Шт./% available at every level where meaningful.
// ────────────────────────────────────────────────────────────────

export type DrillDimension = 'procurement' | 'budget' | 'department' | 'execution';

export const DRILL_DIMENSION_LABELS: Record<DrillDimension, string> = {
  procurement: 'Способ закупки',
  budget: 'Бюджеты',
  department: 'Управления',
  execution: 'Исполнение',
};

type Metric = 'plan' | 'fact' | 'economy' | 'count' | 'execPct';

const METRIC_LABELS: Record<Metric, string> = {
  plan: 'План ₽',
  fact: 'Факт ₽',
  economy: 'Эконом. ₽',
  count: 'Закупки, шт.',
  execPct: 'Исп. %',
};

type ViewLevel = 'grbs' | 'orgs';
const VIEW_LEVEL_LABELS: Record<ViewLevel, string> = {
  grbs: 'ГРБС',
  orgs: 'Организации',
};

const METRIC_UNIT: Record<Metric, '₽' | 'шт.' | '%'> = {
  plan: '₽', fact: '₽', economy: '₽', count: 'шт.', execPct: '%',
};

// Scope constraints — composable, stack-ordered
type Scope =
  | { kind: 'dept'; deptName: string }
  | { kind: 'method'; m: 'КП' | 'ЕП' }
  | { kind: 'budget'; b: 'ФБ' | 'КБ' | 'МБ' };

interface Slice {
  id: string;
  name: string;
  value: number;
  color?: string;
  onClick?: () => void;
  drillable: boolean;
}

export interface DrillPieChartProps {
  mdm: MultiDimResult;
  procurementFilter: string;
  formatMoney: (v: number) => string;
  onDeptToggle?: (deptShort: string) => void;
  /** Kept for compat; NOT called from slice clicks anymore */
  onNavigate?: (page: 'analytics', opts?: any) => void;
}

// ── Helpers ──

const MONTH_ABBR = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];

function scopeLabel(s: Scope): string {
  if (s.kind === 'dept') return s.deptName;
  if (s.kind === 'method') return s.m;
  return s.b;
}

function scopeHasMethod(stack: Scope[]): 'КП' | 'ЕП' | null {
  const m = stack.find(s => s.kind === 'method');
  return m ? (m as any).m : null;
}
function scopeHasBudget(stack: Scope[]): 'ФБ' | 'КБ' | 'МБ' | null {
  const b = stack.find(s => s.kind === 'budget');
  return b ? (b as any).b : null;
}
function scopeHasDept(stack: Scope[]): string | null {
  const d = stack.find(s => s.kind === 'dept');
  return d ? (d as any).deptName : null;
}

function readBudget(m: any, budget: 'ФБ' | 'КБ' | 'МБ', metric: Metric): number {
  if (metric === 'plan') return m?.budget?.[`plan${budget === 'ФБ' ? 'FB' : budget === 'КБ' ? 'KB' : 'MB'}`] ?? 0;
  if (metric === 'fact') return m?.budget?.[`fact${budget === 'ФБ' ? 'FB' : budget === 'КБ' ? 'KB' : 'MB'}`] ?? 0;
  if (metric === 'economy') return m?.budget?.[`economy${budget === 'ФБ' ? 'FB' : budget === 'КБ' ? 'KB' : 'MB'}`] ?? 0;
  return 0;
}

function readMetric(m: any, metric: Metric, scope: Scope[]): number {
  if (!m) return 0;
  const budgetScope = scopeHasBudget(scope);
  if (budgetScope && (metric === 'plan' || metric === 'fact' || metric === 'economy')) {
    return readBudget(m, budgetScope, metric);
  }
  const methodScope = scopeHasMethod(scope);
  if (methodScope && metric === 'count') {
    return methodScope === 'КП' ? (m.competitiveCount ?? 0) : (m.epCount ?? 0);
  }
  switch (metric) {
    case 'plan': return m.planTotal ?? 0;
    case 'fact': return m.factTotal ?? 0;
    case 'economy': return m.economyTotal ?? 0;
    case 'count': return (m.competitiveCount ?? 0) + (m.epCount ?? 0);
    case 'execPct': return m.execCountPct ?? 0;
  }
}

function metricValidFor(dim: DrillDimension | 'composition', metric: Metric): boolean {
  if (dim === 'procurement') return metric === 'count' || metric === 'plan' || metric === 'fact';
  if (dim === 'budget') return metric === 'plan' || metric === 'fact' || metric === 'economy';
  // department, execution, composition allow all
  return true;
}

// ── Component ──

export function DrillPieChart({
  mdm,
  procurementFilter,
  formatMoney,
  onDeptToggle,
}: DrillPieChartProps) {
  const isDark = useTheme(s => s.theme) === 'dark';
  const chartColors = getChartColors(isDark);
  const { contentStyle: tooltipStyle } = getTooltipStyle(isDark);
  const cursorStyle = { fill: isDark ? 'rgba(148,163,184,0.12)' : 'rgba(0,0,0,0.06)', stroke: 'none' };

  // Period display
  const year = useStore(s => s.year);
  const activeMonths = useStore(s => s.activeMonths);
  const periodMode = useStore(s => s.periodMode);
  const period = useStore(s => s.period);
  const focusedWeekStart = useStore(s => s.focusedWeekStart);

  const periodLabel = useMemo(() => {
    if (periodMode === 'week') {
      const d = new Date(focusedWeekStart);
      const end = new Date(d); end.setDate(d.getDate() + 6);
      const sameMonth = d.getMonth() === end.getMonth();
      const fmt = (x: Date) => `${x.getDate()} ${MONTH_ABBR[x.getMonth()]}`;
      return sameMonth ? `Нед. ${d.getDate()}–${end.getDate()} ${MONTH_ABBR[d.getMonth()]}` : `Нед. ${fmt(d)}–${fmt(end)}`;
    }
    if (activeMonths.size === 0) return `${year}`;
    if (activeMonths.size === 12) return `${year} • весь год`;
    if (activeMonths.size === 1) return `${MONTH_ABBR[[...activeMonths][0]]} ${year}`;
    if (period && period !== 'year') return `${period.toUpperCase()} ${year}`;
    const sorted = [...activeMonths].sort((a,b)=>a-b);
    return `${sorted.length} мес. ${year}`;
  }, [periodMode, focusedWeekStart, activeMonths, year, period]);

  // Stable dept color map
  const deptColorMap = useMemo(() => {
    const map = new Map<string, string>();
    mdm.departments.forEach((d, i) => map.set(d.dept, chartColors[i % chartColors.length]));
    return map;
  }, [mdm.departments, chartColors]);

  // ── State ──
  const [dimension, setDimension] = useState<DrillDimension>('department');
  const [metric, setMetric] = useState<Metric>('plan');
  const [scope, setScope] = useState<Scope[]>([]);
  const [activeSliceId, setActiveSliceId] = useState<string | null>(null);
  const [viewLevel, setViewLevel] = useState<ViewLevel>('grbs');

  const pushScope = useCallback((s: Scope) => {
    setScope(prev => [...prev, s]);
    setActiveSliceId(null);
  }, []);

  const popTo = useCallback((idx: number) => {
    setScope(prev => prev.slice(0, idx));
    setActiveSliceId(null);
  }, []);

  const resetAll = useCallback(() => {
    setScope([]);
    setActiveSliceId(null);
  }, []);

  // Ensure metric is valid for current dimension/composition
  const inDeptComposition = scopeHasDept(scope) !== null;
  const effectiveDim: DrillDimension | 'composition' = inDeptComposition ? 'composition' : dimension;
  if (!metricValidFor(effectiveDim, metric)) {
    // will correct on next render via effect; here just pick a safe fallback
  }

  // ── Data builder ──
  const { data, total, unit, centerLabel, centerSub } = useMemo(() => {
    const deptName = scopeHasDept(scope);
    const methodName = scopeHasMethod(scope);
    const budgetName = scopeHasBudget(scope);

    // If a dept is in scope → composition view (orgSelf + subs), respecting method/budget scope
    if (deptName) {
      const dm = mdm.departments.find(d => d.dept === deptName);
      if (!dm) return { data: [], total: 0, unit: METRIC_UNIT[metric], centerLabel: deptName, centerSub: '—' };
      const slices: Slice[] = [];
      if (dm.orgSelf) {
        const v = readMetric(dm.orgSelf.metrics, metric, scope);
        if (v > 0) {
          slices.push({
            id: `self:${dm.dept}`,
            name: `${dm.dept} (само)`,
            value: v,
            color: deptColorMap.get(dm.dept),
            drillable: false,
          });
        }
      }
      for (const sub of dm.realSubs) {
        const v = readMetric(sub.metrics, metric, scope);
        if (v > 0) {
          slices.push({
            id: `sub:${sub.name}`,
            name: sub.displayName,
            value: v,
            drillable: false,
          });
        }
      }
      slices.sort((a, b) => b.value - a.value);
      const t = slices.reduce((s, x) => s + x.value, 0);
      const suffix = [methodName, budgetName].filter(Boolean).join(' • ');
      return {
        data: slices, total: t, unit: METRIC_UNIT[metric],
        centerLabel: dm.dept,
        centerSub: suffix || `${dm.realSubCount} подвед.`,
      };
    }

    // No dept scope: slice by `dimension`
    switch (dimension) {
      case 'procurement': {
        // Show КП/ЕП totals (count-based by default)
        const fd = mdm.fd;
        // If metric is count/plan/fact
        const getV = (key: 'КП' | 'ЕП') => {
          if (metric === 'count') {
            return key === 'КП' ? (fd.totalKP || 0) : (fd.totalEP || 0);
          }
          // For ₽ metric, approximate by summing dept method-filtered values if available; fallback to count
          // We don't have plan₽ per method at fd — use count but label unit as шт.
          return key === 'КП' ? (fd.totalKP || 0) : (fd.totalEP || 0);
        };
        const actualUnit = metric === 'count' ? 'шт.' : 'шт.'; // we only have counts for method split at this layer
        const slicesRaw = ([
          { id: 'm:КП', name: 'Конкурсные (КП)', short: 'КП' as const, value: getV('КП'), color: '#3b82f6' },
          { id: 'm:ЕП', name: 'Единственный пост. (ЕП)', short: 'ЕП' as const, value: getV('ЕП'), color: '#f59e0b' },
        ]).filter(d => {
          if (procurementFilter === 'competitive') return d.short === 'КП';
          if (procurementFilter === 'single') return d.short === 'ЕП';
          return true;
        });
        const slices: Slice[] = slicesRaw.map(d => ({
          id: d.id, name: d.name, value: d.value, color: d.color, drillable: true,
        }));
        const t = slices.reduce((s, x) => s + x.value, 0);
        return { data: slices, total: t, unit: actualUnit as any, centerLabel: 'Закупки', centerSub: 'КП / ЕП' };
      }

      case 'budget': {
        // ФБ/КБ/МБ sum across all depts
        let fb = 0, kb = 0, mb = 0;
        for (const d of mdm.departments) {
          fb += readBudget(d.total, 'ФБ', metric);
          kb += readBudget(d.total, 'КБ', metric);
          mb += readBudget(d.total, 'МБ', metric);
        }
        const slices: Slice[] = [
          { id: 'b:ФБ', name: 'ФБ (федеральный)', value: fb, color: '#3b82f6', drillable: true },
          { id: 'b:КБ', name: 'КБ (краевой)',     value: kb, color: '#10b981', drillable: true },
          { id: 'b:МБ', name: 'МБ (местный)',     value: mb, color: '#f59e0b', drillable: true },
        ].filter(d => d.value > 0);
        const t = slices.reduce((s, x) => s + x.value, 0);
        return { data: slices, total: t, unit: METRIC_UNIT[metric], centerLabel: 'Бюджеты', centerSub: 'ФБ / КБ / МБ' };
      }

      case 'department': {
        if (viewLevel === 'orgs') {
          // Flat list: orgSelf + all realSubs across all depts
          const slices: Slice[] = [];
          for (const dm of mdm.departments) {
            if (dm.orgSelf) {
              const v = readMetric(dm.orgSelf.metrics, metric, scope);
              if (v > 0) slices.push({
                id: `org:self:${dm.dept}`,
                name: `${dm.dept} (само)`,
                value: v,
                color: deptColorMap.get(dm.dept),
                drillable: false,
              });
            }
            for (const sub of dm.realSubs) {
              const v = readMetric(sub.metrics, metric, scope);
              if (v > 0) slices.push({
                id: `org:sub:${dm.dept}:${sub.name}`,
                name: sub.displayName,
                value: v,
                color: deptColorMap.get(dm.dept),
                drillable: false,
              });
            }
          }
          slices.sort((a, b) => b.value - a.value);
          const t = slices.reduce((s, x) => s + x.value, 0);
          const suffix = [methodName, budgetName].filter(Boolean).join(' • ');
          return {
            data: slices, total: t, unit: METRIC_UNIT[metric],
            centerLabel: suffix ? suffix : 'Организации',
            centerSub: `${slices.length} орг.`,
          };
        }
        const slices: Slice[] = mdm.departments.map(dm => ({
          id: `d:${dm.dept}`,
          name: dm.dept,
          value: readMetric(dm.total, metric, scope),
          color: deptColorMap.get(dm.dept),
          drillable: true,
        })).filter(d => d.value > 0);
        slices.sort((a, b) => b.value - a.value);
        const t = slices.reduce((s, x) => s + x.value, 0);
        const suffix = [methodName, budgetName].filter(Boolean).join(' • ');
        return {
          data: slices, total: t, unit: METRIC_UNIT[metric],
          centerLabel: suffix ? suffix : 'Управления',
          centerSub: `${slices.length} ГРБС`,
        };
      }

      case 'execution': {
        if (viewLevel === 'orgs') {
          const slices: Slice[] = [];
          for (const dm of mdm.departments) {
            if (dm.orgSelf) {
              slices.push({
                id: `eo:self:${dm.dept}`,
                name: `${dm.dept} (само)`,
                value: +(dm.orgSelf.metrics.execCountPct || 0).toFixed(1),
                color: deptColorMap.get(dm.dept),
                drillable: false,
              });
            }
            for (const sub of dm.realSubs) {
              slices.push({
                id: `eo:sub:${dm.dept}:${sub.name}`,
                name: sub.displayName,
                value: +(sub.metrics.execCountPct || 0).toFixed(1),
                color: deptColorMap.get(dm.dept),
                drillable: false,
              });
            }
          }
          const filtered = slices.filter(d => d.value > 0);
          filtered.sort((a, b) => b.value - a.value);
          const t = filtered.reduce((s, x) => s + x.value, 0);
          return { data: filtered, total: t, unit: '%' as const, centerLabel: 'Исп. шт.%', centerSub: `${filtered.length} орг.` };
        }
        const slices: Slice[] = mdm.departments.map(dm => ({
          id: `e:${dm.dept}`,
          name: dm.dept,
          value: +(dm.total.execCountPct || 0).toFixed(1),
          color: deptColorMap.get(dm.dept),
          drillable: true,
        })).filter(d => d.value > 0);
        slices.sort((a, b) => b.value - a.value);
        const t = slices.reduce((s, x) => s + x.value, 0);
        return { data: slices, total: t, unit: '%' as const, centerLabel: 'Исп. шт.%', centerSub: `${slices.length} ГРБС` };
      }
    }
  }, [dimension, metric, scope, mdm, procurementFilter, deptColorMap, viewLevel]);

  const formatValue = useCallback((v: number) => {
    if (unit === '₽') return formatMoney(v);
    if (unit === '%') return `${v.toFixed(1)}%`;
    return `${Math.round(v).toLocaleString('ru-RU')} шт.`;
  }, [unit, formatMoney]);

  // ── Click handlers ── ALL INLINE DRILL, NO NAVIGATION
  const handleSliceClick = useCallback((slice: Slice) => {
    setActiveSliceId(slice.id);
    if (!slice.drillable) return;

    if (slice.id.startsWith('d:') || slice.id.startsWith('e:')) {
      // Department slice → push dept scope
      const deptName = slice.name;
      pushScope({ kind: 'dept', deptName });
      return;
    }
    if (slice.id.startsWith('m:')) {
      const m = slice.id === 'm:КП' ? 'КП' : 'ЕП';
      pushScope({ kind: 'method', m });
      // Auto-switch dimension to department so user sees cross-breakdown
      setDimension('department');
      // If metric is ₽, switch to count (method×₽ not reliably mapped at this layer)
      if (metric !== 'count') setMetric('count');
      return;
    }
    if (slice.id.startsWith('b:')) {
      const b = slice.id === 'b:ФБ' ? 'ФБ' : slice.id === 'b:КБ' ? 'КБ' : 'МБ';
      pushScope({ kind: 'budget', b });
      setDimension('department');
      if (!['plan','fact','economy'].includes(metric)) setMetric('plan');
    }
  }, [pushScope, metric]);

  // Breadcrumb items
  const crumbs: { label: string; onClick: () => void }[] = useMemo(() => {
    const list: { label: string; onClick: () => void }[] = [];
    list.push({ label: 'Все', onClick: resetAll });
    scope.forEach((s, i) => {
      list.push({ label: scopeLabel(s), onClick: () => popTo(i + 1) });
    });
    return list;
  }, [scope, resetAll, popTo]);

  // Available metrics for current view
  const availableMetrics: Metric[] = useMemo(() => {
    if (inDeptComposition) {
      const hasBudgetScope = scopeHasBudget(scope) !== null;
      const hasMethodScope = scopeHasMethod(scope) !== null;
      if (hasBudgetScope) return ['plan', 'fact', 'economy'];
      if (hasMethodScope) return ['count'];
      return ['plan', 'fact', 'economy', 'count', 'execPct'];
    }
    if (dimension === 'procurement') return ['count'];
    if (dimension === 'budget') return ['plan', 'fact', 'economy'];
    if (dimension === 'execution') return ['execPct'];
    // department
    const hasBudget = scopeHasBudget(scope) !== null;
    const hasMethod = scopeHasMethod(scope) !== null;
    if (hasBudget) return ['plan', 'fact', 'economy'];
    if (hasMethod) return ['count'];
    return ['plan', 'fact', 'economy', 'count', 'execPct'];
  }, [dimension, scope, inDeptComposition]);

  // Auto-correct metric if not in available
  if (!availableMetrics.includes(metric)) {
    // Defer via microtask to avoid setState during render
    queueMicrotask(() => setMetric(availableMetrics[0] ?? 'plan'));
  }

  // Active-slice highlight (pop-out)
  const activeIndex = data.findIndex(d => d.id === activeSliceId);
  const renderActiveShape = (props: any) => {
    const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
    return (
      <g>
        <Sector
          cx={cx} cy={cy}
          innerRadius={innerRadius}
          outerRadius={outerRadius + 6}
          startAngle={startAngle}
          endAngle={endAngle}
          fill={fill}
          style={{ filter: `drop-shadow(0 2px 8px ${fill}66)` }}
        />
      </g>
    );
  };

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-zinc-200/60 dark:border-zinc-800/60 p-5 hover:shadow-lg transition-shadow duration-300">
      {/* Header: title + period indicator */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <KBTooltip metric={inDeptComposition ? 'dept_composition' : `pie_${dimension}`}>
            <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400 truncate">
              {inDeptComposition ? 'Состав управления' : DRILL_DIMENSION_LABELS[dimension]}
            </h3>
          </KBTooltip>
        </div>
        {/* Period badge — period-reactive indicator */}
        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[10px] font-medium text-zinc-600 dark:text-zinc-300 shrink-0">
          <Calendar size={10} />
          <span className="tabular-nums">{periodLabel}</span>
        </div>
      </div>

      {/* Breadcrumb — reverse navigation between drill levels */}
      {crumbs.length > 1 && (
        <div className="flex items-center gap-1 flex-wrap mb-2 text-[10px]">
          {crumbs.map((c, i) => {
            const isLast = i === crumbs.length - 1;
            return (
              <div key={i} className="flex items-center gap-1">
                <button
                  onClick={c.onClick}
                  disabled={isLast}
                  className={cn(
                    'px-1.5 py-0.5 rounded-md font-medium transition',
                    isLast
                      ? 'bg-blue-600 text-white cursor-default'
                      : 'text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 cursor-pointer'
                  )}
                >
                  {c.label}
                </button>
                {!isLast && <ChevronLeft size={10} className="text-zinc-400 rotate-180" />}
              </div>
            );
          })}
          <button
            onClick={resetAll}
            className="ml-auto flex items-center gap-0.5 text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition"
            title="Сбросить drill"
          >
            <X size={10} />
            сбросить
          </button>
        </div>
      )}

      {/* Dimension pills (top of drill) */}
      {!inDeptComposition && (
        <div className="flex flex-wrap gap-1 mb-2">
          {(Object.keys(DRILL_DIMENSION_LABELS) as DrillDimension[]).map(dim => (
            <button
              key={dim}
              onClick={() => setDimension(dim)}
              className={cn(
                'px-2 py-1 text-[10px] font-medium rounded-full transition',
                dimension === dim
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
              )}
            >
              {DRILL_DIMENSION_LABELS[dim]}
            </button>
          ))}
        </div>
      )}

      {/* ГРБС / Организации toggle — applies to department & execution views */}
      {!inDeptComposition && (dimension === 'department' || dimension === 'execution') && (
        <div className="inline-flex items-center gap-0 mb-2 p-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800">
          {(Object.keys(VIEW_LEVEL_LABELS) as ViewLevel[]).map(lv => (
            <button
              key={lv}
              onClick={() => setViewLevel(lv)}
              className={cn(
                'px-2.5 py-0.5 text-[10px] font-medium rounded-full transition',
                viewLevel === lv
                  ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white shadow-sm'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
              )}
            >
              {VIEW_LEVEL_LABELS[lv]}
            </button>
          ))}
        </div>
      )}

      {/* Metric pills — orthogonal to drill */}
      {availableMetrics.length > 1 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {availableMetrics.map(m => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={cn(
                'px-2 py-0.5 text-[10px] rounded-full transition',
                metric === m
                  ? 'bg-zinc-800 dark:bg-zinc-200 text-white dark:text-zinc-900'
                  : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200'
              )}
            >
              {METRIC_LABELS[m]}
            </button>
          ))}
        </div>
      )}

      {/* Donut */}
      <div className="relative">
        <ResponsiveContainer width="100%" height={210}>
          <PieChart>
            <Pie
              data={data}
              cx="50%" cy="50%"
              innerRadius={58}
              outerRadius={85}
              paddingAngle={2}
              dataKey="value"
              cursor="pointer"
              onClick={(d: any) => handleSliceClick(d as Slice)}
              onMouseEnter={(d: any) => setActiveSliceId((d as Slice).id)}
              onMouseLeave={() => setActiveSliceId(null)}
              activeIndex={activeIndex >= 0 ? activeIndex : undefined}
              activeShape={renderActiveShape}
              isAnimationActive={true}
              animationDuration={400}
            >
              {data.map((d, i) => (
                <Cell
                  key={d.id}
                  fill={d.color ?? chartColors[i % chartColors.length]}
                  stroke={isDark ? '#18181b' : '#ffffff'}
                  strokeWidth={2}
                />
              ))}
            </Pie>
            <Tooltip
              formatter={(v: number, name: string) => [formatValue(v), name]}
              contentStyle={tooltipStyle}
              cursor={cursorStyle}
            />
          </PieChart>
        </ResponsiveContainer>

        {/* Center label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-[9px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500 font-semibold">
            {centerLabel}
          </span>
          <span className="text-sm font-bold text-zinc-800 dark:text-zinc-100 tabular-nums leading-tight">
            {formatValue(total)}
          </span>
          <span className="text-[9px] text-zinc-400 mt-0.5">
            {centerSub}
          </span>
        </div>
      </div>

      {/* Legend — synchronized with slice clicks */}
      <div className="mt-3 space-y-0.5 max-h-28 overflow-y-auto">
        {data.map((d, i) => {
          const pct = total > 0 ? (d.value / total) * 100 : 0;
          const active = activeSliceId === d.id;
          const color = d.color ?? chartColors[i % chartColors.length];
          return (
            <button
              key={d.id}
              onClick={() => handleSliceClick(d)}
              onMouseEnter={() => setActiveSliceId(d.id)}
              onMouseLeave={() => setActiveSliceId(null)}
              className={cn(
                'w-full flex items-center gap-2 px-2 py-1 rounded-lg text-left transition',
                active
                  ? 'bg-blue-50 dark:bg-blue-900/20'
                  : d.drillable
                    ? 'hover:bg-zinc-50 dark:hover:bg-zinc-800/60'
                    : ''
              )}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0 transition-transform"
                style={{
                  background: color,
                  transform: active ? 'scale(1.4)' : 'scale(1)',
                  boxShadow: active ? `0 0 0 2px ${color}33` : 'none',
                }}
              />
              <span className="text-[10px] text-zinc-600 dark:text-zinc-300 truncate flex-1">
                {d.name}
              </span>
              <span className="text-[10px] font-mono tabular-nums text-zinc-500 dark:text-zinc-400 shrink-0">
                {formatValue(d.value)}
              </span>
              <span className="text-[10px] font-mono tabular-nums text-zinc-400 shrink-0 w-8 text-right">
                {pct.toFixed(0)}%
              </span>
            </button>
          );
        })}
        {data.length === 0 && (
          <div className="text-[10px] text-zinc-400 text-center py-4">
            Нет данных для выбранного фильтра
          </div>
        )}
      </div>

      {/* Hint strip */}
      {!inDeptComposition && data.some(d => d.drillable) && (
        <div className="mt-2 text-[9px] text-zinc-400 text-center">
          клик по срезу = детализация • клик по пути сверху = шаг назад
        </div>
      )}

      {/* Dept toggle (filter) — explicit action, only in composition view */}
      {inDeptComposition && onDeptToggle && (
        <button
          onClick={() => onDeptToggle(scopeHasDept(scope)!)}
          className="mt-2 w-full text-[10px] font-medium px-2 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition"
        >
          Применить как глобальный фильтр →
        </button>
      )}
    </div>
  );
}
