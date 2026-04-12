import { useState } from 'react';
import clsx from 'clsx';
import { MONTHS } from '../store';
import { getExecutionHeatBg, getExecutionHeatText } from '../lib/chart-colors';
import { useTheme } from './ThemeProvider';

export interface CalendarHeatmapProps {
  /** Monthly execution data: key = month number (1-12), value = metrics */
  monthlyData: Record<
    number,
    {
      planCount?: number;
      factCount?: number;
      planTotal?: number;
      factTotal?: number;
      executionPct?: number;
    }
  >;
  /** Currently active months */
  activeMonths: Set<number>;
  /** Toggle month callback */
  onToggleMonth: (month: number) => void;
  /** Format money for tooltips */
  formatMoney?: (n: number) => string;
}

const defaultFormatMoney = (n: number) =>
  n.toLocaleString('ru-RU', { maximumFractionDigits: 1 });

export default function CalendarHeatmap({
  monthlyData,
  activeMonths,
  onToggleMonth,
  formatMoney = defaultFormatMoney,
}: CalendarHeatmapProps) {
  const isDark = useTheme((s) => s.theme) === 'dark';
  const [hoveredMonth, setHoveredMonth] = useState<number | null>(null);

  return (
    <div className="space-y-3">
      {/* Grid: 4 columns x 3 rows */}
      <div className="grid grid-cols-4 gap-2">
        {MONTHS.map((m) => {
          const data = monthlyData[m.id];
          const pct = data?.executionPct ?? null;
          const isActive = activeMonths.has(m.id);
          const bg = getExecutionHeatBg(pct, isDark);
          const textColor = getExecutionHeatText(pct, isDark);

          return (
            <div key={m.id} className="relative">
              <button
                type="button"
                onClick={() => onToggleMonth(m.id)}
                onMouseEnter={() => setHoveredMonth(m.id)}
                onMouseLeave={() => setHoveredMonth(null)}
                className={clsx(
                  'w-full aspect-square rounded-lg cursor-pointer transition-all duration-150',
                  'flex flex-col items-center justify-center gap-0.5',
                  'border-2',
                  isActive
                    ? 'border-blue-500 ring-2 ring-blue-500/30'
                    : 'border-transparent hover:border-zinc-300 dark:hover:border-zinc-600',
                )}
                style={{ backgroundColor: bg }}
              >
                <span
                  className="font-medium leading-none"
                  style={{ fontSize: '10px', color: textColor }}
                >
                  {m.short}
                </span>
                <span
                  className="font-semibold leading-none"
                  style={{ fontSize: '13px', color: textColor }}
                >
                  {pct !== null ? `${Math.round(pct)}%` : '\u2014'}
                </span>
              </button>

              {/* Tooltip */}
              {hoveredMonth === m.id && data && (
                <div
                  className={clsx(
                    'absolute z-50 bottom-full left-1/2 -tranzinc-x-1/2 mb-2',
                    'px-3 py-2 rounded-lg shadow-lg text-xs whitespace-nowrap',
                    'bg-white dark:bg-zinc-800',
                    'border border-zinc-200 dark:border-zinc-700',
                    'text-zinc-700 dark:text-zinc-200',
                    'pointer-events-none',
                  )}
                >
                  <div className="font-semibold mb-1">{m.full}</div>
                  <div className="space-y-0.5">
                    <div>
                      План (кол-во):{' '}
                      <span className="font-medium">
                        {data.planCount ?? '\u2014'}
                      </span>
                    </div>
                    <div>
                      Факт (кол-во):{' '}
                      <span className="font-medium">
                        {data.factCount ?? '\u2014'}
                      </span>
                    </div>
                    {data.planTotal != null && (
                      <div>
                        План (сумма):{' '}
                        <span className="font-medium">
                          {formatMoney(data.planTotal)}
                        </span>
                      </div>
                    )}
                    {data.factTotal != null && (
                      <div>
                        Факт (сумма):{' '}
                        <span className="font-medium">
                          {formatMoney(data.factTotal)}
                        </span>
                      </div>
                    )}
                    {pct !== null && (
                      <div>
                        Исполнение:{' '}
                        <span className="font-semibold">
                          {Math.round(pct)}%
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-2 text-[10px] text-zinc-500 dark:text-zinc-400">
        <span>&lt;50%</span>
        <div
          className="h-2.5 w-5 rounded"
          style={{ backgroundColor: getExecutionHeatBg(30, isDark) }}
        />
        <div
          className="h-2.5 w-5 rounded"
          style={{ backgroundColor: getExecutionHeatBg(65, isDark) }}
        />
        <div
          className="h-2.5 w-5 rounded"
          style={{ backgroundColor: getExecutionHeatBg(90, isDark) }}
        />
        <span>&gt;80%</span>
      </div>
    </div>
  );
}
