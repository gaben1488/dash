import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { KBTooltip } from '../ui/kb-tooltip';

/* ─── Types ────────────────────────────────────────────────────── */

interface DonutSegment {
  label: string;
  value: number;
  color: string;
  hoverColor: string;
}

interface BudgetDonutProps {
  fbPlan: number;
  kbPlan: number;
  mbPlan: number;
  formatMoney: (v: number) => string;
  className?: string;
}

/* ─── SVG Donut ────────────────────────────────────────────────── */

function DonutSVG({
  segments,
  size = 160,
  thickness = 24,
  hovered,
  onHover,
}: {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  hovered: number | null;
  onHover: (i: number | null) => void;
}) {
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return null;

  let offset = 0;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="transform -rotate-90">
      {segments.map((seg, i) => {
        const pct = seg.value / total;
        const len = pct * circumference;
        const gap = 3; // gap between segments
        const dash = Math.max(0, len - gap);
        const currentOffset = offset;
        offset += len;

        const isHovered = hovered === i;
        const strokeWidth = isHovered ? thickness + 4 : thickness;

        return (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={isHovered ? seg.hoverColor : seg.color}
            strokeWidth={strokeWidth}
            strokeDasharray={`${dash} ${circumference - dash}`}
            strokeDashoffset={-currentOffset}
            strokeLinecap="round"
            className="transition-all duration-300 cursor-pointer"
            onMouseEnter={() => onHover(i)}
            onMouseLeave={() => onHover(null)}
          />
        );
      })}
    </svg>
  );
}

/* ─── Component ────────────────────────────────────────────────── */

export function BudgetDonut({ fbPlan, kbPlan, mbPlan, formatMoney, className }: BudgetDonutProps) {
  const [hovered, setHovered] = useState<number | null>(null);

  const segments: DonutSegment[] = useMemo(() => [
    { label: 'ФБ', value: fbPlan, color: '#3b82f6', hoverColor: '#60a5fa' },
    { label: 'КБ', value: kbPlan, color: '#10b981', hoverColor: '#34d399' },
    { label: 'МБ', value: mbPlan, color: '#f59e0b', hoverColor: '#fbbf24' },
  ].filter(s => s.value > 0), [fbPlan, kbPlan, mbPlan]);

  const total = fbPlan + kbPlan + mbPlan;
  if (total === 0) return null;

  const hoveredSeg = hovered != null ? segments[hovered] : null;

  return (
    <div className={cn('bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200/60 dark:border-zinc-800/60 p-5', className)}>
      <KBTooltip metric="budget_distribution">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400 mb-4">
          Бюджеты
        </h3>
      </KBTooltip>

      <div className="flex items-center gap-4">
        {/* Donut */}
        <div className="relative flex-shrink-0">
          <DonutSVG
            segments={segments}
            size={140}
            thickness={20}
            hovered={hovered}
            onHover={setHovered}
          />
          {/* Center label */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {hoveredSeg ? (
              <>
                <span className="text-lg font-bold text-zinc-800 dark:text-zinc-100 tabular-nums">
                  {((hoveredSeg.value / total) * 100).toFixed(0)}%
                </span>
                <span className="text-[10px] font-medium text-zinc-400">{hoveredSeg.label}</span>
              </>
            ) : (
              <>
                <span className="text-sm font-bold text-zinc-700 dark:text-zinc-200 tabular-nums">
                  {formatMoney(total)}
                </span>
                <span className="text-[10px] text-zinc-400">Всего</span>
              </>
            )}
          </div>
        </div>

        {/* Legend */}
        <div className="flex-1 space-y-2.5">
          {segments.map((seg, i) => {
            const pct = ((seg.value / total) * 100).toFixed(1);
            return (
              <div
                key={seg.label}
                className={cn(
                  'flex items-center gap-2 p-2 rounded-lg transition-all duration-200 cursor-pointer',
                  hovered === i ? 'bg-zinc-50 dark:bg-zinc-800/60' : 'hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30',
                )}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
              >
                <span
                  className="w-3 h-3 rounded-md flex-shrink-0"
                  style={{ backgroundColor: seg.color }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-zinc-700 dark:text-zinc-200">{seg.label}</div>
                  <div className="text-[10px] text-zinc-400">{formatMoney(seg.value)}</div>
                </div>
                <span className="text-xs font-bold tabular-nums text-zinc-600 dark:text-zinc-300">
                  {pct}%
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
