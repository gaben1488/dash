import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { KBTooltip } from '../ui/kb-tooltip';
import { getThresholdColor } from '@/lib/metrics-registry';
import { ArrowRight, Building2 } from 'lucide-react';
import type { Page } from '@/store';

/* ─── Types ────────────────────────────────────────────────────── */

interface DeptExecution {
  id: string;
  name: string;
  nameShort: string;
  execCountPct: number;
  execAmountPct: number;
  planTotal: number;
  factTotal: number;
  kpCount: number;
  epCount: number;
  fbExecPct?: number | null;
  issueCount: number;
}

interface ExecutionOverviewProps {
  depts: DeptExecution[];
  formatMoney: (v: number) => string;
  onDeptClick: (nameShort: string) => void;
  onNavigate: (page: Page, params?: any) => void;
}

/* ─── Sparkline mini SVG ───────────────────────────────────────── */

function MiniBar({ pct, className }: { pct: number; className?: string }) {
  const color = pct >= 90 ? 'bg-emerald-500' :
                pct >= 70 ? 'bg-blue-500' :
                pct >= 50 ? 'bg-amber-500' :
                pct > 100 ? 'bg-purple-500' : 'bg-red-500';
  const width = Math.min(pct, 120);

  return (
    <div className={cn('h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden', className)}>
      <div
        className={cn('h-full rounded-full transition-all duration-700 ease-out', color)}
        style={{ width: `${Math.min(width, 100)}%` }}
      />
    </div>
  );
}

/* ─── Component ────────────────────────────────────────────────── */

/**
 * ExecutionOverview — visual summary of execution by department.
 * Replaces both the old horizontal BarChart AND the rating table
 * with a unified, information-dense component.
 *
 * Each row shows: rank, dept name, dual progress bars (count + amount),
 * FB%, issue count, and action button.
 */
export function ExecutionOverview({ depts, formatMoney, onDeptClick, onNavigate }: ExecutionOverviewProps) {
  const sorted = useMemo(
    () => [...depts].sort((a, b) => (b.execCountPct ?? 0) - (a.execCountPct ?? 0)),
    [depts],
  );

  if (sorted.length === 0) return null;

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
          Исполнение по управлениям
        </h2>
        <span className="text-[10px] text-zinc-400 dark:text-zinc-500">{sorted.length} ГРБС</span>
      </div>

      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200/60 dark:border-zinc-800/60 overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[2rem_1fr_5rem_5rem_4rem_3.5rem_2rem] gap-2 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 border-b border-zinc-100 dark:border-zinc-800/60">
          <span>#</span>
          <span>ГРБС</span>
          <span className="text-right">Кол-во</span>
          <span className="text-right">Сумма</span>
          <span className="text-right">ФБ%</span>
          <span className="text-right">Зам.</span>
          <span />
        </div>

        {/* Rows */}
        {sorted.map((dept, i) => {
          const rank = i + 1;
          const countColor = getThresholdColor('dept_exec_count_pct', dept.execCountPct);
          const amountColor = getThresholdColor('dept_exec_amount_pct', dept.execAmountPct);

          return (
            <div
              key={dept.id}
              onClick={() => onDeptClick(dept.nameShort)}
              className={cn(
                'grid grid-cols-[2rem_1fr_5rem_5rem_4rem_3.5rem_2rem] gap-2 px-4 py-2.5 items-center cursor-pointer',
                'transition-colors duration-150 hover:bg-zinc-50 dark:hover:bg-zinc-800/40',
                'border-b border-zinc-50 dark:border-zinc-800/30 last:border-b-0',
              )}
            >
              {/* Rank badge */}
              <span className={cn(
                'text-[11px] font-bold tabular-nums w-6 h-6 rounded-lg flex items-center justify-center',
                rank === 1 && 'bg-amber-100 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400',
                rank === 2 && 'bg-zinc-100 dark:bg-zinc-700/40 text-zinc-500 dark:text-zinc-300',
                rank === 3 && 'bg-orange-100/80 dark:bg-orange-500/10 text-orange-600 dark:text-orange-400',
                rank > 3 && 'text-zinc-400 dark:text-zinc-500',
              )}>
                {rank}
              </span>

              {/* Department name */}
              <div className="min-w-0">
                <div className="text-sm font-medium text-zinc-700 dark:text-zinc-200 truncate">
                  {dept.nameShort}
                </div>
                <div className="text-[10px] text-zinc-400 dark:text-zinc-500 truncate">
                  КП {dept.kpCount} · ЕП {dept.epCount}
                </div>
              </div>

              {/* Count execution */}
              <div className="text-right">
                <div className={cn('text-sm font-bold tabular-nums', countColor)}>
                  {dept.execCountPct.toFixed(0)}%
                </div>
                <MiniBar pct={dept.execCountPct} className="mt-1 w-full" />
              </div>

              {/* Amount execution */}
              <div className="text-right">
                <div className={cn('text-sm font-semibold tabular-nums', amountColor)}>
                  {dept.execAmountPct.toFixed(0)}%
                </div>
                <MiniBar pct={dept.execAmountPct} className="mt-1 w-full" />
              </div>

              {/* FB% */}
              <div className="text-right text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                {dept.fbExecPct != null ? `${dept.fbExecPct.toFixed(0)}%` : '—'}
              </div>

              {/* Issues */}
              <div className="text-right">
                {dept.issueCount > 0 ? (
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-red-50 dark:bg-red-500/10 text-[10px] font-bold text-red-600 dark:text-red-400">
                    {dept.issueCount}
                  </span>
                ) : (
                  <span className="text-[10px] text-zinc-300 dark:text-zinc-600">—</span>
                )}
              </div>

              {/* Detail arrow */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onNavigate('data', { department: dept.id });
                }}
                className="w-5 h-5 rounded-md flex items-center justify-center text-zinc-300 dark:text-zinc-600 hover:text-blue-500 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-all"
              >
                <ArrowRight size={12} />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
