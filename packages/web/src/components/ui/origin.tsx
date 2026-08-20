// ── Происхождение числа: «откуда это взялось» рядом с самим числом.
//
//    ЧТО ВЗЯТО ГОТОВЫМ (канон п.112). Механика всплывающего слоя — Radix
//    Popover, который уже стоит в проекте: он сам ставит слой поверх всего,
//    сам возвращает фокус на кнопку при закрытии, сам закрывается по Esc и
//    по щелчку мимо, сам не даёт содержимому уехать за край экрана. Ни
//    позиционирования, ни ловушки фокуса мы не пишем.
//
//    Приём взят у современных панелей аналитики: происхождение числа
//    (lineage — цепочка «источник → преобразование → показанное значение»)
//    показывают НЕ отдельной вкладкой, а раскрытием прямо у числа, потому
//    что вопрос «откуда это» возникает в момент чтения числа, а не потом.
//
//    ЧТО НАДСТРОЕНО (канон п.114). Готовая панель показывает цепочку
//    таблиц; наш читатель работает не с таблицами, а с книгой, листом и
//    ячейкой, и спрашивает другое. Поэтому здесь пять полей, которых нет
//    ни в одной библиотеке:
//
//    1. Источник обязанности (канон п.104) — из какого из пяти документов
//       показатель родом: свод, еженедельный отчёт, дополнительный отчёт,
//       книга мониторинга, норма 44-ФЗ. Шестое значение — «наша
//       инициатива», и оно называется вслух, а не прячется.
//    2. Как считает ИСТОЧНИК — формула листа либо фраза отчёта дословно.
//       Не как считаем мы: читатель сверяет нас с документом, а не с нами.
//    3. Расхождение названо словом. Если наш счёт не совпадает со счётом
//       источника, это не прячется в сноску, а поднимается наверх и
//       помечается тревожным тоном — иначе число молча спорит с бумагой,
//       которую держит в руках начальник.
//    4. Двойной адрес: лист и ячейка плюс «строка · № п/п». Номер строки
//       листа устаревает при сортировке, «№ п/п» — нет; по одному только
//       номеру строки найти закупку назавтра уже нельзя.
//    5. Момент чтения. Число без момента — не число (канон п.58).
//
//    Чего здесь НЕТ: расчёта и форматирования. Компонент показывает уже
//    готовые строки. Второй дом правил округления был бы хуже отсутствия
//    происхождения вовсе.

import type { ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import clsx from 'clsx';

/** Как наш счёт относится к счёту источника. */
export type OriginMatch = 'exact' | 'divergent' | 'initiative';

const MATCH_WORD: Record<OriginMatch, string> = {
  exact: 'Считаем так же, как источник',
  divergent: 'Считаем иначе, чем источник',
  initiative: 'Источник этого не считает — наша инициатива',
};

export interface OriginProps {
  /** Что за число объясняем. «Исполнение плана», а не «Показатель». */
  metric: string;
  /** Человеческое имя источника: «Книга „Свод“», «Еженедельный отчёт». */
  source: string;
  /** Как считает источник: формула листа либо фраза документа дословно. */
  howSourceCounts: string;
  match: OriginMatch;
  /** Адрес на листе: «СВОД ТД-ПМ · L14». */
  sheetRef?: string;
  /** Второй адрес: «строка 218 · № п/п 145». Переживает сортировку. */
  rowAddress?: string;
  /** Когда прочитано: «18.08.2026, 09:14». */
  readAt?: string;
  /** Расхождение, оговорка либо обоснование инициативы — одной фразой. */
  note?: string;
  /** Содержимое кнопки: обычно само число либо его подпись. */
  children: ReactNode;
  className?: string;
}

/** Строка «подпись — значение» внутри раскрытия. */
function Line({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-x-[var(--space-2)] gap-y-0.5">
      <dt className="ds-text-3xs text-[var(--ink-faint)]">{term}</dt>
      <dd className="ds-text-2xs text-[var(--ink)]">{children}</dd>
    </div>
  );
}

export function Origin({
  metric,
  source,
  howSourceCounts,
  match,
  sheetRef,
  rowAddress,
  readAt,
  note,
  children,
  className,
}: OriginProps) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          // Имя кнопки — не «подробнее», а вопрос читателя целиком: диктор
          // читает его вне контекста, и «подробнее» ему ничего не говорит.
          aria-label={`Откуда число: ${metric}`}
          className={clsx(
            'group inline-flex items-baseline gap-1 rounded-[var(--radius-badge)] text-left',
            'transition-colors [transition-duration:var(--dur-fast)] [transition-timing-function:var(--ease-standard)]',
            'hover:text-[var(--ink-strong)]',
            className,
          )}
        >
          {children}
          {/* Признак «есть что раскрыть». Точка, а не значок: значок в
              строке чисел ломает базовую линию и тянет взгляд на себя.
              Тон меняется, когда наш счёт расходится с источником, —
              и это единственное место, где точка позволяет себе цвет. */}
          <span
            aria-hidden="true"
            className="inline-block h-1 w-1 shrink-0 translate-y-[-0.3em] rounded-full"
            style={{
              backgroundColor:
                match === 'divergent' ? 'var(--data-warn)' : 'var(--ink-faint)',
            }}
          />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          sideOffset={6}
          collisionPadding={12}
          className={clsx(
            'z-50 w-[min(22rem,calc(100vw-2rem))] rounded-[var(--radius-card)] border p-[var(--space-3)]',
            'border-[var(--line-strong)] bg-[var(--surface-overlay)] shadow-[var(--elevation-3)]',
            // Появление короткое и без сдвига: раскрытие рядом с числом не
            // должно уводить взгляд с самого числа.
            'data-[state=open]:animate-[fadeIn_var(--dur-fast)_var(--ease-out)]',
          )}
        >
          <p className="ds-text-2xs font-[var(--weight-strong)] text-[var(--ink-strong)]">
            {metric}
          </p>

          {/* Отношение к источнику стоит первым: это ответ на вопрос
              «можно ли показывать это число начальнику». */}
          <p
            className="mt-1 ds-text-2xs"
            style={{
              color: match === 'divergent' ? 'var(--data-warn)' : 'var(--ink-muted)',
            }}
          >
            {MATCH_WORD[match]}
          </p>

          <dl className="mt-[var(--space-3)] space-y-1 border-t border-[var(--line-soft)] pt-[var(--space-2)]">
            <Line term="Источник">{source}</Line>
            <Line term="Как считает">{howSourceCounts}</Line>
            {sheetRef && (
              <Line term="Адрес">
                <span className="tabular-nums">{sheetRef}</span>
              </Line>
            )}
            {rowAddress && (
              <Line term="Строка">
                <span className="tabular-nums">{rowAddress}</span>
              </Line>
            )}
            {readAt && (
              <Line term="Прочитано">
                <span className="tabular-nums">{readAt}</span>
              </Line>
            )}
          </dl>

          {note && (
            <p className="mt-[var(--space-2)] border-t border-[var(--line-soft)] pt-[var(--space-2)] ds-text-3xs ds-prose text-[var(--ink-muted)]">
              {note}
            </p>
          )}

          <Popover.Arrow className="fill-[var(--surface-overlay)]" width={10} height={5} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
