/**
 * Таблица нагрузки управлений (канон п.103).
 *
 * ЧТО ЗДЕСЬ ИЗМЕРЯЕТСЯ. Не качество работы, а её трудоёмкость: сколько закупок
 * ведёт одно учреждение и сколько правок приходится на одну строку. Порядок —
 * по строкам на учреждение убыванием (его задаёт сервер): сверху книга, где на
 * одну организацию приходится больше всего закупок, а не та, где больше всего
 * строк вообще.
 *
 * ДВА РОДА СТРОК ТАБЛИЦЫ. Измеренная книга показывает числа. Книга, у которой
 * не прочитано что-то одно — строки или журнал, — числа НЕ показывает вовсе:
 * вместо них идёт объяснение сервера во всю ширину. Ноль на её месте означал бы
 * «работы нет» там, где на самом деле «мы не смотрели», и ровно эта подмена
 * превращает дыру наблюдаемости в чистый отчёт.
 *
 * КЛИК ВЕДЁТ К ОСНОВАНИЯМ. Число трудоёмкости считается по строкам книги,
 * поэтому строка таблицы открывает эти строки в Реестре — сверить меру с тем,
 * из чего она сложилась, можно в одно движение, а не пересчитывая руками.
 *
 * ОБЛИК (канон п.129). Своей рамки таблица не заводит: её держит карточка
 * секции, а строки разделяет тихая линия из ролей. Обводка на каждом атоме —
 * частокол, а не форма.
 */
import { Eye, EyeOff, Minus } from 'lucide-react';
import { productLabel } from '@aemr/shared';
import { DataTable, TBody, THead, Td, Th, Tr } from '../ui/data-table';
import {
  OBSERVABILITY_LABEL,
  OBSERVABILITY_MEANING,
  fmtCount,
  fmtRatio,
  type JournalObservability,
  type WorkloadBook,
} from './contract';

/** Значок и роль цвета признака наблюдаемости. Цвет несёт данные, не украшает. */
const OBSERVABILITY_STYLE: Readonly<
  Record<JournalObservability, { icon: typeof Eye; color: string }>
> = {
  rich: { icon: Eye, color: 'var(--data-good)' },
  thin: { icon: Eye, color: 'var(--data-warn)' },
  blind: { icon: EyeOff, color: 'var(--ink-muted)' },
};

function ObservabilityCell({ value }: { value: JournalObservability | null }) {
  if (value === null) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[var(--ink-faint)]">
        <Minus size={13} aria-hidden="true" />
        не измерено
      </span>
    );
  }
  const style = OBSERVABILITY_STYLE[value];
  const Icon = style.icon;
  return (
    <span
      className="inline-flex items-center gap-1.5 font-[var(--weight-medium)]"
      style={{ color: style.color }}
      title={OBSERVABILITY_MEANING[value]}
    >
      <Icon size={13} aria-hidden="true" />
      {OBSERVABILITY_LABEL[value]}
    </span>
  );
}

export interface WorkloadTableProps {
  books: readonly WorkloadBook[];
  /** Момент чтения книг — уезжает в подпись таблицы (канон п.58). */
  readAt: string;
  /** Открыть строки книги в Реестре: мера сверяется со своими основаниями. */
  onOpenBook?: (dept: string) => void;
}

export function WorkloadTable({ books, readAt, onOpenBook }: WorkloadTableProps) {
  return (
    <DataTable
      caption={`Нагрузка управлений: строки книги, учреждения, правки журнала и их отношения. Порядок — по числу строк на одно учреждение, убыванием. Прочитано ${readAt}.`}
      captionHidden
    >
      <THead>
        <tr>
          <Th>Управление</Th>
          <Th numeric title="Строк-закупок в книге управления">Строк</Th>
          <Th numeric title="Различных учреждений в колонке C, включая само управление">
            Учреждений
          </Th>
          <Th numeric title="Записей в журнале правок книги">Правок</Th>
          <Th numeric title="Записей журнала на одну строку закупки">Правок на строку</Th>
          <Th numeric title="Сколько закупок ведёт одно учреждение">Строк на учреждение</Th>
          <Th>Наблюдаемость журнала</Th>
        </tr>
      </THead>
      <TBody>
        {books.map((book) => {
          const measured = book.observability !== null;
          const open = onOpenBook && book.rowsAvailable ? () => onOpenBook(book.dept) : undefined;
          return (
            <Tr
              key={book.dept}
              onClick={open}
              // Непрочитанная книга утоплена подложкой, а не второй рамкой:
              // поверхности разделяет светлота (канон п.129).
              className={measured ? undefined : 'bg-[var(--surface-sunken)]'}
            >
              {/* Имя книги — заголовок строки, а не ячейка: диктор читает его
                  перед каждым числом ряда, иначе «12,6» звучит без адресата. */}
              <th
                scope="row"
                className="whitespace-nowrap text-left font-[var(--weight-medium)] text-[var(--ink-strong)]"
                style={{ padding: 'var(--cell-pad-y) var(--cell-pad-x)' }}
              >
                <span
                  title={
                    open
                      ? `${book.deptName}. Открыть строки книги в Реестре`
                      : book.deptName
                  }
                >
                  {productLabel(book.deptLatin)}
                </span>
              </th>
              {measured ? (
                <>
                  <Td numeric muted>{fmtCount(book.rows)}</Td>
                  <Td numeric muted>{fmtCount(book.subordinates)}</Td>
                  <Td numeric muted>{fmtCount(book.journalEntries)}</Td>
                  <Td numeric>{fmtRatio(book.editsPerRow)}</Td>
                  <Td numeric className="font-[var(--weight-medium)]">
                    {fmtRatio(book.rowsPerSubordinate)}
                  </Td>
                  <Td>
                    <ObservabilityCell value={book.observability} />
                  </Td>
                </>
              ) : (
                // Числа не показываем вовсе: прочерк с объяснением честнее
                // нуля, который читался бы как «работы нет».
                <Td colSpan={6} muted>{book.note}</Td>
              )}
            </Tr>
          );
        })}
      </TBody>
    </DataTable>
  );
}
