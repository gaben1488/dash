// ── Визуальные примитивы страницы «Экономия»: бюджет-токены, бейдж доли,
//    три-колор бар, прогресс факта, мини-спарклайн, карточка.
//    Ни один примитив не читает store — только пропсы.

import clsx from 'clsx';
import { ArrowUpDown, ChevronDown, ChevronUp } from 'lucide-react';
import { formatPct } from '../../lib/economy/format';
import type { SortDir, SortField } from '../../lib/economy/types';

/** Цветовые токены трёх бюджетов (ФБ/КБ/МБ) — единые для чартов и таблиц. */
export const BT = {
  fb: { fill: '#3b82f6', bg: 'bg-blue-500/8', text: 'text-blue-500', dot: 'bg-blue-500', label: 'ФБ', full: 'федеральный бюджет' },
  kb: { fill: '#10b981', bg: 'bg-emerald-500/8', text: 'text-emerald-500', dot: 'bg-emerald-500', label: 'КБ', full: 'краевой бюджет' },
  mb: { fill: '#f59e0b', bg: 'bg-amber-500/8', text: 'text-amber-500', dot: 'bg-amber-500', label: 'МБ', full: 'муниципальный бюджет' },
} as const;

export type BudgetTokenKey = keyof typeof BT;

/** Общий класс видимого фокуса — клавиатура должна видеть, где она находится. */
export const FOCUS_RING =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70 focus-visible:ring-offset-1 focus-visible:ring-offset-zinc-900 rounded-sm';

/**
 * Бейдж доли экономии от лимита.
 * Пороги: свыше 25 % красный (проверка по ст.37 44-ФЗ), 5–15 % зелёный
 * (обычная конкурентная экономия), ниже 2 % янтарный (торги могли быть
 * формальными). Отсутствие лимита — не ноль, а честное «нет плана».
 */
export function PctBadge({ pct, compact }: { pct: number | null; compact?: boolean }) {
  const size = compact ? 'px-1 py-px text-[9px]' : 'px-1.5 py-0.5 text-[10px]';
  if (pct === null) {
    return (
      <span
        className={clsx(
          'inline-flex items-center rounded-md ring-1 ring-inset font-medium',
          'bg-zinc-500/8 text-zinc-500 ring-zinc-500/10',
          size,
        )}
        title="Лимит не задан — доля экономии не считается"
      >
        нет плана
      </span>
    );
  }
  const cls =
    pct > 25 ? 'bg-red-500/10 text-red-400 ring-red-500/20'
    : pct >= 5 && pct <= 15 ? 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/20'
    : pct < 2 ? 'bg-amber-500/10 text-amber-400 ring-amber-500/20'
    : 'bg-zinc-500/8 text-zinc-400 ring-zinc-500/10';
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-md ring-1 ring-inset tabular-nums font-semibold',
        size,
        cls,
      )}
      title="Доля утверждённой экономии от лимита"
    >
      {formatPct(pct)}
    </span>
  );
}

