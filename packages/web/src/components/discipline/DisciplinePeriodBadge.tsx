/**
 * Подпись периода вкладки «Дисциплина».
 *
 * Дела считаются ПО ВСЕМУ ГОДУ: половина классов («не обеспечено
 * финансированием», «факт без даты») — это строки, у которых дат попросту нет,
 * и сузить их до квартала или месяца нечем. Поэтому:
 *   - без сужения (и в недельном режиме) подпись даёт канонический
 *     PeriodBadge — он сам честно оговаривает выбранную неделю;
 *   - при явном сужении (квартал/месяцы в барабане) бейдж унаследовать нельзя
 *     (канон п.58б: бейдж фильтра, которому числа не подчиняются, запрещён) —
 *     рисуем подпись фактического периметра «год» с янтарной оговоркой.
 */
import { Calendar } from 'lucide-react';
import { useStore } from '../../store';
import { periodDataLabel } from '../../lib/period-label';
import { PeriodBadge } from '../PeriodBadge';

const NO_MONTHS = new Set<number>();

export function DisciplinePeriodBadge() {
  const year = useStore((s) => s.year);
  const period = useStore((s) => s.period);
  const activeMonths = useStore((s) => s.activeMonths);
  const periodMode = useStore((s) => s.periodMode);

  const narrowed = periodMode === 'explicit' && (period !== 'year' || activeMonths.size > 0);
  if (!narrowed) return <PeriodBadge />;

  const yearLabel = periodDataLabel({ year, period: 'year', activeMonths: NO_MONTHS });
  const chosenLabel = periodDataLabel({ year, period, activeMonths });
  return (
    <div className="flex flex-col items-end gap-1 shrink-0">
      <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[10px] font-medium text-zinc-600 dark:text-zinc-300">
        <Calendar size={10} aria-hidden="true" />
        <span className="tabular-nums">{yearLabel}</span>
      </div>
      <span
        className="text-[9px] leading-tight text-amber-600 dark:text-amber-400 text-right max-w-[15rem]"
        title="Дела собираются из строк, у которых даты часто не проставлены вовсе, — сузить такой список до квартала или месяца нечем, поэтому он всегда за весь год."
      >
        в шапке выбран период «{chosenLabel}», но дела считаются за весь год
      </span>
    </div>
  );
}
