/**
 * AEMR Premium Chart Component Library
 *
 * Custom-styled chart wrappers with gradient fills, glass tooltips,
 * animated entrances, dark mode support, and drill-down interactions.
 *
 * Components:
 *   - ChartCard         — Glass wrapper card for any chart
 *   - PlanFactChart     — Quarterly plan vs fact (ComposedChart)
 *   - ExecutionBarsChart — Horizontal execution bars by department
 *   - DistributionDonut — Animated SVG donut with dimension switcher
 *   - SignalGrid        — Signal anomaly indicator cards
 *   - SparklineChart    — Tiny inline SVG sparkline
 */

import { useState, useMemo, useRef, useEffect, type ReactNode } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, Legend, Tooltip as RechartsTooltip,
} from 'recharts';
import { useTheme } from '../ThemeProvider';
import {
  getChartColors, getAxisColor, getGridColor,
  getExecutionBarColor,
} from '../../lib/chart-colors';
import { KBTooltip } from '../ui/kb-tooltip';

// ════════════════════════════════════════════════════════════════════
//  SHARED: Glass Tooltip
// ════════════════════════════════════════════════════════════════════

function GlassTooltip({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`
        backdrop-blur-xl rounded-xl p-3 shadow-2xl text-xs
        border border-white/20 dark:border-white/8
        bg-white/85 dark:bg-zinc-900/85
        ${className}
      `}
      style={{
        boxShadow: '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)',
      }}
    >
      {children}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  SHARED: Unique ID generator for SVG gradients
// ════════════════════════════════════════════════════════════════════

let _uid = 0;
function useUid(prefix = 'chart') {
  const ref = useRef(`${prefix}-${++_uid}`);
  return ref.current;
}

// ════════════════════════════════════════════════════════════════════
//  1. ChartCard — Wrapper card with header, KB tooltip, expand
// ════════════════════════════════════════════════════════════════════

export interface ChartCardProps {
  title: string;
  metricKey?: string;
  children: ReactNode;
  className?: string;
  subtitle?: string;
  action?: ReactNode;
  expandable?: boolean;
  onExpand?: () => void;
}

export function ChartCard({
  title, metricKey, children, className = '',
  subtitle, action, expandable, onExpand,
}: ChartCardProps) {
  const content = (
    <div
      className={`
        bg-white dark:bg-zinc-900 rounded-2xl
        border border-zinc-200/60 dark:border-zinc-800/60
        shadow-sm hover:shadow-lg
        transition-shadow duration-300
        p-5 relative overflow-hidden
        ${className}
      `}
      style={{ animation: 'slideUp 0.4s cubic-bezier(0.16,1,0.3,1) both' }}
    >
      {/* Subtle top-edge gradient glow */}
      <div
        className="absolute top-0 left-0 right-0 h-px"
        style={{
          background: 'linear-gradient(90deg, transparent, rgba(59,130,246,0.15), transparent)',
        }}
      />

      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            {title}
          </h3>
          {subtitle && (
            <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-0.5">{subtitle}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {action}
          {expandable && (
            <button
              onClick={onExpand}
              className="p-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              title="Развернуть"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-zinc-400">
                <path d="M2 9L2 12L5 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M12 5L12 2L9 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M2 12L6 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M12 2L8 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
      </div>
      {children}
    </div>
  );

  if (metricKey) {
    return <KBTooltip metric={metricKey}>{content}</KBTooltip>;
  }
  return content;
}

// ════════════════════════════════════════════════════════════════════
//  2. PlanFactChart — Quarterly plan vs fact
// ════════════════════════════════════════════════════════════════════

export interface PlanFactDatum {
  name: string;
  plan: number;
  fact: number;
  kpPlan?: number;
  epPlan?: number;
  kpFact?: number;
  epFact?: number;
}

export interface PlanFactChartProps {
  data: PlanFactDatum[];
  showStacked?: boolean;
  formatMoney: (v: number) => string;
  onQuarterClick?: (quarter: string) => void;
}

export function PlanFactChart({ data, showStacked, formatMoney, onQuarterClick }: PlanFactChartProps) {
  const isDark = useTheme(s => s.theme) === 'dark';
  const uid = useUid('pf');

  const handleBarClick = (entry: any) => {
    if (!onQuarterClick) return;
    const qMap: Record<string, string> = { '1 \u043a\u0432.': 'q1', '2 \u043a\u0432.': 'q2', '3 \u043a\u0432.': 'q3', '4 \u043a\u0432.': 'q4' };
    const q = qMap[entry?.name];
    if (q) onQuarterClick(q);
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    if (!d) return null;

    return (
      <GlassTooltip>
        <p className="font-semibold text-zinc-700 dark:text-zinc-200 mb-1.5">{label}</p>
        {showStacked ? (
          <>
            <div className="space-y-0.5">
              <p className="text-zinc-500 dark:text-zinc-400">
                КП план: <strong className="text-zinc-700 dark:text-zinc-200">{formatMoney(d.kpPlan ?? 0)}</strong>
              </p>
              <p className="text-zinc-500 dark:text-zinc-400">
                ЕП план: <strong className="text-zinc-700 dark:text-zinc-200">{formatMoney(d.epPlan ?? 0)}</strong>
              </p>
            </div>
            <div className="border-t border-zinc-200/50 dark:border-zinc-700/50 mt-1.5 pt-1.5">
              <p className="text-zinc-500 dark:text-zinc-400">
                Итого план: <strong className="text-zinc-700 dark:text-zinc-200">{formatMoney(d.plan)}</strong>
              </p>
              <p className="text-zinc-500 dark:text-zinc-400">
                Факт: <strong className="text-emerald-600 dark:text-emerald-400">{formatMoney(d.fact)}</strong>
              </p>
            </div>
          </>
        ) : (
          <div className="space-y-0.5">
            <p className="text-zinc-500 dark:text-zinc-400">
              План: <strong className="text-zinc-700 dark:text-zinc-200">{formatMoney(d.plan)}</strong>
            </p>
            <p className="text-zinc-500 dark:text-zinc-400">
              Факт: <strong className="text-emerald-600 dark:text-emerald-400">{formatMoney(d.fact)}</strong>
            </p>
            {d.plan > 0 && (
              <p className="text-zinc-400 dark:text-zinc-500 text-[10px] mt-1">
                Исполнение: {((d.fact / d.plan) * 100).toFixed(1)}%
              </p>
            )}
          </div>
        )}
      </GlassTooltip>
    );
  };

  return (
    <div style={{ animation: 'slideUp 0.5s cubic-bezier(0.16,1,0.3,1) both' }}>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={data} barCategoryGap="20%">
          <defs>
            <linearGradient id={`${uid}-plan`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={isDark ? '#60a5fa' : '#3b82f6'} stopOpacity={1} />
              <stop offset="100%" stopColor={isDark ? '#3b82f6' : '#2563eb'} stopOpacity={0.8} />
            </linearGradient>
            <linearGradient id={`${uid}-kp`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={isDark ? '#60a5fa' : '#3b82f6'} stopOpacity={1} />
              <stop offset="100%" stopColor={isDark ? '#3b82f6' : '#2563eb'} stopOpacity={0.7} />
            </linearGradient>
            <linearGradient id={`${uid}-ep`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={isDark ? '#a5b4fc' : '#818cf8'} stopOpacity={1} />
              <stop offset="100%" stopColor={isDark ? '#818cf8' : '#6366f1'} stopOpacity={0.7} />
            </linearGradient>
            <linearGradient id={`${uid}-fact-line`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={isDark ? '#34d399' : '#10b981'} />
              <stop offset="100%" stopColor={isDark ? '#6ee7b7' : '#34d399'} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={getGridColor(isDark)} />
          <XAxis dataKey="name" fontSize={11} tick={{ fill: getAxisColor(isDark) }} />
          <YAxis fontSize={10} tickFormatter={(v: number) => formatMoney(v)} tick={{ fill: getAxisColor(isDark) }} />
          <RechartsTooltip
            content={<CustomTooltip />}
            cursor={{ fill: isDark ? 'rgba(148,163,184,0.12)' : 'rgba(0,0,0,0.06)', stroke: 'none' }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {showStacked ? (
            <>
              <Bar
                dataKey="kpPlan" name="КП план" stackId="plan"
                fill={`url(#${uid}-kp)`} barSize={32} radius={[0, 0, 0, 0]}
                cursor="pointer" onClick={handleBarClick}
              />
              <Bar
                dataKey="epPlan" name="ЕП план" stackId="plan"
                fill={`url(#${uid}-ep)`} barSize={32} radius={[4, 4, 0, 0]}
                cursor="pointer" onClick={handleBarClick}
              />
            </>
          ) : (
            <Bar
              dataKey="plan" name="План"
              fill={`url(#${uid}-plan)`} radius={[4, 4, 0, 0]} barSize={32}
              cursor="pointer" onClick={handleBarClick}
            />
          )}
          <Line
            type="monotone" dataKey="fact" name="Факт"
            stroke={`url(#${uid}-fact-line)`}
            strokeWidth={2.5}
            dot={{ r: 5, fill: isDark ? '#34d399' : '#10b981', strokeWidth: 2, stroke: isDark ? '#1e293b' : '#ffffff' }}
            activeDot={{ r: 7, strokeWidth: 2, stroke: isDark ? '#34d399' : '#10b981', fill: isDark ? '#1e293b' : '#ffffff' }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  3. ExecutionBarsChart — Horizontal bars by department
// ════════════════════════════════════════════════════════════════════

export interface ExecutionBarDatum {
  name: string;
  nameShort?: string;
  pct: number;
  execCountPct?: number | null;
  planTotal?: number;
  factTotal?: number;
  kpCount?: number;
  epCount?: number;
}

export interface ExecutionBarsChartProps {
  data: ExecutionBarDatum[];
  onDeptClick?: (nameOrShort: string) => void;
  formatMoney: (v: number) => string;
}

export function ExecutionBarsChart({ data, onDeptClick, formatMoney }: ExecutionBarsChartProps) {
  const isDark = useTheme(s => s.theme) === 'dark';

  const maxPct = useMemo(() => Math.max(100, ...data.map(d => d.pct)), [data]);

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.[0]?.payload) return null;
    const d = payload[0].payload;
    return (
      <GlassTooltip>
        <p className="font-semibold text-zinc-700 dark:text-zinc-200 mb-1.5">{d.name}</p>
        <div className="space-y-0.5">
          <p className="text-zinc-500 dark:text-zinc-400">
            По сумме: <strong className="text-zinc-700 dark:text-zinc-200">{d.pct.toFixed(1)}%</strong>
            {d.pct > 100 && <span className="ml-1 text-purple-500 text-[10px]">Факт {'>'} План</span>}
          </p>
          {d.execCountPct != null && (
            <p className="text-zinc-500 dark:text-zinc-400">
              По кол-ву: <strong className="text-zinc-700 dark:text-zinc-200">{d.execCountPct.toFixed(1)}%</strong>
            </p>
          )}
          {d.planTotal != null && (
            <p className="text-zinc-500 dark:text-zinc-400">
              План: <strong>{formatMoney(d.planTotal)}</strong>
            </p>
          )}
          {d.factTotal != null && (
            <p className="text-zinc-500 dark:text-zinc-400">
              Факт: <strong>{formatMoney(d.factTotal)}</strong>
            </p>
          )}
          {(d.kpCount != null || d.epCount != null) && (
            <p className="text-zinc-400 dark:text-zinc-500 text-[10px] mt-1">
              КП: {d.kpCount ?? 0} | ЕП: {d.epCount ?? 0}
            </p>
          )}
        </div>
      </GlassTooltip>
    );
  };

  return (
    <div style={{ animation: 'slideUp 0.5s cubic-bezier(0.16,1,0.3,1) 0.05s both' }}>
      {/* Mini progress bar layout */}
      <div className="space-y-2">
        {data.map((d, i) => {
          const barColor = getExecutionBarColor(d.pct, isDark);
          const widthPct = Math.min((d.pct / maxPct) * 100, 100);
          const countWidthPct = d.execCountPct != null ? Math.min((d.execCountPct / maxPct) * 100, 100) : null;

          return (
            <button
              key={d.nameShort ?? d.name}
              onClick={() => onDeptClick?.(d.nameShort ?? d.name)}
              className="w-full text-left group cursor-pointer"
              style={{ animation: `slideUp 0.4s cubic-bezier(0.16,1,0.3,1) ${i * 0.04}s both` }}
            >
              <div className="flex items-center gap-3">
                {/* Dept name */}
                <span className="w-16 text-[11px] font-medium text-zinc-600 dark:text-zinc-300 truncate shrink-0">
                  {d.nameShort ?? d.name}
                </span>

                {/* Bar track */}
                <div className="flex-1 relative h-5 bg-zinc-100 dark:bg-zinc-800/60 rounded-md overflow-hidden group-hover:bg-zinc-200/80 dark:group-hover:bg-zinc-800 transition-colors">
                  {/* Main execution bar (amount) */}
                  <div
                    className="absolute inset-y-0 left-0 rounded-md transition-all duration-500 ease-out"
                    style={{
                      width: `${widthPct}%`,
                      background: `linear-gradient(90deg, ${barColor}cc, ${barColor})`,
                      boxShadow: `0 0 8px ${barColor}30`,
                    }}
                  />

                  {/* Count-based execution overlay line */}
                  {countWidthPct != null && (
                    <div
                      className="absolute top-0 bottom-0 w-0.5 transition-all duration-500 ease-out"
                      style={{
                        left: `${countWidthPct}%`,
                        background: isDark ? '#f59e0b' : '#d97706',
                        boxShadow: `0 0 4px ${isDark ? '#f59e0b' : '#d97706'}40`,
                      }}
                    />
                  )}

                  {/* Percentage label inside bar */}
                  <span
                    className="absolute inset-y-0 flex items-center text-[10px] font-bold tabular-nums"
                    style={{
                      left: widthPct > 30 ? '8px' : `calc(${widthPct}% + 6px)`,
                      color: widthPct > 30 ? 'white' : (isDark ? '#e2e8f0' : '#3f3f46'),
                      textShadow: widthPct > 30 ? '0 1px 2px rgba(0,0,0,0.3)' : 'none',
                    }}
                  >
                    {d.pct.toFixed(1)}%
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex gap-3 text-[10px] text-zinc-400 dark:text-zinc-500 mt-3 flex-wrap">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> {'<'}50%</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> 50-80%</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> {'\u2265'}80%</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-500" /> {'>'}100%</span>
        <span className="flex items-center gap-1 ml-2"><span className="w-3 h-0.5 bg-amber-500 rounded" /> по кол-ву</span>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  4. DistributionDonut — Custom SVG donut with animated segments
// ════════════════════════════════════════════════════════════════════

export interface DonutSegment {
  name: string;
  value: number;
}

export interface DistributionDonutProps {
  data: DonutSegment[];
  label?: string;
  onSegmentClick?: (segment: DonutSegment, index: number) => void;
  formatValue?: (v: number) => string;
  size?: number;
}

export function DistributionDonut({
  data, label, onSegmentClick, formatValue,
  size = 180,
}: DistributionDonutProps) {
  const isDark = useTheme(s => s.theme) === 'dark';
  const chartColors = getChartColors(isDark);
  const [hovered, setHovered] = useState<number | null>(null);
  const [animProgress, setAnimProgress] = useState(0);
  const uid = useUid('donut');

  // Animate on mount
  useEffect(() => {
    let frame: number;
    const start = performance.now();
    const duration = 800;
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      setAnimProgress(eased);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [data]);

  const total = useMemo(() => data.reduce((s, d) => s + d.value, 0), [data]);
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size / 2 - 8;
  const innerR = outerR * 0.62;
  const hoverExpand = 4;

  // Build arc segments
  const segments = useMemo(() => {
    const gap = data.length > 1 ? 0.02 : 0; // radians gap between segments
    const totalGap = gap * data.length;
    const available = (2 * Math.PI - totalGap) * animProgress;
    let angle = -Math.PI / 2;
    return data.map((d, i) => {
      const sweep = total > 0 ? (d.value / total) * available : 0;
      const startAngle = angle + gap / 2;
      const endAngle = startAngle + sweep;
      angle = endAngle + gap / 2;
      return { ...d, startAngle, endAngle, index: i };
    });
  }, [data, total, animProgress]);

  function arcPath(startAngle: number, endAngle: number, inner: number, outer: number) {
    if (endAngle - startAngle >= 2 * Math.PI - 0.01) {
      // Full circle — use two arcs
      const mid = startAngle + Math.PI;
      return [
        `M ${cx + Math.cos(startAngle) * outer} ${cy + Math.sin(startAngle) * outer}`,
        `A ${outer} ${outer} 0 0 1 ${cx + Math.cos(mid) * outer} ${cy + Math.sin(mid) * outer}`,
        `A ${outer} ${outer} 0 0 1 ${cx + Math.cos(startAngle) * outer} ${cy + Math.sin(startAngle) * outer}`,
        `L ${cx + Math.cos(startAngle) * inner} ${cy + Math.sin(startAngle) * inner}`,
        `A ${inner} ${inner} 0 0 0 ${cx + Math.cos(mid) * inner} ${cy + Math.sin(mid) * inner}`,
        `A ${inner} ${inner} 0 0 0 ${cx + Math.cos(startAngle) * inner} ${cy + Math.sin(startAngle) * inner}`,
        'Z',
      ].join(' ');
    }
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
    return [
      `M ${cx + Math.cos(startAngle) * outer} ${cy + Math.sin(startAngle) * outer}`,
      `A ${outer} ${outer} 0 ${largeArc} 1 ${cx + Math.cos(endAngle) * outer} ${cy + Math.sin(endAngle) * outer}`,
      `L ${cx + Math.cos(endAngle) * inner} ${cy + Math.sin(endAngle) * inner}`,
      `A ${inner} ${inner} 0 ${largeArc} 0 ${cx + Math.cos(startAngle) * inner} ${cy + Math.sin(startAngle) * inner}`,
      'Z',
    ].join(' ');
  }

  const displayValue = hovered != null ? data[hovered]?.value ?? total : total;
  const displayLabel = hovered != null ? data[hovered]?.name ?? label : label ?? 'Итого';

  return (
    <div className="flex flex-col items-center" style={{ animation: 'scaleIn 0.5s cubic-bezier(0.16,1,0.3,1) both' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="overflow-visible">
        <defs>
          {data.map((_, i) => {
            const color = chartColors[i % chartColors.length];
            return (
              <linearGradient key={i} id={`${uid}-seg-${i}`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.9} />
                <stop offset="100%" stopColor={color} stopOpacity={1} />
              </linearGradient>
            );
          })}
        </defs>

        {segments.map((seg) => {
          const isHover = hovered === seg.index;
          const oR = isHover ? outerR + hoverExpand : outerR;
          const iR = isHover ? innerR - 1 : innerR;

          return (
            <path
              key={seg.index}
              d={arcPath(seg.startAngle, seg.endAngle, iR, oR)}
              fill={`url(#${uid}-seg-${seg.index})`}
              stroke={isDark ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.8)'}
              strokeWidth={1.5}
              className="cursor-pointer transition-all duration-200"
              style={{
                filter: isHover ? `drop-shadow(0 0 6px ${chartColors[seg.index % chartColors.length]}50)` : 'none',
              }}
              onMouseEnter={() => setHovered(seg.index)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onSegmentClick?.(seg, seg.index)}
            />
          );
        })}

        {/* Center label */}
        <text
          x={cx} y={cy - 6}
          textAnchor="middle"
          className="fill-zinc-800 dark:fill-zinc-100 font-bold tabular-nums"
          fontSize={16}
        >
          {formatValue ? formatValue(displayValue) : displayValue.toLocaleString('ru-RU')}
        </text>
        <text
          x={cx} y={cy + 12}
          textAnchor="middle"
          className="fill-zinc-400 dark:fill-zinc-500"
          fontSize={10}
        >
          {displayLabel}
        </text>
      </svg>

      {/* Legend below */}
      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-2">
        {data.map((d, i) => (
          <button
            key={i}
            className="flex items-center gap-1 text-[10px] text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors cursor-pointer"
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => onSegmentClick?.(d, i)}
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: chartColors[i % chartColors.length] }}
            />
            <span className="truncate max-w-[100px]">{d.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  5. SignalGrid — Signal anomaly indicator cards
// ════════════════════════════════════════════════════════════════════

export interface Signal {
  label: string;
  signal: string;
  search?: string;
  metricKey?: string;
  color: string;
  icon: string;
  count: number;
}

export interface SignalGridProps {
  signals: Signal[];
  onSignalClick?: (signal: Signal) => void;
}

const SIGNAL_COLOR_MAP: Record<string, {
  bg: string; border: string; text: string; number: string; glow: string; pulse: string;
}> = {
  red:    { bg: 'bg-red-500/8',    border: 'border-red-500/15 hover:border-red-500/30',    text: 'text-red-500/80',    number: 'text-red-500',    glow: 'hover:shadow-red-500/10',    pulse: 'bg-red-500' },
  rose:   { bg: 'bg-rose-500/8',   border: 'border-rose-500/15 hover:border-rose-500/30',   text: 'text-rose-500/80',   number: 'text-rose-500',   glow: 'hover:shadow-rose-500/10',   pulse: 'bg-rose-500' },
  orange: { bg: 'bg-orange-500/8', border: 'border-orange-500/15 hover:border-orange-500/30', text: 'text-orange-500/80', number: 'text-orange-500', glow: 'hover:shadow-orange-500/10', pulse: 'bg-orange-500' },
  amber:  { bg: 'bg-amber-500/8',  border: 'border-amber-500/15 hover:border-amber-500/30',  text: 'text-amber-500/80',  number: 'text-amber-500',  glow: 'hover:shadow-amber-500/10',  pulse: 'bg-amber-500' },
  purple: { bg: 'bg-purple-500/8', border: 'border-purple-500/15 hover:border-purple-500/30', text: 'text-purple-500/80', number: 'text-purple-500', glow: 'hover:shadow-purple-500/10', pulse: 'bg-purple-500' },
  cyan:   { bg: 'bg-cyan-500/8',   border: 'border-cyan-500/15 hover:border-cyan-500/30',   text: 'text-cyan-500/80',   number: 'text-cyan-500',   glow: 'hover:shadow-cyan-500/10',   pulse: 'bg-cyan-500' },
  blue:   { bg: 'bg-blue-500/8',   border: 'border-blue-500/15 hover:border-blue-500/30',   text: 'text-blue-500/80',   number: 'text-blue-500',   glow: 'hover:shadow-blue-500/10',   pulse: 'bg-blue-500' },
  indigo: { bg: 'bg-indigo-500/8', border: 'border-indigo-500/15 hover:border-indigo-500/30', text: 'text-indigo-500/80', number: 'text-indigo-500', glow: 'hover:shadow-indigo-500/10', pulse: 'bg-indigo-500' },
  teal:   { bg: 'bg-teal-500/8',   border: 'border-teal-500/15 hover:border-teal-500/30',   text: 'text-teal-500/80',   number: 'text-teal-500',   glow: 'hover:shadow-teal-500/10',   pulse: 'bg-teal-500' },
};

export function SignalGrid({ signals, onSignalClick }: SignalGridProps) {
  const totalCount = signals.reduce((s, c) => s + c.count, 0);
  if (totalCount === 0) return null;

  return (
    <div style={{ animation: 'slideUp 0.5s cubic-bezier(0.16,1,0.3,1) 0.1s both' }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Сигналы и аномалии
          </h2>
          <span className="text-[9px] px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 font-bold tabular-nums">
            {totalCount}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-2">
        {signals.map((sig, i) => {
          const colors = SIGNAL_COLOR_MAP[sig.color] ?? SIGNAL_COLOR_MAP.blue;
          const isActive = sig.count > 0;
          const isCritical = isActive && sig.count >= 5;

          const card = (
            <button
              key={sig.signal}
              onClick={() => isActive && onSignalClick?.(sig)}
              disabled={!isActive}
              className={`
                ${colors.bg} border ${colors.border} rounded-xl p-3 text-left
                transition-all duration-200 cursor-pointer w-full relative overflow-hidden
                hover:scale-[1.03] active:scale-[0.98]
                hover:shadow-lg ${colors.glow}
                ${!isActive ? 'opacity-40 cursor-default hover:scale-100 hover:shadow-none' : ''}
              `}
              style={{ animation: `slideUp 0.4s cubic-bezier(0.16,1,0.3,1) ${i * 0.03}s both` }}
            >
              {/* Pulsing indicator for critical signals */}
              {isCritical && (
                <span className="absolute top-1.5 right-1.5 flex h-2 w-2">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${colors.pulse} opacity-60`} />
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${colors.pulse}`} />
                </span>
              )}

              <div className="text-base mb-0.5">{sig.icon}</div>
              <div className={`text-xl font-bold tabular-nums leading-none ${isActive ? colors.number : 'text-zinc-300 dark:text-zinc-700'}`}>
                {sig.count}
              </div>
              <div className={`text-[10px] font-medium mt-1.5 leading-tight ${isActive ? colors.text : 'text-zinc-300 dark:text-zinc-600'}`}>
                {sig.label}
              </div>
            </button>
          );

          if (sig.metricKey) {
            return <KBTooltip key={sig.signal} metric={sig.metricKey}>{card}</KBTooltip>;
          }
          return card;
        })}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  6. SparklineChart — Tiny inline SVG sparkline
// ════════════════════════════════════════════════════════════════════

export interface SparklineChartProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  showGradient?: boolean;
  className?: string;
}

export function SparklineChart({
  data,
  width = 60,
  height = 24,
  color,
  showGradient = true,
  className = '',
}: SparklineChartProps) {
  const isDark = useTheme(s => s.theme) === 'dark';
  const uid = useUid('spark');

  if (!data || data.length < 2) return null;

  // Determine trend color if not explicit
  const trend = data[data.length - 1] >= data[data.length - 2] ? 'up' : 'down';
  const strokeColor = color ?? (trend === 'up'
    ? (isDark ? '#34d399' : '#10b981')
    : (isDark ? '#f87171' : '#ef4444')
  );

  const pad = 2;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data.map((v, i) => ({
    x: pad + (i / (data.length - 1)) * w,
    y: pad + h - ((v - min) / range) * h,
  }));

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${(height - pad).toFixed(1)} L ${points[0].x.toFixed(1)} ${(height - pad).toFixed(1)} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`overflow-visible ${className}`}
    >
      {showGradient && (
        <defs>
          <linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={strokeColor} stopOpacity={0.25} />
            <stop offset="100%" stopColor={strokeColor} stopOpacity={0.02} />
          </linearGradient>
        </defs>
      )}

      {/* Gradient fill area */}
      {showGradient && (
        <path d={areaPath} fill={`url(#${uid})`} />
      )}

      {/* Line */}
      <path
        d={linePath}
        fill="none"
        stroke={strokeColor}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* End dot */}
      <circle
        cx={points[points.length - 1].x}
        cy={points[points.length - 1].y}
        r={2}
        fill={strokeColor}
      />
    </svg>
  );
}
