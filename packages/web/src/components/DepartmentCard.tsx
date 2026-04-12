import clsx from 'clsx';
import { Building2, AlertTriangle } from 'lucide-react';
import { getExecutionTextClass, getExecutionBarClass } from '../lib/chart-colors';

interface SubordinateInfo {
  name: string;
  planTotal: number;
  factTotal: number;
  executionPct: number;
}

interface DepartmentCardProps {
  name: string;
  nameShort: string;
  executionPercent: number | null;
  execCountPct?: number | null;
  planTotal: number | null;
  factTotal: number | null;
  economyTotal: number | null;
  issueCount: number;
  criticalIssueCount: number;
  trustScore?: number | null;
  subordinates?: SubordinateInfo[];
  status: 'normal' | 'warning' | 'critical';
  formatMoney?: (value: number) => string;
  onIssueClick?: () => void;
  onSubordinateClick?: (subName: string) => void;
}

export function DepartmentCard({
  name, nameShort, executionPercent, execCountPct, planTotal, factTotal,
  economyTotal, issueCount, criticalIssueCount, trustScore, subordinates, status, formatMoney, onIssueClick, onSubordinateClick,
}: DepartmentCardProps) {
  const fmt = formatMoney ?? formatNum;
  // executionPercent уже в диапазоне 0-100 (конвертировано в dashboard.ts)
  const pct = executionPercent !== null ? executionPercent.toFixed(1) : null;
  const pctColor = getExecutionTextClass(executionPercent);

  return (
    <div className={clsx(
      'card hover:border-blue-300 dark:hover:border-blue-600/60 hover:shadow-lg hover:scale-[1.02] transition-all duration-200 cursor-pointer',
      status === 'critical' && 'border-red-500/30',
      status === 'warning' && 'border-amber-500/30',
    )}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Building2 size={16} className="text-brand-400" />
          <span className="font-semibold text-sm text-zinc-800 dark:text-white">{nameShort}</span>
        </div>
        {criticalIssueCount > 0 && (
          <div
            className="badge badge-critical hover:opacity-80 transition"
            onClick={(e) => { if (onIssueClick) { e.stopPropagation(); onIssueClick(); } }}
            role={onIssueClick ? 'button' : undefined}
          >
            <AlertTriangle size={10} />
            {criticalIssueCount}
          </div>
        )}
      </div>

      <div className="mb-3">
        <div className="flex items-baseline gap-3">
          <div>
            <span className={clsx('text-3xl font-bold', pctColor)}>
              {pct !== null ? `${pct}%` : '—'}
            </span>
            <span className="text-[10px] text-zinc-500 dark:text-zinc-400 ml-1">по сумме</span>
          </div>
          {execCountPct != null && (
            <div>
              <span className={clsx('text-xl font-bold', getExecutionTextClass(execCountPct))}>
                {execCountPct.toFixed(1)}%
              </span>
              <span className="text-[10px] text-zinc-500 dark:text-zinc-400 ml-1">по кол-ву</span>
            </div>
          )}
        </div>
      </div>

      {executionPercent !== null && (
        <div className="progress-bar mb-3">
          <div
            className={clsx('progress-fill', getExecutionBarClass(executionPercent))}
            style={{ width: `${Math.min(executionPercent, 100)}%` }}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="text-zinc-500 dark:text-zinc-400">План</span>
          <p className="text-zinc-800 dark:text-zinc-300 font-medium">
            {planTotal !== null ? fmt(planTotal) : '—'}
          </p>
        </div>
        <div>
          <span className="text-zinc-500 dark:text-zinc-400">Факт</span>
          <p className="text-zinc-800 dark:text-zinc-300 font-medium">
            {factTotal !== null ? fmt(factTotal) : '—'}
          </p>
        </div>
      </div>

      {economyTotal !== null && (
        <div className="mt-2 pt-2 border-t border-zinc-200 dark:border-zinc-700/50 text-xs">
          <span className="text-zinc-500 dark:text-zinc-400">Экономия: </span>
          <span className="text-emerald-400 font-medium">{fmt(economyTotal)}</span>
        </div>
      )}

      {trustScore != null && (
        <div className="mt-2 pt-2 border-t border-zinc-200 dark:border-zinc-700/50 flex items-center gap-2">
          <div className={clsx(
            'text-[10px] font-bold px-1.5 py-0.5 rounded',
            trustScore >= 80 ? 'bg-emerald-500/10 text-emerald-500' :
            trustScore >= 60 ? 'bg-amber-500/10 text-amber-500' :
            'bg-red-500/10 text-red-500',
          )}>
            {trustScore}
          </div>
          <span className="text-[10px] text-zinc-400">Надёжность</span>
        </div>
      )}

      {subordinates && subordinates.length > 0 && (
        <div className="mt-2 pt-2 border-t border-zinc-200 dark:border-zinc-700/50">
          <div className="text-[9px] font-bold text-zinc-400 dark:text-zinc-500 uppercase mb-1">Подведомственные ({subordinates.length})</div>
          <div className="space-y-0.5 max-h-20 overflow-y-auto">
            {subordinates.slice(0, 5).map(sub => (
              <div key={sub.name} className="flex items-center justify-between text-[10px]" onClick={(e) => { e.stopPropagation(); onSubordinateClick?.(sub.name); }}>
                <span className="text-zinc-500 dark:text-zinc-400 truncate max-w-[120px] hover:text-blue-500 cursor-pointer" title={sub.name}>{sub.name}</span>
                <span className={clsx('font-medium tabular-nums', getExecutionTextClass(sub.executionPct))}>
                  {sub.executionPct > 0 ? `${sub.executionPct.toFixed(0)}%` : '—'}
                </span>
              </div>
            ))}
            {subordinates.length > 5 && (
              <div className="text-[9px] text-zinc-400">+{subordinates.length - 5} ещё</div>
            )}
          </div>
        </div>
      )}

      <div className="mt-2 text-[10px] text-zinc-500 dark:text-zinc-400">{name}</div>
    </div>
  );
}

function formatNum(n: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n);
}
