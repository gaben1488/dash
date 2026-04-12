import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { KBTooltip } from './ui/kb-tooltip';
import { Badge } from './ui/badge';
import {
  ArrowUpDown,
  ChevronRight,
  ChevronDown,
  TrendingUp,
  TrendingDown,
  Minus,
  ExternalLink,
  Building2,
} from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { getThresholdColor, getThresholdBg } from '@/lib/metrics-registry';

// ────────────────────────────────────────────────────────────────
// RatingTableV2 — Phase 4 Premium Redesign
//
// Changes:
//   • Premium glassmorphism row hover
//   • Gradient progress bars inline
//   • Smooth expand animation
//   • Area sparklines instead of line
//   • Adaptive subordinate display
//   • Visual rank badges (gold/silver/bronze for top 3)
// ────────────────────────────────────────────────────────────────

export interface DeptRowV2 {
  id: string;
  name: string;
  nameShort: string;
  execAmountPct: number | null;
  execCountPct: number | null;
  fbExecPct?: number | null;
  trustScore: number | null;
  issueCount: number;
  criticalIssueCount: number;
  sparkData?: number[];
  deltaWeek?: number | null;
  subordinates?: SubRow[];
}

export interface SubRow {
  name: string;
  execAmountPct: number | null;
  execCountPct: number | null;
  issueCount: number;
}

type SortKey = 'execCountPct' | 'execAmountPct' | 'fbExecPct' | 'trustScore' | 'issueCount';

interface RatingTableV2Props {
  departments: DeptRowV2[];
  showSubordinates?: boolean;
  onDeptClick: (deptId: string) => void;
  onDeptDetail: (deptId: string) => void;
}

/** Rank badge colors for top 3 */
const RANK_STYLES: Record<number, string> = {
  1: 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 font-bold',
  2: 'bg-zinc-200 dark:bg-zinc-600/30 text-zinc-600 dark:text-zinc-300 font-bold',
  3: 'bg-amber-50 dark:bg-amber-800/20 text-amber-600 dark:text-amber-500 font-bold',
};

