/**
 * UpcomingSection — «Близкие к плановой дате» (канон п.75б): строки без
 * заключения, чья плановая дата наступает в ближайшие 14 дней ЛИБО уже прошла.
 * Просроченные — сверху, по глубине просрочки (сортировку даёт сервер).
 *
 * Периметр карточки СОБСТВЕННЫЙ и объявлен данными (канон п.58): окно всегда
 * отсчитывается от сегодняшнего дня календаря продукта, выбранный в шапке
 * период на список не влияет — при суженном периоде об этом сказано вслух.
 * Фильтр управлений — глобальный: применяется к списку на месте.
 *
 * Клик по строке открывает её полную карточку (RowDetailCard): строка
 * дочитывается из книги управления тем же путём, что в Реестре.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, CalendarClock, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { productLabel } from '@aemr/shared';
import type { UpcomingRiskRow } from '@aemr/core';
import { api, humanizeRequestError, type UpcomingResponse } from '../../api';
import { useStore } from '../../store';
import { toCanonicalDeptId } from '../../lib/dept-key';
import { useOrgScope } from '../../lib/selectors/org-scope';
import { subordinateLabel, ORG_ITSELF_LABEL } from '../../lib/subordinate-label';
import { pluralRu } from '../../lib/economy-copy';
import { collectAllPages } from '../../lib/rows/collect-pages';
import { EmptyState } from '../EmptyState';
import { SkeletonCard } from '../Skeleton';
import { RowDetailCard, type RowDetailRow } from '../RowDetailCard';
import { KBTooltip } from '../ui/kb-tooltip';
import { GROUP3_KB_ADDITIONS, kbCardProps } from '../../pages/kb-additions';
import { daysPhrase, formatDateRu } from './timeline-view';

/** Окно «близких» — канонические 14 дней (п.75б, дефолт сервера). */
const UPCOMING_DAYS = 14;
/** Сколько строк видно без раскрытия: горящее — сверху, остальное — по кнопке. */
const COLLAPSED_LIMIT = 12;

/** Чип «сколько дней до/после плановой даты» — тон по остроте. */
function DaysChip({ daysToPlan }: { daysToPlan: number }) {
  return (
    <span
      className={clsx(
        'shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold tabular-nums whitespace-nowrap',
        daysToPlan < 0
          ? 'bg-[var(--surface-raised)] text-[var(--data-bad)]'
          : daysToPlan === 0
            ? 'bg-[var(--surface-raised)] text-[var(--data-warn)]'
            : 'bg-[var(--surface-raised)] text-[var(--ink-muted)]',
      )}
    >
      {daysPhrase(daysToPlan)}
    </span>
  );
}

