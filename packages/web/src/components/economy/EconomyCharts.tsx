// ── Чарт-блок страницы «Экономия» (E11-5): стек-бар по бюджетам (клик =
//    фильтр ГРБС) и квартальный тренд с переключателем ФБ/КБ/МБ и оверлеем
//    линий отдельных ГРБС (2–6 в выборке). Store не читает.

import clsx from 'clsx';
import { BarChart3, Building2, Layers, TrendingUp } from 'lucide-react';
import {
  Area, Bar, CartesianGrid, ComposedChart, Line,
  ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis,
} from 'recharts';
import { BT, Card, SectionHead } from './primitives';
import type { EconomyBarDatum } from '../../lib/economy/dept-economy';
import type { PerDeptSeries, TrendChartPoint } from '../../lib/economy/quarterly';

function formatAxisMoney(v: number): string {
  return v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : String(v);
}

/** Тултип бар-чарта: бюджеты + итог + разрез «само управление / подведы». */
function EconomyChartTooltip({ active, payload, formatMoney: fmt }: {
  active?: boolean; payload?: Array<{ payload?: EconomyBarDatum }>; label?: string; formatMoney: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className="rounded-lg border border-white/[0.08] bg-zinc-900/95 backdrop-blur-sm shadow-2xl px-3 py-2 text-[10px] min-w-[160px]">
      <div className="font-bold text-zinc-200 text-[11px] mb-1.5">{d.name}</div>
      <div className="space-y-1 mb-1.5">
        <div className="flex justify-between gap-4"><span className="text-blue-400">ФБ</span><span className="tabular-nums text-zinc-300">{fmt(d.fb)}</span></div>
        <div className="flex justify-between gap-4"><span className="text-emerald-400">КБ</span><span className="tabular-nums text-zinc-300">{fmt(d.kb)}</span></div>
        <div className="flex justify-between gap-4"><span className="text-amber-400">МБ</span><span className="tabular-nums text-zinc-300">{fmt(d.mb)}</span></div>
      </div>
      <div className="border-t border-white/[0.06] pt-1.5 flex justify-between gap-4">
        <span className="text-zinc-400">Итого</span>
        <span className="font-bold tabular-nums text-emerald-400">{fmt(d.total)}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-zinc-500">Снижение</span>
        <span className="tabular-nums text-purple-400">{d.pct.toFixed(1)}%</span>
      </div>
      {d.subCount > 0 && (
        <div className="border-t border-white/[0.06] mt-1.5 pt-1.5">
          <div className="flex justify-between gap-4 text-zinc-500">
            <span className="flex items-center gap-1"><Building2 size={7} />{d.name} (само)</span>
            <span className="tabular-nums text-blue-300">{fmt(d.ownEco)}</span>
          </div>
          <div className="flex justify-between gap-4 text-zinc-500">
            <span className="flex items-center gap-1"><Layers size={7} />Подведы ({d.subCount})</span>
            <span className="tabular-nums text-zinc-400">{fmt(d.subsEco)}</span>
          </div>
          {d.topSubs.length > 0 && (
            <div className="mt-1 space-y-px">
              {d.topSubs.map(s => (
                <div key={s.name} className="flex justify-between gap-2 text-[9px]">
                  <span className="text-zinc-600 truncate max-w-[120px]">{s.name}</span>
                  <span className="tabular-nums text-zinc-500">{fmt(s.eco)}</span>
                </div>
              ))}
              {d.subCount > 3 && <div className="text-[8px] text-zinc-700">...ещё {d.subCount - 3}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export interface EconomyChartsProps {
  barChartData: EconomyBarDatum[];
  trendData: TrendChartPoint[];
  perDeptQuarterly: PerDeptSeries[] | null;
  showBudgetBreakdown: boolean;
  onToggleBudgetBreakdown: () => void;
  formatMoney: (v: number) => string;
  /** Клик по бару = фильтр по ГРБС (deptId из payload). */
  onBarClick: (deptId: string) => void;
}

export function EconomyCharts({
  barChartData, trendData, perDeptQuarterly,
  showBudgetBreakdown, onToggleBudgetBreakdown, formatMoney, onBarClick,
}: EconomyChartsProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-2">

      {/* ── Бар-чарт по бюджетам (3/5) ── */}
      <Card className="lg:col-span-3" accent="emerald">
        <SectionHead
          icon={<BarChart3 size={13} className="text-emerald-400" />}
          title="Экономия по бюджетам"
          right={
            <div className="flex items-center gap-3">
              {(['fb', 'kb', 'mb'] as const).map(k => (
                <span key={k} className="flex items-center gap-1 text-[9px] text-zinc-500">
                  <span className={clsx('w-1.5 h-1.5 rounded-sm', BT[k].dot)} />
                  {BT[k].label}
                </span>
              ))}
              <span className="text-[8px] text-zinc-700">клик = фильтр</span>
            </div>
          }
        />
        <div className="p-3 h-48">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={barChartData}
              margin={{ top: 4, right: 8, bottom: 0, left: 8 }}
              onClick={(state: { activePayload?: Array<{ payload?: EconomyBarDatum }> }) => {
                const deptId = state?.activePayload?.[0]?.payload?.deptId;
                if (deptId) onBarClick(deptId);
              }}
              className="cursor-pointer"
            >
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#71717a' }} axisLine={false} tickLine={false} interval={0} angle={-30} textAnchor="end" height={35} />
              <YAxis yAxisId="left" tick={{ fontSize: 9, fill: '#52525b' }} axisLine={false} tickLine={false} tickFormatter={formatAxisMoney} width={42} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9, fill: '#52525b' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v.toFixed(0)}%`} width={30} />
              <RechartsTooltip
                content={<EconomyChartTooltip formatMoney={formatMoney} />}
                cursor={{ fill: 'rgba(59, 130, 246, 0.04)' }}
              />
              <Bar yAxisId="left" dataKey="fb" name="ФБ" stackId="eco" fill={BT.fb.fill} radius={[0, 0, 0, 0]} />
              <Bar yAxisId="left" dataKey="kb" name="КБ" stackId="eco" fill={BT.kb.fill} radius={[0, 0, 0, 0]} />
              <Bar yAxisId="left" dataKey="mb" name="МБ" stackId="eco" fill={BT.mb.fill} radius={[2, 2, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="pct" name="% снижения" stroke="#a855f7" strokeWidth={1.5} strokeDasharray="4 2" dot={{ r: 2, fill: '#a855f7', strokeWidth: 0 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* ── Квартальный тренд (2/5) ── */}
      <Card className="lg:col-span-2" accent="blue">
        <SectionHead
          icon={<TrendingUp size={13} className="text-blue-400" />}
          title="Тренд по кварталам"
          right={
            <button
              onClick={onToggleBudgetBreakdown}
              className={clsx(
                'text-[9px] font-semibold px-2 py-0.5 rounded-md transition-all',
                showBudgetBreakdown ? 'bg-emerald-500/10 text-emerald-400' : 'text-zinc-600 hover:text-zinc-300 hover:bg-white/[0.04]',
              )}
            >
              ФБ/КБ/МБ
            </button>
          }
        />
        <div className="p-3 h-48">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={trendData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#71717a' }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="left" tick={{ fontSize: 9, fill: '#52525b' }} axisLine={false} tickLine={false} tickFormatter={formatAxisMoney} width={42} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9, fill: '#52525b' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v.toFixed(0)}%`} width={28} />
              <RechartsTooltip
                formatter={(value: number, name: string) => name === '% снижения' ? `${(+value).toFixed(1)}%` : formatMoney(value)}
                contentStyle={{ fontSize: 10, borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 8px 32px rgba(0,0,0,0.4)', background: '#18181b', color: '#e4e4e7', padding: '6px 10px' }}
              />
              {showBudgetBreakdown ? (
                <>
                  <Bar yAxisId="left" dataKey="fb" name="ФБ" stackId="b" fill={BT.fb.fill} radius={[0, 0, 0, 0]} />
                  <Bar yAxisId="left" dataKey="kb" name="КБ" stackId="b" fill={BT.kb.fill} radius={[0, 0, 0, 0]} />
                  <Bar yAxisId="left" dataKey="mb" name="МБ" stackId="b" fill={BT.mb.fill} radius={[2, 2, 0, 0]} />
                </>
              ) : (
                <Area yAxisId="left" type="monotone" dataKey="economy" name="Экономия" fill="rgba(16,185,129,0.1)" stroke="#10b981" strokeWidth={2} />
              )}
              {/* Оверлей-линии отдельных ГРБС при выборке 2–6 управлений */}
              {perDeptQuarterly && perDeptQuarterly.map(dept => (
                <Line key={dept.id} yAxisId="left" type="monotone" dataKey={dept.id} name={dept.id}
                  stroke={dept.color} strokeWidth={1.2} strokeDasharray="3 2"
                  dot={{ r: 2, fill: dept.color, strokeWidth: 0 }} />
              ))}
              <Line yAxisId="right" type="monotone" dataKey="pct" name="% снижения" stroke="#3b82f6" strokeWidth={1.5} strokeDasharray="4 2" dot={{ r: 2.5, fill: '#3b82f6', strokeWidth: 0 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
