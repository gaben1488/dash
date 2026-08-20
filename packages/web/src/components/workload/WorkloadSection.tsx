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
 * СВОЙ ПЕРИМЕТР И СВОЙ МОМЕНТ. Период и способ из шапки к секции не
 * применяются: журнал книги и её строки читаются целиком, разрезать их годом
 * или кварталом нечем. Выбранное управление, НАПРОТИВ, применяется (канон
 * п.127, 20.08.2026): чужая книга в чужой срез не лезет — ни строкой таблицы,
 * ни событием журнала, ни оговоркой о непрочитанном. Момент чтения назван в
 * плашке (канон п.58).
 *
 * РЕЖИМ ПОДВЕДОВ (приказ владельца 20.08.2026). Разбивки по подведомственным
 * учреждениям здесь НЕТ — и это ответ, а не пропуск: правка ячейки в журнале
 * не несёт имени учреждения, поэтому разделить нагрузку по подведам нечем.
 * Секция говорит это словами и показывает, чем на вопрос отвечает взамен
 * (колонка «строк на учреждение» и канонический счёт учреждений управления),
 * вместо того чтобы молча показать пустое место.
 *
 * ОБЛИК (канон п.129). Своих обводок секция не заводит: поверхности разделяет
 * светлота ролей, а не рамка на каждом атоме. Красок — ровно две роли: тон
 * отказа у плашки чтения и тон данных в таблице.
 */
import { useCallback, useMemo } from 'react';
import { AlertTriangle, Clock, RotateCcw, Scale, Users } from 'lucide-react';
import { ORG_ITSELF_SENTINEL } from '@aemr/shared';
import { useStore } from '../../store';
import { deptScopeOf, filterByDeptScope } from '../../lib/selectors/dept-isolation';
import { useOrgScope } from '../../lib/selectors/org-scope';
import { pluralRu } from '../../lib/economy-copy';
import { EmptyState } from '../EmptyState';
import { SkeletonCard } from '../Skeleton';
import { KBTooltip } from '../ui/kb-tooltip';
import { Card, CardHeader } from '../ui/card';
import { RowEventsPanel } from './RowEventsPanel';
import { WorkloadTable } from './WorkloadTable';
import { WORKLOAD_KB, fmtMoment, type WorkloadResponse } from './contract';
import { useWorkload } from './useWorkload';

/** Плашка периода данных секции: момент чтения плюс честная оговорка. */
function WorkloadPeriodBadge({
  asOf,
  rowsSource,
  scoped,
}: {
  asOf: string;
  rowsSource: string;
  /** Действует ли срез управления из шапки (канон п.127). */
  scoped: boolean;
}) {
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <div className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] bg-[var(--surface-raised)] px-2 py-0.5 ds-text-3xs font-[var(--weight-medium)] text-[var(--ink-muted)]">
        <Clock size={10} aria-hidden="true" />
        <span className="tabular-nums">прочитано {fmtMoment(asOf)}</span>
      </div>
      <span
        className="max-w-[15rem] text-right ds-text-3xs leading-tight text-[var(--ink-faint)]"
        title="Журнал правок и строки книги читаются целиком — разрезать их годом, кварталом или неделей нечем. Выбранное управление срез сужает (канон п.127)."
      >
        числа за всю книгу, период в шапке их не сужает
        {scoped && '; показаны книги выбранных управлений'}
        {rowsSource === 'snapshot' && '; строки — из сохранённого снимка'}
      </span>
    </div>
  );
}

