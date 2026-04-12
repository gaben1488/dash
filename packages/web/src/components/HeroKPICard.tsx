import { useState, useCallback } from 'react';
import NumberFlow from '@number-flow/react';
import { cn } from '@/lib/utils';
import { KBTooltip } from './ui/kb-tooltip';
import { STANDARD_METRICS } from '@/lib/metrics-registry';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  ChevronDown,
  ExternalLink,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Activity,
} from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, Area, AreaChart } from 'recharts';

// ────────────────────────────────────────────────────────────────
// HeroKPICard — Phase 4 Premium Redesign
//
// Design principles:
//   • Click = Expand inline (NEVER navigate)
//   • @number-flow FLIP animation on value change
//   • Delta (Δ) with sparkline (4 quarters)
//   • KB tooltip on hover
//   • Budget breakdown (ФБ/КБ/МБ) in expand panel
//   • 6-axis filter reactive
//   • Premium glassmorphism with gradient accents
//   • Inspired by: Stripe dashboard, Linear, Vercel
// ────────────────────────────────────────────────────────────────

export interface HeroKPICardProps {
  metricKey: string;
  label: string;
  value: number;
  displayValue?: string;
  unit?: '%' | 'шт.' | '₽' | 'тыс. ₽' | 'млн ₽';
  status?: 'normal' | 'warning' | 'critical';
  trend?: 'up' | 'down' | 'stable';
  delta?: string;
  deltaValue?: number;
  invertDelta?: boolean;
  sparkData?: number[];
  sourceCell?: string;
  origin?: 'official' | 'calculated' | string;
  isTrust?: boolean;
  trustOk?: boolean;
  secondaryValue?: number;
  secondaryLabel?: string;
  secondaryUnit?: '%' | 'шт.' | '₽' | 'тыс. ₽' | 'млн ₽';
  secondaryMetricKey?: string;
  secondaryTrend?: 'up' | 'down' | 'stable';
  secondarySparkData?: number[];
  expandContent?: () => React.ReactNode;
  expanded?: boolean;
  onToggleExpand?: () => void;
  id?: string;
}

/** Status-specific visual config */
const STATUS_CONFIG = {
  normal: {
    border: 'border-zinc-200/80 dark:border-zinc-800/80',
    glow: '',
    accent: 'bg-emerald-500',
    badge: 'text-emerald-600 dark:text-emerald-400',
    badgeText: 'OK',
    bgGradient: '',
  },
  warning: {
    border: 'border-amber-200/60 dark:border-amber-700/40',
    glow: 'shadow-amber-500/5',
    accent: 'bg-amber-500',
    badge: 'text-amber-600 dark:text-amber-400',
    badgeText: '!',
    bgGradient: 'bg-gradient-to-br from-amber-50/40 to-transparent dark:from-amber-950/10 dark:to-transparent',
  },
  critical: {
    border: 'border-red-200/60 dark:border-red-700/40',
    glow: 'shadow-red-500/5',
    accent: 'bg-red-500',
    badge: 'text-red-600 dark:text-red-400',
    badgeText: '!!',
    bgGradient: 'bg-gradient-to-br from-red-50/40 to-transparent dark:from-red-950/10 dark:to-transparent',
  },
};

