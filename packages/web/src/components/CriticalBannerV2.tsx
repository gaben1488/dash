import { useState } from 'react';
import { cn } from '@/lib/utils';
import { AlertTriangle, ChevronDown, ChevronRight, ShieldAlert, AlertOctagon } from 'lucide-react';
import { Badge } from './ui/badge';

// ────────────────────────────────────────────────────────────────
// CriticalBannerV2 — Premium Redesign
//
// Features:
//   • Gradient banner with pulse glow for critical
//   • Click = expand inline with dept-grouped issues
//   • Premium severity badges with icons
//   • Smooth spring animation
// ────────────────────────────────────────────────────────────────

interface CriticalIssue {
  id?: string;
  signal?: string;
  severity: string;
  description?: string;
  department?: string;
  deptId?: string;
}

interface CriticalBannerV2Props {
  criticalCount: number;
  warningCount: number;
  issues?: CriticalIssue[];
  onNavigate: () => void;
}

export function CriticalBannerV2({
  criticalCount,
  warningCount,
  issues = [],
  onNavigate,
}: CriticalBannerV2Props) {
  const [expanded, setExpanded] = useState(false);

  if (criticalCount === 0 && warningCount === 0) return null;

  const isCritical = criticalCount > 0;
  const totalCount = criticalCount + warningCount;

  // Group issues by department
  const byDept = new Map<string, CriticalIssue[]>();
  for (const issue of issues) {
    const dept = issue.department ?? issue.deptId ?? 'Общие';
    if (!byDept.has(dept)) byDept.set(dept, []);
    byDept.get(dept)!.push(issue);
  }

  return (
    <div className="space-y-1.5">
      {/* Banner button */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'w-full rounded-2xl px-5 py-3.5 flex items-center justify-between text-white transition-all duration-300 group relative overflow-hidden',
          isCritical
            ? 'bg-gradient-to-r from-red-600 via-red-500 to-rose-500 dark:from-red-700 dark:via-red-600 dark:to-rose-600 hover:shadow-xl hover:shadow-red-500/20'
            : 'bg-gradient-to-r from-amber-500 via-amber-400 to-orange-400 dark:from-amber-600 dark:via-amber-500 dark:to-orange-500 hover:shadow-xl hover:shadow-amber-500/20',
        )}
      >
        {/* Animated pulse overlay for critical */}
        {isCritical && (
          <div className="absolute inset-0 bg-gradient-to-r from-red-500/0 via-red-400/20 to-red-500/0 animate-pulse" />
        )}

        <div className="flex items-center gap-3 relative z-10">
          <div className={cn(
            'w-9 h-9 rounded-xl flex items-center justify-center',
            isCritical ? 'bg-white/15' : 'bg-white/15',
          )}>
            {isCritical ? <AlertOctagon size={20} /> : <AlertTriangle size={20} />}
          </div>
          <div className="text-left">
            <div className="font-bold text-sm">
              {isCritical
                ? `${criticalCount} критических замечаний`
                : `${warningCount} предупреждений`}
            </div>
            {isCritical && warningCount > 0 && (
              <div className="text-xs opacity-75 mt-0.5">
                + {warningCount} предупреждений
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 relative z-10">
          {/* Total counter badge */}
          <span className="bg-white/20 backdrop-blur-sm px-2.5 py-1 rounded-lg text-xs font-bold tabular-nums">
            {totalCount}
          </span>
          <ChevronDown
            size={16}
            className={cn(
              'opacity-60 transition-transform duration-300',
              expanded && 'rotate-180',
            )}
          />
        </div>
      </button>

      {/* Expand panel */}
      {expanded && (
        <div className={cn(
          'rounded-2xl border bg-white dark:bg-zinc-900 shadow-lg p-5 animate-in slide-in-from-top-2 fade-in-0 duration-200',
          isCritical
            ? 'border-red-200/60 dark:border-red-700/30 shadow-red-500/5'
            : 'border-amber-200/60 dark:border-amber-700/30 shadow-amber-500/5',
        )}>
          {byDept.size > 0 ? (
            <div className="space-y-4">
              {[...byDept.entries()].map(([dept, deptIssues]) => (
                <div key={dept}>
                  <div className="flex items-center gap-2 mb-2">
                    <h4 className="text-xs font-bold text-zinc-700 dark:text-zinc-200">
                      {dept}
                    </h4>
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 font-bold">
                      {deptIssues.length}
                    </span>
                  </div>
                  <div className="space-y-1.5 pl-3 border-l-2 border-zinc-100 dark:border-zinc-800">
                    {deptIssues.slice(0, 5).map((issue, i) => (
                      <div
                        key={issue.id ?? i}
                        className="flex items-start gap-2.5 text-xs text-zinc-600 dark:text-zinc-400 py-0.5"
                      >
                        <Badge
                          variant={
                            issue.severity === 'critical'
                              ? 'critical'
                              : issue.severity === 'error'
                                ? 'error'
                                : issue.severity === 'significant'
                                  ? 'significant'
                                  : 'warning'
                          }
                          className="text-[9px] px-1.5 py-0 shrink-0 mt-0.5"
                        >
                          {issue.severity}
                        </Badge>
                        <span className="line-clamp-2 leading-relaxed">
                          {issue.description ?? issue.signal ?? 'Замечание'}
                        </span>
                      </div>
                    ))}
                    {deptIssues.length > 5 && (
                      <span className="text-[10px] text-zinc-400 pl-1">
                        ...и ещё {deptIssues.length - 5}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-zinc-400 italic">Нет детализации</p>
          )}

          <div className="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800 flex justify-end">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onNavigate();
              }}
              className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
            >
              Все замечания
              <ChevronRight size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
