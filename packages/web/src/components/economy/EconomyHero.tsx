// ── Hero-полоса страницы «Экономия» (E11-5): четыре кликабельные метрики
//    со спарклайнами и дельтами, вертикальный разрез по бюджетам и топ-4
//    ГРБС по экономии. Store не читает — все данные и колбэки через пропсы.

import clsx from 'clsx';
import { KBTooltip } from '../ui/kb-tooltip';
import { Card, MiniSpark, TriBar } from './primitives';
import type { DeptEconomy } from '../../lib/economy/types';
import type { EconomyTotals } from '../../lib/economy/dept-economy';
import type { QuarterDeltas } from '../../lib/economy/quarterly';

/** Выбранная hero-метрика (подсветка активной ячейки). */
export type HeroMetric = 'economy' | 'pct' | 'high' | 'conflicts';

export interface EconomyHeroProps {
  /** Отфильтрованные строки ГРБС в исходном порядке (списки в подписях). */
  rows: DeptEconomy[];
  /** Те же строки, отсортированные текущей сортировкой (топ-4 справа). */
  sortedRows: DeptEconomy[];
  totals: EconomyTotals;
  economySpark: number[];
  pctSpark: number[];
  deltas: QuarterDeltas;
  heroMetric: HeroMetric;
  onHeroMetric: (metric: HeroMetric) => void;
  formatMoney: (v: number) => string;
  onToggleDepartment: (deptId: string) => void;
}

