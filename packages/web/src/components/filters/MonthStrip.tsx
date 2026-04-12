import { useStore, MONTHS, QUARTER_MONTHS } from '../../store';
import clsx from 'clsx';

const QUARTERS = [
  { key: 'q1', label: '1 кв.', months: 'янв — мар' },
  { key: 'q2', label: '2 кв.', months: 'апр — июн' },
  { key: 'q3', label: '3 кв.', months: 'июл — сен' },
  { key: 'q4', label: '4 кв.', months: 'окт — дек' },
] as const;

export function MonthStrip() {
  const { activeMonths, toggleMonth, setQuarterMonths } = useStore();

  const isQuarterFull = (qKey: string): boolean => {
    const months = QUARTER_MONTHS[qKey];
    return months ? months.every((m) => activeMonths.has(m)) : false;
  };

  const isQuarterPartial = (qKey: string): boolean => {
    const months = QUARTER_MONTHS[qKey];
    return months ? months.some((m) => activeMonths.has(m)) && !isQuarterFull(qKey) : false;
  };

  return (
    <div className="flex flex-col gap-1.5 py-1">
      {/* Month pills row */}
      <div className="flex items-center gap-0.5">
        {MONTHS.map((m) => {
          const active = activeMonths.has(m.id);
          return (
            <button
              key={m.id}
              onClick={() => toggleMonth(m.id)}
              title={m.full}
              className={clsx(
                'px-2 py-1 rounded-md text-[10px] font-medium transition-all duration-150 select-none',
                active
                  ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-sm shadow-blue-600/25'
                  : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700/50 hover:text-zinc-700 dark:hover:text-zinc-200',
              )}
            >
              {m.short}
            </button>
          );
        })}
      </div>

      {/* Quarter brackets row */}
      <div className="flex items-center gap-0.5">
        {QUARTERS.map((q) => {
          const full = isQuarterFull(q.key);
          const partial = isQuarterPartial(q.key);
          return (
            <button
              key={q.key}
              onClick={() => setQuarterMonths(q.key)}
              title={q.months}
              className={clsx(
                'flex-1 px-1 py-1 rounded-md text-[10px] font-medium text-center transition-all duration-150 border select-none',
                full
                  ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white border-blue-500 shadow-sm shadow-blue-600/20'
                  : partial
                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-700'
                    : 'text-zinc-400 dark:text-zinc-500 border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-300',
              )}
            >
              {q.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
