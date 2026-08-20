/**
 * Ряд режимов листов книги — вкладки второго уровня (спека §2, §6.1).
 *
 * ПЯТЬ КНОПОК, А НЕ ТРИНАДЦАТЬ (п.128-1). Восемь кнопок листов управлений из
 * ряда убраны: срез по управлению даёт глобальный фильтр шапки (п.127), и
 * линейка организаций внутри вкладки его дублировала. Ряд теперь помещается
 * в одну строку рядом с поиском и разрезами.
 *
 * ЛИСТ, КОТОРОГО СЕРВЕР ЕЩЁ НЕ ОТДАЁТ, ОСТАЁТСЯ В РЯДУ. Спрятать его значило
 * бы соврать о книге: лист в книге есть, и читатель, который его ищет, должен
 * найти кнопку и прочитать, чего именно она ждёт. Кнопка помечается точкой и
 * ведёт на честную пустоту с причиной, а не в никуда.
 *
 * НА УЗКОМ ЭКРАНЕ (§6.3) ряд едет горизонтально внутри себя — корпус страницы
 * стоит на месте.
 */
import { SHEET_MODES, type SheetMode } from '../../lib/monitoring/modes';

export interface SheetModeTabsProps {
  activeId: string;
  onSelect: (mode: SheetMode) => void;
  /**
   * Ид режимов, чей лист сервер пока не прислал. Кнопка остаётся живой:
   * пустота с причиной полезнее исчезнувшей кнопки.
   */
  pendingIds?: readonly string[];
  /** Сколько строк реестра в режиме; ключ — ид режима. Нет ключа — числа нет. */
  counts?: Readonly<Record<string, number>>;
}

export function SheetModeTabs({ activeId, onSelect, pendingIds = [], counts = {} }: SheetModeTabsProps) {
  return (
    <nav
      aria-label="Листы книги «Ежедневный мониторинг»"
      className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1"
    >
      {SHEET_MODES.map((mode) => {
        const active = mode.id === activeId;
        const pending = pendingIds.includes(mode.id);
        const count = counts[mode.id];
        return (
          <button
            key={mode.id}
            type="button"
            onClick={() => onSelect(mode)}
            aria-current={active ? 'page' : undefined}
            title={pending ? `${mode.hint} Сервер этот лист ещё не отдаёт.` : mode.hint}
            className={[
              'shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium transition',
              active
                ? 'bg-zinc-800 text-white dark:bg-zinc-100 dark:text-zinc-900'
                : 'border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/60 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700/40',
            ].join(' ')}
          >
            {mode.label}
            {typeof count === 'number' && (
              <span className="ml-1.5 tabular-nums opacity-60">{count.toLocaleString('ru-RU')}</span>
            )}
            {pending && (
              <span
                className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-500 align-middle"
                aria-label="лист ещё не приходит с сервера"
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}
