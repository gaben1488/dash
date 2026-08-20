// ── Таблица: единственный дом реестровой сетки.
//
//    Главный экран этого продукта — не график, а реестр: строка закупки со
//    всеми её признаками. Поэтому таблица здесь не «оформление», а основной
//    прибор, и требования к ней те же, что к таблице в книге:
//
//      • шапка не уезжает при прокрутке (sticky) — иначе на сотой строке
//        читатель не помнит, что за колонка;
//      • числа прижаты вправо и набраны табличными цифрами — разряды стоят
//        в столбик, сумма не меняет ширину при обновлении;
//      • подпись (caption) обязательна и называет скоуп: что за срез и на
//        какой момент прочитан. Таблица без подписи — число без момента;
//      • полосу горизонтальной прокрутки можно взять с клавиатуры: контейнер
//        получает tabIndex и роль области, иначе правые колонки недоступны
//        тем, кто не пользуется мышью;
//      • плотность приходит из токенов (`--row-h`, `--cell-pad-*`), поэтому
//        компактный и просторный режимы — это одна разметка.
//
//    Зебры нет намеренно: чередование заливки добавляет краски, не добавляя
//    сведений (принцип «краска только данным»). Строки разделяет линия.

import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from 'react';
import clsx from 'clsx';
import type { DataTone } from './tokens';

export interface DataTableProps {
  /**
   * Подпись таблицы: что показано и на какой момент прочитано.
   * Например: «Закупки управления образования · 2026 год · на 18.08».
   */
  caption: ReactNode;
  /** Спрятать подпись визуально, оставив её диктору. */
  captionHidden?: boolean;
  children: ReactNode;
  className?: string;
  /** Максимальная высота области прокрутки: «60vh», «420px». */
  maxHeight?: string;
}

