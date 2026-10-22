/**
 * Секция «Целостность книг» — раздел «Контроль», рядом с замечаниями.
 *
 * ЧТО ЗАКРЫВАЕТ. Три модуля, которые считались правильно и не выводились
 * никуда (инвентаризация сигналов 20.08.2026, §4): целостность нумерации,
 * сбитый вид ячейки даты и сравнение снимков на пропажу строк. Все три отвечают
 * на вопросы, которые больше не задаёт ни один экран.
 *
 * ПОЧЕМУ ЗДЕСЬ, А НЕ НА «АНАЛИТИКЕ». Речь не о деньгах и не о поведении, а о
 * том, можно ли на строку сослаться и на месте ли она. Это ровно предмет
 * вкладки «Контроль»: рядом лежат замечания, у которых адрес строки — главное
 * содержимое. Признаки странностей (деньги под риском) живут отдельно, на
 * «Аналитике», — у них другой вопрос и другой читатель.
 *
 * ПРОПУСК НОМЕРА — НЕ ОШИБКА НУМЕРАЦИИ, А СЛЕД. Журнал книги удаление строки
 * не записывает (канон п.105): строка, убранная через меню таблицы, не создаёт
 * ни одной правки ячейки. Поэтому пропуск в «№ п/п» и разница двух снимков —
 * единственные видимые следы пропажи, и тон здесь соответствующий: не упрёк, а
 * приглашение проверить.
 *
 * ГРАНИЦА ЧЕСТНОСТИ У ВИДА ЯЧЕЙКИ. Книги читаются в необработанном виде, и
 * дату с правильным форматом от даты с числовым отличить нечем. Показывается
 * та половина, которая видна честно: код даты, лежащий в ячейке ТЕКСТОМ. Про
 * вторую половину сказано словами — пустой список здесь не означает «формат
 * везде верен».
 *
 * ИЗОЛЯЦИЯ УПРАВЛЕНИЯ (канон п.127): выбранное в шапке управление сужает и
 * книги, и сравнение снимков, и оговорки о непрочитанном.
 */
import { useMemo, useState } from 'react';
import { AlertTriangle, Clock, Hash, RotateCcw } from 'lucide-react';
import { useStore } from '../../store';
import { deptScopeOf, filterByDeptScope } from '../../lib/selectors/dept-isolation';
import { useOrgScope } from '../../lib/selectors/org-scope';
import { pluralRu } from '../../lib/economy-copy';
import { EmptyState } from '../EmptyState';
import { SkeletonCard } from '../Skeleton';
import { KBTooltip } from '../ui/kb-tooltip';
import { Card } from '../ui/card';
import { fmtMoment } from '../workload/contract';
import { useIntegrity } from './useExtraSignals';
import {
  INTEGRITY_KB,
  addressText,
  fmtTys,
  uniqueOperationalAbsences,
  scopedIntegrityTotals,
  type IntegrityBookDto,
  type VanishedBookDto,
} from './contract';

/** Сколько строк без номера показывать сразу. */
const SHOWN_ROWS = 6;

/** Отрезки пропусков словами: «41–48 (8)». */
function gapsText(gaps: Array<{ from: number; to: number; count: number }>): string {
  return gaps
    .map((g) => (g.from === g.to ? `${g.from}` : `${g.from}–${g.to} (${g.count})`))
    .join(', ');
}