export function RatingTableV2({
  departments,
  showSubordinates = false,
  onDeptClick,
  onDeptDetail,
}: RatingTableV2Props) {
  const [sortKey, setSortKey] = useState<SortKey>('execCountPct');
  const [sortAsc, setSortAsc] = useState(false);
  const [expandedDept, setExpandedDept] = useState<string | null>(null);

  const sorted = useMemo(
    () =>
      [...departments].sort((a, b) => {
        const va = a[sortKey] ?? -1;
        const vb = b[sortKey] ?? -1;
        return sortAsc ? va - vb : vb - va;
      }),
    [departments, sortKey, sortAsc],
  );

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const SortHeader = ({
    label,
    field,
    metricKey,
    className,
  }: {
    label: string;
    field: SortKey;
    metricKey?: string;
    className?: string;
  }) => (
    <th
      className={cn(
        'px-2 py-3 text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase cursor-pointer select-none',
        'hover:text-blue-500 transition-colors duration-150',
        className,
      )}
      onClick={() => toggleSort(field)}
    >
      <KBTooltip metric={metricKey} side="bottom">
        <span className="flex items-center gap-0.5 whitespace-nowrap">
          {label}
          <ArrowUpDown
            size={10}
            className={cn(
              'transition-colors',
              sortKey === field ? 'text-blue-500' : 'opacity-20',
            )}
          />
        </span>
      </KBTooltip>
    </th>
  );

  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b-2 border-zinc-200/80 dark:border-zinc-700/60">
            <th className="px-2 py-3 text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase w-10">
              #
            </th>
            <th className="px-2 py-3 text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase text-left min-w-[80px]">
              ГРБС
            </th>
            <SortHeader label="Кол-во%" field="execCountPct" metricKey="dept_exec_count_pct" />
            <SortHeader label="Сумма%" field="execAmountPct" metricKey="dept_exec_amount_pct" />
            <SortHeader label="ФБ%" field="fbExecPct" metricKey="dept_fb_pct" />
            <th className="px-2 py-3 text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase w-20">
              <KBTooltip
                metric="dept_exec_count_pct"
                description="Тренд исполнения по кварталам (q1→q4)"
              >
                <span>Тренд</span>
              </KBTooltip>
            </th>
            <SortHeader label="Доверие" field="trustScore" metricKey="dept_trust" />
            <SortHeader label="Замеч." field="issueCount" metricKey="dept_issues" />
            <th className="px-2 py-3 text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase">
              Δ нед.
            </th>
            <th className="px-1 py-3 w-8" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((dept, i) => {
            const isExpanded = expandedDept === dept.id;
            return (
              <DeptRowComponent
                key={dept.id}
                dept={dept}
                rank={i + 1}
                isExpanded={isExpanded}
                showSubordinates={showSubordinates}
                onToggleExpand={() =>
                  setExpandedDept(isExpanded ? null : dept.id)
                }
                onDeptClick={() => onDeptClick(dept.id)}
                onDeptDetail={() => onDeptDetail(dept.id)}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Inline progress bar for percentage cells */
function CellProgress({ value, metricKey }: { value: number | null; metricKey: string }) {
  if (value == null) return <span className="text-zinc-300 dark:text-zinc-600">—</span>;

  const color = getThresholdColor(metricKey, value);
  const barColor = value >= 90 ? 'bg-emerald-500'
    : value >= 70 ? 'bg-blue-500'
    : value >= 50 ? 'bg-amber-500'
    : 'bg-red-500';
  const barWidth = Math.min(100, Math.max(0, value));

  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className={cn('font-bold tabular-nums', color)}>
        {value.toFixed(1)}%
      </span>
      <div className="w-full h-1 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500', barColor)}
          style={{ width: `${barWidth}%` }}
        />
      </div>
    </div>
  );
}

function DeptRowComponent({
  dept,
  rank,
  isExpanded,
  showSubordinates,
  onToggleExpand,
  onDeptClick,
  onDeptDetail,
}: {
  dept: DeptRowV2;
  rank: number;
  isExpanded: boolean;
  showSubordinates: boolean;
  onToggleExpand: () => void;
  onDeptClick: () => void;
  onDeptDetail: () => void;
}) {
  const trustColor = getThresholdColor('dept_trust', dept.trustScore ?? 0);
  const trustBg = getThresholdBg('dept_trust', dept.trustScore ?? 0);

  // Sparkline
  const sparkTrend = dept.sparkData && dept.sparkData.length >= 2
    ? dept.sparkData[dept.sparkData.length - 1] >= dept.sparkData[0] ? 'up' : 'down'
    : 'stable';
  const sparkColor = sparkTrend === 'down' ? '#f87171' : sparkTrend === 'up' ? '#34d399' : '#94a3b8';

  // Delta display
  const deltaColor = dept.deltaWeek == null
    ? 'text-zinc-300 dark:text-zinc-600'
    : dept.deltaWeek > 0
      ? 'text-emerald-600 dark:text-emerald-400'
      : dept.deltaWeek < 0
        ? 'text-red-600 dark:text-red-400'
        : 'text-zinc-400';

  const rankStyle = RANK_STYLES[rank] ?? 'text-zinc-400 dark:text-zinc-500';
  const hasSubs = dept.subordinates && dept.subordinates.length > 0;

  return (
    <>
      <tr
        className={cn(
          'border-b border-zinc-100 dark:border-zinc-800/50 cursor-pointer transition-all duration-200 group',
          'hover:bg-blue-50/40 dark:hover:bg-blue-950/10',
          isExpanded && 'bg-blue-50/60 dark:bg-blue-950/20 border-blue-200/30 dark:border-blue-800/30',
        )}
        onClick={onToggleExpand}
      >
        {/* Rank */}
        <td className="px-2 py-3 text-center">
          <span className={cn(
            'inline-flex w-6 h-6 items-center justify-center rounded-lg text-[10px] tabular-nums',
            rankStyle,
          )}>
            {rank}
          </span>
        </td>

        {/* Name */}
        <td className="px-2 py-3 font-semibold text-zinc-700 dark:text-zinc-200">
          <div className="flex items-center gap-1.5">
            {(showSubordinates || hasSubs) && (
              <ChevronDown
                size={12}
                className={cn(
                  'text-zinc-400 transition-transform duration-200 shrink-0',
                  isExpanded ? 'rotate-0' : '-rotate-90',
                )}
              />
            )}
            <span className="group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
              {dept.nameShort}
            </span>
          </div>
        </td>

        {/* Execution by count — with mini progress bar */}
        <td className="px-2 py-3 text-center w-20">
          <CellProgress value={dept.execCountPct} metricKey="dept_exec_count_pct" />
        </td>

        {/* Execution by amount */}
        <td className="px-2 py-3 text-center w-20">
          <CellProgress value={dept.execAmountPct} metricKey="dept_exec_amount_pct" />
        </td>

        {/* ФБ% */}
        <td className="px-2 py-3 text-center w-16">
          <CellProgress value={dept.fbExecPct ?? null} metricKey="dept_fb_pct" />
        </td>

        {/* Sparkline — area */}
        <td className="px-1 py-1">
          {dept.sparkData && dept.sparkData.length > 1 ? (
            <div className="w-16 h-6 opacity-70 group-hover:opacity-100 transition-opacity">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dept.sparkData.map((v, i) => ({ v, i }))}>
                  <defs>
                    <linearGradient id={`sp-${dept.id}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={sparkColor} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={sparkColor} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone"
                    dataKey="v"
                    stroke={sparkColor}
                    strokeWidth={1.5}
                    fill={`url(#sp-${dept.id})`}
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <span className="text-zinc-200 dark:text-zinc-700">—</span>
          )}
        </td>

        {/* Trust badge */}
        <td className="px-2 py-3 text-center">
          <span
            className={cn(
              'inline-block px-2 py-0.5 rounded-md text-[10px] font-bold',
              trustBg,
              trustColor,
            )}
          >
            {dept.trustScore ?? '—'}
          </span>
        </td>

        {/* Issues */}
        <td className="px-2 py-3 text-center tabular-nums">
          <div className="flex items-center justify-center gap-1">
            {dept.criticalIssueCount > 0 && (
              <span className="inline-flex items-center justify-center w-4.5 h-4.5 rounded-full bg-red-100 dark:bg-red-500/15 text-red-600 dark:text-red-400 text-[9px] font-bold">
                {dept.criticalIssueCount}
              </span>
            )}
            <span className="text-zinc-400">{dept.issueCount}</span>
          </div>
        </td>

        {/* Delta */}
        <td className={cn('px-2 py-3 text-center tabular-nums text-xs font-medium', deltaColor)}>
          {dept.deltaWeek != null ? (
            <span className="flex items-center justify-center gap-0.5">
              {dept.deltaWeek > 0 ? (
                <TrendingUp size={10} />
              ) : dept.deltaWeek < 0 ? (
                <TrendingDown size={10} />
              ) : (
                <Minus size={10} />
              )}
              {dept.deltaWeek > 0 ? '+' : ''}
              {dept.deltaWeek.toFixed(1)}%
            </span>
          ) : (
            '—'
          )}
        </td>

        {/* Detail link */}
        <td className="px-1 py-3">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDeptDetail();
            }}
            className="w-6 h-6 flex items-center justify-center rounded-lg text-zinc-300 dark:text-zinc-600 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-all"
            title="Подробнее"
          >
            <ChevronRight size={14} />
          </button>
        </td>
      </tr>

      {/* Expanded row — subordinates */}
      {isExpanded && (
        <tr>
          <td colSpan={10} className="p-0">
            <div className="bg-gradient-to-b from-zinc-50 to-white dark:from-zinc-800/40 dark:to-zinc-900 border-t border-b border-zinc-200/60 dark:border-zinc-700/30 px-6 py-4 animate-in slide-in-from-top-1 duration-200">
              {hasSubs ? (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 mb-3">
                    <Building2 size={13} className="text-zinc-400" />
                    <h4 className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                      Подведомственные организации
                    </h4>
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 font-bold">
                      {dept.subordinates!.length}
                    </span>
                  </div>

                  {/* Sub table headers */}
                  <div className="flex items-center gap-4 px-3 py-1 text-[9px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                    <span className="flex-1">Организация</span>
                    <span className="w-16 text-right">Кол-во%</span>
                    <span className="w-16 text-right">Сумма%</span>
                    <span className="w-10 text-right">Замеч.</span>
                  </div>

                  <div className="grid gap-0.5">
                    {dept.subordinates!.map(sub => (
                      <div
                        key={sub.name}
                        className="flex items-center gap-4 px-3 py-2 rounded-xl hover:bg-white dark:hover:bg-zinc-800/60 transition-colors text-xs group/sub"
                      >
                        <span className="text-zinc-600 dark:text-zinc-300 flex-1 truncate group-hover/sub:text-zinc-900 dark:group-hover/sub:text-white transition-colors" title={sub.name}>
                          {sub.name}
                        </span>
                        <span className={cn('font-bold tabular-nums w-16 text-right', getThresholdColor('dept_exec_count_pct', sub.execCountPct ?? 0))}>
                          {sub.execCountPct != null ? `${sub.execCountPct.toFixed(1)}%` : '—'}
                        </span>
                        <span className={cn('tabular-nums w-16 text-right', getThresholdColor('dept_exec_amount_pct', sub.execAmountPct ?? 0))}>
                          {sub.execAmountPct != null ? `${sub.execAmountPct.toFixed(1)}%` : '—'}
                        </span>
                        <span className="text-zinc-400 tabular-nums w-10 text-right">
                          {sub.issueCount || '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-zinc-400 italic py-2">
                  <Building2 size={13} />
                  Подведы не загружены. Выберите управление для детализации.
                </div>
              )}

              {/* Detail link */}
              <div className="mt-3 pt-3 border-t border-zinc-200/40 dark:border-zinc-700/30 flex justify-end">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeptDetail();
                  }}
                  className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 font-medium transition-colors"
                >
                  Подробнее
                  <ExternalLink size={11} />
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
