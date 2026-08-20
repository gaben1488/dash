/**
 * Секция «Признаки странностей в строках» — раздел «Аналитика».
 *
 * ЧТО ЗАКРЫВАЕТ. Инвентаризация сигналов 20.08.2026 записала перекос: на
 * экране висели безадресные счётчики («сезонных аномалий 7»), а двенадцать
 * проработанных адресных признаков и пятнадцать видов аномалий датасета лежали
 * без единого потребителя. Счётчик без адреса — упрёк, а не инструмент: по
 * нему нельзя сделать ни одного шага. Здесь у каждой находки есть ответ на три
 * вопроса канона п.119: какая строка, что в ней, почему сработало.
 *
 * ДВЕ ШКАЛЫ, А НЕ ОДИН БАЛЛ. «Похоже на опечатку» и «похоже на подгон»
 * отвечают на разные вопросы — рука дрогнула или числа подобраны — и лечатся
 * разным: первое правкой ячейки, второе проверкой документов. Сложить их в
 * общий рейтинг значит получить число, которое не значит ничего.
 *
 * ТОН БЕЗ УПРЁКА (канон п.104). Признак говорит, что наблюдается и что это
 * МОЖЕТ означать, и зовёт открыть строку. Совпадение признака — не нарушение,
 * отсутствие признака — не чистота. Обе оговорки стоят на экране, а не только
 * в комментарии.
 *
 * ИЗОЛЯЦИЯ УПРАВЛЕНИЯ (канон п.127). Выбранное в шапке управление сужает всё:
 * находки, счётчики, деньги под риском и оговорки о непрочитанных книгах.
 * Чужая книга в чужой срез не попадает ни строкой, ни числом.
 *
 * РЕЖИМ ПОДВЕДОВ (приказ владельца 20.08.2026). В режиме «с подведомственными»
 * находки раскладываются по учреждениям: у каждой строки книги колонка C уже
 * прочитана сервером. В режиме «только ГРБС» разбивки нет — и это сказано
 * словами. У управления без подведов сказано и это.
 *
 * СВОЙ ПЕРИМЕТР. Период из шапки к секции не применяется: детектор сравнивает
 * строку с её соседями по всей книге, и сузить это кварталом нечем. Момент
 * чтения назван в плашке (канон п.58).
 */
import { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, Building2, Clock, Microscope, RotateCcw } from 'lucide-react';
import { useStore } from '../../store';
import { deptScopeOf, filterByDeptScope } from '../../lib/selectors/dept-isolation';
import { useOrgScope } from '../../lib/selectors/org-scope';
import { pluralRu } from '../../lib/economy-copy';
import { EmptyState } from '../EmptyState';
import { SkeletonCard } from '../Skeleton';
import { KBTooltip } from '../ui/kb-tooltip';
import { Card } from '../ui/card';
import { fmtMoment } from '../workload/contract';
import { useAnomalies } from './useExtraSignals';
import {
  ANOMALY_SIGNS_KB,
  LEVEL_LABEL,
  SCALE_LEAD,
  SCALE_TITLE,
  addressText,
  fmtTys,
  type AnomalyScale,
  type AnomalySignDto,
  type DatasetFindingDto,
  type NoiseGroupDto,
} from './contract';

/** Сколько находок показывать сразу — остальные раскрываются кнопкой. */
const SHOWN_AT_ONCE = 8;

/** Ссылка на строку: ведёт в Реестр с отбором книги и предмета. */
function RowLink({
  dept,
  sheetRow,
  rowSeq,
  subject,
}: {
  dept: string;
  sheetRow: number | null;
  rowSeq: string;
  subject: string;
}) {
  const navigateTo = useStore((s) => s.navigateTo);
  const label = addressText(sheetRow, rowSeq);
  if (label === '') return null;
  return (
    <button
      type="button"
      onClick={() => navigateTo('data', {
        department: dept,
        ...(subject.trim() === '' ? {} : { search: subject.trim().slice(0, 60) }),
      })}
      title="Открыть эту закупку в Реестре"
      className="font-mono ds-text-3xs text-[var(--ink-muted)] underline decoration-dotted underline-offset-2 transition-colors hover:text-[var(--accent)]"
    >
      {label}
    </button>
  );
}

