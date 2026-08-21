import { useState, useEffect, useMemo, useCallback } from 'react';
import { productLabel } from '@aemr/shared';
import { useStore } from '../store';
import { api, humanizeRequestError } from '../api';
import { journalPeriodRange } from '../lib/selectors/journal-period';
import {
  JOURNAL_FILTERABLE_TYPES,
  formatEventTime,
  humanizeJournalDetails,
  journalActorLabel,
  type JournalFilterableType,
} from '../lib/selectors/journal-display';
import { pluralRu } from '../lib/economy-copy';
import { BookOpen, Search, Filter, Inbox, Database, FileEdit, AlertTriangle, Settings, RefreshCw, ChevronLeft, ChevronRight, Loader2, CalendarRange, Info, RotateCcw, CircleSlash } from 'lucide-react';
import clsx from 'clsx';

interface JournalEntry {
  id: string;
  type: string;
  timestamp: string;
  actor: string;
  action: string;
  details: string;
  dept?: string;
}

interface TypeStyle {
  label: string;
  bg: string;
  text: string;
  icon: typeof Database;
}

/**
 * Оформление типа события.
 *
 * Подписи разведены по смыслу: «Замечание найдено» и «Статус замечания» —
 * разные события, а печатались оба как «Замечание», и два чипа фильтра выглядели
 * одинаково. Ключи здесь ровно те, что производит сервер (см.
 * journal-display.ts): типов-призраков, дававших вечно пустой список, больше нет.
 */
