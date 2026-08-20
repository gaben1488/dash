/**
 * «События над строками» — три рода событий журнала (канон п.105).
 *
 * Журнал книги пишет ЯЧЕЙКИ, а не строки: одно добавление закупки выглядит как
 * десяток записей «было пусто — стало значение» в одну минуту. Сервер
 * восстанавливает из этого три рода — добавили закупку, поправили ячейки,
 * очистили строку — и блок показывает именно их, а не сырые записи.
 *
 * ЧЕТВЁРТОГО ЧИСЛА ЗДЕСЬ НЕТ НАМЕРЕННО. Удаление строки через меню таблицы не
 * порождает ни одной правки ячейки, и журнал его не видит. Показать «удалено:
 * 0» значило бы соврать: ноль означал бы «не случалось», тогда как на деле
 * «не наблюдаемо». Поэтому вместо четвёртой плитки стоит плашка, которая
 * называет механизм и говорит, чем пропажу ищут на самом деле.
 */
import { FilePlus2, Eraser, PencilLine, Info } from 'lucide-react';
import { productLabel } from '@aemr/shared';
import { KBTooltip } from '../ui/kb-tooltip';
import { ROW_EVENTS_KB, fmtCount, type WorkloadResponse } from './contract';

interface RowEventsPanelProps {
  events: WorkloadResponse['events'];
  /** Книги, чей журнал не прочитан: их события в суммы не вошли. */
  booksSilent: readonly string[];
}

const TILES = [
  {
    key: 'added' as const,
    icon: FilePlus2,
    label: 'добавлено закупок',
    title: 'Пустая строка книги заполнена целиком — так выглядит новая закупка',
  },
  {
    key: 'edits' as const,
    icon: PencilLine,
    label: 'точечных правок',
    title: 'Правки отдельных ячеек: суммы, даты, предмет',
  },
  {
    key: 'cleared' as const,
    icon: Eraser,
    label: 'строк очищено',
    title: 'Содержимое строки обнулено, сама строка осталась на месте',
  },
];

export function RowEventsPanel({ events, booksSilent }: RowEventsPanelProps) {
  return (
    <section
      aria-label="События над строками"
      className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 p-5 space-y-4"
    >
      <div>
        <KBTooltip {...ROW_EVENTS_KB} showIcon>
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            События над строками
          </h3>
        </KBTooltip>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 max-w-2xl">
          Журнал книги записывает правки ячеек. Род события восстановлен группировкой: что
          добавили, что поправили, что очистили.
        </p>
      </div>

      <div className="flex items-start gap-8 flex-wrap">
        {TILES.map((tile) => {
          const Icon = tile.icon;
          return (
            <div key={tile.key} title={tile.title}>
              <p className="text-2xl font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
                {fmtCount(events[tile.key])}
              </p>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
                <Icon size={11} aria-hidden="true" />
                {tile.label}
              </p>
            </div>
          );
        })}
      </div>

      {/* Плашка вместо четвёртой плитки: ненаблюдаемость — свойство источника. */}
      <div className="flex items-start gap-2 text-xs bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-700/60 rounded-lg px-3 py-2.5">
        <Info size={13} className="text-zinc-500 dark:text-zinc-400 mt-px shrink-0" aria-hidden="true" />
        <div className="text-zinc-600 dark:text-zinc-300 space-y-1">
          <p>
            Удаления строк журналом не фиксируются — пропажи ищем сравнением снимков книги
            по «№ п/п». Строка, убранная через меню таблицы, не создаёт ни одной правки
            ячейки, поэтому четвёртого числа здесь нет: ноль удалений означал бы «не
            случалось», а верно — «не наблюдаемо».
          </p>
          {booksSilent.length > 0 && (
            <p className="text-zinc-500 dark:text-zinc-400">
              Журнал не прочитан у книг:{' '}
              {booksSilent.map((d) => productLabel(d)).join(', ')} — их события в суммы выше
              не вошли. Это не ноль событий.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