/** Одна находка детектора: адрес, что в строке, почему сработало, цена вопроса. */
function SignRow({ item }: { item: AnomalySignDto }) {
  return (
    <li className="border-b border-[var(--line-soft)] py-[var(--space-3)] last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="ds-text-sm font-[var(--weight-medium)] text-[var(--ink-strong)]">
          {item.title}
        </span>
        <span className="tabular-nums ds-text-xs text-[var(--ink-muted)]">
          {item.amountAtRisk > 0 ? `под риском ${fmtTys(item.amountAtRisk)}` : 'сумма не названа'}
        </span>
      </div>

      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 ds-text-3xs text-[var(--ink-faint)]">
        <span>{item.deptName}</span>
        {item.subordinate && <span>· {item.subordinate}</span>}
        <span>· лист {item.sheet}</span>
        <RowLink
          dept={item.dept}
          sheetRow={item.sheetRow > 0 ? item.sheetRow : null}
          rowSeq={item.rowSeq}
          subject={item.subject}
        />
        {item.cell && <span className="font-mono">· ячейка {item.cell}</span>}
      </div>

      {item.subject && (
        <p className="mt-1 ds-text-xs text-[var(--ink)]">{item.subject}</p>
      )}
      <p className="ds-prose mt-1 ds-text-xs text-[var(--ink-muted)]">{item.explanation}</p>

      {item.members.length > 0 && (
        <p className="mt-1 ds-text-3xs text-[var(--ink-faint)]">
          Остальные строки группы: {item.members.join(', ')}
          {item.rows > item.members.length + 1 && ` и ещё ${item.rows - item.members.length - 1}`}
        </p>
      )}
      {item.smallSample && (
        <p className="mt-1 ds-text-3xs text-[var(--data-warn)]">
          Данных мало: признак можно посмотреть, опираться на него как на вывод — нельзя.
          {item.note ? ` ${item.note}` : ''}
        </p>
      )}
      {!item.smallSample && item.note && (
        <p className="mt-1 ds-text-3xs text-[var(--ink-faint)]">{item.note}</p>
      )}
    </li>
  );
}

