// ── Визуальные примитивы страницы «Экономия» (E11-5): бюджет-токены,
//    бейдж %, три-колор бар, прогресс факта, мини-спарклайн, карточка.
//    Ни один примитив не читает store — только пропсы.

import clsx from 'clsx';
import { ArrowUpDown, ChevronDown, ChevronUp } from 'lucide-react';
import type { SortDir, SortField } from '../../lib/economy/types';

/** Цветовые токены трёх бюджетов (ФБ/КБ/МБ) — единые для чартов и таблиц. */
export const BT = {
  fb: { fill: '#3b82f6', bg: 'bg-blue-500/8', text: 'text-blue-500', dot: 'bg-blue-500', label: 'ФБ' },
  kb: { fill: '#10b981', bg: 'bg-emerald-500/8', text: 'text-emerald-500', dot: 'bg-emerald-500', label: 'КБ' },
  mb: { fill: '#f59e0b', bg: 'bg-amber-500/8', text: 'text-amber-500', dot: 'bg-amber-500', label: 'МБ' },
} as const;

export type BudgetTokenKey = keyof typeof BT;

/** Бейдж % экономии: >25% красный (антидемпинг), 5–15% зелёный (норма), <2% янтарный. */
export function PctBadge({ pct, compact }: { pct: number; compact?: boolean }) {
  const cls =
    pct > 25 ? 'bg-red-500/10 text-red-400 ring-red-500/20'
    : pct >= 5 && pct <= 15 ? 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/20'
    : pct < 2 ? 'bg-amber-500/10 text-amber-400 ring-amber-500/20'
    : 'bg-zinc-500/8 text-zinc-400 ring-zinc-500/10';
  return (
    <span className={clsx(
      'inline-flex items-center rounded-md ring-1 ring-inset tabular-nums font-semibold',
      compact ? 'px-1 py-px text-[9px]' : 'px-1.5 py-0.5 text-[10px]',
      cls,
    )}>
      {pct.toFixed(1)}%
    </span>
  );
}

/** Прогресс исполнения: факт (синий) + остаток лимита (зелёный). */
export function EconomyProgress({ limit, fact, className }: { limit: number; fact: number; className?: string }) {
  if (limit <= 0) return null;
  const factPct = Math.min((fact / limit) * 100, 100);
  const remainingPct = 100 - factPct;
  return (
    <div className={clsx('relative h-1 rounded-full bg-zinc-800/40 overflow-hidden', className)} title={`Факт ${factPct.toFixed(1)}% / остаток лимита ${remainingPct.toFixed(1)}%`}>
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-700"
        style={{ width: `${factPct}%` }}
      />
      {remainingPct > 2 && (
        <div
          className="absolute inset-y-0 right-0 rounded-full bg-emerald-500/40 transition-all duration-700"
          style={{ width: `${remainingPct}%` }}
        />
      )}
    </div>
  );
}

/** Инлайн-разбивка суммы по трём бюджетам одной полосой. */
export function TriBar({ fb, kb, mb, h = 'h-1' }: { fb: number; kb: number; mb: number; h?: string }) {
  const total = fb + kb + mb;
  if (total <= 0) return <span className="text-zinc-600 text-[10px]">--</span>;
  const pFB = (fb / total) * 100;
  const pKB = (kb / total) * 100;
  return (
    <div className={clsx('w-full rounded-full overflow-hidden flex', h, 'bg-zinc-800/40')}>
      {pFB > 0 && <div className="h-full bg-blue-500 transition-all duration-500" style={{ width: `${pFB}%` }} />}
      {pKB > 0 && <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${pKB}%` }} />}
      {(100 - pFB - pKB) > 0.1 && <div className="h-full bg-amber-500 transition-all duration-500" style={{ width: `${100 - pFB - pKB}%` }} />}
    </div>
  );
}

/** SVG-мини-спарклайн без recharts; null при <2 точках или сплошных нулях. */
export function MiniSpark({ data, color = '#10b981', w = 48, h = 16 }: { data: number[]; color?: string; w?: number; h?: number }) {
  if (!data || data.length < 2 || data.every(v => v === 0)) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`).join(' ');
  return (
    <svg width={w} height={h} className="shrink-0 opacity-60 group-hover/row:opacity-100 transition-opacity">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Индикатор сортировки колонки. */
export function SortChevron({ field, active, dir }: { field: SortField; active: SortField; dir: SortDir }) {
  if (field !== active) return <ArrowUpDown size={9} className="text-zinc-600 ml-0.5 opacity-40" />;
  return dir === 'desc'
    ? <ChevronDown size={9} className="text-blue-400 ml-0.5" />
    : <ChevronUp size={9} className="text-blue-400 ml-0.5" />;
}

/** Карточка-обёртка (Linear-стиль: тонкая рамка, акцент-градиент сверху). */
export function Card({ children, className, accent }: {
  children: React.ReactNode; className?: string;
  accent?: 'emerald' | 'blue' | 'amber' | 'red' | 'purple';
}) {
  const accentGrad = accent
    ? `from-${accent}-500/30 via-${accent}-400/10 to-transparent`
    : 'from-white/[0.06] via-transparent to-transparent';
  return (
    <div className={clsx(
      'relative rounded-xl border border-white/[0.06] bg-white/[0.02]',
      'backdrop-blur-sm overflow-hidden',
      className,
    )}>
      <div className={clsx('absolute top-0 inset-x-0 h-px bg-gradient-to-r', accentGrad)} />
      {children}
    </div>
  );
}

/** Шапка секции внутри карточки. */
export function SectionHead({ icon, title, right }: {
  icon: React.ReactNode; title: string; right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.04]">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-xs font-semibold text-zinc-200 tracking-tight">{title}</span>
      </div>
      {right}
    </div>
  );
}