export function HeroKPICard({
  metricKey,
  label,
  value,
  displayValue,
  unit,
  status = 'normal',
  trend,
  delta,
  deltaValue,
  invertDelta = false,
  sparkData,
  sourceCell,
  origin,
  isTrust,
  trustOk,
  secondaryValue,
  secondaryLabel,
  secondaryUnit,
  secondaryMetricKey,
  secondaryTrend,
  secondarySparkData,
  expandContent,
  expanded: controlledExpanded,
  onToggleExpand,
  id,
}: HeroKPICardProps) {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const isExpanded = controlledExpanded ?? internalExpanded;
  const toggleExpand = onToggleExpand ?? (() => setInternalExpanded(v => !v));

  const config = STATUS_CONFIG[status];

  // Delta color
  const deltaIsGood = deltaValue != null
    ? invertDelta ? deltaValue < 0 : deltaValue > 0
    : false;
  const deltaColor = deltaValue == null
    ? 'text-zinc-400'
    : deltaIsGood
      ? 'text-emerald-600 dark:text-emerald-400'
      : deltaValue === 0
        ? 'text-zinc-400'
        : 'text-red-600 dark:text-red-400';

  // Sparkline colors
  const sparkColor = trend === 'down' ? '#f87171' : trend === 'up' ? '#34d399' : '#94a3b8';
  const sparkFill = trend === 'down' ? 'url(#sparkRedGrad)' : trend === 'up' ? 'url(#sparkGreenGrad)' : 'url(#sparkGrayGrad)';

  return (
    <div className="flex flex-col">
      {/* Main card */}
      <KBTooltip metric={metricKey}>
        <button
          onClick={toggleExpand}
          className={cn(
            'w-full text-left rounded-2xl border bg-white dark:bg-zinc-900 transition-all duration-300 group relative overflow-hidden',
            config.border,
            config.bgGradient,
            'hover:shadow-xl hover:shadow-zinc-900/5 dark:hover:shadow-black/20',
            'hover:scale-[1.01] active:scale-[0.995]',
            'hover:border-blue-300/60 dark:hover:border-blue-600/40',
            isExpanded && 'ring-2 ring-blue-500/20 border-blue-300/60 dark:border-blue-600/40 shadow-xl shadow-blue-500/5',
            config.glow,
          )}
        >
          {/* Status accent bar — top edge */}
          <div className={cn('absolute top-0 left-4 right-4 h-[2px] rounded-b-full opacity-60', config.accent)} />

          <div className="p-4 pt-5">
            {/* Header row: label + status dot */}
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 leading-tight">
                {label}
              </span>
              <div className="flex items-center gap-1.5">
                {/* Status indicator dot */}
                <span className={cn(
                  'w-1.5 h-1.5 rounded-full',
                  status === 'normal' && 'bg-emerald-500',
                  status === 'warning' && 'bg-amber-500 animate-pulse',
                  status === 'critical' && 'bg-red-500 animate-pulse',
                )} />
              </div>
            </div>

            {/* Value row */}
            <div className="flex items-end gap-3">
              <div className="flex-1">
                {isTrust ? (
                  // Binary trust display — premium
                  <div className="flex items-center gap-2.5">
                    <div className={cn(
                      'w-10 h-10 rounded-xl flex items-center justify-center',
                      trustOk
                        ? 'bg-emerald-50 dark:bg-emerald-500/10'
                        : 'bg-red-50 dark:bg-red-500/10',
                    )}>
                      {trustOk ? (
                        <CheckCircle2 size={22} className="text-emerald-500" />
                      ) : (
                        <XCircle size={22} className="text-red-500" />
                      )}
                    </div>
                    <div>
                      <span className={cn(
                        'text-base font-bold leading-tight',
                        trustOk ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
                      )}>
                        {trustOk ? 'Можно доверять' : 'Расхождения'}
                      </span>
                      {value > 0 && (
                        <div className="text-[10px] text-zinc-400 mt-0.5 font-mono tabular-nums">
                          Score: {value}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-3xl font-bold text-zinc-900 dark:text-white tabular-nums leading-none tracking-tight">
                        {displayValue ?? (
                          <NumberFlow
                            value={value}
                            format={{ maximumFractionDigits: 1 }}
                            transformTiming={{ duration: 600, easing: 'ease-out' }}
                          />
                        )}
                      </span>
                      {unit && (
                        <span className="text-sm text-zinc-400 dark:text-zinc-500 font-medium mb-0.5">
                          {unit}
                        </span>
                      )}
                    </div>
                    {/* Trend + delta row */}
                    <div className="flex items-center gap-2 mt-1.5">
                      {trend && (
                        <span className={cn(
                          'flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-md',
                          trend === 'up' && 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                          trend === 'down' && 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400',
                          trend === 'stable' && 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400',
                        )}>
                          {trend === 'up' && <TrendingUp size={10} />}
                          {trend === 'down' && <TrendingDown size={10} />}
                          {trend === 'stable' && <Minus size={8} />}
                          {trend === 'up' ? 'Рост' : trend === 'down' ? 'Падение' : 'Стабильно'}
                        </span>
                      )}
                      {delta && (
                        <span className={cn('text-[10px] font-medium tabular-nums', deltaColor)}>
                          {delta}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Sparkline — area chart (right side) */}
              {sparkData && sparkData.length > 1 && !isTrust && (
                <div className="w-20 h-10 shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={sparkData.map((v, i) => ({ v, i }))}>
                      <defs>
                        <linearGradient id="sparkGreenGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#34d399" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="sparkRedGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#f87171" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="#f87171" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="sparkGrayGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#94a3b8" stopOpacity={0.2} />
                          <stop offset="100%" stopColor="#94a3b8" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <Area
                        type="monotone"
                        dataKey="v"
                        stroke={sparkColor}
                        strokeWidth={1.5}
                        fill={sparkFill}
                        dot={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Secondary metric (dual mode) */}
            {secondaryValue != null && !isTrust && (
              <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800/60">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-zinc-400 dark:text-zinc-500 uppercase tracking-wider font-medium">
                    {secondaryLabel ?? 'Доп.'}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-zinc-600 dark:text-zinc-300 tabular-nums">
                      <NumberFlow
                        value={secondaryValue}
                        format={{ maximumFractionDigits: 1 }}
                        transformTiming={{ duration: 600, easing: 'ease-out' }}
                      />
                    </span>
                    {secondaryUnit && (
                      <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
                        {secondaryUnit}
                      </span>
                    )}
                    {secondaryTrend === 'up' && <TrendingUp size={12} className="text-emerald-500" />}
                    {secondaryTrend === 'down' && <TrendingDown size={12} className="text-red-500" />}
                    {secondaryTrend === 'stable' && <Minus size={10} className="text-zinc-400" />}
                  </div>
                </div>

                {/* Dual sparkline overlay */}
                {secondarySparkData && secondarySparkData.length > 1 && sparkData && sparkData.length > 1 && (
                  <div className="mt-2 h-6 -mx-1">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={sparkData.map((v, i) => ({
                        v,
                        s: secondarySparkData?.[i] ?? null,
                        i,
                      }))}>
                        <Line
                          type="monotone"
                          dataKey="v"
                          stroke={sparkColor}
                          strokeWidth={1.5}
                          dot={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="s"
                          stroke="#60a5fa"
                          strokeWidth={1}
                          strokeDasharray="4 2"
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Expand indicator */}
          {expandContent && (
            <div className={cn(
              'absolute bottom-2.5 right-3 w-5 h-5 rounded-full flex items-center justify-center',
              'bg-zinc-100 dark:bg-zinc-800 transition-all duration-200',
              'group-hover:bg-blue-50 dark:group-hover:bg-blue-900/30',
              isExpanded && 'bg-blue-50 dark:bg-blue-900/30',
            )}>
              <ChevronDown
                size={12}
                className={cn(
                  'text-zinc-400 dark:text-zinc-500 transition-transform duration-300',
                  isExpanded && 'rotate-180 text-blue-500',
                  'group-hover:text-blue-500',
                )}
              />
            </div>
          )}

          {/* Source provenance (on hover) */}
          {(sourceCell || origin) && (
            <div className="absolute top-3 right-10 opacity-0 group-hover:opacity-100 transition-opacity text-[9px] font-mono text-zinc-400 dark:text-zinc-600">
              {sourceCell}
            </div>
          )}
        </button>
      </KBTooltip>

      {/* Expand panel — inline, NOT modal, NOT navigate */}
      {isExpanded && expandContent && (
        <div className={cn(
          'mt-1.5 rounded-2xl border border-blue-200/60 dark:border-blue-700/40',
          'bg-white dark:bg-zinc-900 shadow-lg shadow-blue-500/5 p-5',
          'animate-in slide-in-from-top-2 fade-in-0 duration-200',
        )}>
          {expandContent()}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Expand panel sub-components
// ────────────────────────────────────────────────────────────────

interface DeptBreakdownProps {
  departments: Array<{
    id: string;
    name: string;
    value: number;
    secondaryValue?: number;
    color?: string;
    secondaryColor?: string;
  }>;
  unit?: string;
  secondaryUnit?: string;
  primaryLabel?: string;
  secondaryLabel?: string;
  onDeptClick?: (deptId: string) => void;
}

/** Per-department breakdown — horizontal bars with gradient fills */
export function DeptBreakdown({
  departments,
  unit = '%',
  secondaryUnit,
  primaryLabel,
  secondaryLabel,
  onDeptClick,
}: DeptBreakdownProps) {
  const maxVal = Math.max(...departments.map(d => d.value), 1);

  return (
    <div className="space-y-1">
      {secondaryLabel && (
        <div className="flex items-center justify-end gap-4 text-[9px] text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-1 pr-1">
          <span>{primaryLabel ?? 'Кол-во'}</span>
          <span>{secondaryLabel}</span>
        </div>
      )}
      {departments.map(d => {
        const barPct = Math.min(100, (d.value / maxVal) * 100);
        const barColor = d.value >= 90 ? 'from-emerald-500 to-emerald-400'
          : d.value >= 70 ? 'from-blue-500 to-blue-400'
          : d.value >= 50 ? 'from-amber-500 to-amber-400'
          : 'from-red-500 to-red-400';

        return (
          <button
            key={d.id}
            onClick={() => onDeptClick?.(d.id)}
            className={cn(
              'w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-all duration-200 text-left',
              'hover:bg-zinc-50 dark:hover:bg-zinc-800/60',
              'cursor-pointer group/dept active:scale-[0.99]',
            )}
          >
            <span className="text-[11px] text-zinc-600 dark:text-zinc-300 w-14 shrink-0 truncate font-semibold group-hover/dept:text-blue-600 dark:group-hover/dept:text-blue-400 transition-colors">
              {d.name}
            </span>
            <div className="flex-1 h-2 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
              <div
                className={cn('h-full rounded-full bg-gradient-to-r transition-all duration-700 ease-out', barColor)}
                style={{ width: `${barPct}%` }}
              />
            </div>
            <span className={cn('text-xs font-bold tabular-nums w-14 text-right', d.color ?? 'text-zinc-700 dark:text-zinc-200')}>
              {d.value.toFixed(1)}{unit}
            </span>
            {d.secondaryValue != null && (
              <span className={cn('text-[11px] tabular-nums w-14 text-right', d.secondaryColor ?? 'text-zinc-400')}>
                {d.secondaryValue.toFixed(1)}{secondaryUnit ?? unit}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

interface BudgetBreakdownProps {
  fb: number;
  kb: number;
  mb: number;
  formatter?: (v: number) => string;
}

/** ФБ/КБ/МБ breakdown — stacked bar + legend */
export function BudgetBreakdown({ fb, kb, mb, formatter }: BudgetBreakdownProps) {
  const fmt = formatter ?? ((v: number) => v.toLocaleString('ru-RU'));
  const total = fb + kb + mb;
  const pct = (v: number) => total > 0 ? ((v / total) * 100).toFixed(0) : '0';

  const budgets = [
    { label: 'ФБ', value: fb, gradient: 'from-blue-500 to-blue-400', text: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-500' },
    { label: 'КБ', value: kb, gradient: 'from-emerald-500 to-emerald-400', text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500' },
    { label: 'МБ', value: mb, gradient: 'from-amber-500 to-amber-400', text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500' },
  ];

  return (
    <div className="space-y-3">
      <h4 className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
        По бюджетам
      </h4>

      {/* Stacked bar */}
      {total > 0 && (
        <div className="flex h-2.5 rounded-full overflow-hidden bg-zinc-100 dark:bg-zinc-800">
          {budgets.filter(b => b.value > 0).map(b => (
            <div
              key={b.label}
              className={cn('h-full bg-gradient-to-r transition-all duration-500', b.gradient)}
              style={{ width: `${pct(b.value)}%` }}
              title={`${b.label}: ${fmt(b.value)} (${pct(b.value)}%)`}
            />
          ))}
        </div>
      )}

      {/* Legend rows */}
      <div className="space-y-1.5">
        {budgets.map(b => (
          <div key={b.label} className="flex items-center gap-3">
            <div className="flex items-center gap-2 w-10">
              <span className={cn('w-2 h-2 rounded-full', b.bg)} />
              <span className={cn('text-xs font-bold', b.text)}>{b.label}</span>
            </div>
            <div className="flex-1 text-xs font-mono text-zinc-600 dark:text-zinc-300 tabular-nums text-right">
              {fmt(b.value)}
            </div>
            <span className="text-[10px] text-zinc-400 tabular-nums w-10 text-right">
              {pct(b.value)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface TrustComponentsProps {
  components: Array<{
    label: string;
    score: number;
    weight: string;
    metricKey?: string;
  }>;
}

/** 5 trust component bars — premium design */
export function TrustComponents({ components }: TrustComponentsProps) {
  return (
    <div className="space-y-3">
      <h4 className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
        Компоненты доверия
      </h4>
      <div className="space-y-2.5">
        {components.map(c => {
          const gradient = c.score >= 80 ? 'from-emerald-500 to-emerald-400'
            : c.score >= 60 ? 'from-blue-500 to-blue-400'
            : c.score >= 40 ? 'from-amber-500 to-amber-400'
            : 'from-red-500 to-red-400';
          return (
            <KBTooltip key={c.label} metric={c.metricKey}>
              <div className="flex items-center gap-3 w-full group/trust">
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400 w-32 shrink-0 truncate group-hover/trust:text-zinc-700 dark:group-hover/trust:text-zinc-200 transition-colors">
                  {c.label}
                  <span className="text-zinc-300 dark:text-zinc-600 ml-1">({c.weight})</span>
                </span>
                <div className="flex-1 h-2.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className={cn('h-full rounded-full bg-gradient-to-r transition-all duration-700 ease-out', gradient)}
                    style={{ width: `${Math.max(0, Math.min(100, c.score))}%` }}
                  />
                </div>
                <span className="text-xs font-bold tabular-nums w-8 text-right text-zinc-700 dark:text-zinc-200">
                  {c.score}
                </span>
              </div>
            </KBTooltip>
          );
        })}
      </div>
    </div>
  );
}
