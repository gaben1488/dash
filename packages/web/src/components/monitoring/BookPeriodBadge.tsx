/**
 * Плашка периода данных для блоков вкладки «Мониторинг» (канон п.58).
 *
 * ПОЧЕМУ НЕ ОБЩИЙ `PeriodBadge`. Тот берёт период из фильтров шапки
 * приложения — года, кварталы, недели книг ГРБС. К книге «Ежедневный
 * мониторинг» эти фильтры не применяются вовсе, и общая плашка написала бы
 * «2026 · весь год» там, где на деле показан весь реестр на момент чтения.
 * Это была бы неправда в самой плашке, которая создана против неправды.
 *
 * ПЕРИОД У КАЖДОГО БЛОКА СВОЙ, и это не придирка: реестр показывается на
 * момент чтения книги, сезонность — по дате публикации, сверка — по датам
 * обеих книг сразу. Одна плашка на страницу склеила бы три разных периода в
 * один и соврала бы дважды.
 */
import { Calendar, Clock } from 'lucide-react';

export interface BookPeriodBadgeProps {
  /** Что за период показывают числа блока: «на момент чтения книги». */
  label: string;
  /**
   * Честная оговорка янтарным — то, чего период НЕ покрывает. Пусто —
   * оговорки нет, а не «оговорка забыта».
   */
  note?: string;
  /** Момент — часы, период — календарь: значок различает два рода плашек. */
  kind?: 'moment' | 'period';
}

export function BookPeriodBadge({ label, note, kind = 'moment' }: BookPeriodBadgeProps) {
  const Icon = kind === 'moment' ? Clock : Calendar;
  return (
    <div className="flex flex-col items-start sm:items-end gap-1 shrink-0">
      <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[10px] font-medium text-zinc-600 dark:text-zinc-300">
        <Icon size={10} aria-hidden="true" />
        <span className="tabular-nums">{label}</span>
      </div>
      {note && (
        <span className="text-[9px] leading-tight text-amber-700 dark:text-amber-400 sm:text-right max-w-[15rem]">
          {note}
        </span>
      )}
    </div>
  );
}
