// ── Графики страницы «Экономия»: стек-бар по бюджетам (клик = фильтр по
//    управлению) и квартальный тренд с переключателем ФБ/КБ/МБ и наложением
//    линий отдельных управлений (при выборке от двух до шести). Store не читает.
//
//    Величина, которую рисует пунктирная линия, — ДОЛЯ УТВЕРЖДЁННОЙ ЭКОНОМИИ
//    от лимита (экономия ÷ лимит). Прежняя подпись «% снижения» описывала
//    «лимит минус факт» — другую величину, и читатель проверял бы не то число.

import clsx from 'clsx';
import { BarChart3, Building2, Layers, TrendingUp } from 'lucide-react';
import {
  Area, Bar, CartesianGrid, ComposedChart, Line,
  ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis,
} from 'recharts';
import { tooltipProps } from '../ui/chart-theme';
import { BT, Card, FOCUS_RING, SectionHead } from './primitives';
import { formatAxisMoney, formatAxisPct, formatPct } from '../../lib/economy/format';
import type { EconomyBarDatum } from '../../lib/economy/dept-economy';
import type { PerDeptSeries, TrendChartPoint } from '../../lib/economy/quarterly';

/** Подпись ряда доли — одна строка на оба графика, чтобы не разъезжалась. */
const SHARE_SERIES = 'Доля экономии';

