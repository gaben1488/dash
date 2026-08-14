/**
 * Плашка периода ДАННЫХ карточки — единый паттерн на всю систему (канон п.58,
 * образец владелец одобрил на карточке «Исполнение»: «понятно, что показывает;
 * на других карточках такой плашки нет» — теперь есть).
 *
 * Два правила, за которые плашка отвечает:
 *   1. Подпись называет период, которому числа ФАКТИЧЕСКИ подчиняются, а не
 *      выбор в шапке. Дефолт без фильтров утверждён владельцем 14.08:
 *      «2026 · весь год».
 *   2. Если недельный выбор сделан, но расчёт карточки неделю не сужает, —
 *      честная оговорка янтарным, а не унаследованный лживый бейдж.
 */
import { useMemo } from 'react';
import { Calendar } from 'lucide-react';
import { useStore, MONTHS } from '../store';
import { periodDataLabel } from '../lib/period-label';

const MONTH_ABBR = MONTHS.map((m) => m.short.toLowerCase());

/** Все данные плашки из состояния фильтров — один хук вместо копий по карточкам. */
export function usePeriodBadge() {
  const year = useStore((s) => s.year);
  const period = useStore((s) => s.period);
  const activeMonths = useStore((s) => s.activeMonths);
  const periodMode = useStore((s) => s.periodMode);
  const focusedWeekStart = useStore((s) => s.focusedWeekStart);

  const periodLabel = useMemo(
    () => periodDataLabel({ year, period, activeMonths }),
    [activeMonths, year, period],
  );

  const weekLabel = useMemo(() => {
    const d = new Date(focusedWeekStart);
    const end = new Date(d);
    end.setDate(d.getDate() + 6);
    const fmt = (x: Date) => `${x.getDate()} ${MONTH_ABBR[x.getMonth()]}`;
    return d.getMonth() === end.getMonth()
      ? `${d.getDate()}–${end.getDate()} ${MONTH_ABBR[d.getMonth()]}`
      : `${fmt(d)}–${fmt(end)}`;
  }, [focusedWeekStart]);

  return { periodLabel, weekLabel, weekNotApplied: periodMode === 'week' };
}

/**
 * Сама плашка. `appliesWeek` ставит карточка, чей расчёт РЕАЛЬНО сужается до
 * недели (таких сейчас нет — появятся с недельным срезом в движке): тогда
 * оговорка не показывается.
 */
export function PeriodBadge({ appliesWeek = false }: { appliesWeek?: boolean }) {
  const { periodLabel, weekLabel, weekNotApplied } = usePeriodBadge();
  return (
    <div className="flex flex-col items-end gap-1 shrink-0">
      <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[10px] font-medium text-zinc-600 dark:text-zinc-300">
        <Calendar size={10} aria-hidden="true" />
        <span className="tabular-nums">{periodLabel}</span>
      </div>
      {weekNotApplied && !appliesWeek && (
        <span
          className="text-[9px] leading-tight text-amber-600 dark:text-amber-400 text-right max-w-[13rem]"
          title="Недельный выбор пока не сужает расчёт этой карточки: числа выше — за указанный период, не за неделю."
        >
          неделя {weekLabel} выбрана, но числа за {periodLabel}
        </span>
      )}
    </div>
  );
}