export function EconomyHero({
  rows, sortedRows, totals, economySpark, pctSpark, deltas,
  heroMetric, onHeroMetric, formatMoney, onToggleDepartment,
}: EconomyHeroProps) {
  const metrics = [
    { key: 'economy' as const, label: 'Экономия', value: formatMoney(totals.economy),
      sub: `${formatMoney(totals.plan)} → ${formatMoney(totals.fact)}`,
      delta: deltas.economy !== 0 ? formatMoney(Math.abs(deltas.economy)) : null,
      deltaUp: deltas.economy > 0, deltaLabel: deltas.label,
      color: 'text-emerald-400', metric: 'total_economy',
      status: totals.economy < 0 ? 'border-red-500/40' : '',
      spark: economySpark },
    { key: 'pct' as const, label: 'Снижение', value: `${totals.avgPct.toFixed(1)}%`,
      sub: `мин ${totals.pctMin.toFixed(1)}% / макс ${totals.pctMax.toFixed(1)}%`,
      delta: deltas.pct !== 0 ? `${Math.abs(deltas.pct).toFixed(1)}%` : null,
      deltaUp: deltas.pct > 0, deltaLabel: deltas.label,
      color: totals.avgPct > 25 ? 'text-red-400' : 'text-blue-400', metric: 'avg_reduction_pct',
      status: totals.avgPct > 25 ? 'border-red-500/40' : '',
      spark: pctSpark },
    { key: 'high' as const, label: '>25%', value: String(totals.highCount),
      sub: totals.highCount > 0 ? rows.filter(d => d.highEconomy).map(d => d.dept).join(', ') : 'норма',
      delta: null, deltaUp: false, deltaLabel: '',
      color: totals.highCount > 0 ? 'text-red-400' : 'text-emerald-400', metric: 'high_economy_count',
      status: totals.highCount > 0 ? 'border-red-500/40' : '',
      spark: null },
    { key: 'conflicts' as const, label: 'Расхождения', value: String(totals.conflicts),
      sub: totals.conflicts > 0 ? rows.filter(d => d.conflicts > 0).map(d => `${d.dept}(${d.conflicts})`).join(', ') : 'УФБП/ГРБС ОК',
      delta: null, deltaUp: false, deltaLabel: '',
      color: totals.conflicts > 0 ? 'text-amber-400' : 'text-emerald-400', metric: 'economy_conflicts',
      status: totals.conflicts > 3 ? 'border-red-500/40' : totals.conflicts > 0 ? 'border-amber-500/40' : '',
      spark: null },
  ];

  const budgetLegend = [
    { label: 'ФБ', val: totals.fbEco, color: 'text-blue-400', dot: 'bg-blue-500' },
    { label: 'КБ', val: totals.kbEco, color: 'text-emerald-400', dot: 'bg-emerald-500' },
    { label: 'МБ', val: totals.mbEco, color: 'text-amber-400', dot: 'bg-amber-500' },
  ];

  return (
    <Card accent="emerald" className="animate-[slideUp_400ms_ease-out]">
      <div className="grid grid-cols-[1fr_1px_auto] lg:grid-cols-[2fr_1px_auto_1px_auto]">

        {/* ── Слева: 4 метрики-селектора ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4">
          {metrics.map((m, i) => (
            <button
              key={m.key}
              onClick={() => onHeroMetric(m.key)}
              className={clsx(
                'relative px-3 py-2 text-left transition-all group/metric',
                heroMetric === m.key
                  ? 'bg-white/[0.04]'
                  : 'hover:bg-white/[0.02]',
                i > 0 && 'border-l border-white/[0.04]',
                m.status,
              )}
            >
              {heroMetric === m.key && (
                <div className="absolute bottom-0 inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent" />
              )}
              <KBTooltip metric={m.metric} side="bottom" showIcon>
                <div className="min-w-0">
                  <div className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-0.5">{m.label}</div>
                  <div className="flex items-baseline gap-1">
                    <span className={clsx('text-sm font-black tabular-nums leading-none tracking-tight', m.color)}>{m.value}</span>
                    {m.delta && (
                      <span className={clsx(
                        'inline-flex items-center gap-px text-[7px] font-bold tabular-nums whitespace-nowrap',
                        m.deltaUp ? 'text-emerald-400' : 'text-red-400',
                      )} title={m.deltaLabel}>
                        {m.deltaUp ? '↑' : '↓'}{m.delta}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    {m.spark && <MiniSpark data={m.spark} w={40} h={10} color={m.color.includes('red') ? '#ef4444' : '#10b981'} />}
                    <span className="text-[8px] text-zinc-600 truncate" title={m.sub}>{m.sub}</span>
                  </div>
                </div>
              </KBTooltip>
            </button>
          ))}
        </div>

        <div className="bg-white/[0.06] hidden lg:block" />

        {/* ── Центр: разрез по бюджетам ── */}
        <div className="hidden lg:flex flex-col justify-center px-3 py-1.5 gap-1 min-w-[140px]">
          <div className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">Бюджеты</div>
          <TriBar fb={totals.fbEco} kb={totals.kbEco} mb={totals.mbEco} h="h-1.5" />
          <div className="flex flex-col gap-px">
            {budgetLegend.map(b => (
              <div key={b.label} className="flex items-center gap-1">
                <span className={clsx('w-1 h-1 rounded-full shrink-0', b.dot)} />
                <span className="text-[8px] text-zinc-500 w-4">{b.label}</span>
                <span className={clsx('text-[9px] font-bold tabular-nums', b.color)}>{formatMoney(b.val)}</span>
                <span className="text-[8px] text-zinc-600 ml-auto">{totals.economy > 0 ? `${((b.val / totals.economy) * 100).toFixed(0)}%` : ''}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white/[0.06] hidden lg:block" />

        {/* ── Справа: топ-4 ГРБС по экономии ── */}
        <div className="hidden lg:block px-3 py-1.5 min-w-[140px] max-w-[170px]">
          <div className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Топ по экономии</div>
          {sortedRows.slice(0, 4).map((d, i) => (
            <button
              key={d.deptId}
              onClick={() => onToggleDepartment(d.deptId)}
              className="w-full flex items-center gap-1.5 py-0.5 hover:bg-white/[0.03] rounded transition-colors group/rank"
            >
              <span className="text-[9px] font-bold text-zinc-600 w-3">{i + 1}</span>
              <span className="text-[10px] text-zinc-400 group-hover/rank:text-blue-400 transition-colors truncate flex-1 text-left">{d.dept}</span>
              <span className="text-[10px] font-bold tabular-nums text-emerald-400">{formatMoney(d.economy)}</span>
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
}