/** Блок одной шкалы: заголовок-вопрос, цена вопроса, список находок. */
function ScaleBlock({
  scale,
  items,
  amount,
  groups,
}: {
  scale: AnomalyScale;
  items: AnomalySignDto[];
  amount: number;
  /** Разбивка по учреждениям; null — режим её не строит. */
  groups: Array<{ label: string; items: AnomalySignDto[] }> | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, SHOWN_AT_ONCE);

  return (
    <Card bare aria-label={SCALE_TITLE[scale]}>
      <div className="px-[var(--card-pad)] pt-[var(--card-pad)]">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 className="ds-text-sm font-[var(--weight-strong)] text-[var(--ink-strong)]">
            {SCALE_TITLE[scale]}
          </h3>
          <span className="tabular-nums ds-text-xs text-[var(--ink-muted)]">
            {items.length} {pluralRu(items.length, 'признак', 'признака', 'признаков')}
            {amount > 0 && ` · ${fmtTys(amount)} под риском`}
          </span>
        </div>
        <p className="ds-prose mt-0.5 ds-text-xs text-[var(--ink-muted)]">{SCALE_LEAD[scale]}</p>
      </div>

      <div className="px-[var(--card-pad)] pb-[var(--card-pad)]">
        {items.length === 0 ? (
          <p className="mt-[var(--space-3)] ds-text-xs text-[var(--ink-faint)]">
            Признаков этой шкалы не найдено. Это не значит, что данные верны: детектор смотрит
            только на то, что видно в числах и датах строки.
          </p>
        ) : groups ? (
          <div className="mt-[var(--space-2)] space-y-[var(--space-4)]">
            {groups.map((g) => (
              <div key={g.label}>
                <h4 className="ds-text-xs font-[var(--weight-medium)] text-[var(--ink)]">
                  {g.label}
                  <span className="ml-1.5 font-normal text-[var(--ink-faint)]">
                    {g.items.length === 0
                      ? '— находок нет'
                      : `— ${g.items.length} ${pluralRu(g.items.length, 'признак', 'признака', 'признаков')}`}
                  </span>
                </h4>
                {g.items.length > 0 && (
                  <ul className="mt-1">
                    {g.items.map((item, i) => (
                      <SignRow key={`${item.dept}-${item.sign}-${item.sheetRow}-${i}`} item={item} />
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        ) : (
          <>
            <ul className="mt-[var(--space-2)]">
              {shown.map((item, i) => (
                <SignRow key={`${item.dept}-${item.sign}-${item.sheetRow}-${i}`} item={item} />
              ))}
            </ul>
            {items.length > SHOWN_AT_ONCE && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-[var(--space-2)] ds-text-xs font-[var(--weight-medium)] text-[var(--accent)] hover:underline"
              >
                {expanded
                  ? 'Свернуть'
                  : `Показать остальные ${items.length - SHOWN_AT_ONCE}`}
              </button>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

/** Аномалии датасета: те же три вопроса, но считает их конвейер при чтении книг. */
function DatasetBlock({ items, available }: { items: DatasetFindingDto[]; available: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, SHOWN_AT_ONCE);

  return (
    <Card bare aria-label="Аномалии датасета">
      <div className="px-[var(--card-pad)] pt-[var(--card-pad)]">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 className="ds-text-sm font-[var(--weight-strong)] text-[var(--ink-strong)]">
            Аномалии датасета
          </h3>
          <span className="tabular-nums ds-text-xs text-[var(--ink-muted)]">
            {items.length} {pluralRu(items.length, 'находка', 'находки', 'находок')}
          </span>
        </div>
        <p className="ds-prose mt-0.5 ds-text-xs text-[var(--ink-muted)]">
          Пятнадцать видов, которые конвейер считает при чтении книг: пять по строке, четыре
          видны только сравнением с прошлым чтением, шесть — признаки всей книги. Раньше до
          экрана доезжал только их общий счёт; здесь у каждой находки есть адрес.
        </p>
      </div>
      <div className="px-[var(--card-pad)] pb-[var(--card-pad)]">
        {!available ? (
          <p className="mt-[var(--space-3)] ds-text-xs text-[var(--ink-faint)]">
            Разбор датасета в снимке отсутствует: показывать нечего потому, что его не из чего
            взять. Обновите данные — разбор считается при чтении книг.
          </p>
        ) : items.length === 0 ? (
          <p className="mt-[var(--space-3)] ds-text-xs text-[var(--ink-faint)]">
            Аномалий не найдено. Это утверждение о прочитанных книгах, а не обо всех: книги,
            которые не ответили, названы ниже отдельной строкой.
          </p>
        ) : (
          <>
            <ul className="mt-[var(--space-2)]">
              {shown.map((f, i) => (
                <li
                  key={`${f.dept}-${f.type}-${f.sheetRow}-${i}`}
                  className="border-b border-[var(--line-soft)] py-[var(--space-3)] last:border-b-0"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="ds-text-sm font-[var(--weight-medium)] text-[var(--ink-strong)]">
                      {f.title}
                    </span>
                    <span className="ds-text-3xs text-[var(--ink-muted)]">{f.urgency}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 ds-text-3xs text-[var(--ink-faint)]">
                    <span>{f.deptName}</span>
                    {f.subordinate && <span>· {f.subordinate}</span>}
                    <span>· {LEVEL_LABEL[f.level]}</span>
                    <RowLink dept={f.dept} sheetRow={f.sheetRow} rowSeq={f.rowSeq} subject={f.subject} />
                  </div>
                  {f.subject && <p className="mt-1 ds-text-xs text-[var(--ink)]">{f.subject}</p>}
                  <p className="ds-prose mt-1 ds-text-xs text-[var(--ink-muted)]">{f.why}</p>
                  {f.members.length > 0 && (
                    <p className="mt-1 ds-text-3xs text-[var(--ink-faint)]">
                      Задетые строки: {f.members.join(', ')}
                      {f.rows > f.members.length && ` и ещё ${f.rows - f.members.length}`}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            {items.length > SHOWN_AT_ONCE && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-[var(--space-2)] ds-text-xs font-[var(--weight-medium)] text-[var(--accent)] hover:underline"
              >
                {expanded ? 'Свернуть' : `Показать остальные ${items.length - SHOWN_AT_ONCE}`}
              </button>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

/** Свёртка по типам: один род — одна строка со счётом и первыми адресами. */
function NoiseBlock({ items }: { items: NoiseGroupDto[] }) {
  if (items.length === 0) return null;
  return (
    <Card bare aria-label="Свёртка находок по типам">
      <div className="px-[var(--card-pad)] pt-[var(--card-pad)]">
        <h3 className="ds-text-sm font-[var(--weight-strong)] text-[var(--ink-strong)]">
          Свёртка по типам
        </h3>
        <p className="ds-prose mt-0.5 ds-text-xs text-[var(--ink-muted)]">
          Тот же материал, свёрнутый в один ряд на род: сколько строк за каждым и какие
          первые. Полный построчный разбор тех же признаков живёт в Реестре — здесь ответ на
          вопрос «чего в книге больше всего».
        </p>
      </div>
      <div className="overflow-x-auto px-[var(--card-pad)] pb-[var(--card-pad)]">
        <table className="mt-[var(--space-2)] w-full ds-text-xs">
          <caption className="sr-only">
            Роды находок по книгам: сколько строк за каждым и адреса первых
          </caption>
          <thead>
            <tr className="border-b border-[var(--line-soft)] text-left ds-text-3xs uppercase text-[var(--ink-faint)]">
              <th scope="col" className="py-1.5 pr-3">Род</th>
              <th scope="col" className="py-1.5 pr-3">Книга</th>
              <th scope="col" className="py-1.5 pr-3 text-right">Строк</th>
              <th scope="col" className="py-1.5">Первые адреса</th>
            </tr>
          </thead>
          <tbody>
            {items.map((g) => (
              <tr key={g.key} className="border-b border-[var(--line-soft)] align-top last:border-b-0">
                <td className="py-2 pr-3 font-[var(--weight-medium)] text-[var(--ink-strong)]">
                  {g.label}
                  <span className="mt-0.5 block font-normal ds-text-3xs text-[var(--ink-faint)]">
                    {g.urgency}
                  </span>
                </td>
                <td className="py-2 pr-3 text-[var(--ink-muted)]">{g.deptName}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-[var(--ink-muted)]">{g.count}</td>
                <td className="py-2 font-mono ds-text-3xs text-[var(--ink-faint)]">
                  {g.members.join(', ') || 'адресов снимок не сохранил'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function AnomalySignsSection() {
  const { data, loading, error, reload } = useAnomalies();
  const selectedDepartments = useStore((s) => s.selectedDepartments);
  const deptScope = useMemo(() => deptScopeOf(selectedDepartments), [selectedDepartments]);
  const orgScope = useOrgScope();

  const typo = useMemo(
    () => filterByDeptScope(data?.typo ?? [], deptScope, (f) => f.dept),
    [data, deptScope],
  );
  const fitted = useMemo(
    () => filterByDeptScope(data?.fitted ?? [], deptScope, (f) => f.dept),
    [data, deptScope],
  );
  const dataset = useMemo(
    () => filterByDeptScope(data?.dataset ?? [], deptScope, (f) => f.dept),
    [data, deptScope],
  );
  const noise = useMemo(
    () => filterByDeptScope(data?.noise ?? [], deptScope, (g) => g.dept),
    [data, deptScope],
  );
  const booksSilent = useMemo(
    () => filterByDeptScope(data?.booksSilent ?? [], deptScope, (d) => d),
    [data, deptScope],
  );
  const journalsSilent = useMemo(
    () => filterByDeptScope(data?.journalsSilent ?? [], deptScope, (d) => d),
    [data, deptScope],
  );

  /** Деньги под риском считаются по показанному, а не берутся итогом района. */
  const amount = useMemo(() => ({
    typo: typo.reduce((s, f) => s + f.amountAtRisk, 0),
    fitted: fitted.reduce((s, f) => s + f.amountAtRisk, 0),
  }), [typo, fitted]);

  /**
   * Разбивка по учреждениям в режиме «с подведомственными». Канонический
   * список организаций управления берётся из скоупа: учреждение без находок
   * остаётся в разбивке с честным «находок нет» — «строк нет» и «организации
   * нет» обязаны различаться.
   */
  const groupsOf = useCallback(
    (items: AnomalySignDto[]): Array<{ label: string; items: AnomalySignDto[] }> | null => {
      if (orgScope.mode !== 'withSubs' || !orgScope.hasSubs) return null;
      const known = orgScope.subordinates.map((g) => g.label);
      const buckets = new Map<string, AnomalySignDto[]>(known.map((label) => [label, []]));
      for (const item of items) {
        const label = item.subordinate || 'Аппарат управления';
        const bucket = buckets.get(label);
        if (bucket) bucket.push(item);
        else buckets.set(label, [item]);
      }
      return [...buckets.entries()].map(([label, list]) => ({ label, items: list }));
    },
    [orgScope],
  );

  /** Ответ режима подведов словами — три режима, три разные новости. */
  const orgNote = useMemo(() => {
    if (orgScope.mode === 'district') return null;
    if (orgScope.mode === 'grbs') {
      return 'Включён режим «только ГРБС»: разбивка находок по учреждениям скрыта. Верните '
        + '«с подведомственными» в фильтре организаций, чтобы увидеть, чьи это строки.';
    }
    if (!orgScope.hasSubs) {
      return 'У этого управления подведомственных учреждений нет: все закупки ведёт аппарат '
        + 'управления, и разбивать находки не на что.';
    }
    return null;
  }, [orgScope]);

  const nothingFound = typo.length === 0 && fitted.length === 0 && dataset.length === 0;

  return (
    <section aria-label="Признаки странностей в строках" className="space-y-[var(--space-4)]">
      <div className="flex flex-wrap items-start justify-between gap-[var(--space-4)]">
        <div className="min-w-0">
          <KBTooltip {...ANOMALY_SIGNS_KB} showIcon>
            <h2 className="ds-text-lg font-[var(--weight-strong)] text-[var(--ink-strong)]">
              Признаки странностей в строках
            </h2>
          </KBTooltip>
          <p className="ds-prose mt-0.5 ds-text-xs text-[var(--ink-muted)]">
            Каждая находка называет строку книги, что в ней и почему сработало. Признак —
            повод открыть строку и сверить её с документом, а не вывод о нарушении;
            отсутствие признаков не означает, что данные верны.
          </p>
        </div>
        {data && (
          <div className="flex shrink-0 flex-col items-end gap-1">
            <div className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] bg-[var(--surface-raised)] px-2 py-0.5 ds-text-3xs font-[var(--weight-medium)] text-[var(--ink-muted)]">
              <Clock size={10} aria-hidden="true" />
              <span className="tabular-nums">прочитано {fmtMoment(data.asOf)}</span>
            </div>
            <span
              className="max-w-[16rem] text-right ds-text-3xs leading-tight text-[var(--ink-faint)]"
              title="Детектор сравнивает строку с её соседями по всей книге — сузить это кварталом нечем. Выбранное управление срез сужает (канон п.127)."
            >
              строки читаются книгой целиком, период в шапке их не сужает
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
              Признаки не прочитаны: {error}
              {data && ' Ниже — находки предыдущего чтения; момент указан в плашке.'}
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
        <p className="flex items-start gap-1.5 ds-text-xs text-[var(--ink-muted)]">
          <Building2 size={12} className="mt-px shrink-0 text-[var(--ink-faint)]" aria-hidden="true" />
          <span>{orgNote}</span>
        </p>
      )}

      {loading && !data ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">Читаем строки книг и журналы правок</span>
          <SkeletonCard />
        </div>
      ) : !data ? (
        !error && (
          <EmptyState
            tone="problem"
            title="Признаки не посчитаны"
            description="Сервер не отдал ни одной книги: смотреть на строки не из чего."
            action={{ label: 'Прочитать ещё раз', onClick: reload }}
          />
        )
      ) : nothingFound && deptScope !== null && data.typo.length + data.fitted.length > 0 ? (
        <EmptyState
          title="По выбранным управлениям признаков нет"
          description={
            'В книгах района признаки есть, но ни один из них не относится к выбранным '
            + 'управлениям. Снимите отбор управления в шапке — и разбор вернётся целиком.'
          }
        />
      ) : (
        <div className="space-y-[var(--space-4)]">
          <div className="flex items-center gap-1.5 ds-text-3xs text-[var(--ink-faint)]">
            <Microscope size={12} aria-hidden="true" />
            <span>
              просмотрено строк: {data.rowsScanned.toLocaleString('ru-RU')}
              {data.booksRead.length > 0 && ` в ${data.booksRead.length} ${pluralRu(data.booksRead.length, 'книге', 'книгах', 'книгах')}`}
            </span>
          </div>

          <ScaleBlock scale="typo" items={typo} amount={amount.typo} groups={groupsOf(typo)} />
          <ScaleBlock scale="fitted" items={fitted} amount={amount.fitted} groups={groupsOf(fitted)} />
          <DatasetBlock items={dataset} available={data.datasetAvailable} />
          <NoiseBlock items={noise} />

          {(booksSilent.length > 0 || journalsSilent.length > 0) && (
            <div className="rounded-[var(--radius-card)] bg-[var(--surface-raised)] px-4 py-3 ds-text-xs text-[var(--ink-muted)]">
              {booksSilent.length > 0 && (
                <p>
                  Строки не прочитаны: {booksSilent.join(', ')}. По этим книгам признаков нет
                  потому, что смотреть было нечего, — это не «странностей не найдено».
                </p>
              )}
              {journalsSilent.length > 0 && (
                <p className={booksSilent.length > 0 ? 'mt-1' : undefined}>
                  Журнал правок не прочитан: {journalsSilent.join(', ')}. Признаки «правка в
                  кратное десяти число раз» и «правка плана после факта» по этим книгам не
                  проверялись.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
