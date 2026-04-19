import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { KBTooltip } from '../ui/kb-tooltip';
import { useTheme } from '../ThemeProvider';
import { getChartColors, getTooltipStyle, getAxisColor, getGridColor } from '@/lib/chart-colors';
import type { PeriodScope, ProcurementFilter, Page } from '@/store';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend, Cell,
} from 'recharts';

/* ─── Types ────────────────────────────────────────────────────── */

interface QuarterData {
  name: string;
  plan: number;
  fact: number;
  kpPlan: number;
  epPlan: number;
  kpFact: number;
  epFact: number;
}

interface QuarterlyChartProps {
  data: QuarterData[];
  showStacked: boolean;
  formatMoney: (v: number) => string;
  onQuarterClick: (quarter: PeriodScope) => void;
  className?: string;
}

/* ─── Quarter map ──────────────────────────────────────────────── */

const Q_MAP: Record<string, PeriodScope> = {
  '1 кв.': 'q1', '2 кв.': 'q2', '3 кв.': 'q3', '4 кв.': 'q4',
};

/* ─── Custom tooltip ───────────────────────────────────────────── */

function ChartTooltip({ payload, label, formatMoney, showStacked }: any) {
  if (!payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;

  return (
    <div className="bg-white/95 dark:bg-zinc-800/95 backdrop-blur-lg border border-zinc-200/60 dark:border-zinc-700/60 rounded-xl p-3 shadow-xl text-xs space-y-1">
      <p className="font-semibold text-zinc-700 dark:text-zinc-200">{label}</p>
      {showStacked ? (
        <>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-sm bg-blue-500" />
            <span className="text-zinc-500">КП план:</span>
            <span className="font-bold ml-auto">{formatMoney(d.kpPlan)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-sm bg-indigo-500" />
            <span className="text-zinc-500">ЕП план:</span>
            <span className="font-bold ml-auto">{formatMoney(d.epPlan)}</span>
          </div>
          <div className="border-t border-zinc-200/60 dark:border-zinc-700/40 pt-1 mt-1">
            <div className="flex justify-between">
              <span className="text-zinc-500">Итого план:</span>
              <span className="font-bold">{formatMoney(d.plan)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Факт:</span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400">{formatMoney(d.fact)}</span>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="flex justify-between">
            <span className="text-zinc-500">План:</span>
            <span className="font-bold">{formatMoney(d.plan)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">Факт:</span>
            <span className="font-bold text-emerald-600 dark:text-emerald-400">{formatMoney(d.fact)}</span>
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Component ────────────────────────────────────────────────── */

export function QuarterlyChart({ data, showStacked, formatMoney, onQuarterClick, className }: QuarterlyChartProps) {
  const isDark = useTheme(s => s.theme) === 'dark';

  const hasData = data.some(d => d.plan > 0 || d.fact > 0);
  if (!hasData) return null;

  return (
    <div className={cn('bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200/60 dark:border-zinc-800/60 p-5', className)}>
      <KBTooltip metric="plan_fact_quarterly">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400 mb-4">
          План / Факт по кварталам
          {showStacked && (
            <span className="text-[10px] text-zinc-400 dark:text-zinc-500 ml-2 font-normal normal-case tracking-normal">
              (КП + ЕП)
            </span>
          )}
        </h3>
      </KBTooltip>

      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={data} barCategoryGap="20%">
          <defs>
            <linearGradient id="barGradKP" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={isDark ? '#60a5fa' : '#3b82f6'} stopOpacity={1} />
              <stop offset="100%" stopColor={isDark ? '#3b82f6' : '#2563eb'} stopOpacity={0.8} />
            </linearGradient>
            <linearGradient id="barGradEP" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={isDark ? '#818cf8' : '#6366f1'} stopOpacity={1} />
              <stop offset="100%" stopColor={isDark ? '#6366f1' : '#4f46e5'} stopOpacity={0.8} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={getGridColor(isDark)} />
          <XAxis
            dataKey="name"
            fontSize={11}
            tick={{ fill: getAxisColor(isDark) }}
          />
          <YAxis
            fontSize={10}
            tickFormatter={(v: number) => formatMoney(v)}
            tick={{ fill: getAxisColor(isDark) }}
          />
          <Tooltip
            content={<ChartTooltip formatMoney={formatMoney} showStacked={showStacked} />}
            cursor={{ fill: isDark ? 'rgba(148,163,184,0.08)' : 'rgba(0,0,0,0.04)', stroke: 'none' }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />

          {showStacked ? (
            <>
              <Bar
                dataKey="kpPlan" name="КП план" stackId="plan"
                fill="url(#barGradKP)" barSize={28} radius={[0, 0, 0, 0]}
                cursor="pointer"
                onClick={(d: any) => { const q = Q_MAP[d?.name]; if (q) onQuarterClick(q); }}
              />
              <Bar
                dataKey="epPlan" name="ЕП план" stackId="plan"
                fill="url(#barGradEP)" barSize={28} radius={[4, 4, 0, 0]}
                cursor="pointer"
                onClick={(d: any) => { const q = Q_MAP[d?.name]; if (q) onQuarterClick(q); }}
              />
            </>
          ) : (
            <Bar
              dataKey="plan" name="План"
              fill="url(#barGradKP)" radius={[4, 4, 0, 0]} barSize={28}
              cursor="pointer"
              onClick={(d: any) => { const q = Q_MAP[d?.name]; if (q) onQuarterClick(q); }}
            />
          )}

          <Line
            type="monotone" dataKey="fact" name="Факт"
            stroke={isDark ? '#34d399' : '#10b981'} strokeWidth={2.5}
            dot={{ r: 4, fill: isDark ? '#34d399' : '#10b981', strokeWidth: 0 }}
            activeDot={{ r: 6, strokeWidth: 2, stroke: isDark ? '#34d399' : '#10b981', fill: isDark ? '#18181b' : '#fff' }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