export function DataTable({ caption, captionHidden, children, className, maxHeight }: DataTableProps) {
  return (
    <div
      // role + tabIndex: прокручиваемая область обязана быть достижима
      // с клавиатуры, иначе правые колонки просто не существуют для того,
      // кто ходит по интерфейсу табуляцией.
      role="region"
      tabIndex={0}
      aria-label={typeof caption === 'string' ? caption : undefined}
      className={clsx('ds-table-scroll overflow-auto rounded-[var(--radius-card)]', className)}
      style={maxHeight ? { maxHeight } : undefined}
    >
      <table className="ds-table w-full border-collapse ds-text-2xs">
        <caption
          className={clsx(
            'ds-text-3xs text-left text-[var(--ink-faint)]',
            captionHidden ? 'sr-only' : 'px-[var(--cell-pad-x)] pb-[var(--space-2)]',
          )}
        >
          {caption}
        </caption>
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="sticky top-0 z-10 bg-[var(--surface-sunken)]">
      {children}
    </thead>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

export interface TrProps {
  children: ReactNode;
  /** Строка, на которую смотрят: выделяется линией слева, а не заливкой. */
  marked?: boolean;
  /**
   * Тон замечания к строке — полоса слева.
   *
   * НАДСТРОЙКА над обычной таблицей (канон п.114, §5 харнесса «лоскут
   * против системы»). Замечания к закупке НЕ выносятся отдельным списком
   * на отдельную вкладку: там они теряют строку, к которой относятся, и
   * читателю приходится искать её заново. Строка помечается там, где она
   * уже показана, а сам текст замечания живёт в ячейке (`RowSignals`) —
   * полоса без слова была бы цветом ради цвета.
   */
  signalTone?: DataTone;
  onClick?: () => void;
  className?: string;
}

export function Tr({ children, marked, signalTone, onClick, className }: TrProps) {
  return (
    <tr
      onClick={onClick}
      className={clsx(
        'border-b border-[var(--line-soft)] last:border-b-0',
        onClick && 'cursor-pointer hover:bg-[var(--surface-raised)] transition-colors [transition-duration:var(--dur-instant)]',
        marked && 'bg-[var(--surface-raised)]',
        className,
      )}
      style={{
        height: 'var(--row-h)',
        // Полоса рисуется внутренней тенью, а не border-left: border сдвинул
        // бы содержимое строки на три пикселя и вся таблица «поехала» бы
        // ровно в тот момент, когда у строки появилось замечание.
        ...(signalTone ? { boxShadow: `inset 3px 0 0 var(--data-${signalTone})` } : null),
      }}
      data-signal={signalTone}
    >
      {children}
    </tr>
  );
}

type CellAlign = 'left' | 'right' | 'center';

const ALIGN: Record<CellAlign, string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
};

export interface ThProps extends Omit<ThHTMLAttributes<HTMLTableCellElement>, 'align'> {
  children: ReactNode;
  /** Числовая колонка — заголовок встаёт вправо вслед за числами. */
  numeric?: boolean;
  align?: CellAlign;
  /**
   * Колонка считается формулой листа и здесь только читается.
   *
   * НАДСТРОЙКА над обычной таблицей (канон п.114). В книге часть колонок —
   * не ввод, а формула: экономия, исполнение, отклонение. Если такую
   * колонку показать неотличимо от вводимой, читатель попробует её
   * поправить, а правка либо не сохранится, либо перезатрёт формулу листа
   * и сломает счёт у всех. Признак объявлен в заголовке один раз на
   * колонку, а не значком в каждой ячейке: значок в каждой строке — это
   * тысяча повторов одного и того же факта.
   */
  formula?: boolean;
}

export function Th({ children, numeric, align, formula, className, ...rest }: ThProps) {
  return (
    <th
      scope="col"
      {...rest}
      data-formula={formula ? '' : undefined}
      title={formula ? 'Колонка считается формулой листа — правится в книге, а не здесь' : rest.title}
      className={clsx(
        'ds-text-3xs font-[var(--weight-medium)] text-[var(--ink-muted)] whitespace-nowrap',
        'border-b border-[var(--line-strong)]',
        ALIGN[align ?? (numeric ? 'right' : 'left')],
        className,
      )}
      style={{ padding: 'var(--cell-pad-y) var(--cell-pad-x)' }}
    >
      {children}
      {formula && (
        <>
          {/* Знак «равно» — то же, чем помечает формулу табличный редактор:
              читатель этого продукта видит его каждый день в книге. */}
          <span aria-hidden="true" className="ml-1 text-[var(--ink-faint)]">=</span>
          <span className="sr-only"> (колонка считается формулой листа, только для чтения)</span>
        </>
      )}
    </th>
  );
}

export interface TdProps extends Omit<TdHTMLAttributes<HTMLTableCellElement>, 'align'> {
  children: ReactNode;
  numeric?: boolean;
  align?: CellAlign;
  /** Приглушить ячейку: вспомогательный признак, не главный. */
  muted?: boolean;
  /** Ячейка формульной колонки: читается, но не правится. См. `ThProps.formula`. */
  formula?: boolean;
}

export function Td({ children, numeric, align, muted, formula, className, ...rest }: TdProps) {
  return (
    <td
      {...rest}
      data-formula={formula ? '' : undefined}
      // data-numeric включает табличные цифры из базового слоя index.css:
      // ширина числа не пляшет при обновлении.
      data-numeric={numeric ? '' : undefined}
      className={clsx(
        muted ? 'text-[var(--ink-faint)]' : 'text-[var(--ink)]',
        numeric && 'tabular-nums',
        ALIGN[align ?? (numeric ? 'right' : 'left')],
        className,
      )}
      style={{ padding: 'var(--cell-pad-y) var(--cell-pad-x)' }}
    >
      {children}
    </td>
  );
}

/* ──────────────────────────────────────────────────────────────────────
   НАДСТРОЙКА НАД ГОТОВОЙ ТАБЛИЦЕЙ (канон п.114)
   Ниже — то, чего не знает ни одна библиотека таблиц: как в этом продукте
   адресуется строка и как к ней крепится замечание.
   ────────────────────────────────────────────────────────────────────── */

export interface RowAddressProps {
  /** Имя листа книги: «СВОД ТД-ПМ», «Мониторинг». */
  sheet?: string;
  /** Номер строки на листе. Устаревает при сортировке — потому и не один. */
  row: number;
  /**
   * «№ п/п» из колонки A. Переживает сортировку и вставку строк, поэтому
   * он и есть настоящий адрес закупки; номер строки — только подсказка,
   * куда смотреть прямо сейчас.
   */
  seq?: string | number | null;
  className?: string;
}

/**
 * Двойной адрес строки: «строка 218 · № п/п 145».
 *
 * НАДСТРОЙКА (канон п.114). Библиотека таблиц знает про индекс строки — и
 * этого мало. Читатель этого продукта уходит с числом в книгу и ищет там
 * ту же закупку; к тому времени лист успевают отсортировать, и номер
 * строки показывает уже на чужую закупку. Поэтому адрес всегда двойной:
 * номер строки — чтобы найти сейчас, «№ п/п» — чтобы найти завтра.
 * Когда «№ п/п» у строки нет, это говорится словом, а не пропускается:
 * отсутствие постоянного адреса — само по себе замечание к строке.
 */
export function RowAddress({ sheet, row, seq, className }: RowAddressProps) {
  return (
    <span className={clsx('ds-text-3xs whitespace-nowrap text-[var(--ink-faint)]', className)} data-address>
      {sheet && <>{sheet} · </>}
      строка <span className="tabular-nums">{row}</span>
      {seq != null && seq !== '' ? (
        <>
          {' · № п/п '}
          <span className="tabular-nums font-[var(--weight-medium)]">{seq}</span>
        </>
      ) : (
        <span title="У строки нет «№ п/п» — после сортировки листа её будет не найти">
          {' · № п/п не проставлен'}
        </span>
      )}
    </span>
  );
}

export interface RowSignal {
  /** Что не так — одной фразой, без обвинения: «план на год не проставлен». */
  label: string;
  tone: DataTone;
}

export interface RowSignalsProps {
  signals: readonly RowSignal[];
  className?: string;
}

/**
 * Замечания к строке — рядом со строкой, а не отдельным списком.
 *
 * НАДСТРОЙКА (канон п.114, §5 харнесса). Вынести замечания на свою вкладку
 * проще всего, и это ровно тот «лоскут», который харнесс запрещает: там
 * замечание теряет закупку, к которой относится, и читателю приходится
 * искать её заново по номеру. Здесь замечание живёт в той же строке, где
 * закупка уже показана, а полоса слева (`Tr signalTone`) только помогает
 * найти строку взглядом.
 */
export function RowSignals({ signals, className }: RowSignalsProps) {
  if (signals.length === 0) {
    // Пустота честная: «замечаний нет» — это утверждение, и оно отличается
    // от «замечания не проверяли». Второе состояние живёт в `FreshnessMark`.
    return <span className={clsx('ds-text-3xs text-[var(--ink-faint)]', className)}>замечаний нет</span>;
  }

  return (
    <span className={clsx('inline-flex flex-wrap items-center gap-1', className)}>
      {signals.map((signal) => (
        <span
          key={signal.label}
          className="inline-flex items-baseline gap-1 ds-text-3xs"
          style={{ color: `var(--data-${signal.tone})` }}
        >
          <span
            aria-hidden="true"
            className="inline-block h-1.5 w-1.5 shrink-0 translate-y-[-0.1em] rounded-full"
            style={{ backgroundColor: `var(--data-${signal.tone})` }}
          />
          {signal.label}
        </span>
      ))}
    </span>
  );
}
