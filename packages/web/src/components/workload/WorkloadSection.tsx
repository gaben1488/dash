/**
 * Секция «Нагрузка управлений» (канон п.103) вместе с блоком «События над
 * строками» (канон п.105).
 *
 * ПОЧЕМУ ЗДЕСЬ, НА «ДИСЦИПЛИНЕ». Вкладка уже говорит о работе с книгами —
 * список дел по ним. Нагрузка отвечает на вопрос, который список дел
 * порождает: почему у одного управления дел вдесятеро больше. Ответ чаще
 * всего — объём работы, а не небрежность, и держать эти два блока порознь
 * значит оставить список дел без объяснения.
 *
 * ТОН — ИЗМЕРЕНИЕ, НЕ РЕЙТИНГ. Это написано на экране словами, а не только в
 * комментарии: много правок означает живую работу с книгой; мало правок при
 * живых закупках — чаще то, что журнал не ведётся, а не то, что работы нет.
 * Ни сортировка, ни цвет здесь не расставляют управления по «качеству».
 *
 * СВОЙ ПЕРИМЕТР И СВОЙ МОМЕНТ. Секция не подчиняется ни выбору управлений, ни
 * периоду в шапке: журнал книги и её строки читаются целиком, разрезать их
 * годом или кварталом нечем. Плашка называет момент чтения и говорит об этом
 * прямо — канон п.58 (у каждого числа есть момент, к которому оно относится).
 */
import { AlertTriangle, Clock, RotateCcw, Scale } from 'lucide-react';
import { EmptyState } from '../EmptyState';
import { SkeletonCard } from '../Skeleton';
import { KBTooltip } from '../ui/kb-tooltip';
import { RowEventsPanel } from './RowEventsPanel';
import { WorkloadTable } from './WorkloadTable';
import { WORKLOAD_KB, fmtMoment } from './contract';
import { useWorkload } from './useWorkload';

/** Плашка периода данных секции: момент чтения плюс честная оговорка. */
function WorkloadPeriodBadge({ asOf, rowsSource }: { asOf: string; rowsSource: string }) {
  return (
    <div className="flex flex-col items-end gap-1 shrink-0">
      <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[10px] font-medium text-zinc-600 dark:text-zinc-300">
        <Clock size={10} aria-hidden="true" />
        <span className="tabular-nums">прочитано {fmtMoment(asOf)}</span>
      </div>
      <span
        className="text-[9px] leading-tight text-amber-700 dark:text-amber-400 text-right max-w-[15rem]"
        title="Журнал правок и строки книги читаются целиком — разрезать их годом, кварталом или неделей нечем."
      >
        числа за всю книгу, период в шапке их не сужает
        {rowsSource === 'snapshot' && '; строки — из сохранённого снимка'}
      </span>
    </div>
  );
}

export function WorkloadSection() {
  const { data, loading, error, reload } = useWorkload();

  return (
    <section aria-label="Нагрузка управлений" className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <KBTooltip {...WORKLOAD_KB} showIcon>
            <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-100">
              Нагрузка управлений
            </h2>
          </KBTooltip>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-2xl mt-0.5">
            Сколько закупок ведёт одно учреждение и сколько правок приходится на строку.
            Это измерение трудоёмкости, а не рейтинг вины: много правок — признак живой
            работы с книгой, мало правок при живых закупках — чаще признак того, что
            журнал не ведётся.
          </p>
        </div>
        {data && <WorkloadPeriodBadge asOf={data.asOf} rowsSource={data.rowsSource} />}
      </div>

      {error && (
        <div className="flex items-start gap-2 text-xs bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3">
          <AlertTriangle size={14} className="text-amber-600 dark:text-amber-400 mt-px shrink-0" aria-hidden="true" />
          <div className="text-amber-800 dark:text-amber-300">
            <p>
              Нагрузка не прочитана: {error}
              {data && ' Ниже — числа предыдущего чтения; момент указан в плашке.'}
            </p>
            <button
              type="button"
              onClick={reload}
              className="mt-1.5 inline-flex items-center gap-1 font-medium hover:underline"
            >
              <RotateCcw size={11} aria-hidden="true" /> Прочитать ещё раз
            </button>
          </div>
        </div>
      )}

      {loading && !data ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">Читаем журналы правок книг управлений</span>
          <SkeletonCard />
        </div>
      ) : !data ? (
        !error && (
          <EmptyState
            tone="problem"
            title="Нагрузка управлений не посчитана"
            description="Сервер не отдал ни одной книги: без строк и журналов измерить трудоёмкость не из чего."
            action={{ label: 'Прочитать ещё раз', onClick: reload }}
          />
        )
      ) : data.booksMeasured === 0 ? (
        <>
          <EmptyState
            tone="problem"
            title="Ни по одной книге меры не посчитаны"
            description={
              'Нагрузка считается отношениями, и для них нужны обе половины — строки книги и её ' +
              'журнал правок. Сейчас хотя бы одной половины нет ни у одной из книг, поэтому ' +
              'вместо чисел ниже стоят причины.'
            }
            action={{ label: 'Прочитать ещё раз', onClick: reload }}
          />
          <WorkloadTable books={data.books} />
        </>
      ) : (
        <>
          <WorkloadTable books={data.books} />

          {/* Итоги района и разброс — подписи механизма, не оценки. */}
          <div className="flex items-start gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            <Scale size={13} className="mt-px shrink-0" aria-hidden="true" />
            <p className="max-w-3xl">
              {data.notes.join(' ')}
            </p>
          </div>
        </>
      )}

      {data && <RowEventsPanel events={data.events} booksSilent={data.booksSilent} />}
    </section>
  );
}