/** Тултип бар-чарта: бюджеты + итог + разрез «аппарат / подведомственные». */
function EconomyChartTooltip({ active, payload, formatMoney: fmt }: {
  active?: boolean; payload?: Array<{ payload?: EconomyBarDatum }>; label?: string; formatMoney: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    // Подсказка живёт на поверхности всплывающего слоя и говорит ролями, а не
    // красками: прежде она была прибита к тёмной теме (zinc-900 + светлые
    // чернила) и на светлой теме читалась чужеродным чёрным прямоугольником.
    <div
      className="rounded-lg px-3 py-2 text-[10px] min-w-[160px] backdrop-blur-sm"
      style={{
        background: 'var(--chart-tooltip-bg)',
        border: '1px solid var(--chart-tooltip-line)',
        color: 'var(--ink)',
        boxShadow: 'var(--elevation-2)',
      }}
    >
      <div className="font-bold text-[11px] mb-1.5" style={{ color: 'var(--ink-strong)' }}>{d.name}</div>
      <div className="space-y-1 mb-1.5">
        <div className="flex justify-between gap-4"><span className="text-blue-600 dark:text-blue-400">ФБ</span><span className="tabular-nums">{fmt(d.fb)}</span></div>
        <div className="flex justify-between gap-4"><span className="text-emerald-600 dark:text-emerald-400">КБ</span><span className="tabular-nums">{fmt(d.kb)}</span></div>
        <div className="flex justify-between gap-4"><span className="text-amber-600 dark:text-amber-400">МБ</span><span className="tabular-nums">{fmt(d.mb)}</span></div>
      </div>
      <div
        className="pt-1.5 flex justify-between gap-4"
        style={{ borderTop: '1px solid var(--chart-tooltip-line)' }}
      >
        <span style={{ color: 'var(--ink-muted)' }}>Итого</span>
        <span className="font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{fmt(d.total)}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span style={{ color: 'var(--ink-muted)' }}>Доля от лимита</span>
        <span className="tabular-nums text-purple-600 dark:text-purple-400">{formatPct(d.pct)}</span>
      </div>
      {d.subCount > 0 && (
        <div className="mt-1.5 pt-1.5" style={{ borderTop: '1px solid var(--chart-tooltip-line)' }}>
          <div className="flex justify-between gap-4" style={{ color: 'var(--ink-muted)' }}>
            <span className="flex items-center gap-1"><Building2 size={7} aria-hidden="true" />Аппарат управления</span>
            <span className="tabular-nums text-blue-600 dark:text-blue-400">{fmt(d.ownEco)}</span>
          </div>
          <div className="flex justify-between gap-4" style={{ color: 'var(--ink-muted)' }}>
            <span className="flex items-center gap-1"><Layers size={7} aria-hidden="true" />Подведомственные ({d.subCount})</span>
            <span className="tabular-nums">{fmt(d.subsEco)}</span>
          </div>
          {d.topSubs.length > 0 && (
            <div className="mt-1 space-y-px">
              {d.topSubs.map(s => (
                <div key={s.name} className="flex justify-between gap-2 text-[9px]" style={{ color: 'var(--ink-faint)' }}>
                  <span className="truncate max-w-[120px]">{s.name}</span>
                  <span className="tabular-nums">{fmt(s.eco)}</span>
                </div>
              ))}
              {d.subCount > 3 && (
                <div className="text-[8px]" style={{ color: 'var(--ink-faint)' }}>…ещё {d.subCount - 3}</div>
              )}
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
  /** Сколько управлений в выборке — нужно, чтобы честно объяснить отсутствие линий. */
  deptCount: number;
  showBudgetBreakdown: boolean;
  onToggleBudgetBreakdown: () => void;
  formatMoney: (v: number) => string;
  /** Клик по бару = фильтр по управлению (deptId из payload);
      в режиме подведов страница передаёт переход к строкам учреждения. */
  onBarClick: (deptId: string) => void;
  /** Подпись действия клика по бару; страница меняет её в режиме подведов. */
  barClickHint?: string;
}

export function EconomyCharts({
  barChartData, trendData, perDeptQuarterly, deptCount,
  showBudgetBreakdown, onToggleBudgetBreakdown, formatMoney, onBarClick,
  barClickHint = 'клик — фильтр',
}: EconomyChartsProps) {
  // ── Заголовки-утверждения: говорят, что видно на картинке, а не как она называется ──
  const budgetSums = barChartData.reduce(
    (acc, d) => ({ fb: acc.fb + d.fb, kb: acc.kb + d.kb, mb: acc.mb + d.mb }),
    { fb: 0, kb: 0, mb: 0 },
  );
  const budgetTotal = budgetSums.fb + budgetSums.kb + budgetSums.mb;
  const leadBudget = budgetTotal > 0
    ? (['fb', 'kb', 'mb'] as const).reduce((best, k) => (budgetSums[k] > budgetSums[best] ? k : best), 'fb' as const)
    : null;
  const barTitle = leadBudget
    ? `Экономия идёт в основном из ${BT[leadBudget].full}а`
    : 'Экономии по бюджетам пока нет';
  const barHint = leadBudget
    ? `${BT[leadBudget].label} — ${formatPct((budgetSums[leadBudget] / budgetTotal) * 100, 0)} всей экономии`
    : undefined;

  const quartersWithData = trendData.filter(p => Number(p.economy) !== 0);
  const lastQ = quartersWithData[quartersWithData.length - 1];
  const prevQ = quartersWithData[quartersWithData.length - 2];
  const trendTitle = !lastQ
    ? 'Квартальных данных ещё нет'
    : !prevQ
      ? `Экономия пока только за ${lastQ.name}`
      : Number(lastQ.economy) >= Number(prevQ.economy)
        ? `Экономия выросла к ${lastQ.name}`
        : `Экономия снизилась к ${lastQ.name}`;

  // Линии отдельных управлений читаемы лишь в узком диапазоне выборки.
  // Молча их не показывать — значит оставить читателя гадать, куда они делись.
  const overlayNote = perDeptQuarterly
    ? undefined
    : deptCount > 6
      ? 'линии по управлениям — при выборке не более шести'
      : deptCount === 1
        ? 'выбрано одно управление — общая линия и есть его линия'
        : undefined;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-2">

      {/* ── Бар-чарт по бюджетам (3/5) ── */}
      <Card className="lg:col-span-3" accent="emerald">
        <SectionHead
          icon={<BarChart3 size={13} className="text-emerald-600 dark:text-emerald-400" />}
          title={barTitle}
          hint={barHint}
          right={
            <div className="flex items-center gap-3 shrink-0">
              {(['fb', 'kb', 'mb'] as const).map(k => (
                <span key={k} className="flex items-center gap-1 text-[9px] text-zinc-500" title={BT[k].full}>
                  <span className={clsx('w-1.5 h-1.5 rounded-sm', BT[k].dot)} aria-hidden="true" />
                  {BT[k].label}
                </span>
              ))}
              <span className="text-[8px] text-zinc-400 dark:text-zinc-700">{barClickHint}</span>
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
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#71717a' }} axisLine={false} tickLine={false} interval={0} angle={-30} textAnchor="end" height={35} />
              <YAxis yAxisId="left" tick={{ fontSize: 9, fill: '#52525b' }} axisLine={false} tickLine={false} tickFormatter={formatAxisMoney} width={56} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9, fill: '#52525b' }} axisLine={false} tickLine={false} tickFormatter={formatAxisPct} width={38} />
              <RechartsTooltip
                content={<EconomyChartTooltip formatMoney={formatMoney} />}
                cursor={{ fill: 'rgba(214, 191, 133, 0.08)' }}
              />
              <Bar yAxisId="left" dataKey="fb" name="ФБ" stackId="eco" fill={BT.fb.fill} radius={[0, 0, 0, 0]} />
              <Bar yAxisId="left" dataKey="kb" name="КБ" stackId="eco" fill={BT.kb.fill} radius={[0, 0, 0, 0]} />
              <Bar yAxisId="left" dataKey="mb" name="МБ" stackId="eco" fill={BT.mb.fill} radius={[2, 2, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="pct" name={SHARE_SERIES} stroke="#a855f7" strokeWidth={1.5} strokeDasharray="4 2" dot={{ r: 2, fill: '#a855f7', strokeWidth: 0 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* ── Квартальный тренд (2/5) ── */}
      <Card className="lg:col-span-2" accent="blue">
        <SectionHead
          icon={<TrendingUp size={13} className="text-blue-600 dark:text-blue-400" />}
          title={trendTitle}
          hint={overlayNote}
          right={
            <button
              type="button"
              onClick={onToggleBudgetBreakdown}
              aria-pressed={showBudgetBreakdown}
              title="Разложить квартальную экономию на федеральный, краевой и муниципальный бюджеты"
              className={clsx(
                'text-[9px] font-semibold px-2 py-0.5 rounded-md transition-all shrink-0',
                FOCUS_RING,
                showBudgetBreakdown
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'text-zinc-500 dark:text-zinc-600 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/[0.04]',
              )}
            >
              ФБ/КБ/МБ
            </button>
          }
        />
        <div className="p-3 h-48">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={trendData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#71717a' }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="left" tick={{ fontSize: 9, fill: '#52525b' }} axisLine={false} tickLine={false} tickFormatter={formatAxisMoney} width={56} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9, fill: '#52525b' }} axisLine={false} tickLine={false} tickFormatter={formatAxisPct} width={38} />
              <RechartsTooltip
                formatter={(value: number, name: string) => name === SHARE_SERIES ? formatPct(+value) : formatMoney(value)}
                // Облик подсказки — общий дом графиков (ui/chart-theme): роли
                // вместо красок, обе темы правятся в одном месте.
                {...tooltipProps}
                contentStyle={{ ...tooltipProps.contentStyle, fontSize: 10, padding: '6px 10px' }}
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
              {/* Линии отдельных управлений при выборке от двух до шести */}
              {perDeptQuarterly && perDeptQuarterly.map(dept => (
                <Line key={dept.id} yAxisId="left" type="monotone" dataKey={dept.id} name={dept.id}
                  stroke={dept.color} strokeWidth={1.2} strokeDasharray="3 2"
                  dot={{ r: 2, fill: dept.color, strokeWidth: 0 }} />
              ))}
              <Line yAxisId="right" type="monotone" dataKey="pct" name={SHARE_SERIES} stroke="#bfa161" strokeWidth={1.5} strokeDasharray="4 2" dot={{ r: 2.5, fill: '#bfa161', strokeWidth: 0 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