export function WorkloadSection() {
  const { data, loading, error, reload } = useWorkload();

  // Изоляция по управлению (канон п.127): книга чужого управления не
  // показывается в срезе управления ни строкой, ни событием, ни оговоркой.
  const selectedDepartments = useStore((s) => s.selectedDepartments);
  const navigateTo = useStore((s) => s.navigateTo);
  const deptScope = useMemo(() => deptScopeOf(selectedDepartments), [selectedDepartments]);
  const orgScope = useOrgScope();

  const books = useMemo(
    () => filterByDeptScope(data?.books ?? [], deptScope, (b) => b.dept),
    [data, deptScope],
  );
  const booksSilent = useMemo(
    () => filterByDeptScope(data?.booksSilent ?? [], deptScope, (d) => d),
    [data, deptScope],
  );
  const booksMeasured = useMemo(
    () => books.filter((b) => b.observability !== null).length,
    [books],
  );

  /**
   * События среза. Без выбранного управления берутся итоги сервера; в срезе
   * складываются события только показанных книг — итог района в срезе одного
   * управления был бы числом чужой работы.
   */
  const events = useMemo<WorkloadResponse['events'] | null>(() => {
    if (!data) return null;
    if (deptScope === null) return data.events;
    const counted = books.filter((b) => b.events !== null);
    return {
      added: counted.reduce((s, b) => s + (b.events?.added ?? 0), 0),
      cleared: counted.reduce((s, b) => s + (b.events?.cleared ?? 0), 0),
      edits: counted.reduce((s, b) => s + (b.events?.edits ?? 0), 0),
      deletionsUnobservable: true,
      countedBooks: counted.map((b) => b.dept),
      note: data.events.note,
    };
  }, [data, deptScope, books]);

  /** Клик по книге ведёт к строкам, из которых мера и сложилась. */
  const openBook = useCallback(
    (dept: string) => navigateTo('data', { department: dept }),
    [navigateTo],
  );

  /**
   * Ответ режима подведов словами (приказ 20.08). Разбить нагрузку по
   * учреждениям нечем — и вместо пустого места секция говорит, почему и что
   * показывает взамен.
   */
  const orgNote = useMemo(() => {
    if (orgScope.mode === 'district') return null;
    const subs = orgScope.subordinates.filter((g) => g.key !== ORG_ITSELF_SENTINEL).length;
    if (orgScope.mode === 'grbs') {
      return 'Выбран режим «только ГРБС»: подведы скрыты в фильтре, но числа книги их всё '
        + 'равно включают — строки и журнал читаются книгой целиком, разделить их по '
        + 'учреждениям нечем.';
    }
    if (!orgScope.hasSubs) {
      return 'У этого управления подведомственных учреждений нет: вся его книга — закупки '
        + 'самого аппарата, и разбивать её не на что.';
    }
    return 'Разбивки по подведомственным учреждениям здесь нет: правка ячейки в журнале не '
      + 'несёт имени учреждения, поэтому разделить нагрузку по ним нечем. На вопрос «сколько '
      + 'приходится на одного» отвечают колонки «учреждений» и «строк на учреждение» — они '
      + `делят книгу целиком. В справочнике управления ${subs} `
      + `${pluralRu(subs, 'подведомственное учреждение', 'подведомственных учреждения', 'подведомственных учреждений')}.`;
  }, [orgScope]);

  return (
    <section aria-label="Нагрузка управлений" className="space-y-[var(--space-4)]">
      <div className="flex flex-wrap items-start justify-between gap-[var(--space-4)]">
        <div className="min-w-0">
          <KBTooltip {...WORKLOAD_KB} showIcon>
            <h2 className="ds-text-lg font-[var(--weight-strong)] text-[var(--ink-strong)]">
              Нагрузка управлений
            </h2>
          </KBTooltip>
          <p className="ds-prose mt-0.5 ds-text-xs text-[var(--ink-muted)]">
            Сколько закупок ведёт одно учреждение и сколько правок приходится на строку.
            Это измерение трудоёмкости, а не рейтинг вины: много правок — признак живой
            работы с книгой, мало правок при живых закупках — чаще признак того, что
            журнал не ведётся.
          </p>
        </div>
        {data && (
          <WorkloadPeriodBadge
            asOf={data.asOf}
            rowsSource={data.rowsSource}
            scoped={deptScope !== null}
          />
        )}
      </div>

      {/* Отказ сервера: прежние числа не стираются, момент назван в плашке. */}
      {error && (
        <div
          className="flex items-start gap-2 rounded-[var(--radius-card)] px-4 py-3 ds-text-xs"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--data-warn) 10%, transparent)',
            color: 'var(--data-warn)',
          }}
        >
          <AlertTriangle size={14} className="mt-px shrink-0" aria-hidden="true" />
          <div>
            <p>
              Нагрузка не прочитана: {error}
              {data && ' Ниже — числа предыдущего чтения; момент указан в плашке.'}
            </p>
            <button
              type="button"
              onClick={reload}
              className="mt-1.5 inline-flex items-center gap-1 font-[var(--weight-medium)] hover:underline"
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
      ) : books.length === 0 ? (
        // Срез управления при живом ответе: книги есть, но все — чужие.
        <EmptyState
          title="По выбранным управлениям книг в замере нет"
          description={
            `Нагрузка посчитана по ${data.booksTotal} ${pluralRu(data.booksTotal, 'книге', 'книгам', 'книгам')} района, `
            + 'но ни одна из них не принадлежит выбранным управлениям. Снимите отбор управления '
            + 'в шапке — и замер вернётся целиком.'
          }
        />
      ) : booksMeasured === 0 ? (
        <>
          <EmptyState
            tone="problem"
            title="Ни по одной книге меры не посчитаны"
            description={
              'Нагрузка считается отношениями, и для них нужны обе половины — строки книги и её '
              + 'журнал правок. Сейчас хотя бы одной половины нет ни у одной из книг, поэтому '
              + 'вместо чисел ниже стоят причины.'
            }
            action={{ label: 'Прочитать ещё раз', onClick: reload }}
          />
          <Card bare aria-label="Меры нагрузки по книгам">
            <WorkloadTable books={books} readAt={fmtMoment(data.asOf)} onOpenBook={openBook} />
          </Card>
        </>
      ) : (
        <>
          <Card bare aria-label="Меры нагрузки по книгам">
            <div className="px-[var(--card-pad)] pt-[var(--card-pad)]">
              <CardHeader
                title="Меры нагрузки"
                scope={`${books.length} ${pluralRu(books.length, 'книга', 'книги', 'книг')} · прочитано ${fmtMoment(data.asOf)}`}
                note="Строки книги и записи её журнала правок, пересчитанные в отношения. Строка таблицы открывает свои строки в Реестре — мера сверяется с тем, из чего сложилась."
              />
            </div>
            <WorkloadTable books={books} readAt={fmtMoment(data.asOf)} onOpenBook={openBook} />
          </Card>

          {/* Ответ режима подведов — словами, а не пустым местом. */}
          {orgNote && (
            <div className="flex items-start gap-2 ds-text-2xs text-[var(--ink-muted)]">
              <Users size={13} className="mt-px shrink-0" aria-hidden="true" />
              <p className="max-w-3xl">{orgNote}</p>
            </div>
          )}

          {/* Итоги района и разброс — подписи механизма, не оценки. В срезе
              управления итоги района не показываются: это числа чужой работы. */}
          <div className="flex items-start gap-2 ds-text-2xs text-[var(--ink-muted)]">
            <Scale size={13} className="mt-px shrink-0" aria-hidden="true" />
            <p className="max-w-3xl">
              {deptScope === null
                ? data.notes.join(' ')
                : 'Показаны книги выбранных управлений. Итоги района и разброс между '
                  + 'управлениями считаются по всем восьми книгам и видны в срезе «все управления».'}
            </p>
          </div>
        </>
      )}

      {data && events && <RowEventsPanel events={events} booksSilent={booksSilent} />}
    </section>
  );
}