/** Прогресс исполнения: факт (синий) + остаток лимита (зелёный). */
export function EconomyProgress({ limit, fact, className }: { limit: number; fact: number; className?: string }) {
  if (limit <= 0) return null;
  const factPct = Math.min((fact / limit) * 100, 100);
  const remainingPct = 100 - factPct;
  return (
    <div
      className={clsx('relative h-1 rounded-full bg-zinc-800/40 overflow-hidden', className)}
      title={`Факт освоил ${formatPct(factPct)} лимита, остаток ${formatPct(remainingPct)}`}
      aria-hidden="true"
    >
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

/**
 * Инлайн-разбивка суммы по трём бюджетам одной полосой.
 * Пустоту называем причиной, а не прочерком: разбивки может не быть либо
 * потому что суммы нулевые, либо потому что среди них есть отрицательные —
 * доли от такой суммы не строятся.
 */
export function TriBar({ fb, kb, mb, h = 'h-1' }: { fb: number; kb: number; mb: number; h?: string }) {
  const total = fb + kb + mb;
  const hasNegative = fb < 0 || kb < 0 || mb < 0;
  if (hasNegative || total <= 0) {
    return (
      <span
        className="text-zinc-600 text-[9px] whitespace-nowrap"
        title={hasNegative
          ? 'Среди сумм ФБ/КБ/МБ есть отрицательные — доли не строятся'
          : 'Экономии по ФБ/КБ/МБ нет — разбивку строить не от чего'}
      >
        нет разбивки
      </span>
    );
  }
  const pFB = (fb / total) * 100;
  const pKB = (kb / total) * 100;
  const pMB = 100 - pFB - pKB;
  return (
    <div
      className={clsx('w-full rounded-full overflow-hidden flex', h, 'bg-zinc-800/40')}
      title={`ФБ ${pFB.toFixed(0)} %, КБ ${pKB.toFixed(0)} %, МБ ${pMB.toFixed(0)} %`}
    >
      {pFB > 0 && <div className="h-full bg-blue-500 transition-all duration-500" style={{ width: `${pFB}%` }} />}
      {pKB > 0 && <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${pKB}%` }} />}
      {pMB > 0.1 && <div className="h-full bg-amber-500 transition-all duration-500" style={{ width: `${pMB}%` }} />}
    </div>
  );
}

/**
 * SVG-мини-спарклайн без recharts. Точки без значения (`null`) рвут линию,
 * а не проседают в ноль — квартал без лимита не то же самое, что квартал
 * с нулевой долей. Декоративен: соседнее число говорит то же самое словами.
 */
export function MiniSpark({ data, color = '#10b981', w = 48, h = 16 }: {
  data: Array<number | null> | undefined; color?: string; w?: number; h?: number;
}) {
  if (!data) return null;
  const known = data.filter((v): v is number => v !== null);
  if (known.length < 2 || known.every(v => v === 0)) return null;
  const min = Math.min(...known);
  const max = Math.max(...known);
  const range = max - min || 1;
  const step = data.length > 1 ? w / (data.length - 1) : 0;

  // Разрыв в данных = разрыв в линии: копим подряд идущие точки в сегмент.
  const segments: string[] = [];
  let current: string[] = [];
  data.forEach((v, i) => {
    if (v === null) {
      if (current.length > 1) segments.push(current.join(' '));
      current = [];
      return;
    }
    current.push(`${i * step},${h - ((v - min) / range) * h}`);
  });
  if (current.length > 1) segments.push(current.join(' '));
  if (segments.length === 0) return null;

  return (
    <svg
      width={w}
      height={h}
      aria-hidden="true"
      focusable="false"
      className="shrink-0 opacity-60 group-hover/row:opacity-100 transition-opacity"
    >
      {segments.map((points, i) => (
        <polyline key={i} points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
}

/** Индикатор сортировки колонки (декоративный — состояние несёт aria-sort). */
export function SortChevron({ field, active, dir }: { field: SortField; active: SortField; dir: SortDir }) {
  if (field !== active) return <ArrowUpDown size={9} aria-hidden="true" className="text-zinc-600 ml-0.5 opacity-40" />;
  return dir === 'desc'
    ? <ChevronDown size={9} aria-hidden="true" className="text-blue-400 ml-0.5" />
    : <ChevronUp size={9} aria-hidden="true" className="text-blue-400 ml-0.5" />;
}

/**
 * Акцентные градиенты карточек — статической картой, а не шаблонной строкой.
 * Tailwind собирает классы поиском по исходникам: `from-${accent}-500/30`
 * в сборку не попадал, и акцент не рисовался вовсе.
 */
const CARD_ACCENTS = {
  emerald: 'from-emerald-500/30 via-emerald-400/10 to-transparent',
  blue: 'from-blue-500/30 via-blue-400/10 to-transparent',
  amber: 'from-amber-500/30 via-amber-400/10 to-transparent',
  red: 'from-red-500/30 via-red-400/10 to-transparent',
  purple: 'from-purple-500/30 via-purple-400/10 to-transparent',
} as const;

/** Карточка-обёртка (тонкая рамка, акцент-градиент сверху). */
export function Card({ children, className, accent }: {
  children: React.ReactNode; className?: string;
  accent?: keyof typeof CARD_ACCENTS;
}) {
  const accentGrad = accent ? CARD_ACCENTS[accent] : 'from-white/[0.06] via-transparent to-transparent';
  return (
    <div className={clsx(
      'relative rounded-xl border border-white/[0.06] bg-white/[0.02]',
      'backdrop-blur-sm overflow-hidden',
      className,
    )}>
      <div className={clsx('absolute top-0 inset-x-0 h-px bg-gradient-to-r', accentGrad)} aria-hidden="true" />
      {children}
    </div>
  );
}

/** Шапка секции внутри карточки. */
export function SectionHead({ icon, title, hint, right }: {
  icon: React.ReactNode; title: string; hint?: string; right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-white/[0.04]">
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="shrink-0 self-center" aria-hidden="true">{icon}</span>
        <h3 className="text-xs font-semibold text-zinc-200 tracking-tight truncate">{title}</h3>
        {hint && <span className="text-[9px] text-zinc-600 truncate">{hint}</span>}
      </div>
      {right}
    </div>
  );
}
