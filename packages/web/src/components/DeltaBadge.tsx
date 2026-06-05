import clsx from 'clsx';
import type { MetricDelta } from '@aemr/core';
import { formatDelta, type DeltaTone } from '../lib/delta-format';

const TONE: Record<DeltaTone, string> = {
  good: 'text-emerald-600 dark:text-emerald-400',
  bad: 'text-amber-600 dark:text-amber-400',
  neutral: 'text-zinc-400 dark:text-zinc-500',
};

/**
 * Тихий инлайн-бейдж дрейфа метрики (слой 1 истории изменений).
 * Цвет — по смыслу (сентимент), не по знаку. Клик → поповер «было→стало» (фаза позже).
 */
export function DeltaBadge({ delta, onClick }: { delta: MetricDelta; onClick?: () => void }) {
  const v = formatDelta(delta);
  return (
    <span
      role={onClick ? 'button' : undefined}
      onClick={onClick}
      title={v.title}
      className={clsx(
        'inline-flex items-center gap-0.5 text-[10px] font-semibold tabular-nums leading-none select-none',
        TONE[v.tone],
        onClick && 'cursor-pointer hover:opacity-80',
      )}
    >
      <span aria-hidden>{v.arrow}</span>
      {v.text}
    </span>
  );
}
