import { useStore } from '../../store';
import { AVAILABLE_YEARS } from '../../store';
import type { YearFilter } from '../../store';
import clsx from 'clsx';

/** Options: "Все" + all available years */
const OPTIONS: { value: YearFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  ...AVAILABLE_YEARS.map((y) => ({ value: y as YearFilter, label: String(y) })),
];

export function YearScroller() {
  const { year, setYear } = useStore();

  return (
    <div className="flex items-center gap-1 select-none">
      {OPTIONS.map((opt) => {
        const isActive = opt.value === year;
        const isAll = opt.value === 'all';

        return (
          <button
            key={String(opt.value)}
            onClick={() => setYear(opt.value)}
            className={clsx(
              'relative h-[36px] min-w-[36px] px-2.5 rounded-full text-xs font-semibold transition-all duration-200 outline-none',
              isActive && !isAll && [
                'bg-blue-500 text-white',
                'shadow-[0_0_10px_rgba(59,130,246,0.45),0_2px_6px_rgba(59,130,246,0.25)]',
              ],
              isActive && isAll && [
                'bg-gradient-to-r from-blue-500 to-indigo-500 text-white',
                'shadow-[0_0_12px_rgba(99,102,241,0.4),0_2px_6px_rgba(59,130,246,0.25)]',
              ],
              !isActive && isAll && [
                'text-zinc-500 dark:text-zinc-400',
                'bg-transparent',
                'ring-1 ring-zinc-300 dark:ring-zinc-600',
                'hover:ring-blue-400 dark:hover:ring-blue-500 hover:text-blue-600 dark:hover:text-blue-400',
              ],
              !isActive && !isAll && [
                'text-zinc-500 dark:text-zinc-400',
                'bg-zinc-100/60 dark:bg-zinc-800/60',
                'hover:bg-zinc-200/80 dark:hover:bg-zinc-700/60 hover:text-zinc-700 dark:hover:text-zinc-200',
              ],
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