const TYPE_CONFIG: Record<string, TypeStyle> = {
  import: { label: 'Импорт', bg: 'bg-blue-50 dark:bg-blue-950/30', text: 'text-blue-700 dark:text-blue-400', icon: Database },
  edit: { label: 'Правка', bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-400', icon: FileEdit },
  issue_create: { label: 'Замечание найдено', bg: 'bg-amber-50 dark:bg-amber-950/30', text: 'text-amber-700 dark:text-amber-400', icon: AlertTriangle },
  issue_status: { label: 'Статус замечания', bg: 'bg-orange-50 dark:bg-orange-950/30', text: 'text-orange-700 dark:text-orange-400', icon: RefreshCw },
  normalize: { label: 'Нормализация', bg: 'bg-zinc-50 dark:bg-zinc-700/50', text: 'text-zinc-600 dark:text-zinc-400', icon: Settings },
  input_error: { label: 'Ошибка ввода', bg: 'bg-red-50 dark:bg-red-950/30', text: 'text-red-700 dark:text-red-400', icon: AlertTriangle },
  mapping_change: { label: 'Привязка данных', bg: 'bg-indigo-50 dark:bg-indigo-950/30', text: 'text-indigo-700 dark:text-indigo-400', icon: Settings },
};

/**
 * Тип события, которого нет в списке выше. Сервер кладёт в тип содержимое
 * колонки действия аудит-лога — там может оказаться что угодно. Раньше такая
 * запись роняла страницу (обращение к полю несуществующей настройки); теперь
 * она честно называется незнакомой и показывает сырой ключ мелким шрифтом.
 */
function typeStyle(type: string): TypeStyle {
  return TYPE_CONFIG[type] ?? {
    label: `Другое событие (${type})`,
    bg: 'bg-zinc-50 dark:bg-zinc-700/50',
    text: 'text-zinc-600 dark:text-zinc-400',
    icon: CircleSlash,
  };
}

const PAGE_SIZE = 10;
/** Сколько номеров страниц показываем вокруг текущей: 200 кнопок подряд нечитаемы. */
const PAGE_WINDOW = 7;

function eventsWord(n: number): string {
  return pluralRu(n, 'событие', 'события', 'событий');
}

/** Номера страниц вокруг текущей — окно, а не весь диапазон. */
function pageWindow(current: number, total: number): number[] {
  if (total <= PAGE_WINDOW) return Array.from({ length: total }, (_, i) => i + 1);
  const half = Math.floor(PAGE_WINDOW / 2);
  const start = Math.min(Math.max(1, current - half), total - PAGE_WINDOW + 1);
  return Array.from({ length: PAGE_WINDOW }, (_, i) => start + i);
}

export function JournalPage() {
  const { selectedDepartments, year, period, activeMonths } = useStore();
  const [search, setSearch] = useState('');
  /**
   * Тип события — ОДИН на запрос. `/api/journal` принимает единственный
   * параметр `action`; прежний множественный выбор подсвечивал несколько чипов,
   * а на сервер уходил только первый — фильтр показывал одно, делал другое.
   */
  const [typeFilter, setTypeFilter] = useState<JournalFilterableType | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [totalFromApi, setTotalFromApi] = useState(0);
  const [countsByAction, setCountsByAction] = useState<Record<string, number>>({});
  const [reloadToken, setReloadToken] = useState(0);

  // Глобальная ось времени → интервал дат события (см. journal-period.ts).
  const periodRange = useMemo(
    () => journalPeriodRange({ year, period, activeMonths }),
    [year, period, activeMonths],
  );
  const { from: periodFrom, to: periodTo } = periodRange;

  // Смена периода меняет весь набор записей: остаться на пятой странице
  // прежней выдачи значит показать пустой экран вместо первых событий.
  // Сброс на рендере, а не в эффекте: иначе успевает уйти лишний запрос
  // за несуществующей страницей нового периода.
  const rangeKey = `${periodFrom ?? ''}|${periodTo ?? ''}`;
  const [appliedRangeKey, setAppliedRangeKey] = useState(rangeKey);
  if (appliedRangeKey !== rangeKey) {
    setAppliedRangeKey(rangeKey);
    setCurrentPage(1);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params: Record<string, string> = {
      page: String(currentPage),
      limit: String(PAGE_SIZE),
    };
    if (search) params.search = search;
    if (typeFilter) params.action = typeFilter;
    // Б6: сервер понимает deptId (раньше слали неизвестный ему `dept` — фильтр был no-op)
    if (selectedDepartments.size > 0) params.deptId = [...selectedDepartments].join(',');
    // Период применяется к дате СОБЫТИЯ — единственной дате, которая у записи
    // журнала есть. Раньше барабан периода крутился вхолостую (§3 п.3 плана).
    if (periodFrom) params.from = periodFrom;
    if (periodTo) params.to = periodTo;

    api.getJournal(params).then((data: any) => {
      if (cancelled) return;
      const entries = (data.entries ?? []).map((e: any) => ({
        id: e.id,
        type: e.type ?? 'edit',
        timestamp: e.timestamp ?? '',
        actor: e.actor ?? '',
        action: e.action ?? '',
        details: e.details ?? '',
        dept: e.departmentId ?? undefined,
      }));
      setJournalEntries(entries);
      setTotalFromApi(data.pagination?.total ?? entries.length);
      setCountsByAction(data.counts?.byAction ?? {});
      setLoadError(null);
    }).catch((err: unknown) => {
      // Молчаливый провал показывал «Журнал событий пока пуст» — то есть выдавал
      // недоступность журнала за отсутствие событий. Это разные новости.
      if (!cancelled) {
        setJournalEntries([]);
        setCountsByAction({});
        setTotalFromApi(0);
        setLoadError(humanizeRequestError(err));
      }
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [currentPage, search, typeFilter, selectedDepartments, periodFrom, periodTo, reloadToken]);

  const selectType = useCallback((t: JournalFilterableType) => {
    setTypeFilter(prev => (prev === t ? null : t));
    setCurrentPage(1);
  }, []);

  // Data is already filtered/paginated by API
  const totalPages = Math.ceil(totalFromApi / PAGE_SIZE);
  const pageItems = journalEntries;

  // Счётчики берутся из серверного `counts.byAction` — итоги по ВСЕЙ выборке
  // текущих фильтров. Прежние считались по десяти строкам открытой страницы и
  // стояли рядом с «Всего событий», то есть читались как итоги, не будучи ими.
  const inputErrorCount = countsByAction.input_error ?? 0;
  const importCount = countsByAction.import ?? 0;

  const hasPageFilter = search.trim() !== '' || typeFilter !== null;

  return (
    <div className="space-y-6">
      {/*
        Итоги — по ВСЕЙ выборке текущих фильтров, а не по открытой странице
        (серверный `counts.byAction`). Это сказано вслух: три числа стоят рядом
        с постраничным списком, и без оговорки их читают как счёт по странице.
      */}
      <div className="text-xs bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-transparent px-5 py-3">
        <div className="flex flex-wrap gap-6">
          <div className="flex items-center gap-2">
            <BookOpen size={14} className="text-blue-500" aria-hidden="true" />
            <span className="text-zinc-500 dark:text-zinc-400">
              Всего событий: <strong className="text-zinc-700 dark:text-zinc-200 tabular-nums">{totalFromApi}</strong>
            </span>
          </div>
          <span className="text-zinc-500 dark:text-zinc-400">Ошибок ввода: <strong className="text-red-600 dark:text-red-400 tabular-nums">{inputErrorCount}</strong></span>
          <span className="text-zinc-500 dark:text-zinc-400">Импортов: <strong className="text-blue-600 dark:text-blue-400 tabular-nums">{importCount}</strong></span>
        </div>
        <p className="mt-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
          Числа посчитаны по всей выборке текущих фильтров, а не по открытой странице списка.
        </p>
      </div>

      {/* Что делает глобальная ось на этой вкладке — и чего она здесь не делает */}
      <div className="flex flex-wrap items-start gap-x-6 gap-y-2 text-xs bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-transparent px-5 py-3">
        <span className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300">
          <CalendarRange size={14} className="text-zinc-400" aria-hidden="true" />
          Период применён к дате события:{' '}
          <strong className="text-zinc-700 dark:text-zinc-200">{periodRange.rangeLabel ?? 'без ограничения'}</strong>
        </span>
        {periodRange.widened && (
          <span className="text-amber-600 dark:text-amber-400">
            Выбраны несмежные месяцы — журнал режется одним общим интервалом, поэтому в списке есть события промежуточных месяцев.
          </span>
        )}
        <span className="flex items-start gap-2 text-zinc-500 dark:text-zinc-400 basis-full">
          <Info size={14} className="text-zinc-400 mt-px shrink-0" aria-hidden="true" />
          <span>
            Из шапки здесь работают управление и период. Способ закупки, вид деятельности и подведомственная
            организация не применяются: у события нет ни того, ни другого, ни третьего — есть только время, автор,
            действие и управление. Поиск в шапке ищет по строкам закупок и журнала не касается — для событий есть
            своя строка поиска ниже.
          </span>
        </span>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-transparent p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
            <label htmlFor="journal-search" className="sr-only">Поиск по событиям журнала</label>
            <input
              id="journal-search"
              type="text"
              placeholder="Поиск по действию и деталям события"
              value={search}
              onChange={e => { setSearch(e.target.value); setCurrentPage(1); }}
              className="w-full pl-9 pr-3 py-2 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900/50 text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div className="flex items-center gap-1 flex-wrap" role="group" aria-label="Тип события — можно выбрать один">
            <Filter size={13} className="text-zinc-400 mr-1" aria-hidden="true" />
            {JOURNAL_FILTERABLE_TYPES.map(type => {
              const cfg = typeStyle(type);
              const active = typeFilter === type;
              return (
                <button
                  key={type}
                  onClick={() => selectType(type)}
                  aria-pressed={active}
                  className={clsx(
                    'px-2.5 py-1 text-xs rounded-full border transition font-medium',
                    active ? `${cfg.bg} ${cfg.text} border-current` : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700/30'
                  )}
                >
                  {cfg.label}
                </button>
              );
            })}
          </div>
          {hasPageFilter && (
            <button
              onClick={() => { setSearch(''); setTypeFilter(null); setCurrentPage(1); }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-700/30 transition"
            >
              <RotateCcw size={13} aria-hidden="true" /> Снять отбор страницы
            </button>
          )}
        </div>
        <p className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">
          Тип выбирается один: журнал умеет отбирать по одному типу события за раз. Повторное нажатие снимает отбор.
        </p>
      </div>

      {/* Table or Empty State */}
      <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-transparent overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <Loader2 className="mx-auto text-blue-400 mb-3 animate-spin" size={32} aria-hidden="true" />
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Читаем журнал событий…</p>
          </div>
        ) : loadError ? (
          <div className="p-12 text-center">
            <AlertTriangle className="mx-auto text-amber-400 mb-4" size={40} aria-hidden="true" />
            <h2 className="text-lg font-semibold text-zinc-700 dark:text-zinc-200 mb-2">Журнал не прочитан</h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-md mx-auto">
              События могут быть — сейчас их не видно, потому что сервер не ответил. Пустым журнал считать нельзя.
              Повторите попытку; если повторяется, проверьте доступ к серверу данных.
            </p>
            <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">({loadError})</p>
            <button
              onClick={() => setReloadToken(t => t + 1)}
              className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
            >
              <RotateCcw size={13} aria-hidden="true" /> Попробовать снова
            </button>
          </div>
        ) : pageItems.length === 0 ? (
          <div className="p-12 text-center">
            <Inbox className="mx-auto text-zinc-300 dark:text-zinc-600 mb-4" size={48} aria-hidden="true" />
            <h2 className="text-lg font-semibold text-zinc-600 dark:text-zinc-300 mb-2">
              {hasPageFilter
                ? 'Под отбор страницы не подошло ни одно событие'
                : periodRange.rangeLabel
                  ? 'За выбранный период событий нет'
                  : 'Журнал событий пока пуст'}
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-md mx-auto">
              {hasPageFilter
                ? 'Событий такого типа или с таким текстом в выбранном периоде не записано. Снимите отбор страницы или сдвиньте период.'
                : periodRange.rangeLabel
                  ? `Отбор идёт по дате события: ${periodRange.rangeLabel}. Записи журнала появляются с момента запуска системы, а не за период данных, — сдвиньте период или снимите его.`
                  : 'События будут записываться при обновлении данных и изменении статусов замечаний.'}
            </p>
            {hasPageFilter && (
              <button
                onClick={() => { setSearch(''); setTypeFilter(null); setCurrentPage(1); }}
                className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
              >
                <RotateCcw size={13} aria-hidden="true" /> Снять отбор страницы
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Журнал событий системы: время, автор, тип, действие и детали</caption>
                <thead>
                  <tr className="bg-zinc-50 dark:bg-zinc-900/50 text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                    <th scope="col" className="px-5 py-3 text-left">Время</th>
                    <th scope="col" className="px-4 py-3 text-left">Кто</th>
                    <th scope="col" className="px-4 py-3 text-center">Тип</th>
                    <th scope="col" className="px-4 py-3 text-left">Действие</th>
                    <th scope="col" className="px-4 py-3 text-left">Детали</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
                  {pageItems.map(entry => {
                    const cfg = typeStyle(entry.type);
                    const Icon = cfg.icon;
                    const details = humanizeJournalDetails(entry.details);
                    return (
                      <tr key={entry.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-700/30 transition">
                        <td className="px-5 py-3 text-xs text-zinc-500 dark:text-zinc-400 whitespace-nowrap tabular-nums">
                          {formatEventTime(entry.timestamp)}
                        </td>
                        <td className="px-4 py-3 text-xs text-zinc-600 dark:text-zinc-300 font-medium">
                          {journalActorLabel(entry.actor)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium', cfg.bg, cfg.text)}>
                            <Icon size={10} aria-hidden="true" /> {cfg.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-zinc-700 dark:text-zinc-200 font-medium">
                          {entry.action}
                          {entry.dept && (
                            <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400">
                              {productLabel(entry.dept)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-zinc-500 dark:text-zinc-400 max-w-xs truncate" title={details}>
                          {details || 'подробностей не записано'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <nav
                aria-label="Страницы журнала"
                className="flex items-center justify-between px-5 py-3 border-t border-zinc-100 dark:border-zinc-700/50 bg-zinc-50/50 dark:bg-zinc-900/30"
              >
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  Показано {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, totalFromApi)} из {totalFromApi} {eventsWord(totalFromApi)}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    aria-label="Предыдущая страница"
                    className="p-1.5 rounded-lg text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-30 transition"
                  >
                    <ChevronLeft size={14} aria-hidden="true" />
                  </button>
                  {/* Окно страниц: при сотне страниц сотня кнопок подряд нечитаема. */}
                  {pageWindow(currentPage, totalPages).map(n => (
                    <button
                      key={n}
                      onClick={() => setCurrentPage(n)}
                      aria-label={`Страница ${n}`}
                      aria-current={currentPage === n ? 'page' : undefined}
                      className={clsx(
                        'w-7 h-7 text-xs rounded-lg transition font-medium tabular-nums',
                        currentPage === n ? 'bg-blue-600 text-white' : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                      )}
                    >
                      {n}
                    </button>
                  ))}
                  <button
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    aria-label="Следующая страница"
                    className="p-1.5 rounded-lg text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-30 transition"
                  >
                    <ChevronRight size={14} aria-hidden="true" />
                  </button>
                </div>
              </nav>
            )}
          </>
        )}
      </div>
    </div>
  );
}
