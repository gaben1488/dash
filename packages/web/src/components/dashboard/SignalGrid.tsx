import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { KBTooltip } from '../ui/kb-tooltip';
import {
  Clock, Zap, TrendingUp, Lock, CalendarOff, Banknote,
  Pause, ArrowUpRight, ArrowDownRight,
} from 'lucide-react';

/* ─── Signal definitions ───────────────────────────────────────── */

interface SignalDef {
  key: string;
  label: string;
  search: string;
  metricKey?: string;
  icon: React.ElementType;
  hue: string; // tailwind color name
}

const SIGNALS: SignalDef[] = [
  { key: 'overdue',           label: 'Просрочки',         search: 'просрочк',           metricKey: 'signal_overdue',           icon: Clock,         hue: 'red' },
  { key: 'economyConflict',   label: 'Флаг экономии',     search: 'флаг эконом',        metricKey: 'signal_economy_conflict',  icon: Zap,           hue: 'rose' },
  { key: 'highEconomy',       label: 'Высокая экономия',  search: 'высокая экономия',   metricKey: 'signal_high_economy',      icon: TrendingUp,    hue: 'orange' },
  { key: 'earlyClosure',      label: 'Раннее закрытие',   search: 'раннее закрытие',                                           icon: Lock,          hue: 'amber' },
  { key: 'factWithoutDate',   label: 'Факт без даты',     search: 'факт без даты',                                             icon: CalendarOff,   hue: 'purple' },
  { key: 'dateWithoutFact',   label: 'Дата без сумм',     search: 'факт дата без сумм', metricKey: 'signal_fact_date_before_plan', icon: Banknote,  hue: 'cyan' },
  { key: 'stalledContract',   label: 'Подвисшие',         search: 'подвис',             metricKey: 'signal_stalled_contract',  icon: Pause,         hue: 'blue' },
  { key: 'factExceedsPlan',   label: 'Факт > план',       search: 'факт превыш',        metricKey: 'signal_fact_exceeds_plan', icon: ArrowUpRight,  hue: 'indigo' },
  { key: 'factDateBeforePlan',label: 'Факт < план дата',  search: 'факт дата раньше',   metricKey: 'signal_fact_date_before_plan', icon: ArrowDownRight, hue: 'teal' },
];

/* ─── Color system for signal hues ─────────────────────────────── */

const HUE_STYLES: Record<string, { bg: string; border: string; text: string; num: string; iconBg: string }> = {
  red:    { bg: 'bg-red-500/5',    border: 'border-red-500/20 hover:border-red-500/40',    text: 'text-red-500/70',    num: 'text-red-600 dark:text-red-400',       iconBg: 'bg-red-500/10' },
  rose:   { bg: 'bg-rose-500/5',   border: 'border-rose-500/20 hover:border-rose-500/40',   text: 'text-rose-500/70',   num: 'text-rose-600 dark:text-rose-400',     iconBg: 'bg-rose-500/10' },
  orange: { bg: 'bg-orange-500/5', border: 'border-orange-500/20 hover:border-orange-500/40', text: 'text-orange-500/70', num: 'text-orange-600 dark:text-orange-400', iconBg: 'bg-orange-500/10' },
  amber:  { bg: 'bg-amber-500/5',  border: 'border-amber-500/20 hover:border-amber-500/40',  text: 'text-amber-500/70',  num: 'text-amber-600 dark:text-amber-400',   iconBg: 'bg-amber-500/10' },
  purple: { bg: 'bg-purple-500/5', border: 'border-purple-500/20 hover:border-purple-500/40', text: 'text-purple-500/70', num: 'text-purple-600 dark:text-purple-400', iconBg: 'bg-purple-500/10' },
  cyan:   { bg: 'bg-cyan-500/5',   border: 'border-cyan-500/20 hover:border-cyan-500/40',   text: 'text-cyan-500/70',   num: 'text-cyan-600 dark:text-cyan-400',     iconBg: 'bg-cyan-500/10' },
  blue:   { bg: 'bg-blue-500/5',   border: 'border-blue-500/20 hover:border-blue-500/40',   text: 'text-blue-500/70',   num: 'text-blue-600 dark:text-blue-400',     iconBg: 'bg-blue-500/10' },
  indigo: { bg: 'bg-indigo-500/5', border: 'border-indigo-500/20 hover:border-indigo-500/40', text: 'text-indigo-500/70', num: 'text-indigo-600 dark:text-indigo-400', iconBg: 'bg-indigo-500/10' },
  teal:   { bg: 'bg-teal-500/5',   border: 'border-teal-500/20 hover:border-teal-500/40',   text: 'text-teal-500/70',   num: 'text-teal-600 dark:text-teal-400',     iconBg: 'bg-teal-500/10' },
};

/* ─── Component ────────────────────────────────────────────────── */

interface SignalGridProps {
  issues: any[];
  signalCounts?: Record<string, number>;
  onNavigate: (category: string, search?: string) => void;
}

export function SignalGrid({ issues, onNavigate }: SignalGridProps) {
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const iss of issues) {
      const sig = iss.signal;
      if (sig) c[sig] = (c[sig] || 0) + 1;
    }
    return c;
  }, [issues]);

  const total = SIGNALS.reduce((s, sig) => s + (counts[sig.key] || 0), 0);
  if (total === 0) return null;

  // Sort: active signals first, then by count desc
  const sorted = [...SIGNALS].sort((a, b) => {
    const ca = counts[a.key] || 0;
    const cb = counts[b.key] || 0;
    if (ca > 0 && cb === 0) return -1;
    if (ca === 0 && cb > 0) return 1;
    return cb - ca;
  });

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
          Сигналы
        </h2>
        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-500 font-bold tabular-nums">
          {total}
        </span>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2">
        {sorted.map(sig => {
          const count = counts[sig.key] || 0;
          const s = HUE_STYLES[sig.hue] ?? HUE_STYLES.blue;
          const active = count > 0;
          const Icon = sig.icon;

          const card = (
            <button
              key={sig.key}
              onClick={() => active && onNavigate(sig.key, sig.search)}
              disabled={!active}
              className={cn(
                'relative group rounded-xl border p-2.5 text-left transition-all duration-200 w-full',
                s.bg, s.border,
                active && 'cursor-pointer hover:scale-[1.03] active:scale-[0.97]',
                !active && 'opacity-30 cursor-default',
              )}
            >
              {/* Icon */}
              <div className={cn('w-6 h-6 rounded-lg flex items-center justify-center mb-2', s.iconBg)}>
                <Icon size={13} className={s.text} />
              </div>

              {/* Count */}
              <div className={cn(
                'text-lg font-bold tabular-nums leading-none',
                active ? s.num : 'text-zinc-300 dark:text-zinc-700',
              )}>
                {count}
              </div>

              {/* Label */}
              <div className={cn(
                'text-[10px] font-medium mt-1 leading-tight',
                active ? s.text : 'text-zinc-300 dark:text-zinc-600',
              )}>
                {sig.label}
              </div>

              {/* Pulse on critical signals */}
              {active && count > 3 && sig.hue === 'red' && (
                <span className="absolute top-1.5 right-1.5 flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                </span>
              )}
            </button>
          );

          if (sig.metricKey) {
            return (
              <KBTooltip key={sig.key} metric={sig.metricKey}>
                {card}
              </KBTooltip>
            );
          }
          return card;
        })}
      </div>
    </section>
  );
}