/** Одна строка списка: дни · предмет · контекст · бейджи причин и процедуры. */
function UpcomingItem({
  row,
  opening,
  formatMoney,
  onOpen,
}: {
  row: UpcomingRiskRow;
  opening: boolean;
  formatMoney: (n: number) => string;
  onOpen: (row: UpcomingRiskRow) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(row)}
        title="Открыть карточку строки"
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-[var(--surface-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
      >
        <DaysChip daysToPlan={row.daysToPlan} />
        <span className="flex-1 min-w-0">
          <span className="block truncate text-xs font-medium text-[var(--ink)]">
            {row.subject || 'Предмет закупки не указан'}
          </span>
          <span className="block truncate text-[10px] text-[var(--ink-muted)]">
            {productLabel(toCanonicalDeptId(row.dept))} · строка {row.sheetRow} · план{' '}
            <span className="tabular-nums">{row.plannedDate ? formatDateRu(row.plannedDate) : '—'}</span>
            {row.planSum > 0 && <> · {formatMoney(row.planSum)}</>}
            {row.method && <> · {row.method}</>}
          </span>
        </span>
        <span className="shrink-0 flex items-center gap-1.5">
          {row.hasLiveReason && row.reason && (
            <span
              className="rounded bg-[var(--surface-raised)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--accent)]"
              title={`Живая причина по словарю (ячейка ${row.reason.cell}): ${row.reason.canon}`}
            >
              живая причина
            </span>
          )}
          {row.procedureCode && (
            <span
              className="rounded bg-[var(--surface-raised)] px-1.5 py-0.5 text-[9px] font-medium tabular-nums text-[var(--ink-muted)]"
              title={row.monitoringStage
                ? `Процедура ${row.procedureCode} · стадия в мониторинге: ${row.monitoringStage}`
                : `Номер процедуры из книги: ${row.procedureCode}`}
            >
              {row.procedureCode}
            </span>
          )}
          {row.monitoringStage && (
            <span className="rounded bg-[var(--surface-raised)] px-1.5 py-0.5 text-[9px] font-medium text-[var(--data-good)]">
              {row.monitoringStage}
            </span>
          )}
          {opening
            ? <Loader2 size={13} className="animate-spin text-[var(--ink-faint)]" aria-hidden="true" />
            : <ChevronRight size={13} className="text-[var(--ink-faint)]" aria-hidden="true" />}
        </span>
      </button>
    </li>
  );
}

/** Одна пачка списка: организация управления и её строки (может быть пустой). */
interface OrgBucket {
  key: string;
  label: string;
  rows: UpcomingRiskRow[];
}

export function UpcomingSection() {
  const selectedDepartments = useStore((s) => s.selectedDepartments);
  const formatMoney = useStore((s) => s.formatMoney);
  const navigateTo = useStore((s) => s.navigateTo);
  const period = useStore((s) => s.period);
  const activeMonths = useStore((s) => s.activeMonths);
  const periodMode = useStore((s) => s.periodMode);

  const [data, setData] = useState<UpcomingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  // Открытие карточки строки: книга дочитывается тем же путём, что в Реестре.
  const rowsCache = useRef(new Map<string, Record<string, unknown>[]>());
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const [openedRow, setOpenedRow] = useState<Record<string, unknown> | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.getTimelineUpcoming(UPCOMING_DAYS)
      .then(setData)
      .catch((err: unknown) => setError(humanizeRequestError(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Глобальный фильтр управлений применяется на месте (сервер отдаёт все книги).
  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    if (selectedDepartments.size === 0) return all;
    const canonSelected = new Set([...selectedDepartments].map(toCanonicalDeptId));
    return all.filter((r) => canonSelected.has(toCanonicalDeptId(r.dept)));
  }, [data, selectedDepartments]);

  const overdueCount = useMemo(() => rows.filter((r) => r.overdue).length, [rows]);
  const soonCount = rows.length - overdueCount;
  const visible = expanded ? rows : rows.slice(0, COLLAPSED_LIMIT);

  /**
   * Режим организаций (приказ владельца 20.08). Список приходит с сервера
   * БЕЗ колонки учреждения, поэтому в режиме «с подведомственными» книга
   * выбранного управления дочитывается один раз — тем же путём, что для
   * карточки строки, — и даёт соответствие «строка книги → учреждение».
   * Второго дома чтения книг здесь не заводится: используется тот же кэш.
   */
  const orgScope = useOrgScope();
  const [orgByRow, setOrgByRow] = useState<Map<number, string> | null>(null);
  const [orgState, setOrgState] = useState<'idle' | 'loading' | 'error'>('idle');

  useEffect(() => {
    if (orgScope.mode !== 'withSubs' || !orgScope.dept || rows.length === 0) {
      setOrgByRow(null);
      setOrgState('idle');
      return;
    }
    const dept = orgScope.dept;
    let alive = true;
    setOrgState('loading');
    const readBook = async () => {
      let deptRows = rowsCache.current.get(dept);
      if (!deptRows) {
        deptRows = await collectAllPages<Record<string, unknown>>((page) =>
          api.getRows(dept, { limit: '1000', ...(page > 1 ? { page: String(page) } : {}) }));
        if (deptRows.length > 0) rowsCache.current.set(dept, deptRows);
      }
      return deptRows;
    };
    readBook()
      .then((deptRows) => {
        if (!alive) return;
        if (deptRows.length === 0) { setOrgState('error'); setOrgByRow(null); return; }
        const map = new Map<number, string>();
        for (const r of deptRows) {
          const idx = Number(r.rowIndex);
          if (!Number.isFinite(idx)) continue;
          const raw = typeof r.subordinate === 'string' ? r.subordinate.trim() : '';
          map.set(idx, raw || ORG_ITSELF_LABEL);
        }
        setOrgByRow(map);
        setOrgState('idle');
      })
      .catch(() => { if (alive) { setOrgState('error'); setOrgByRow(null); } });
    return () => { alive = false; };
  }, [orgScope.mode, orgScope.dept, rows.length]);

  /**
   * Разбивка видимых строк по организациям. Присутствие организации задаёт
   * канон фильтра: учреждение без единой близкой строки остаётся в списке с
   * честным «строк нет» — «нет строк» и «нет организации» обязаны звучать
   * по-разному.
   */
  const orgBuckets: OrgBucket[] | null = useMemo(() => {
    if (orgScope.mode !== 'withSubs' || orgByRow === null) return null;
    const buckets = new Map<string, UpcomingRiskRow[]>();
    for (const group of orgScope.subordinates) buckets.set(group.label, []);
    for (const row of visible) {
      const label = orgByRow.get(row.sheetRow) ?? ORG_ITSELF_LABEL;
      const bucket = buckets.get(label) ?? buckets.get(subordinateLabel(label));
      if (bucket) bucket.push(row);
      else buckets.set(label, [row]);
    }
    return [...buckets.entries()].map(([label, bucketRows]) => ({ key: label, label, rows: bucketRows }));
  }, [orgScope.mode, orgScope.subordinates, orgByRow, visible]);

  const scopeLabel = selectedDepartments.size === 0
    ? 'все управления'
    : [...selectedDepartments].map((d) => productLabel(toCanonicalDeptId(d))).join(', ');

  // Периметр шапки сужен (квартал/месяцы/неделя) — этот список ему не
  // подчиняется по построению: об этом говорится вслух (канон п.58б).
  const headerPeriodNarrowed =
    periodMode === 'week'
    || (periodMode === 'explicit' && (period !== 'year' || activeMonths.size > 0));

  const openRowCard = useCallback(async (row: UpcomingRiskRow) => {
    const canonDept = toCanonicalDeptId(row.dept);
    setOpenError(null);
    setOpeningKey(row.rowKey);
    try {
      let deptRows = rowsCache.current.get(canonDept);
      if (!deptRows) {
        // Без фильтра года: периметр «близких» — от сегодняшней даты, не от года шапки.
        deptRows = await collectAllPages<Record<string, unknown>>((page) =>
          api.getRows(canonDept, { limit: '1000', ...(page > 1 ? { page: String(page) } : {}) }));
        // Пустой ответ первой страницы — отказ чтения книги, кэшировать нечего.
        if (deptRows.length > 0) rowsCache.current.set(canonDept, deptRows);
      }
      const found = deptRows.find((r) => Number(r.rowIndex) === row.sheetRow);
      if (found) {
        setOpenedRow({ ...found, dept: found.dept || canonDept });
      } else if (deptRows.length === 0) {
        setOpenError(
          `Книга «${productLabel(canonDept)}» не прочиталась: сервер не отдал её строки. Повторите попытку или откройте Реестр.`,
        );
      } else {
        setOpenError(
          `Строка ${row.sheetRow} книги «${productLabel(canonDept)}» не нашлась в текущем чтении книги — возможно, книгу только что правили. Обновите список или откройте Реестр.`,
        );
      }
    } catch (err) {
      setOpenError(humanizeRequestError(err));
    } finally {
      setOpeningKey(null);
    }
  }, []);

  return (
    <section
      aria-label="Близкие к плановой дате"
      className="rounded-xl border border-[var(--line-soft)] bg-[var(--surface-card)] p-5 shadow-sm"
    >
      {/* ── Шапка: заголовок + собственная подпись периметра (канон п.58а) ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          {/* Карточка БЗ секции (п.91-2): окно, периметр «от сегодня», действия. */}
          <KBTooltip {...kbCardProps(GROUP3_KB_ADDITIONS.upcoming_window)} showIcon>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--ink-strong)]">
              <CalendarClock size={15} className="text-[var(--ink-muted)]" aria-hidden="true" />
              Близкие к плановой дате
            </h2>
          </KBTooltip>
          <p className="mt-0.5 max-w-2xl text-[11px] text-[var(--ink-muted)]">
            Незаключённые строки, чья плановая дата уже прошла или наступает в ближайшие{' '}
            {UPCOMING_DAYS} дней. Просроченные — сверху, по глубине просрочки.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <div
            className="flex items-center gap-1 rounded-full bg-[var(--surface-raised)] px-2 py-0.5 text-[10px] font-medium text-[var(--ink-muted)]"
            title={`Окно отсчитывается от сегодняшнего дня календаря продукта${data ? ` (${formatDateRu(data.asOf)})` : ''}: просроченные без ограничения глубины плюс ${UPCOMING_DAYS} дней вперёд. Числа — на текущий момент.`}
          >
            <Calendar size={10} aria-hidden="true" />
            <span className="tabular-nums">
              {data ? `на ${formatDateRu(data.asOf)}` : 'на сегодня'} · окно {UPCOMING_DAYS} дн. · {scopeLabel}
            </span>
          </div>
          {headerPeriodNarrowed && (
            <span className="max-w-[15rem] text-right text-[9px] leading-tight text-[var(--data-warn)]">
              выбранный в шапке период на этот список не влияет: окно всегда от сегодняшней даты
            </span>
          )}
        </div>
      </div>

      {/* ── Содержимое ── */}
      <div className="mt-4">
        {loading ? (
          <div role="status" aria-live="polite">
            <span className="sr-only">Собираем строки, близкие к плановой дате</span>
            <SkeletonCard />
          </div>
        ) : error ? (
          <EmptyState
            tone="problem"
            title="Список близких к плановой дате не загрузился"
            description="Сервер не отдал строки с плановыми датами — без них раздел пуст не по-настоящему."
            detail={error}
            action={{ label: 'Запросить ещё раз', onClick: load }}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title="Близких к плановой дате нет"
            description={`Среди незаключённых строк (${scopeLabel}) нет ни просроченных, ни строк с плановой датой в ближайшие ${UPCOMING_DAYS} дней. Строки без распознанной плановой даты сюда не попадают — их видно в Реестре.`}
            action={{ label: 'Открыть Реестр', onClick: () => navigateTo('data') }}
          />
        ) : (
          <>
            {/* Счётчики остроты: сколько горит, сколько на подходе. */}
            <p className="mb-2 text-[11px] tabular-nums text-[var(--ink-muted)]">
              {overdueCount > 0 && (
                <span className="font-semibold text-[var(--data-bad)]">
                  {overdueCount} {pluralRu(overdueCount, 'просроченная', 'просроченные', 'просроченных')}
                </span>
              )}
              {overdueCount > 0 && soonCount > 0 && ' · '}
              {soonCount > 0 && (
                <span>{soonCount} {pluralRu(soonCount, 'строка на подходе', 'строки на подходе', 'строк на подходе')}</span>
              )}
            </p>

            {openError && (
              <div className="mb-2 rounded-lg bg-[var(--surface-raised)] px-3 py-2 text-[11px] text-[var(--data-warn)]">
                {openError}{' '}
                <button type="button" onClick={() => navigateTo('data')} className="font-medium hover:underline">
                  Открыть Реестр
                </button>
              </div>
            )}

            {/* Оговорка режима организаций: три режима — три разные новости. */}
            {orgScope.mode === 'grbs' && orgScope.hasSubs && (
              <p className="mb-2 text-[11px] text-[var(--ink-faint)]">
                Разбивка по учреждениям скрыта: включён режим «только ГРБС».
              </p>
            )}
            {orgScope.mode === 'withSubs' && !orgScope.hasSubs && (
              <p className="mb-2 text-[11px] text-[var(--ink-faint)]">
                У этого управления подведомственных учреждений нет — список идёт одной лентой.
              </p>
            )}
            {orgScope.mode === 'withSubs' && orgScope.hasSubs && orgState === 'loading' && (
              <p className="mb-2 text-[11px] text-[var(--ink-faint)]" role="status" aria-live="polite">
                Раскладываем строки по учреждениям: дочитываем книгу управления…
              </p>
            )}
            {orgScope.mode === 'withSubs' && orgState === 'error' && (
              <p className="mb-2 text-[11px] text-[var(--data-warn)]">
                Книга управления не прочиталась — разбивка по учреждениям не построена, список идёт одной лентой.
              </p>
            )}

            {orgBuckets ? (
              <div className="space-y-3">
                {orgBuckets.map((bucket) => (
                  <section key={bucket.key} aria-label={bucket.label}>
                    <h3 className="mb-1 flex items-baseline gap-2 text-[11px] font-semibold text-[var(--ink)]">
                      {bucket.label}
                      <span className="text-[10px] font-normal tabular-nums text-[var(--ink-faint)]">
                        {bucket.rows.length > 0
                          ? `${bucket.rows.length} ${pluralRu(bucket.rows.length, 'строка', 'строки', 'строк')}`
                          : 'близких к плановой дате строк нет'}
                      </span>
                    </h3>
                    {bucket.rows.length > 0 && (
                      <ol className="divide-y divide-[var(--line-soft)]">
                        {bucket.rows.map((row) => (
                          <UpcomingItem
                            key={row.rowKey}
                            row={row}
                            opening={openingKey === row.rowKey}
                            formatMoney={formatMoney}
                            onOpen={openRowCard}
                          />
                        ))}
                      </ol>
                    )}
                  </section>
                ))}
              </div>
            ) : (
              <ol className="divide-y divide-[var(--line-soft)]">
                {visible.map((row) => (
                  <UpcomingItem
                    key={row.rowKey}
                    row={row}
                    opening={openingKey === row.rowKey}
                    formatMoney={formatMoney}
                    onOpen={openRowCard}
                  />
                ))}
              </ol>
            )}

            {rows.length > COLLAPSED_LIMIT && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-[var(--ink-muted)] transition hover:text-[var(--ink-strong)]"
              >
                <ChevronDown
                  size={12}
                  aria-hidden="true"
                  className={clsx('transition-transform', expanded && 'rotate-180')}
                />
                {expanded ? 'Свернуть список' : `Показать все ${rows.length}`}
              </button>
            )}

            {data && !data.monitoringLinked && (
              <p className="mt-3 border-t border-[var(--line-soft)] pt-2 text-[10px] text-[var(--ink-muted)]">
                Стадии процедур появятся после подключения вкладки «Ежедневный мониторинг» —
                связки по номерам процедур пока нет, поэтому они не показываются.
              </p>
            )}
          </>
        )}
      </div>

      {openedRow && (
        <RowDetailCard row={openedRow as RowDetailRow} onClose={() => setOpenedRow(null)} />
      )}
    </section>
  );
}
