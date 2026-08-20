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
 *
 * ОБЛИК (канон п.129). Числа живут в одной карточке, оговорка — на утопленной
 * подложке из ролей, а не во второй рамке внутри первой. Каждое число несёт
 * подпись, счётные книги названы поимённо (канон п.58: у числа есть периметр).
 */
import { FilePlus2, Eraser, PencilLine, Info } from 'lucide-react';
import { productLabel } from '@aemr/shared';
import { KBTooltip } from '../ui/kb-tooltip';
import { Card, CardHeader } from '../ui/card';
import { Stat } from '../ui/stat';
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
    hint: 'Пустая строка книги заполнена целиком — так выглядит новая закупка',
  },
  {
    key: 'edits' as const,
    icon: PencilLine,
    label: 'точечных правок',
    hint: 'Правки отдельных ячеек: суммы, даты, предмет',
  },
  {
    key: 'cleared' as const,
    icon: Eraser,
    label: 'строк очищено',
    hint: 'Содержимое строки обнулено, сама строка осталась на месте',
  },
];

export function RowEventsPanel({ events, booksSilent }: RowEventsPanelProps) {
  const counted = events.countedBooks.map((d) => productLabel(d)).join(', ');

  return (
    <section aria-label="События над строками">
      <Card className="space-y-[var(--space-4)]">
        <CardHeader
          title={
            <KBTooltip {...ROW_EVENTS_KB} showIcon>
              <span>События над строками</span>
            </KBTooltip>
          }
          scope={
            events.countedBooks.length > 0
              ? `по журналам книг: ${counted}`
              : 'ни один журнал не прочитан'
          }
          note="Журнал книги записывает правки ячеек. Род события восстановлен группировкой: что добавили, что поправили, что очистили."
          className="mb-0"
        />

        <div className="flex flex-wrap items-start gap-x-[var(--space-8)] gap-y-[var(--space-3)]">
          {TILES.map((tile) => {
            const Icon = tile.icon;
            return (
              <Stat
                key={tile.key}
                label={
                  <span className="inline-flex items-center gap-1">
                    <Icon size={11} aria-hidden="true" />
                    {tile.label}
                  </span>
                }
                value={
                  events.countedBooks.length > 0 ? fmtCount(events[tile.key]) : null
                }
                emptyReason="журнал не прочитан — событий не из чего сложить"
                hint={tile.hint}
              />
            );
          })}
        </div>

        {/* Оговорка вместо четвёртой плитки: ненаблюдаемость — свойство
            источника. Подложка утоплена светлотой, второй рамки нет (п.129). */}
        <div className="flex items-start gap-2 rounded-[var(--radius-card)] bg-[var(--surface-sunken)] px-3 py-2.5 ds-text-2xs">
          <Info size={13} className="mt-px shrink-0 text-[var(--ink-faint)]" aria-hidden="true" />
          <div className="space-y-1 text-[var(--ink-muted)]">
            <p className="max-w-3xl">
              Удаления строк журналом не фиксируются — пропажи ищем сравнением снимков книги
              по «№ п/п». Строка, убранная через меню таблицы, не создаёт ни одной правки
              ячейки, поэтому четвёртого числа здесь нет: ноль удалений означал бы «не
              случалось», а верно — «не наблюдаемо».
            </p>
            {booksSilent.length > 0 && (
              <p className="max-w-3xl text-[var(--ink-faint)]">
                Журнал не прочитан у книг:{' '}
                {booksSilent.map((d) => productLabel(d)).join(', ')} — их события в суммы выше
                не вошли. Это не ноль событий.
              </p>
            )}
          </div>
        </div>
      </Card>
    </section>
  );
}
