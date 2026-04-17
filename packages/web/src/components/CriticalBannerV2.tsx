import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  AlertOctagon,
} from 'lucide-react';
import { Badge } from './ui/badge';

// ────────────────────────────────────────────────────────────────
// CriticalBannerV2 — Premium Redesign
//
// Features:
//   • Gradient banner with pulse glow for critical
//   • Click = expand inline with dept-grouped issues
//   • Premium severity badges with icons
//   • Empty state — calm green pill (no expand)
//   • Keyboard: Enter/Space open, Esc close, arrow up/down navigate groups
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

const MAX_DISPLAY = 30;
const DESC_TRUNCATE = 120;

function truncate(text: string, max: number): string {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function severityVariant(severity: string): 'critical' | 'error' | 'warning' | 'significant' {
  if (severity === 'critical') return 'critical';
  if (severity === 'error') return 'error';
  if (severity === 'significant') return 'significant';
  return 'warning';
}

export function CriticalBannerV2({
  criticalCount,
  warningCount,
  issues = [],
  onNavigate,
}: CriticalBannerV2Props) {
  const [expanded, setExpanded] = useState(false);
  const [activeGroupIdx, setActiveGroupIdx] = useState(0);
  const groupRefs = useRef<(HTMLDivElement | null)[]>([]);

  // ── Empty state ───────────────────────────────────────────
  if (criticalCount === 0 && warningCount === 0) {
    return (
      <div
        role="status"
        aria-label="Замечаний нет, состояние нормы"
        className={cn(
          'inline-flex items-center gap-2 px-3.5 py-2 rounded-full',
          'bg-emerald-50 dark:bg-emerald-950/30',
          'border border-emerald-200/70 dark:border-emerald-800/50',
          'text-emerald-700 dark:text-emerald-300',
          'select-none cursor-default',
        )}
      >
        <CheckCircle2 size={16} className="shrink-0" />
        <span className="text-xs font-semibold">Замечаний нет</span>
      </div>
    );
  }

  const isCritical = criticalCount > 0;
  const totalCount = criticalCount + warningCount;

  // ── Group by department (preserve insertion order) ────────
  const byDept = new Map<string, CriticalIssue[]>();
  for (const issue of issues) {
    const dept = issue.department ?? issue.deptId ?? 'Общие';
    if (!byDept.has(dept)) byDept.set(dept, []);
    byDept.get(dept)!.push(issue);
  }

  // ── Cap display to MAX_DISPLAY across all groups ──────────
  const groups: { dept: string; items: CriticalIssue[]; groupDropped: number }[] = [];
  let rendered = 0;
  let droppedTotal = 0;
  for (const [dept, deptIssues] of byDept) {
    const remaining = MAX_DISPLAY - rendered;
    if (remaining <= 0) {
      droppedTotal += deptIssues.length;
      continue;
    }
    const take = Math.min(remaining, deptIssues.length);
    const slice = deptIssues.slice(0, take);
    const groupDropped = deptIssues.length - take;
    droppedTotal += groupDropped;
    groups.push({ dept, items: slice, groupDropped });
    rendered += take;
  }

  const groupCount = groups.length;

  // ── Keyboard handling ─────────────────────────────────────
  const handleBannerKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setExpanded((prev) => !prev);
    } else if (e.key === 'Escape' && expanded) {
      e.preventDefault();
      setExpanded(false);
    }
  };

  const handlePanelKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setExpanded(false);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (groupCount === 0) return;
      e.preventDefault();
      setActiveGroupIdx((idx) => {
        const next =
          e.key === 'ArrowDown'
            ? Math.min(groupCount - 1, idx + 1)
            : Math.max(0, idx - 1);
        return next;
      });
    }
  };

  // Focus active group on keyboard nav
  useEffect(() => {
    if (!expanded) return;
    const el = groupRefs.current[activeGroupIdx];
    el?.focus({ preventScroll: false });
  }, [activeGroupIdx, expanded]);

  return (
    <div className="space-y-1.5">
      {/* Banner button */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        onKeyDown={handleBannerKey}
        aria-expanded={expanded}
        aria-controls="critical-banner-panel"
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
                ? `${criticalCount} замечаний требуют решения`
                : `${warningCount} предупреждений требуют внимания`}
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
        <div
          id="critical-banner-panel"
          role="region"
          aria-label="Список замечаний по управлениям"
          tabIndex={-1}
          onKeyDown={handlePanelKey}
          className={cn(
            'rounded-2xl border bg-white dark:bg-zinc-900 shadow-lg p-5 animate-in slide-in-from-top-2 fade-in-0 duration-200 outline-none',
            isCritical
              ? 'border-red-200/60 dark:border-red-700/30 shadow-red-500/5'
              : 'border-amber-200/60 dark:border-amber-700/30 shadow-amber-500/5',
          )}
        >
          {groups.length > 0 ? (
            <div className="space-y-4">
              {groups.map((group, gi) => (
                <div
                  key={group.dept}
                  ref={(el) => { groupRefs.current[gi] = el; }}
                  tabIndex={0}
                  role="group"
                  aria-label={`${group.dept}: ${group.items.length} замечаний`}
                  className={cn(
                    'outline-none rounded-lg px-1 -mx-1 transition-colors',
                    activeGroupIdx === gi && 'ring-1 ring-blue-300/40 bg-blue-50/30 dark:bg-blue-500/5',
                  )}
                  onFocus={() => setActiveGroupIdx(gi)}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <h4 className="text-xs font-bold text-zinc-700 dark:text-zinc-200">
                      {group.dept}
                    </h4>
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 font-bold">
                      {group.items.length}
                    </span>
                  </div>
                  <div className="space-y-1.5 pl-3 border-l-2 border-zinc-100 dark:border-zinc-800">
                    {group.items.map((issue, i) => (
                      <div
                        key={issue.id ?? `${group.dept}-${i}`}
                        className="flex items-start gap-2.5 text-xs text-zinc-600 dark:text-zinc-400 py-0.5"
                      >
                        <Badge
                          variant={severityVariant(issue.severity)}
                          className="text-[9px] px-1.5 py-0 shrink-0 mt-0.5"
                        >
                          {issue.severity}
                        </Badge>
                        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                          <span className="leading-relaxed">
                            {truncate(issue.description ?? 'Замечание', DESC_TRUNCATE)}
                          </span>
                          {issue.signal && (
                            <span className="text-[9px] text-zinc-400 dark:text-zinc-500 font-mono">
                              {issue.signal}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                    {group.groupDropped > 0 && (
                      <span className="text-[10px] text-zinc-400 pl-1">
                        …ещё {group.groupDropped} в этой группе
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {droppedTotal > 0 && (
                <p className="text-[10px] text-zinc-400 italic pt-1">
                  +{droppedTotal} ещё не показаны — открой «Все замечания».
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-zinc-400 italic">Нет детализации</p>
          )}

          <div className="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800 flex justify-end">
            <button
              type="button"
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