/** Одна книга: охват нумерации, пропуски, повторы, строки без адреса. */
function BookCard({ book }: { book: IntegrityBookDto }) {
  const navigateTo = useStore((s) => s.navigateTo);
  const [expanded, setExpanded] = useState(false);
  const seq = book.sequence;

  return (
    <Card bare aria-label={`Целостность книги ${book.deptName}`}>
      <div className="px-[var(--card-pad)] py-[var(--card-pad)]">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 className="ds-text-sm font-[var(--weight-strong)] text-[var(--ink-strong)]">
            {book.deptName}
          </h3>
          <span className="ds-text-3xs text-[var(--ink-faint)]">лист {book.sheet}</span>
        </div>

        {!book.rowsAvailable || seq === null ? (
          <p className="ds-prose mt-1 ds-text-xs text-[var(--ink-muted)]">{book.note}</p>
        ) : (
          <>
            <p className="mt-1 ds-text-xs text-[var(--ink-muted)]">
              Номер есть у{' '}
              <span className="tabular-nums font-[var(--weight-medium)] text-[var(--ink-strong)]">
                {seq.coveragePct === null ? 'нет счётных строк' : `${seq.coveragePct}%`}
              </span>{' '}
              {seq.coveragePct === null ? '' : 'счётных строк'}
              {seq.range && (
                <> · использованы номера с {seq.range.min} по {seq.range.max}</>
              )}
            </p>
            <p className="ds-prose mt-1 ds-text-xs text-[var(--ink-muted)]">{seq.note}</p>

            {seq.gapCount > 0 && (
              <p className="mt-1.5 ds-text-xs text-[var(--ink)]">
                <span className="font-[var(--weight-medium)]">Пропущено номеров:</span>{' '}
                <span className="tabular-nums">{seq.gapCount}</span>
                {seq.gaps.length > 0 && (
                  <span className="ml-1 font-mono ds-text-3xs text-[var(--ink-faint)]">
                    {gapsText(seq.gaps)}
                    {seq.gaps.length < seq.gapCount && ' …'}
                  </span>
                )}
              </p>
            )}

            {seq.duplicates.length > 0 && (
              <p className="mt-1 ds-text-xs text-[var(--ink)]">
                <span className="font-[var(--weight-medium)]">Номер стоит дважды:</span>{' '}
                {seq.duplicates
                  .map((d) => `№ ${d.rowSeq} — строки ${d.sheetRows.join(' и ')}`)
                  .join('; ')}
                . Ссылка «строка № такой-то» перестаёт быть однозначной.
              </p>
            )}

            {seq.unnumbered.length > 0 && (
              <div className="mt-1.5">
                <p className="ds-text-xs font-[var(--weight-medium)] text-[var(--ink)]">
                  Счётные строки без номера — сослаться на них нечем:
                </p>
                <ul className="mt-1 space-y-0.5">
                  {(expanded ? seq.unnumbered : seq.unnumbered.slice(0, SHOWN_ROWS)).map((r) => (
                    <li key={r.sheetRow} className="ds-text-xs text-[var(--ink-muted)]">
                      <button
                        type="button"
                        onClick={() => navigateTo('data', {
                          department: book.dept,
                          ...(r.subject ? { search: r.subject.slice(0, 60) } : {}),
                        })}
                        title="Открыть эту закупку в Реестре"
                        className="font-mono ds-text-3xs underline decoration-dotted underline-offset-2 transition-colors hover:text-[var(--accent)]"
                      >
                        строка {r.sheetRow}
                      </button>
                      {r.subject ? ` — ${r.subject}` : ' — предмет не заполнен'}
                      {r.planSum !== null && (
                        <span className="tabular-nums text-[var(--ink-faint)]">
                          {' '}· {fmtTys(r.planSum)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                {seq.unnumbered.length > SHOWN_ROWS && (
                  <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    className="mt-1 ds-text-xs font-[var(--weight-medium)] text-[var(--accent)] hover:underline"
                  >
                    {expanded
                      ? 'Свернуть'
                      : `Показать остальные ${seq.unnumbered.length - SHOWN_ROWS}`}
                  </button>
                )}
                {seq.countableWithoutSeq > seq.unnumbered.length && (
                  <p className="mt-1 ds-text-3xs text-[var(--ink-faint)]">
                    Всего таких строк {seq.countableWithoutSeq}; показаны самые дорогие.
                  </p>
                )}
              </div>
            )}

            {book.dateFormat.length > 0 && (
              <div className="mt-2 rounded-[var(--radius-card)] bg-[var(--surface-raised)] px-3 py-2">
                <p className="ds-text-xs font-[var(--weight-medium)] text-[var(--ink)]">
                  В графе срока лежит код даты текстом:
                </p>
                <ul className="mt-1 space-y-1">
                  {book.dateFormat.map((d) => (
                    <li key={`${d.sheetRow}-${d.column}`} className="ds-text-xs text-[var(--ink-muted)]">
                      <span className="font-mono ds-text-3xs">
                        {addressText(d.sheetRow, d.rowSeq)}
                      </span>
                      {' · '}{d.columnLabel}: показано «{d.shown}», это {d.meansDate}
                      {d.subject ? ` · ${d.subject}` : ''}
                      <span className="mt-0.5 block ds-text-3xs text-[var(--ink-faint)]">{d.action}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

/** Пропажи и переезды строк одной книги между двумя снимками. */
function VanishedCard({ book, afterLabel = 'сейчас' }: { book: VanishedBookDto; afterLabel?: string }) {
  const likelyOld = new Set(book.identityCandidates.map((c) => c.beforeRowSeq));
  const unexplained = book.vanished.filter((v) => !likelyOld.has(v.rowSeq));
  const ambiguous = [...new Set([...book.ambiguousKeys.before, ...book.ambiguousKeys.after])];

  return (
    <div className="border-b border-[var(--line-soft)] py-[var(--space-3)] last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="ds-text-sm font-[var(--weight-medium)] text-[var(--ink-strong)]">
          {book.deptName}
        </span>
        <span className="tabular-nums ds-text-xs text-[var(--ink-muted)]">
          {unexplained.length === 0 && book.identityCandidates.length === 0
            ? (book.contextChanged.length > 0
              ? book.contextChanged.length + ' изменений контекста при прежнем №'
              : 'отсутствующих прежних номеров нет')
            : `${unexplained.length} ${pluralRu(unexplained.length, 'номер без соответствия', 'номера без соответствия', 'номеров без соответствия')}` +
              ` · ${book.identityCandidates.length} возможных смен №`}
        </span>
      </div>
      {unexplained.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {unexplained.map((v) => (
            <li key={v.rowSeq} className="ds-text-xs text-[var(--ink-muted)]">
              <span className="font-mono ds-text-3xs">
                Прежний № {v.rowSeq} · была строка {v.wasAtSheetRow}
              </span>
              {v.subject ? ` — ${v.subject}` : ' — предмет не заполнен'}
              {v.subordinate ? ` · ${v.subordinate}` : ''}
              {v.planSum !== null && (
                <span className="tabular-nums text-[var(--ink-faint)]"> · {fmtTys(v.planSum)} плана по прежней записи</span>
              )}
              {' · причина не установлена'}
            </li>
          ))}
        </ul>
      )}
      {book.identityCandidates.length > 0 && (
        <ul className="mt-2 space-y-1">
          {book.identityCandidates.map((candidate) => (
            <li key={candidate.beforeRowSeq + ':' + candidate.afterRowSeq}
                className="ds-text-xs text-[var(--ink-muted)]">
              <span className="font-medium text-[var(--ink)]">
                Возможная смена № {candidate.beforeRowSeq} → № {candidate.afterRowSeq}
              </span>
              {' · '}{candidate.subject} · {candidate.subordinate}
              {' · совпадают предмет, учреждение, план и способ. Это гипотеза; требуется проверка.'}
            </li>
          ))}
        </ul>
      )}
      {book.contextChanged.length > 0 && (
        <ul className="mt-2 space-y-1">
          {book.contextChanged.map((item) => (
            <li key={item.rowSeq} className="ds-text-xs text-[var(--ink-muted)]">
              <span className="font-medium text-[var(--ink)]">
                № {item.rowSeq}: изменились предмет или учреждение
              </span>
              {' · было: '}{item.beforeSubject}{item.beforeSubordinate ? ' · ' + item.beforeSubordinate : ''}
              {' → стало: '}{item.afterSubject}{item.afterSubordinate ? ' · ' + item.afterSubordinate : ''}
              {' · причина неизвестна; не считать автоматически той же или другой закупкой.'}
            </li>
          ))}
        </ul>
      )}
      {ambiguous.length > 0 && (
        <p className="mt-1 ds-text-xs text-[var(--data-warn)]">
          Повторяющиеся № п/п: {ambiguous.join(', ')}. Их преемственность не установлена.
        </p>
      )}
      {book.moved.length > 0 && (
        <p className="mt-1 ds-text-3xs text-[var(--ink-faint)]">
          Сместились по листу без изменения №: {book.moved.length}. Это не пропажа.
        </p>
      )}
      {(book.unkeyed.before > 0 || book.unkeyed.after > 0) && (
        <p className="mt-1 ds-text-3xs text-[var(--data-warn)]">
          Строк без «№ п/п»: в контроле {book.unkeyed.before}, {afterLabel} {book.unkeyed.after} — их
          преемственность не подтверждена.
        </p>
      )}
    </div>
  );
}

export function IntegritySection() {
  const { data, loading, error, reload } = useIntegrity();
  const selectedDepartments = useStore((s) => s.selectedDepartments);
  const deptScope = useMemo(() => deptScopeOf(selectedDepartments), [selectedDepartments]);
  const orgScope = useOrgScope();

  const books = useMemo(
    () => filterByDeptScope(data?.books ?? [], deptScope, (b) => b.dept),
    [data, deptScope],
  );
  const visibleTotals = useMemo(() => scopedIntegrityTotals(books), [books]);
  const vanishedBooks = useMemo(
    () => filterByDeptScope(data?.comparison?.books ?? [], deptScope, (b) => b.dept),
    [data, deptScope],
  );
  const unavailableBooks = useMemo(
    () => filterByDeptScope(data?.comparison?.unavailableBooks ?? [], deptScope, (b) => b.dept),
    [data, deptScope],
  );
  const weeklyBooks = useMemo(
    () => filterByDeptScope(data?.weeklyComparison?.books ?? [], deptScope, (b) => b.dept),
    [data, deptScope],
  );
  const operationalEntries = filterByDeptScope(data?.operational?.entries ?? [], deptScope, entry => entry.dept);
  const operationalUnavailable = filterByDeptScope(
    data?.operational?.unavailableBooks ?? [], deptScope, item => item.dept);
  const operationalView = uniqueOperationalAbsences(
    operationalEntries, [...vanishedBooks, ...weeklyBooks]);

  /**
   * Разбивки по подведам здесь нет — и это ответ, а не пропуск: нумерация и
   * пропуски живут на уровне ЛИСТА книги, один сквозной ряд номеров на всё
   * управление. Разрезать его по учреждениям нечем, и молчать об этом нельзя.
   */
  const orgNote = useMemo(() => {
    if (orgScope.mode === 'district') return null;
    if (orgScope.mode === 'grbs') {
      return 'Включён режим «только ГРБС». На числа раздела это не влияет: нумерация сквозная '
        + 'по всему листу книги, и строки подведомственных учреждений входят в неё наравне с '
        + 'закупками аппарата.';
    }
    if (!orgScope.hasSubs) {
      return 'У этого управления подведомственных учреждений нет: весь лист — закупки самого '
        + 'аппарата.';
    }
    return 'Разбивки по учреждениям здесь нет: «№ п/п» — один сквозной ряд на весь лист книги, '
      + 'и разрезать его по учреждениям нечем. Чьи именно строки остались без номера, видно в '
      + 'списке ниже — у каждой назван предмет закупки.';
  }, [orgScope]);

  return (
    <section aria-label="Целостность книг" className="space-y-[var(--space-4)]">
      <div className="flex flex-wrap items-start justify-between gap-[var(--space-4)]">
        <div className="min-w-0">
          <KBTooltip {...INTEGRITY_KB} showIcon>
            <h2 className="ds-text-lg font-[var(--weight-strong)] text-[var(--ink-strong)]">
              Целостность книг
            </h2>
          </KBTooltip>
          <p className="ds-prose mt-0.5 ds-text-xs text-[var(--ink-muted)]">
            Можно ли сослаться на строку, видит ли человек в графе срока дату и не пропала ли
            закупка между чтениями. Пропуск номера требует проверки, но сам по себе не доказывает удаление:
            журнал книги удаление строки не записывает.
          </p>
        </div>
        {data && (
          <div className="flex shrink-0 flex-col items-end gap-1">
            <div className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] bg-[var(--surface-raised)] px-2 py-0.5 ds-text-3xs font-[var(--weight-medium)] text-[var(--ink-muted)]">
              <Clock size={10} aria-hidden="true" />
              <span className="tabular-nums">сверка рассчитана {fmtMoment(data.asOf)}</span>
            </div>
            <span
              className="max-w-[16rem] text-right ds-text-3xs leading-tight text-[var(--ink-faint)]"
              title="Нумерация считается по листу целиком — период в шапке её не сужает. Выбранное управление срез сужает (канон п.127)."
            >
              нумерация считается по листу целиком
              {deptScope !== null && '; показаны книги выбранных управлений'}
            </span>
          </div>
        )}
      </div>

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
              Целостность не прочитана: {error}
              {data && ' Ниже — результат предыдущего чтения; момент указан в плашке.'}
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

      {orgNote && (
        <p className="ds-prose ds-text-xs text-[var(--ink-muted)]">{orgNote}</p>
      )}

      {loading && !data ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">Читаем нумерацию строк и сравниваем снимки</span>
          <SkeletonCard />
        </div>
      ) : !data ? (
        !error && (
          <EmptyState
            tone="problem"
            title="Целостность книг не проверена"
            description="Сервер не отдал ни одной книги: смотреть на нумерацию не из чего."
            action={{ label: 'Прочитать ещё раз', onClick: reload }}
          />
        )
      ) : books.length === 0 ? (
        <EmptyState
          title="По выбранным управлениям книг в проверке нет"
          description={
            'Проверка прошла по книгам района, но ни одна из них не принадлежит выбранным '
            + 'управлениям. Снимите отбор управления в шапке — и проверка вернётся целиком.'
          }
        />
      ) : (
        <div className="space-y-[var(--space-4)]">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 ds-text-3xs text-[var(--ink-faint)]">
              <Hash size={12} aria-hidden="true" />
              <span>
                {visibleTotals.checkedBooks === 0 ? (
                  'Нумерация выбранных книг не проверена — нет прочитанных данных.'
                ) : (
                  <>
                    пропущено номеров: {visibleTotals.gapCount.toLocaleString('ru-RU')} · строк без
                    номера: {visibleTotals.countableWithoutSeq.toLocaleString('ru-RU')} · повторов
                    номера: {visibleTotals.duplicates}
                  </>
                )}
              </span>
            </div>
            {visibleTotals.unreadBooks > 0 && (
              <p className="ds-text-3xs text-[var(--data-warn)]">
                Проверено {visibleTotals.checkedBooks} из {books.length} выбранных книг.
                Непрочитанные книги не входят в итог и не означают нулевую пропажу.
              </p>
            )}
          </div>

          {books.map((book) => <BookCard key={book.dept} book={book} />)}

          <Card bare aria-label="Пропавшие закупки">
            <div className="px-[var(--card-pad)] py-[var(--card-pad)]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="ds-text-sm font-[var(--weight-strong)] text-[var(--ink-strong)]">
                  Пропавшие закупки: контрольный четверг → текущие книги
                </h3>
                <button type="button" onClick={reload} disabled={loading}
                  className="inline-flex items-center gap-1 ds-text-xs font-[var(--weight-medium)] text-[var(--accent)] hover:underline disabled:opacity-50"
                  aria-label="Сверить текущие книги с четверговым контролем после перечитывания">
                  <RotateCcw size={12} aria-hidden="true" />
                  {loading ? 'Читаем…' : 'Сверить сейчас'}
                </button>
              </div>
              {data.comparison === null ? (
                <p className="ds-prose mt-1 ds-text-xs text-[var(--ink-muted)]">
                  {data.comparisonNote}
                </p>
              ) : (
                <>
                  <p className="ds-prose mt-0.5 ds-text-xs text-[var(--ink-muted)]">
                    Проверенный четверг: {fmtMoment(data.comparison.beforeAt)}. Текущие
                    книги прочитаны с {fmtMoment(data.comparison.oldestCurrentAt)} по{' '}
                    {fmtMoment(data.comparison.afterAt)}. Отсутствие прежнего номера не доказывает
                    удаление закупки; возможна перенумерация.
                  </p>
                  {unavailableBooks.length > 0 && (
                    <p className="mt-1 ds-text-xs text-[var(--data-warn)]">
                      Не удалось сверить: {unavailableBooks.map((b) => b.dept + ' — ' + b.reason).join('; ')}.
                      По этим книгам не утверждаем, что пропаж нет.
                    </p>
                  )}
                  {vanishedBooks.length === 0 ? (
                    <p className="mt-2 ds-text-xs text-[var(--ink-faint)]">
                      {unavailableBooks.length === 0
                        ? 'По сопоставленным книгам отсутствующих прежних номеров не найдено.'
                        : 'По доступным книгам отсутствующих прежних номеров не найдено; проверка неполная.'}
                      {' '}Строки без «№ п/п» не позволяют установить преемственность.
                    </p>
                  ) : (
                    <ul className="mt-1">
                      {vanishedBooks.map((b) => <VanishedCard key={b.dept} book={b} />)}
                    </ul>
                  )}
                </>
              )}
              <div className="mt-4 border-t border-[var(--line-soft)] pt-3">
                <h4 className="ds-text-sm font-[var(--weight-medium)] text-[var(--ink-strong)]">
                  Независимая сверка двух недельных контролей
                </h4>
                {data.weeklyComparison == null ? (
                  <p className="ds-prose mt-1 ds-text-xs text-[var(--data-warn)]">
                    {data.weeklyComparisonNote ?? 'Недельная сверка недоступна в этой версии API.'}
                  </p>
                ) : (
                  <>
                    <p className="ds-prose mt-1 ds-text-xs text-[var(--ink-muted)]">
                      Полные срезы: {fmtMoment(data.weeklyComparison.beforeAt)} →{' '}
                      {fmtMoment(data.weeklyComparison.afterAt)}. Сравнение по книге и № п/п
                      независимо от промежуточных вебхуков и изменений положения строк.
                      Отсутствие прежнего номера — кандидат для проверки, не доказанное удаление.
                    </p>
                    {data.weeklyComparisonNote && (
                      <p className="ds-prose mt-1 ds-text-xs text-[var(--data-warn)]">
                        {data.weeklyComparisonNote}
                      </p>
                    )}
                    {weeklyBooks.length === 0 ? (
                      <p className="mt-2 ds-text-xs text-[var(--ink-faint)]">
                        В сопоставленных недельных контролях по выбранным управлениям
                        отсутствующих прежних номеров и неоднозначных связей не найдено.
                      </p>
                    ) : (
                      <ul className="mt-1">
                        {weeklyBooks.map((book) => (
                          <VanishedCard key={book.dept} book={book} afterLabel="в следующем срезе" />
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
              {data.operational && (
                <div className="mt-4 border-t border-[var(--line-soft)] pt-3">
                  <h4 className="ds-text-sm font-[var(--weight-medium)] text-[var(--ink-strong)]">
                    Оперативные наблюдения между недельными срезами
                  </h4>
                  <p className="ds-prose mt-1 ds-text-xs text-[var(--ink-muted)]">
                    Записаны с {fmtMoment(data.operational.since)}. Сопоставлены с последним
                    принятым чтением без нового обращения к Google. Отсутствие прежнего
                    номера не доказывает удаления закупки.
                  </p>
                  {data.operational.error && (
                    <p className="mt-1 ds-text-xs text-[var(--data-warn)]">
                      {data.operational.error}. Отсутствие пропаж не подтверждено.
                    </p>
                  )}
                  {operationalUnavailable.length > 0 && (
                    <p className="mt-1 ds-text-xs text-[var(--data-warn)]">
                      Не проверено: {operationalUnavailable
                        .map(item => item.dept + ' — ' + item.reason).join('; ')}.
                      Не считаем эти книги чистыми.
                    </p>
                  )}
                  {operationalView.only.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {operationalView.only.map(entry => (
                        <li key={entry.dept + ':' + entry.rowSeq}
                            className="ds-text-xs text-[var(--ink-muted)]">
                          <span className="font-mono ds-text-3xs">
                            {entry.dept} · прежний № {entry.rowSeq}
                            {entry.wasAtSheetRow !== null ? ' · была строка ' + entry.wasAtSheetRow : ''}
                          </span>
                          {entry.subject ? ' — ' + entry.subject : ''}
                          {' · наблюдалось '}{fmtMoment(entry.observedAt)}
                          {' · причина не установлена'}
                        </li>
                      ))}
                    </ul>
                  )}
                  {operationalView.corroboratedCount > 0 && (
                    <p className="mt-1 ds-text-3xs text-[var(--ink-faint)]">
                      С недельной сверкой совпало {operationalView.corroboratedCount} наблюдений.
                      Повторно не считаем.
                    </p>
                  )}
                  {operationalView.only.length === 0 &&
                    operationalView.corroboratedCount === 0 &&
                    operationalUnavailable.length === 0 &&
                    !data.operational.error && (
                      <p className="mt-1 ds-text-xs text-[var(--ink-faint)]">
                        Записанных кандидатов за это окно нет. Это не подтверждение отсутствия
                        изменений в исходных книгах.
                      </p>
                    )}
                </div>
              )}
            </div>
          </Card>

          <p className="ds-prose ds-text-3xs text-[var(--ink-faint)]">
            Вид ячейки проверяется только там, где код даты лежит текстом: книги читаются в
            необработанном виде, и дату с правильным форматом от даты с числовым отличить
            нечем. Пустой список означает «текстовых кодов не найдено», а не «формат везде
            верен».
          </p>
        </div>
      )}
    </section>
  );
}
