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
 */
import { Eye, EyeOff, Minus } from 'lucide-react';
import clsx from 'clsx';
import { productLabel } from '@aemr/shared';
import {
  OBSERVABILITY_LABEL,
  OBSERVABILITY_MEANING,
  fmtCount,
  fmtRatio,
  type JournalObservability,
  type WorkloadBook,
} from './contract';

/** Значок и цвет признака наблюдаемости. Цвет несёт данные, не украшает. */
const OBSERVABILITY_STYLE: Readonly<
  Record<JournalObservability, { icon: typeof Eye; className: string }>
> = {
  rich: { icon: Eye, className: 'text-emerald-600 dark:text-emerald-400' },
  thin: { icon: Eye, className: 'text-amber-600 dark:text-amber-400' },
  blind: { icon: EyeOff, className: 'text-zinc-500 dark:text-zinc-400' },
};

function ObservabilityCell({ value }: { value: JournalObservability | null }) {
  if (value === null) {
    return (
      <span className="inline-flex items-center gap-1.5 text-zinc-400 dark:text-zinc-500">
        <Minus size={13} aria-hidden="true" />
        не измерено
      </span>
    );
  }
  const style = OBSERVABILITY_STYLE[value];
  const Icon = style.icon;
  return (
    <span
      className={clsx('inline-flex items-center gap-1.5 font-medium', style.className)}
      title={OBSERVABILITY_MEANING[value]}
    >
      <Icon size={13} aria-hidden="true" />
      {OBSERVABILITY_LABEL[value]}
    </span>
  );
}

export function WorkloadTable({ books }: { books: readonly WorkloadBook[] }) {
  return (
    <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Нагрузка управлений: строки книги, учреждения, правки журнала и их отношения.
            Порядок — по числу строк на одно учреждение, убыванием.
          </caption>
          <thead>
            <tr className="bg-zinc-50 dark:bg-zinc-900/50 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400">
              <th scope="col" className="px-4 py-2.5">Управление</th>
              <th scope="col" className="px-3 py-2.5 text-right" title="Строк-закупок в книге управления">
                Строк
              </th>
              <th
                scope="col"
                className="px-3 py-2.5 text-right"
                title="Различных учреждений в колонке C, включая само управление"
              >
                Учреждений
              </th>
              <th scope="col" className="px-3 py-2.5 text-right" title="Записей в журнале правок книги">
                Правок
              </th>
              <th
                scope="col"
                className="px-3 py-2.5 text-right"
                title="Записей журнала на одну строку закупки"
              >
                Правок на строку
              </th>
              <th
                scope="col"
                className="px-3 py-2.5 text-right"
                title="Сколько закупок ведёт одно учреждение"
              >
                Строк на учреждение
              </th>
              <th scope="col" className="px-4 py-2.5">Наблюдаемость журнала</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
            {books.map((book) => {
              const measured = book.observability !== null;
              return (
                <tr
                  key={book.dept}
                  className={clsx(
                    'transition',
                    measured
                      ? 'hover:bg-zinc-50 dark:hover:bg-zinc-700/30'
                      : 'bg-zinc-50/60 dark:bg-zinc-900/30',
                  )}
                >
                  <th scope="row" className="px-4 py-2.5 text-left font-medium text-zinc-700 dark:text-zinc-200 whitespace-nowrap">
                    <span title={book.deptName}>{productLabel(book.deptLatin)}</span>
                  </th>
                  {measured ? (
                    <>
                      <td className="px-3 py-2.5 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                        {fmtCount(book.rows)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                        {fmtCount(book.subordinates)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                        {fmtCount(book.journalEntries)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-zinc-700 dark:text-zinc-200">
                        {fmtRatio(book.editsPerRow)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-medium text-zinc-800 dark:text-zinc-100">
                        {fmtRatio(book.rowsPerSubordinate)}
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        <ObservabilityCell value={book.observability} />
                      </td>
                    </>
                  ) : (
                    // Числа не показываем вовсе: прочерк с объяснением честнее
                    // нуля, который читался бы как «работы нет».
                    <td colSpan={6} className="px-3 py-2.5 text-xs text-zinc-500 dark:text-zinc-400">
                      {book.note}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
