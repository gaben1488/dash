import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  BUDGET_SOURCE_META,
  isInitiativeMarker,
  isOrgItself,
  isYearlongStageRow,
  productLabel,
  subordinateKey,
  sumInitiativeRows,
} from '@aemr/shared';
import { YearlongBadge } from '../components/yearlong/YearlongBadge';
import { useStore } from '../store';
import { api, humanizeRequestError } from '../api';
import { Table2, Download, ChevronLeft, ChevronRight, AlertCircle, CheckCircle2, Clock, XCircle, ArrowUpDown, ArrowUp, ArrowDown, Filter, X, Edit3, Eye, Keyboard, MapPin, ArrowUpToLine } from 'lucide-react';
import clsx from 'clsx';
import { RowDetailCard } from '../components/RowDetailCard';
import { PeriodBadge } from '../components/PeriodBadge';
import { PlanSemanticsNote, planSemanticsHoverText, usePlanSemantics } from '../components/PlanSemanticsNote';
import {
  TableEditor,
  type ColumnConfig,
  type RowData,
  COPY_REFUSED_NOTE,
  columnsFingerprint,
  copyText,
  describeRowsBelow,
  formatRowAddress,
  isTypingTarget,
  readTablePrefs,
  rowToTsv,
  useTableScroll,
  writeTablePrefs,
  STICKY_SEAM,
  STICKY_SURFACE,
  TABLE_SCROLL_AREA,
} from '../components/TableEditor';
import { KbHover } from '../components/contract/KbHover';
import { SourceBadge } from '../components/contract/SourceBadge';
import { filterRowsByBudgets } from '../lib/rows-filter';
import { collectAllPages } from '../lib/rows/collect-pages';
import { monthOfDateValue, formatDateCell } from '../lib/sheet-date';
import { toCanonicalDeptId } from '../lib/dept-key';
import { useLiveEvents } from '../hooks/useLiveEvents';
import { changedRowKey, rowChangeHint } from '../components/live/live-text';
import { pluralRu } from '../lib/economy-copy';
import { formatPct } from '../lib/economy/format';
import { useOrgScope } from '../lib/selectors/org-scope';
import { subordinateLabel } from '../lib/subordinate-label';
import { readingMoment } from '../lib/reading-moment';
import {
  REGISTRY_SLICE_PRESETS,
  findSlicePreset,
  numericEconomyOf,
  slicePresetCounts,
  splitRegistrySeed,
  type SliceRow,
} from '../lib/rows/slice-presets';
import {
  ALL_SIGNAL_KEYS,
  activityRowLabel,
  countBySeverity,
  countUncheckedByPeriod,
  describeRegistryCounts,
  describeUncheckedByPeriod,
  requestFilterNames,
  rowHasPeriodDate,
  screenFilterNames,
  signalChipText,
  signalOccurrences,
  signalTone,
} from '../lib/rows/registry-view';

type ViewMode = 'browse' | 'editor';

type SortKey = 'id' | 'subject' | 'method' | 'planSum' | 'factSum' | 'economy' | 'status' | 'dept' | 'signals';
type SortDir = 'asc' | 'desc';

/**
 * Быстрые порядки реестра — переключатель над таблицей (задание группы:
 * по строкам / по деньгам / по числу дел). Дефолт пока «по строкам листа» —
 * канонический дефолт решится отдельным вопросом владельцу (вопрос 37).
 * Щелчок по заголовку столбца по-прежнему сортирует по нему — тогда ни одна
 * кнопка переключателя не активна.
 */
const SORT_PRESETS: { id: string; label: string; hint: string; key: SortKey; dir: SortDir }[] = [
  {
    id: 'rows',
    label: 'По строкам',
    hint: 'Порядок листа книги: № п/п по возрастанию — строки идут так же, как в книге управления.',
    key: 'id',
    dir: 'asc',
  },
  {
    id: 'money',
    label: 'По деньгам',
    hint: 'Сначала самые дорогие: плановый итог строки по убыванию.',
    key: 'planSum',
    dir: 'desc',
  },
  {
    id: 'cases',
    label: 'По числу дел',
    hint: 'Сначала строки, собравшие больше всего замечаний проверок, — разбор разумно начинать с них.',
    key: 'signals',
    dir: 'desc',
  },
];

/** Строк на один запрос к серверу — его же потолок (rows.ts: min(1000, limit)). */
const ROWS_PER_REQUEST = 1000;

/** Доступные размеры страницы; последний — «все строки» без листания. */
const PAGE_SIZES = [25, 50, 100, 500, 1000000] as const;

/**
 * Столбцы реестра в режиме просмотра. Один дом для трёх нужд: отпечаток набора
 * колонок (по нему сбрасываются сохранённые настройки вида), копирование строки
 * и порядок значений в буфере обмена.
 */
const BROWSE_COLUMN_KEYS = [
  'id', 'subject', 'method', 'planSum', 'factSum', 'economy', 'status', 'signals',
] as const;

const BROWSE_PREFS_NAME = 'registry-browse';
const BROWSE_FINGERPRINT = columnsFingerprint(BROWSE_COLUMN_KEYS);

/** Настройки вида реестра, переживающие перезагрузку страницы. */
interface BrowsePrefs {
  sortKey: SortKey;
  sortDir: SortDir;
  pageSize: number;
  viewMode: ViewMode;
}

const SORT_KEYS: SortKey[] = ['id', 'subject', 'method', 'planSum', 'factSum', 'economy', 'status', 'dept', 'signals'];

/**
 * Разбор сохранённых настроек. Каждое поле проверяется отдельно: запись из
 * прошлой версии или правленная руками не должна ни ронять экран, ни
 * подсовывать несуществующий столбец сортировки.
 */
export function sanitizeBrowsePrefs(raw: unknown): Partial<BrowsePrefs> {
  if (!raw || typeof raw !== 'object') return {};
  const value = raw as Record<string, unknown>;
  const result: Partial<BrowsePrefs> = {};
  if (typeof value.sortKey === 'string' && (SORT_KEYS as string[]).includes(value.sortKey)) {
    result.sortKey = value.sortKey as SortKey;
  }
  if (value.sortDir === 'asc' || value.sortDir === 'desc') result.sortDir = value.sortDir;
  if (typeof value.pageSize === 'number' && (PAGE_SIZES as readonly number[]).includes(value.pageSize)) {
    result.pageSize = value.pageSize;
  }
  if (value.viewMode === 'browse' || value.viewMode === 'editor') result.viewMode = value.viewMode;
  return result;
}

/** Подписи горячих клавиш реестра — текст один, показывают его подсказка и нижняя строка. */
const HOTKEYS: { keys: string; what: string }[] = [
  { keys: '↑ ↓', what: 'переход по строкам, на краю страницы — на соседнюю' },
  { keys: 'Enter', what: 'открыть карточку строки' },
  { keys: 'Esc', what: 'закрыть карточку или эту подсказку' },
  { keys: 'Home / End', what: 'первая и последняя строка выборки' },
  { keys: '/', what: 'перейти в поле поиска' },
  { keys: 'Ctrl + C', what: 'скопировать строку под курсором' },
  { keys: '?', what: 'показать и скрыть эту подсказку' },
];

/**
 * Ключ-ведро организации внутри управления — дословное значение колонки C
 * книги. Функция объявлена вне компонента намеренно: хук разбивки помнит
 * результат по ссылке на неё, и новая стрелка на каждый кадр пересобирала бы
 * разбивку впустую.
 */
function rowSubordinateKey(row: Record<string, unknown>): string {
  return subordinateKey(row.subordinate);
}

/**
 * Момент чтения книг у чисел выборки (канон п.58: у числа виден не только
 * период, но и момент, на который оно верно).
 *
 * Фразу собирает единственный дом продукта — `lib/reading-moment`: там же
 * закреплено правило «незнание момента — не свежесть», поэтому молчание
 * сервера здесь не превращается в бодрое «на сейчас». Своей формулировки в
 * странице нет намеренно: вторая копия подписи разошлась бы с первой молча.
 */
function ReadMomentNote() {
  const lastRefreshed = useStore((s) => s.lastRefreshed);
  const moment = readingMoment({ readAt: lastRefreshed });
  return (
    <span
      title={moment.phrase}
      className={clsx(
        'text-[10px]',
        // Остывшие числа говорят об этом сами: до подсказки читатель может и
        // не добраться.
        moment.stale ? 'text-amber-700 dark:text-amber-400' : 'text-zinc-400 dark:text-zinc-500',
      )}
    >
      {moment.label}
    </span>
  );
}

/** Имя управления для глаз: латинский идентификатор книги до экрана не доходит. */
function deptDisplayName(key: unknown): string {
  const raw = String(key ?? '').trim();
  if (!raw) return 'управление не указано';
  return productLabel(toCanonicalDeptId(raw));
}

/** Итог загрузки одного управления: строки плюс честный отчёт о том, что не доехало. */
interface DeptLoadResult {
  dept: string;
  rows: Record<string, unknown>[];
  /** Первая страница не прочиталась — управления в реестре нет вовсе. */
  failed: boolean;
  /** Часть страниц не прочиталась — строки показаны не все. */
  partial: boolean;
  /** Человеческая причина отказа (для мелкой технической строки). */
  error?: string;
}

/**
 * Все строки управления, а не первая тысяча (см. lib/rows/collect-pages).
 *
 * Отказы страниц collectAllPages гасит намеренно (частичные данные лучше
 * пустого экрана), но тогда сбой сети выглядел бы как «нет данных по
 * фильтрам» — ровно та ложь, против которой этот экран и правится. Поэтому
 * загрузчик подсматривает за отказами через замыкание и возвращает их
 * наверх: гасит сборщик, а рассказывает пользователю страница.
 */
async function fetchAllDeptRows(
  dept: string,
  params: Record<string, string>,
): Promise<DeptLoadResult> {
  let firstPageFailed = false;
  let failedPages = 0;
  let lastError: unknown = null;

  const rows = await collectAllPages<Record<string, unknown>>(async (page) => {
    try {
      return await api.getRows(dept, {
        limit: String(ROWS_PER_REQUEST),
        ...(page > 1 ? { page: String(page) } : {}),
        ...params,
      });
    } catch (err) {
      lastError = err;
      failedPages += 1;
      if (page === 1) firstPageFailed = true;
      throw err;
    }
  });

  return {
    dept,
    rows: rows.map((r) => ({ ...r, dept: r.dept || dept })),
    failed: firstPageFailed,
    partial: !firstPageFailed && failedPages > 0,
    ...(lastError ? { error: humanizeRequestError(lastError) } : {}),
  };
}

/** Ответ POST /api/data/rows: успех каждой ячейки в отдельности, отказ — с причиной. */
interface SaveRowsResponse {
  results?: Array<{ field?: string; rowIndex?: number; success?: boolean; error?: string }>;
}

/** Что не доехало при последней загрузке — для честной плашки над таблицей. */
interface LoadTrouble {
  failedDepts: string[];
  partialDepts: string[];
  reason: string | null;
}

const NO_TROUBLE: LoadTrouble = { failedDepts: [], partialDepts: [], reason: null };

/**
 * Корзины Реестра (канон п.73в интервью 14.08.2026): собственные вкладки
 * навигации, каждая — тот же Реестр с зафиксированным фильтром класса строк.
 * Предикаты — ровно те, которыми считает сервер (/api/registry/buckets):
 * счётчик на кнопке навигации и строки на странице обязаны сходиться.
 */
export type RegistryBucket = 'unfunded' | 'yearlong';

const BUCKET_META: Record<RegistryBucket, {
  /** Имя класса — канон (п.23 / п.71), заголовок плашки. */
  title: string;
  /** Механизм класса простыми словами (стандарт п.53). */
  mechanism: string;
  /** Почему в корзине пусто и что делать (честное пустое состояние). */
  emptyReason: string;
  /** Ключ карточки БЗ корзины (объект — в kb-additions.ts рядом со страницей). */
  kbKey: string;
  predicate: (r: Record<string, unknown>) => boolean;
}> = {
  unfunded: {
    title: 'Закупки, не обеспеченные финансированием',
    kbKey: 'bucket_unfunded_rows',
    // Текст ведёт с рукописной плановой даты N, а не с производного года P
    // (канон п.123 «N и Q первичны»): год пуст вслед за датой, и просить
    // читателя заполнить производную графу означало бы послать его не туда.
    mechanism:
      'Способ и плановые деньги у строки есть, а рукописная плановая дата (графа N) не проставлена — '
      + 'и год плана пуст вслед за ней: финансирование не подтверждено. '
      + 'Формулы официального листа СВОД такие строки не видят, и наш годовой срез тоже: они лежат '
      + 'вне обоих чисел и ждут решения — подтвердить срок или снять план.',
    emptyReason:
      'Ни у одной загруженной строки плановая дата не пуста при заполненном способе и плановых деньгах. '
      + 'Если ожидали увидеть строки — проверьте отбор шапки (управление, период, способ) и снимите лишнее.',
    predicate: (r) => Array.isArray(r.signals) && (r.signals as string[]).includes('planYearMissing'),
  },
  yearlong: {
    title: 'Закупки, проводимые в течение года',
    kbKey: 'bucket_yearlong_rows',
    mechanism:
      'Единственный поставщик, дата заключения — заглушка («Х» или пусто), а факт больше нуля: статья исполняется '
      + 'серией договоров или платежей в течение года. Ровно эти строки формулы свода не считают в факте и экономии; план — входит (канон п.71).',
    emptyReason:
      'Среди загруженных строк нет ни одной с способом ЕП, заглушкой в дате заключения и ненулевым фактом. '
      + 'Если ожидали увидеть строки — проверьте отбор шапки (управление, период, бюджет) и снимите лишнее.',
    predicate: (r) => isYearlongStageRow({
      method: String(r.method ?? ''),
      factDateCell: r.factDateRaw,
      factSum: typeof r.factSum === 'number' ? r.factSum : 0,
    }),
  },
};

export function DataBrowserPage({ bucket }: { bucket?: RegistryBucket } = {}) {
  const { formatMoney, moneyUnit, selectedDepartments, selectedSubordinates, activityFilter, procurementFilter, period, activeMonths, searchQuery, subordinatesMap, year, selectedBudgets, navigateTo } = useStore();
  // Вид реестра (сортировка, размер страницы, режим) переживает перезагрузку:
  // читается один раз при первом кадре, дальше живёт в состоянии.
  const storedPrefs = useMemo(
    () => sanitizeBrowsePrefs(readTablePrefs<unknown>(BROWSE_PREFS_NAME, BROWSE_FINGERPRINT)),
    [],
  );
  const [viewMode, setViewMode] = useState<ViewMode>(storedPrefs.viewMode ?? 'browse');
  const [pageNum, setPageNum] = useState(1);
  const [pageSize, setPageSize] = useState(storedPrefs.pageSize ?? 25);
  const [sortKey, setSortKey] = useState<SortKey>(storedPrefs.sortKey ?? 'id');
  const [sortDir, setSortDir] = useState<SortDir>(storedPrefs.sortDir ?? 'asc');
  const [rows, setRows] = useState<any[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [trouble, setTrouble] = useState<LoadTrouble>(NO_TROUBLE);
  const [selectedRow, setSelectedRow] = useState<any>(null);
  // Затравка признаков от «Дисциплины», «Пульта» и «Экономии»:
  // navigateTo('data', { signals }) кладёт ключи в store, Реестр забирает их
  // одним чтением при открытии и очищает — повторный заход в Реестр без
  // затравки стартует с пустым фильтром.
  //
  // Один ключ, у которого есть именованный срез, ведёт В СРЕЗ, а не в
  // безымянный отбор по признаку: так кнопка-чип карточки приводит читателя
  // к подписи класса, механизму отбора и честной причине пустоты, а не к
  // молча сузившейся таблице. Разбор затравки — в lib/rows/slice-presets.
  const [seedRouting] = useState(
    () => splitRegistrySeed(useStore.getState().registrySignalSeed),
  );
  const [signalFilter, setSignalFilter] = useState<string[]>(seedRouting.signals);
  useEffect(() => {
    if (useStore.getState().registrySignalSeed.length > 0) {
      useStore.getState().clearRegistrySignalSeed();
    }
  }, []);
  const [signalDropdownOpen, setSignalDropdownOpen] = useState(false);
  const signalDropdownRef = useRef<HTMLDivElement>(null);
  // Фильтр «только инициативные заявки» (п.76б): строки, где примечание AF
  // ЦЕЛИКОМ равно маркеру словаря «хотелки» — структурное чтение, не парсинг.
  const [initiativeOnly, setInitiativeOnly] = useState(false);
  // Пресет-срез: именованный отбор строк в один щелчок. Одновременно активен
  // ровно один — срезы отвечают на разные вопросы, а не складываются.
  // Список срезов живёт в lib/rows/slice-presets.
  const [slicePresetId, setSlicePresetId] = useState<string | null>(seedRouting.slicePresetId);
  const slicePreset = findSlicePreset(slicePresetId);

  // Организационный срез (приказ владельца 20.08.2026). Реестр — единственное
  // место, где разрез по учреждениям НАСТОЯЩИЙ: заказчик записан в самой
  // строке книги (колонка C), делить готовые итоги ничем не приходится.
  // Здесь берётся только режим; сама разбивка собирается ниже, по выборке.
  const orgMode = useOrgScope();
  /**
   * Фокус на одной организации управления — щелчок по строке разбивки.
   *
   * Почему собственное состояние, а не общий фильтр организаций из шапки:
   * закупки самого аппарата хранятся в книге плейсхолдером колонки C («х»,
   * пустая ячейка), а не именем, и отправить такой отбор на сервер строкой
   * нельзя — он ищет точное совпадение имени и вернул бы пусто. Фокус живёт
   * рядом с разбивкой, работает по тому же ключу-ведру и называется в подписи
   * фильтров экрана наравне с остальными.
   */
  const [subFocus, setSubFocus] = useState<string | null>(null);

  // ── Клавиатура и копирование ──
  /** Строка под курсором клавиатуры — номер внутри текущей страницы; −1 значит «курсора нет». */
  const [cursor, setCursor] = useState(-1);
  const [hotkeysOpen, setHotkeysOpen] = useState(false);
  const [copyNote, setCopyNote] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  /** Куда встать после перехода на соседнюю страницу — в начало или в конец. */
  const pendingCursorRef = useRef<'first' | 'last' | null>(null);

  useEffect(() => {
    writeTablePrefs<BrowsePrefs>(BROWSE_PREFS_NAME, BROWSE_FINGERPRINT, {
      sortKey, sortDir, pageSize, viewMode,
    });
  }, [sortKey, sortDir, pageSize, viewMode]);

  useEffect(() => {
    if (!copyNote) return;
    const timer = setTimeout(() => setCopyNote(null), 4000);
    return () => clearTimeout(timer);
  }, [copyNote]);

  // ── Состояние редактора таблиц ──
  const [editorRows, setEditorRows] = useState<RowData[]>([]);
  const [editorColumns, setEditorColumns] = useState<ColumnConfig[]>([]);
  const [editorOriginals, setEditorOriginals] = useState<Record<string, RowData>>({});

  /** Проверка числового поля редактора — одна на все денежные колонки. */
  const moneyCell = useCallback((v: unknown): string | null => {
    if (v === null || v === '' || v === undefined) return null;
    return isNaN(parseFloat(String(v))) ? 'Ожидается число, например 1250,50' : null;
  }, []);

  const defaultEditorColumns: ColumnConfig[] = useMemo(() => [
    // Ширины — стартовые: столбцы редактора тянутся мышью, и выбор пользователя
    // переживает перезагрузку. Имя управления и признак экономии получили запас
    // ширины: при жёстких ширинах короткая колонка режет текст, а не ужимается.
    { key: 'id', label: '№', type: 'text', width: 'w-14', editable: false },
    { key: 'dept', label: 'Управление', type: 'text', width: 'w-44', editable: false },
    { key: 'subject', label: 'Предмет закупки', type: 'text' },
    { key: 'method', label: 'Способ', type: 'select', width: 'w-20', options: ['ЭА', 'ЭК', 'ЭЗК', 'ЕП'] },
    // Сокращения уровней бюджета — из канон-словаря, а не набраны здесь заново
    { key: 'planFB', label: `План ${BUDGET_SOURCE_META.fb.abbr}`, type: 'currency', width: 'w-28', validate: moneyCell },
    { key: 'planKB', label: `План ${BUDGET_SOURCE_META.kb.abbr}`, type: 'currency', width: 'w-28', validate: moneyCell },
    { key: 'planMB', label: `План ${BUDGET_SOURCE_META.mb.abbr}`, type: 'currency', width: 'w-28', validate: moneyCell },
    // Итоги считает формула книги; в редакторе они показываются пересчитанными
    // от трёх бюджетов, чтобы число под рукой не расходилось с тем, что уедет в лист.
    { key: 'planSum', label: 'План итого', type: 'currency', width: 'w-28', editable: false },
    { key: 'factFB', label: `Факт ${BUDGET_SOURCE_META.fb.abbr}`, type: 'currency', width: 'w-28', validate: moneyCell },
    { key: 'factKB', label: `Факт ${BUDGET_SOURCE_META.kb.abbr}`, type: 'currency', width: 'w-28', validate: moneyCell },
    { key: 'factMB', label: `Факт ${BUDGET_SOURCE_META.mb.abbr}`, type: 'currency', width: 'w-28', validate: moneyCell },
    { key: 'factSum', label: 'Факт итого', type: 'currency', width: 'w-28', editable: false },
    { key: 'planDate', label: 'Дата плана', type: 'date', width: 'w-28' },
    { key: 'factDate', label: 'Дата факта', type: 'date', width: 'w-28' },
    { key: 'status', label: 'Статус', type: 'text', width: 'w-28', editable: false },
    { key: 'flag', label: 'Признак экономии', type: 'text', width: 'w-36' },
    { key: 'commentGRBS', label: 'Комментарий управления', type: 'text' },
  ], [moneyCell]);

  /** Сумма трёх бюджетов; нечисловой ввод в сумму не попадает. */
  const sumBudgets = useCallback((row: RowData, keys: string[]): number => {
    return keys.reduce((acc, key) => {
      const n = parseFloat(String(row[key] ?? ''));
      return acc + (isNaN(n) ? 0 : n);
    }, 0);
  }, []);

  const handleEditorCellChange = useCallback((rowId: string, colKey: string, value: unknown) => {
    setEditorRows(prev => prev.map(r => {
      if (r._id !== rowId) return r;
      const next = { ...r, [colKey]: value };
      // Итоги — производные: в книге их считает формула, здесь пересчитываем
      // сразу, иначе на экране осталась бы прежняя сумма, противоречащая
      // только что введённым бюджетам.
      if (colKey === 'planFB' || colKey === 'planKB' || colKey === 'planMB') {
        next.planSum = sumBudgets(next, ['planFB', 'planKB', 'planMB']);
      }
      if (colKey === 'factFB' || colKey === 'factKB' || colKey === 'factMB') {
        next.factSum = sumBudgets(next, ['factFB', 'factKB', 'factMB']);
      }
      return next;
    }));
  }, [sumBudgets]);

  const handleEditorSaveRow = useCallback(async (rowId: string, data: Record<string, unknown>) => {
    const original = editorOriginals[rowId];
    if (!original) return;

    // Поле редактора → колонка листа. Итоги (план/факт) не пишутся: их считает
    // формула книги, запись затёрла бы её значением.
    const FIELD_TO_COL: Record<string, string> = {
      subject: 'G', method: 'L',
      planFB: 'H', planKB: 'I', planMB: 'J',
      factFB: 'V', factKB: 'W', factMB: 'X',
      planDate: 'N', factDate: 'Q',
      // AF, не AE: по живой шапке книг AE — «Обоснование необходимости»,
      // комментарий управления лежит в AF. Запись в AE затирала обоснование
      // в прод-книге (аудит 30.07: AE заполнено в 409 строках, AF — в 3 523).
      flag: 'AD', commentGRBS: 'AF',
    };

    const changes: Record<string, unknown> = {};
    for (const [editorKey, sheetCol] of Object.entries(FIELD_TO_COL)) {
      if (data[editorKey] !== original[editorKey]) {
        changes[sheetCol] = data[editorKey];
      }
    }

    if (Object.keys(changes).length === 0) return;

    const deptId = String(data._dept ?? '');
    const rowIndex = Number(data._rowIndex ?? 0);

    const response: SaveRowsResponse = await api.saveRows([{ deptId, rowIndex, changes }]);

    // Сервер отвечает 200 и при отказе отдельных ячеек: раньше отказ проходил
    // молча — правка исчезала из отметки «изменено», а в книгу не попадала.
    // «H1481» — адрес ячейки книги, а не служебный код: по нему правку находят глазами.
    const failures: string[] = (response?.results ?? [])
      .filter((r) => !r?.success)
      .map((r) => `${r.field ?? ''}${r.rowIndex ?? ''}: ${r.error ?? 'причина не названа'}`);
    if (failures.length > 0) {
      throw new Error(`Книга не приняла правку — ${failures.join('; ')}`);
    }

    setEditorOriginals(prev => ({
      ...prev,
      [rowId]: { ...data, _id: rowId } as RowData,
    }));
  }, [editorOriginals]);

  const handleEditorRevertRow = useCallback((rowId: string) => {
    const original = editorOriginals[rowId];
    if (!original) return;
    setEditorRows(prev => prev.map(r =>
      r._id === rowId ? { ...original } : r
    ));
  }, [editorOriginals]);

  const handleEditorAddColumn = useCallback((col: ColumnConfig) => {
    setEditorColumns(prev => [...prev, col]);
  }, []);

  // Какие управления грузить (ключи subordinatesMap — всегда актуальный список)
  const allDepartments = useMemo(() => Object.keys(subordinatesMap), [subordinatesMap]);
  const deptsToLoad = useMemo(() => {
    return selectedDepartments.size > 0 ? [...selectedDepartments] : allDepartments;
  }, [selectedDepartments, allDepartments]);

  useEffect(() => {
    let cancelled = false;
    setLoadingRows(true);
    setTrouble(NO_TROUBLE);

    const params: Record<string, string> = {};
    if (selectedSubordinates.size > 0) {
      params.subordinate = Array.from(selectedSubordinates).join(',');
    }
    if (activityFilter !== 'all') {
      params.activity = activityFilter;
    }
    if (procurementFilter !== 'all') {
      params.type = procurementFilter === 'competitive' ? 'КП' : 'ЕП';
    }
    if (typeof year === 'number') {
      params.year = String(year);
    }

    Promise.all(
      deptsToLoad.map(dept => fetchAllDeptRows(dept, params))
    ).then(results => {
      if (cancelled) return;
      setRows(results.flatMap(r => r.rows));
      setTrouble({
        failedDepts: results.filter(r => r.failed).map(r => deptDisplayName(r.dept)),
        partialDepts: results.filter(r => r.partial).map(r => deptDisplayName(r.dept)),
        reason: results.find(r => r.error)?.error ?? null,
      });
    }).catch((err: unknown) => {
      if (cancelled) return;
      setRows([]);
      setTrouble({
        failedDepts: deptsToLoad.map(deptDisplayName),
        partialDepts: [],
        reason: humanizeRequestError(err),
      });
    }).finally(() => {
      if (!cancelled) setLoadingRows(false);
    });

    return () => { cancelled = true; };
  }, [deptsToLoad, selectedSubordinates, activityFilter, procurementFilter, year]);

  // Смена фильтров возвращает на первую страницу
  useEffect(() => { setPageNum(1); }, [searchQuery, selectedDepartments, selectedSubordinates, activityFilter, signalFilter, initiativeOnly, selectedBudgets, bucket, slicePresetId, orgMode.mode, subFocus]);

  // Смена управления (или выход из режима «с подведомственными») снимает фокус
  // на организации: чужой ключ пережил бы переключение и молча оставил бы
  // выборку пустой — читатель увидел бы «строк нет» без причины.
  useEffect(() => { setSubFocus(null); }, [orgMode.dept, orgMode.mode]);

  // Закрытие списка признаков щелчком мимо и клавишей Esc
  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (signalDropdownRef.current && !signalDropdownRef.current.contains(e.target as Node)) {
        setSignalDropdownOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSignalDropdownOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
    setPageNum(1);
  };

  /**
   * Выборка страницы ДО фокуса на одной организации. Разбивка по учреждениям
   * считается именно по ней: иначе щелчок по учреждению схлопывал бы разбивку
   * до одной строки, и вернуться к соседям было бы не по чему — счёт зависел
   * бы от собственного нажатия.
   */
  const scopedRows = useMemo(() => {
    let data = [...rows];
    // Корзина (п.73в): зафиксированный фильтр класса строк — применяется
    // ПЕРВЫМ, остальные фильтры шапки и страницы сужают уже внутри класса.
    if (bucket) {
      data = data.filter(BUCKET_META[bucket].predicate);
    }
    // Режим «только управление» (org-scope): пользователь сознательно убрал
    // подведомственные учреждения, и в Реестре это выполнимо честно — заказчик
    // записан в самой строке. Остаются закупки аппарата управления. Строка
    // подписи под таблицей называет этот отбор наравне с прочими фильтрами
    // экрана: молча сжавшаяся выборка читалась бы как пропажа строк.
    if (orgMode.mode === 'grbs') {
      data = data.filter((r) => isOrgItself(r.subordinate));
    }
    // Пресет-срез — именованный вопрос к выборке; предикат живёт в словаре
    // срезов, не здесь, поэтому счёт кнопки и число строк не расходятся.
    if (slicePreset) {
      data = data.filter((r) => slicePreset.predicate(r as SliceRow));
    }
    // Квартал
    if (period !== 'year') {
      const qMonths: Record<string, number[]> = { q1: [1,2,3], q2: [4,5,6], q3: [7,8,9], q4: [10,11,12] };
      const months = qMonths[period];
      if (months) {
        data = data.filter(r => {
          // Месяц — из ISO-канона DTO (monthOfDateValue понимает и дд.мм.гггг,
          // и legacy-серийники). Раньше new Date(46034) = январь-1970 → фильтр
          // квартала классифицировал все serial-строки ложно (fidelity §2.2).
          const m = monthOfDateValue(r.planDate ?? r.factDate ?? r.date);
          // Строка без даты не прячется, но и не выдаётся за строку периода:
          // их число называет подпись под таблицей (describeUncheckedByPeriod).
          if (m === null) return true;
          return months.includes(m);
        });
      }
    }
    // Отдельные месяцы
    if (activeMonths.size > 0) {
      data = data.filter(r => {
        const m = monthOfDateValue(r.planDate ?? r.factDate ?? r.date);
        if (m === null) return true;
        return activeMonths.has(m);
      });
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      data = data.filter(r =>
        (r.subject ?? '').toLowerCase().includes(q) ||
        (r.dept ?? '').toLowerCase().includes(q) ||
        String(r.id ?? '').includes(q),
      );
    }
    if (signalFilter.length > 0) {
      data = data.filter(r => {
        const sigs = r.signals ?? [];
        return signalFilter.some(s => sigs.includes(s));
      });
    }
    // Инициативные заявки (п.76): примечание AF целиком равно маркеру словаря
    // «хотелки» — структурный код, не интерпретация свободного текста (п.27).
    if (initiativeOnly) {
      data = data.filter(r => isInitiativeMarker(r.commentGRBS));
    }
    // Источники финансирования: строка проходит, если имеет план ИЛИ факт в выбранном
    data = filterRowsByBudgets(data, selectedBudgets);
    // «По числу дел» — производный ключ: замечаний у строки, а не колонка.
    const sortValue = (r: Record<string, unknown>) =>
      sortKey === 'signals' ? (Array.isArray(r.signals) ? r.signals.length : 0) : r[sortKey];
    data.sort((a, b) => {
      const av = sortValue(a), bv = sortValue(b);
      if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av;
      const as = String(av ?? ''), bs = String(bv ?? '');
      return sortDir === 'asc' ? as.localeCompare(bs, 'ru') : bs.localeCompare(as, 'ru');
    });
    return data;
  }, [rows, searchQuery, sortKey, sortDir, period, activeMonths, signalFilter, initiativeOnly, selectedBudgets, bucket, orgMode.mode, slicePreset]);

  /**
   * Итоговая выборка таблицы: та же, плюс фокус на одной организации, если он
   * выбран щелчком в разбивке. Ключ сравнения — тот же, по которому строится
   * разбивка, поэтому число в её строке и число под таблицей совпадают.
   */
  const filtered = useMemo(
    () => (subFocus === null ? scopedRows : scopedRows.filter((r) => rowSubordinateKey(r) === subFocus)),
    [scopedRows, subFocus],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  // Выборка могла ужаться сильнее, чем сбрасывается номер страницы (например,
  // после смены числа строк) — пустая страница при непустой выборке была бы
  // ложной пустотой, поэтому номер прижимается к последней существующей.
  useEffect(() => {
    if (pageNum > totalPages) setPageNum(totalPages);
  }, [pageNum, totalPages]);
  const safePage = Math.min(pageNum, totalPages);
  // Память о срезе обязательна: он же кормит редактор, а новый массив на каждый
  // кадр перезапускал бы пересборку строк редактора без конца.
  const paged = useMemo(
    () => filtered.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filtered, safePage, pageSize],
  );

  // Прямой эфир: строки, которые правили в книгах последние секунды. Ключ —
  // книга и номер строки листа, ровно тот адрес, которым живёт Реестр.
  const liveRows = useLiveEvents().recentRows;
  const liveChangedRows = useMemo(() => {
    const map = new Map<string, (typeof liveRows)[number]>();
    for (const r of liveRows) map.set(changedRowKey(r.book, r.sheetRow), r);
    return map;
  }, [liveRows]);

  // Строки реестра → строки редактора при переходе на вкладку правки.
  // Берётся текущая страница реестра, а не весь загруженный реестр: строк в
  // реестре бывает больше трёх тысяч, а редактор рисует каждую ячейку живой и
  // правимой — разом это вешает вкладку намертво. Сколько строк на странице,
  // выбирает сам пользователь тем же переключателем, что и в просмотре; в
  // оговорке редактора это сказано прямо, чтобы правка страницы не выглядела
  // правкой всего реестра.
  useEffect(() => {
    if (viewMode !== 'editor' || paged.length === 0) return;
    const mapped: RowData[] = paged.map((r, idx) => ({
      _id: `${r.dept}-${r.rowIndex ?? idx}`,
      _dept: r.dept,
      _rowIndex: r.rowIndex,
      id: r.id,
      // Ключ управления остаётся в _dept для записи; на экран идёт имя.
      dept: deptDisplayName(r.dept),
      subject: r.subject,
      method: r.method,
      planFB: r.planFB,
      planKB: r.planKB,
      planMB: r.planMB,
      planSum: r.planSum,
      factFB: r.factFB,
      factKB: r.factKB,
      factMB: r.factMB,
      factSum: r.factSum,
      planDate: r.planDate,
      factDate: r.factDate,
      status: r.status,
      flag: r.flag,
      commentGRBS: r.commentGRBS,
    }));
    setEditorRows(mapped);
    const origMap: Record<string, RowData> = {};
    for (const row of mapped) {
      origMap[row._id] = { ...row };
    }
    setEditorOriginals(origMap);
    if (editorColumns.length === 0) {
      setEditorColumns(defaultEditorColumns);
    }
  }, [viewMode, paged, defaultEditorColumns, editorColumns.length]);

  // ── Курсор по строкам ──
  const { rowsBelow, showBackToTop, scrollToTop } = useTableScroll(scrollRef, rowRefs, paged.length);

  /** Курсор не должен указывать на строку, которой уже нет: фильтры сужают выборку на лету. */
  useEffect(() => {
    setCursor(prev => (prev >= paged.length ? paged.length - 1 : prev));
  }, [paged.length]);

  // Переход на соседнюю страницу стрелкой: курсор встаёт на её край, а не
  // теряется. Отдельным шагом, потому что строки соседней страницы появляются
  // только после перерисовки.
  useEffect(() => {
    if (pendingCursorRef.current === null) return;
    const target = pendingCursorRef.current;
    pendingCursorRef.current = null;
    if (paged.length === 0) return;
    setCursor(target === 'first' ? 0 : paged.length - 1);
  }, [safePage, paged.length]);

  // Строка под курсором получает фокус: так её видно, слышно в экранном дикторе
  // и она сама подтягивается в видимую часть. Два исключения, иначе фокус
  // отбирался бы у того, кому принадлежит: открытая карточка строки (после её
  // закрытия фокус сюда вернётся сам) и кнопка внутри самой строки, до которой
  // дошли клавишей Tab.
  useEffect(() => {
    if (cursor < 0 || selectedRow) return;
    const el = rowRefs.current[cursor];
    if (!el) return;
    if (!el.contains(document.activeElement)) el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest' });
  }, [cursor, safePage, selectedRow]);

  const cursorRow = cursor >= 0 ? paged[cursor] : undefined;

  /** Адрес строки в книге: имя листа управления и номер строки. */
  const rowAddressOf = useCallback(
    (dept: unknown, rowIndex: unknown) => formatRowAddress(deptDisplayName(dept), rowIndex),
    [],
  );

  const report = useCallback(async (text: string, done: string) => {
    setCopyNote(await copyText(text) ? done : COPY_REFUSED_NOTE);
  }, []);

  /**
   * Строка в буфер: значения через табуляцию, как их видит экран. Суммы уходят
   * в масштабе книги (тыс. ₽) и с запятой-разделителем — так их принимает
   * русский Excel; переключатель единиц из шапки на буфер не влияет, иначе одна
   * и та же строка копировалась бы каждый раз в другом масштабе.
   */
  const copyCursorRow = useCallback(() => {
    if (!cursorRow) {
      setCopyNote('Скопировать нечего: выберите строку — щелчком или стрелками.');
      return;
    }
    const money = (v: unknown) =>
      typeof v === 'number' && v !== 0 ? String(v).replace('.', ',') : '';
    void report(rowToTsv([
      cursorRow.id ?? '',
      cursorRow.subject ?? '',
      deptDisplayName(cursorRow.dept),
      activityRowLabel(cursorRow.type, cursorRow.programName),
      cursorRow.method ?? '',
      money(cursorRow.planSum),
      money(cursorRow.factSum),
      money(cursorRow.economy),
      formatDateCell(cursorRow.planDate),
      formatDateCell(cursorRow.factDate),
      cursorRow.status ?? '',
      (cursorRow.signals ?? []).map((s: string) => signalChipText(s).text).join(', '),
    ]), 'Строка скопирована — суммы в тысячах рублей.');
  }, [cursorRow, report]);

  const copyCursorAddress = useCallback(() => {
    const address = cursorRow ? rowAddressOf(cursorRow.dept, cursorRow.rowIndex) : null;
    if (!address) {
      setCopyNote(cursorRow
        ? 'Адрес строки неизвестен: в ней нет номера строки книги.'
        : 'Сначала выберите строку — щелчком или стрелками.');
      return;
    }
    void report(address, `Адрес скопирован: ${address}`);
  }, [cursorRow, rowAddressOf, report]);

  /**
   * Поле поиска живёт в шапке приложения — за пределами этого экрана, поэтому
   * ссылки на него нет и фокус наводится поиском по разметке. Не нашли поле —
   * говорим об этом, а не делаем вид, что клавиша сработала.
   */
  const focusSearchField = useCallback(() => {
    const field = document.querySelector<HTMLInputElement>('input[type="text"][placeholder^="Поиск"]');
    if (!field) {
      setCopyNote('Поле поиска сейчас недоступно — воспользуйтесь фильтрами в шапке.');
      return;
    }
    field.focus();
    field.select();
  }, []);

  const goToPage = useCallback((page: number, land: 'first' | 'last') => {
    pendingCursorRef.current = land;
    setPageNum(page);
  }, []);

  // Клавиатура реестра. Слушатель на документе, а не на таблице: иначе стрелки
  // молчали бы, пока пользователь не щёлкнет по строке, — а «умею в Excel и
  // почту» этого не угадает.
  useEffect(() => {
    if (viewMode !== 'browse') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;

      // Сверяемся с символом, а не с кодом клавиши: в русской раскладке «/»
      // набирается через Shift, и проверка на Shift путала бы «/» с «?».
      if (e.key === '?') {
        e.preventDefault();
        setHotkeysOpen(v => !v);
        return;
      }
      if (e.key === 'Escape') {
        // Карточка строки закрывается собственным слушателем — здесь только подсказка.
        if (!selectedRow && hotkeysOpen) { e.preventDefault(); setHotkeysOpen(false); }
        return;
      }
      // Пока открыта карточка строки, реестр под ней не листается.
      if (selectedRow) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        if ((getSelection()?.toString() ?? '').length > 0) return;
        if (!cursorRow) return;
        e.preventDefault();
        copyCursorRow();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === '/') { e.preventDefault(); focusSearchField(); return; }
      if (paged.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (cursor >= paged.length - 1) {
          if (safePage < totalPages) goToPage(safePage + 1, 'first');
        } else {
          setCursor(c => c + 1);
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        // Стрелка вверх до первого выбора ставит курсор на последнюю строку
        // страницы: иначе первое нажатие не делало бы ничего.
        if (cursor < 0) setCursor(paged.length - 1);
        else if (cursor === 0) { if (safePage > 1) goToPage(safePage - 1, 'last'); }
        else setCursor(c => c - 1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        if (safePage === 1) setCursor(0);
        else goToPage(1, 'first');
      } else if (e.key === 'End') {
        e.preventDefault();
        if (safePage === totalPages) setCursor(paged.length - 1);
        else goToPage(totalPages, 'last');
      } else if (e.key === 'Enter' && cursorRow) {
        e.preventDefault();
        setSelectedRow(cursorRow);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [viewMode, selectedRow, hotkeysOpen, cursor, cursorRow, paged.length, safePage, totalPages, copyCursorRow, focusSearchField, goToPage]);

  const severity = useMemo(() => countBySeverity(filtered), [filtered]);
  const occurrences = useMemo(() => signalOccurrences(rows), [rows]);
  // Счёт срезов — по ЗАГРУЖЕННЫМ строкам, как счётчики признаков рядом: иначе
  // подпись кнопки среза зависела бы от самого среза и таяла бы при нажатии.
  const sliceCounts = useMemo(() => slicePresetCounts(rows as SliceRow[]), [rows]);
  // Разбивка по организациям управления — по строкам ТЕКУЩЕЙ выборки:
  // читатель видит именно то, что лежит под таблицей. Учреждение без строк
  // остаётся в списке с честным «строк нет» — «организации нет» и «строк у неё
  // нет» обязаны различаться словами.
  const orgBreakdown = useOrgScope<Record<string, unknown>>(scopedRows, rowSubordinateKey);
  /** Подпись сфокусированной организации; ключ аппарата спрятан за русским именем. */
  const subFocusLabel = subFocus === null ? null : subordinateLabel(subFocus);
  // «В т.ч. инициативные заявки» (п.76б): счёт по ЗАГРУЖЕННЫМ строкам — как
  // счётчики признаков рядом, чтобы подпись фильтра не зависела от него самого.
  const initiativeTotals = useMemo(() => sumInitiativeRows(rows), [rows]);
  const unchecked = useMemo(() => countUncheckedByPeriod(filtered), [filtered]);

  const requestFilters = useMemo(() => requestFilterNames({
    departments: selectedDepartments.size,
    subordinates: selectedSubordinates.size,
    activity: activityFilter,
    procurement: procurementFilter,
    year,
  }), [selectedDepartments.size, selectedSubordinates.size, activityFilter, procurementFilter, year]);

  // Названия фильтров экрана. Два последних имени приписаны здесь, а не в
  // общем словаре фильтров: и срез, и режим организаций живут только на этой
  // странице. Молчать о них нельзя — иначе строка «на экране скрыто N» назовёт
  // не все причины, по которым выборка сжалась.
  const screenFilters = useMemo(() => {
    const names = screenFilterNames({
      period,
      months: activeMonths.size,
      search: searchQuery,
      signals: signalFilter.length,
      budgets: selectedBudgets.size,
      initiative: initiativeOnly,
    });
    if (orgMode.mode === 'grbs') names.push('только аппарат управления, без учреждений');
    if (slicePreset) names.push(`срез «${slicePreset.label}»`);
    if (subFocusLabel) names.push(`организация «${subFocusLabel}»`);
    return names;
  }, [period, activeMonths.size, searchQuery, signalFilter.length, selectedBudgets.size, initiativeOnly, orgMode.mode, slicePreset, subFocusLabel]);

  const counts = describeRegistryCounts({
    shown: paged.length,
    inSelection: filtered.length,
    loaded: rows.length,
    screenFilters,
    requestFilters,
  });

  const uncheckedNote = describeUncheckedByPeriod(unchecked, {
    period: period !== 'year' || activeMonths.size > 0,
    year: typeof year === 'number',
  });

  const planTotal = useMemo(() => filtered.reduce((s: number, r: { planSum?: number }) => s + (r.planSum || 0), 0), [filtered]);
  // Из чего сложена эта сумма: подпись величины плановых столбцов по периметру
  // (канон п.102) — уходит и в подсказку показателя, и в сноску рядом с числом.
  const planSemantics = usePlanSemantics();
  const factTotal = useMemo(() => filtered.reduce((s: number, r: { factSum?: number }) => s + (r.factSum || 0), 0), [filtered]);

  /**
   * Деньги каждой организации управления. Складываются те же поля строк, что
   * и в итогах выборки над таблицей, — второй формулы здесь нет, и разбивка не
   * может разойтись с итогом. Организация без строк остаётся в перечне с
   * нулевым счётом: «строк нет» и «организации нет» — разные новости, и
   * различать их обязаны слова, а не пропажа строки из таблицы.
   */
  const orgGroups = useMemo(
    () => orgBreakdown.subordinates.map((group) => {
      let plan = 0, fact = 0, economy = 0;
      for (const row of group.rows) {
        plan += Number(row.planSum) || 0;
        fact += Number(row.factSum) || 0;
        economy += Number(row.economy) || 0;
      }
      return { key: group.key, label: group.label, rows: group.rows.length, plan, fact, economy };
    }),
    [orgBreakdown],
  );

  const downloadTable = useCallback(() => {
    if (filtered.length === 0) return;
    const headers = ['№', 'Предмет закупки', 'Управление', 'Вид деятельности', 'Способ', 'План, тыс. ₽', 'Факт, тыс. ₽', 'Экономия, тыс. ₽', 'Дата плана', 'Дата факта', 'Статус', 'Признаки'];
    // Десятичная запятая, как в буфере обмена рядом: разделитель полей — «;»,
    // и точка в числе заставляла русский Excel читать «1234.5» текстом, а то и
    // резать его на две ячейки. Столбцы подписаны в тысячах рублей — масштаб
    // книги, а не переключатель единиц из шапки: файл не должен менять смысл
    // от того, как сейчас настроен экран.
    const money = (v: unknown) => (typeof v === 'number' ? String(v).replace('.', ',') : '');
    const csvRows = filtered.map(r => [
      r.id,
      `"${String(r.subject ?? '').replace(/"/g, '""')}"`,
      deptDisplayName(r.dept),
      `"${activityRowLabel(r.type, r.programName)}"`,
      r.method ?? '',
      money(r.planSum),
      money(r.factSum),
      money(r.economy),
      formatDateCell(r.planDate),
      formatDateCell(r.factDate),
      r.status ?? '',
      `"${(r.signals ?? []).map((s: string) => signalChipText(s).text).join(', ')}"`,
    ].join(';'));
    const bom = '\uFEFF';
    const csv = bom + headers.join(';') + '\n' + csvRows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const today = new Date().toISOString().slice(0, 10);
    // Периметр в имени файла: выгрузка живёт дальше экрана — по почте, в папке
    // среди соседних файлов, — и «Реестр закупок 2026-08-21.csv» ничего не
    // говорит о том, чьи строки и за какой год внутри. Косая черта и двоеточие
    // в имени файла недопустимы, поэтому управления перечисляются через тире.
    const deptPart = selectedDepartments.size === 0
      ? 'все управления'
      : [...selectedDepartments].map((d) => productLabel(toCanonicalDeptId(d))).join(' - ');
    const yearPart = typeof year === 'number' ? `${year}` : 'все годы';
    a.href = url;
    a.download = `Реестр закупок — ${deptPart} — ${yearPart} — выгружено ${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filtered, selectedDepartments, year]);

  /** Утверждение о выборке — оно же заголовок сводной строки. */
  const summaryClaim = severity.critical > 0
    ? `${severity.critical} ${pluralRu(severity.critical, 'строка требует', 'строки требуют', 'строк требуют')} разбора`
    : severity.warning > 0
      ? `${severity.warning} ${pluralRu(severity.warning, 'строка под', 'строки под', 'строк под')} наблюдением`
      : 'Критических признаков в выборке нет';

  const everythingFailed = trouble.failedDepts.length > 0 && rows.length === 0;
  const rowsBelowNote = describeRowsBelow(rowsBelow);

  /** Листание — одно на оба режима: редактор правит ту же страницу, что показывает просмотр. */
  const pager = (
    <div className="flex items-center gap-2 flex-shrink-0">
      <button
        type="button"
        onClick={() => setPageNum(Math.max(1, safePage - 1))}
        disabled={safePage <= 1}
        aria-label="Предыдущая страница"
        className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700 disabled:opacity-30 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
      >
        <ChevronLeft size={16} aria-hidden="true" />
      </button>
      <span className="px-2 font-medium tabular-nums" aria-live="polite">
        Страница {safePage} из {totalPages}
      </span>
      <button
        type="button"
        onClick={() => setPageNum(Math.min(totalPages, safePage + 1))}
        disabled={safePage >= totalPages}
        aria-label="Следующая страница"
        className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700 disabled:opacity-30 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
      >
        <ChevronRight size={16} aria-hidden="true" />
      </button>
    </div>
  );

  // Плашка корзины (п.73в): имя класса — канон, механизм — простыми словами,
  // счёт честный: «в классе всего» считается по загруженным строкам ДО
  // фильтров страницы, чтобы отличать «класс пуст» от «фильтры всё срезали».
  const bucketMeta = bucket ? BUCKET_META[bucket] : null;
  const bucketClassTotal = useMemo(
    () => (bucket ? rows.filter(BUCKET_META[bucket].predicate).length : 0),
    [rows, bucket],
  );

  return (
    <div className="space-y-4">
      {bucketMeta && (
        <section
          aria-label={bucketMeta.title}
          className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-zinc-200/60 dark:border-zinc-800/60 p-4"
        >
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                  {bucketMeta.title}
                </h2>
                {/* Происхождение числа рядом с именем класса: счёт класса
                    получен предикатом по строкам книг, а не взят с листа. */}
                <span title="Строки класса отобраны предикатом по полям книг управлений; официальный лист СВОД в этот счёт не участвует.">
                  <SourceBadge source="calc" />
                </span>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 leading-relaxed max-w-3xl">
                {bucketMeta.mechanism}
              </p>
            </div>
            {/* Подпись периметра (канон п.58): числа корзины подчиняются
                фильтрам шапки — плашка периода здесь не лжёт. */}
            <PeriodBadge />
          </div>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-2 tabular-nums">
            {bucketClassTotal > 0 ? (
              <>В классе{' '}
              {/* Карточка БЗ корзины (п.91-2): запись — в kb-additions.ts рядом
                  со страницей, гейт вливает её в общую базу знаний. */}
              <KbHover
                metricKey={bucketMeta.kbKey}
                live={`${bucketClassTotal} ${pluralRu(bucketClassTotal, 'строка проходит', 'строки проходят', 'строк проходят')} предикат класса среди загруженных книг;\nпод текущий отбор шапки и страницы ${pluralRu(filtered.length, 'подходит', 'подходят', 'подходят')} ${filtered.length}.\nСчёт класса идёт до фильтров экрана — так «класс пуст» отличим от «фильтры всё срезали».`}
              >
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  {bucketClassTotal} {pluralRu(bucketClassTotal, 'строка', 'строки', 'строк')}
                </span>
              </KbHover>{' '}
              из загруженных книг;
              под текущий отбор {pluralRu(filtered.length, 'подходит', 'подходят', 'подходят')} {filtered.length}.</>
            ) : loadingRows ? (
              'Строки книг ещё загружаются…'
            ) : (
              bucketMeta.emptyReason
            )}
          </p>
        </section>
      )}
      {/* Переключение режимов */}
      <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800/60 rounded-lg p-0.5 w-fit" role="tablist" aria-label="Режим работы с реестром">
        <button
          type="button"
          role="tab"
          aria-selected={viewMode === 'browse'}
          onClick={() => setViewMode('browse')}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500',
            viewMode === 'browse'
              ? 'bg-white dark:bg-zinc-700 text-zinc-800 dark:text-white shadow-sm'
              : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200',
          )}
        >
          <Eye size={13} aria-hidden="true" /> Просмотр
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={viewMode === 'editor'}
          onClick={() => setViewMode('editor')}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500',
            viewMode === 'editor'
              ? 'bg-white dark:bg-zinc-700 text-zinc-800 dark:text-white shadow-sm'
              : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200',
          )}
        >
          <Edit3 size={13} aria-hidden="true" /> Редактор таблиц
        </button>
      </div>

      {/* Плашка о непрочитанных книгах — одна на оба режима */}
      {!loadingRows && (trouble.failedDepts.length > 0 || trouble.partialDepts.length > 0) && (
        // Обводки нет (канон п.129): плашку от страницы отделяет тон заливки.
        <div className="flex items-start gap-2.5 px-4 py-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 text-xs">
          <AlertCircle size={15} className="text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <div className="space-y-1">
            {trouble.failedDepts.length > 0 && (
              <p className="text-amber-800 dark:text-amber-200">
                Книги не прочитаны: {trouble.failedDepts.join(', ')}. Строк этих управлений в реестре нет —
                проверьте доступ к книгам и обновите данные в шапке.
              </p>
            )}
            {trouble.partialDepts.length > 0 && (
              <p className="text-amber-800 dark:text-amber-200">
                Прочитаны не полностью: {trouble.partialDepts.join(', ')}. Часть строк не доехала — числа ниже
                занижены, обновите данные и сверьтесь.
              </p>
            )}
            {trouble.reason && (
              <p className="text-amber-700/80 dark:text-amber-300/70">Причина: {trouble.reason}</p>
            )}
          </div>
        </div>
      )}

      {viewMode === 'editor' ? (
        <>
          {/* Тот же выбор страницы, что и в просмотре: редактор правит её строки */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <label className="sr-only" htmlFor="editor-rows-per-page">Строк на странице</label>
              <select
                id="editor-rows-per-page"
                value={pageSize}
                onChange={e => { setPageSize(Number(e.target.value)); setPageNum(1); }}
                className="px-3 py-1.5 text-xs border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800/60 text-zinc-800 dark:text-zinc-200"
              >
                {PAGE_SIZES.map(size => (
                  <option key={size} value={size}>
                    {size >= 1000000 ? 'Все строки' : `${size} строк`}
                  </option>
                ))}
              </select>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {filtered.length} {pluralRu(filtered.length, 'строка', 'строки', 'строк')} в выборке
              </span>
            </div>
            {pager}
          </div>
          <TableEditor
            columns={editorColumns}
            rows={editorRows}
            loading={loadingRows}
            onCellChange={handleEditorCellChange}
            onSaveRow={handleEditorSaveRow}
            onRevertRow={handleEditorRevertRow}
            onAddColumn={handleEditorAddColumn}
            emptyReason={
              everythingFailed
                ? 'Книги управлений не прочитаны — правки сейчас невозможны. Проверьте доступ и обновите данные.'
                : rows.length === 0
                  ? 'По фильтрам шапки не загружено ни одной строки. Снимите часть фильтров — редактор правит только загруженные строки.'
                  : 'На этой странице реестра строк нет. Перейдите на другую страницу или снимите часть фильтров.'
            }
            notice={
              `Редактор правит страницу реестра — сейчас это ${paged.length} ${pluralRu(paged.length, 'строка', 'строки', 'строк')} `
              + `из ${filtered.length} в выборке; остальные листаются кнопками рядом с выбором размера страницы. `
              + 'Строки заводятся и удаляются в самой книге управления: редактор правит существующие ячейки и пишет их в лист.'
            }
            rowAddress={(row) => rowAddressOf(row._dept, row._rowIndex)}
            prefsName="registry-editor"
          />
        </>
      ) : (
      <>
      {/* ── Срезы реестра ────────────────────────────────────────────────────
           Именованные отборы строк в один щелчок: готовый вопрос вместо
           перебора признаков по одному. Одновременно активен ровно один —
           срезы отвечают на разные вопросы, а не складываются. Список живёт
           в lib/rows/slice-presets: новый срез — одна запись словаря, разметку
           здесь править не нужно. Обводок на кнопках нет (канон п.129):
           нажатую отделяет светлота поверхности внутри общей подложки. */}
      <section aria-label="Срезы реестра" className="space-y-1.5">
        <div
          role="group"
          aria-label="Готовые срезы строк"
          className="flex items-center gap-0.5 bg-zinc-100 dark:bg-zinc-800/60 rounded-lg p-0.5 w-fit flex-wrap"
        >
          <button
            type="button"
            aria-pressed={slicePresetId === null}
            title="Все строки текущей выборки, без именованного среза"
            onClick={() => setSlicePresetId(null)}
            className={clsx(
              'px-2.5 py-1 rounded-md text-xs font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500',
              slicePresetId === null
                ? 'bg-white dark:bg-zinc-700 text-zinc-800 dark:text-white shadow-sm'
                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200',
            )}
          >
            Без среза
          </button>
          {REGISTRY_SLICE_PRESETS.map((preset) => {
            const active = slicePresetId === preset.id;
            const found = sliceCounts[preset.id] ?? 0;
            // Пустой срез не исчезает и не притворяется доступным: кнопка
            // остаётся на месте, гаснет и объясняет причину словами.
            const unavailable = found === 0 && !active;
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={active}
                disabled={unavailable || loadingRows}
                title={loadingRows
                  ? 'Книги ещё читаются — счёт по срезам появится после загрузки'
                  : unavailable
                    ? `${preset.mechanism}\n\nСейчас: ${preset.emptyReason}`
                    : preset.mechanism}
                onClick={() => setSlicePresetId(active ? null : preset.id)}
                className={clsx(
                  'px-2.5 py-1 rounded-md text-xs font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500',
                  active
                    ? 'bg-white dark:bg-zinc-700 text-zinc-800 dark:text-white shadow-sm'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200',
                  (unavailable || loadingRows) && 'opacity-45 cursor-not-allowed',
                )}
              >
                {preset.label}
                <span className="ml-1.5 tabular-nums text-[10px] text-zinc-400 dark:text-zinc-500">
                  {loadingRows ? '—' : found}
                </span>
              </button>
            );
          })}
        </div>
        {/* Скоуп и момент чтения у самого числа (канон п.58): счёт кнопок
            берётся по загруженным строкам, а не по тому, что осталось после
            фильтров экрана, — иначе подпись среза зависела бы от него самого. */}
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-snug max-w-3xl">
          {slicePreset ? (
            <>
              {slicePreset.mechanism}{' '}
              {(sliceCounts[slicePreset.id] ?? 0) === 0
                ? slicePreset.emptyReason
                : `Под срез подходит ${sliceCounts[slicePreset.id]} ${pluralRu(sliceCounts[slicePreset.id] ?? 0, 'строка', 'строки', 'строк')} из загруженных; в таблице ниже они дополнительно сужены фильтрами экрана — сейчас ${filtered.length}.`}
            </>
          ) : (
            <>
              Числа у кнопок — сколько загруженных строк проходит срез
              {typeof year === 'number' ? ` за ${year} год` : ' за все годы книг'} по книгам,
              прочитанным под отбор шапки. Фильтры экрана — период, поиск, признаки — этот счёт
              не меняют.
            </>
          )}
        </p>
      </section>

      {/* Панель: размер страницы, фильтр признаков, выгрузка */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <label className="sr-only" htmlFor="rows-per-page">Строк на странице</label>
          <select
            id="rows-per-page"
            value={pageSize}
            onChange={e => { setPageSize(Number(e.target.value)); setPageNum(1); }}
            className="px-3 py-1.5 text-xs border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800/60 text-zinc-800 dark:text-zinc-200"
          >
            {PAGE_SIZES.map(size => (
              <option key={size} value={size}>
                {/* «Все» — по просьбе пользователей: реестр целиком, без листания */}
                {size >= 1000000 ? 'Все строки' : `${size} строк`}
              </option>
            ))}
          </select>

          {/* Быстрый порядок строк: по строкам листа / по деньгам / по числу дел.
              Дефолт «по строкам» — до решения владельца (вопрос 37). Сортировка
              по заголовку столбца снимает выбор переключателя сама собой. */}
          <div
            role="group"
            aria-label="Порядок строк реестра"
            className="flex items-center gap-0.5 bg-zinc-100 dark:bg-zinc-800/60 rounded-lg p-0.5"
          >
            {SORT_PRESETS.map((p) => {
              const active = sortKey === p.key && sortDir === p.dir;
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={active}
                  title={p.hint}
                  onClick={() => { setSortKey(p.key); setSortDir(p.dir); setPageNum(1); }}
                  className={clsx(
                    'px-2.5 py-1 rounded-md text-xs font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500',
                    active
                      ? 'bg-white dark:bg-zinc-700 text-zinc-800 dark:text-white shadow-sm'
                      : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200',
                  )}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          {/* Фильтр по признакам строк */}
          <div className="relative" ref={signalDropdownRef}>
            <button
              type="button"
              aria-expanded={signalDropdownOpen}
              aria-haspopup="true"
              onClick={() => setSignalDropdownOpen(v => !v)}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-lg transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500',
                signalFilter.length > 0
                  ? 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800'
                  : 'text-zinc-600 dark:text-zinc-300 bg-white dark:bg-zinc-800/60 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-700/30',
              )}
            >
              <Filter size={13} aria-hidden="true" />
              Признаки строк
              {signalFilter.length > 0 && (
                <span className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-600 text-[10px] font-bold text-white leading-none">
                  {signalFilter.length}
                </span>
              )}
            </button>
            {signalDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 z-50 w-72 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg py-1">
                <p className="px-3 py-1.5 text-[10px] text-zinc-500 dark:text-zinc-400 border-b border-zinc-100 dark:border-zinc-700">
                  {loadingRows
                    ? 'Книги ещё читаются — счёт по признакам появится после загрузки.'
                    : 'Рядом — сколько загруженных строк несёт признак. Признаки, которых в загруженных строках нет, выбрать нельзя.'}
                </p>
                <div className="max-h-64 overflow-y-auto">
                  {ALL_SIGNAL_KEYS.map((key) => {
                    const found = occurrences[key] ?? 0;
                    const checked = signalFilter.includes(key);
                    const unavailable = found === 0 && !checked;
                    const chip = signalChipText(key);
                    const tone = signalTone(key);
                    return (
                      <label
                        key={key}
                        title={unavailable ? 'В загруженных строках такого признака нет' : chip.hint}
                        className={clsx(
                          'flex items-center gap-2 px-3 py-1.5 text-xs transition',
                          unavailable
                            ? 'opacity-45 cursor-not-allowed'
                            : 'text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700/40 cursor-pointer',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={unavailable}
                          onChange={() => {
                            setSignalFilter(prev =>
                              prev.includes(key) ? prev.filter(s => s !== key) : [...prev, key]
                            );
                          }}
                          className="rounded border-zinc-300 dark:border-zinc-600 text-blue-600 focus:ring-blue-500"
                        />
                        <span className={clsx('px-1.5 py-0.5 rounded text-[10px] font-medium', tone.bg, tone.text)}>
                          {chip.text}
                        </span>
                        <span className="ml-auto tabular-nums text-[10px] text-zinc-400 dark:text-zinc-500">{found}</span>
                      </label>
                    );
                  })}
                </div>
                {/* Инициативные заявки (п.76б): отдельная секция — это стадия
                    по маркеру словаря, а не признак-сигнал движка. */}
                <div className="border-t border-zinc-100 dark:border-zinc-700 mt-1 pt-1">
                  <label
                    title={initiativeTotals.rows === 0 && !initiativeOnly
                      ? 'В загруженных строках нет ни одной ячейки примечания, целиком равной маркеру «хотелки»'
                      : 'Стадия «инициативная заявка без подтверждённой потребности»: примечание строки целиком равно маркеру словаря («хотелки», «Хотелки», «просто хотелки»). План таких строк виден, но подписывается отдельно.'}
                    className={clsx(
                      'flex items-center gap-2 px-3 py-1.5 text-xs transition',
                      initiativeTotals.rows === 0 && !initiativeOnly
                        ? 'opacity-45 cursor-not-allowed'
                        : 'text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700/40 cursor-pointer',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={initiativeOnly}
                      disabled={initiativeTotals.rows === 0 && !initiativeOnly}
                      onChange={() => setInitiativeOnly(v => !v)}
                      className="rounded border-zinc-300 dark:border-zinc-600 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-400">
                      инициативные заявки
                    </span>
                    <span className="ml-auto tabular-nums text-[10px] text-zinc-400 dark:text-zinc-500">
                      {initiativeTotals.rows}
                    </span>
                  </label>
                  {initiativeTotals.rows > 0 && (
                    <p className="px-3 pb-1.5 text-[10px] text-zinc-400 dark:text-zinc-500 tabular-nums">
                      в плане загруженных строк — в т.ч. инициативные заявки{' '}
                      {formatMoney(initiativeTotals.planSum)} ({initiativeTotals.rows}{' '}
                      {pluralRu(initiativeTotals.rows, 'строка', 'строки', 'строк')})
                    </p>
                  )}
                </div>
                {(signalFilter.length > 0 || initiativeOnly) && (
                  <div className="border-t border-zinc-100 dark:border-zinc-700 mt-1 pt-1 px-3 pb-1">
                    <button
                      type="button"
                      onClick={() => { setSignalFilter([]); setInitiativeOnly(false); setSignalDropdownOpen(false); }}
                      className="flex items-center gap-1 text-xs text-zinc-500 hover:text-red-500 dark:text-zinc-400 dark:hover:text-red-400 transition"
                    >
                      <X size={12} aria-hidden="true" /> Снять выбор признаков
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={copyCursorAddress}
            disabled={!cursorRow}
            title={cursorRow
              ? 'Скопировать адрес строки — лист управления и номер строки в книге'
              : 'Сначала выберите строку — щелчком или стрелками'}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 bg-white dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700/30 disabled:opacity-40 disabled:cursor-not-allowed transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
          >
            <MapPin size={13} aria-hidden="true" /> Скопировать адрес строки
          </button>

          <button
            type="button"
            onClick={() => setHotkeysOpen(v => !v)}
            aria-expanded={hotkeysOpen}
            title="Горячие клавиши реестра"
            aria-label="Показать горячие клавиши реестра"
            className={clsx(
              'flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border rounded-lg transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500',
              hotkeysOpen
                ? 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800'
                : 'text-zinc-600 dark:text-zinc-300 bg-white dark:bg-zinc-800/60 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-700/30',
            )}
          >
            <Keyboard size={13} aria-hidden="true" /> Клавиши
          </button>

          <button
            type="button"
            onClick={downloadTable}
            disabled={filtered.length === 0}
            title="Файл в формате CSV с текущей выборкой — открывается в Excel и Р7-Офис"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 bg-white dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700/30 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            <Download size={13} aria-hidden="true" /> Выгрузить таблицу
          </button>
        </div>
      </div>

      {/* Подсказка по клавишам — раскрывается на месте, не поверх экрана (канон: оверлей только для доказательства числа) */}
      {hotkeysOpen && (
        // Обводки нет (канон п.129): подсказку от страницы отделяет светлота фона.
        <div className="px-4 py-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/40">
          <div className="flex items-start justify-between gap-3">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              {HOTKEYS.map(({ keys, what }) => (
                <div key={keys} className="contents">
                  <dt className="font-medium text-zinc-700 dark:text-zinc-200 whitespace-nowrap">{keys}</dt>
                  <dd className="text-zinc-500 dark:text-zinc-400">— {what}</dd>
                </div>
              ))}
            </dl>
            <button
              type="button"
              onClick={() => setHotkeysOpen(false)}
              aria-label="Скрыть подсказку по клавишам"
              className="p-1 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {/* Сводка по выборке — утверждение, затем деньги */}
      {!loadingRows && filtered.length > 0 && (
        <div className="flex items-center gap-4 px-4 py-2.5 bg-white dark:bg-zinc-800/60 rounded-lg border border-zinc-200/60 dark:border-zinc-700/50 text-xs flex-wrap">
          <span className={clsx(
            'font-medium',
            severity.critical > 0
              ? 'text-red-600 dark:text-red-400'
              : severity.warning > 0
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-emerald-600 dark:text-emerald-400',
          )}>
            {summaryClaim}
          </span>
          <span className="w-px h-4 bg-zinc-200 dark:bg-zinc-700" />
          <span className="text-zinc-500 dark:text-zinc-400">
            {filtered.length} {pluralRu(filtered.length, 'строка', 'строки', 'строк')} в выборке
          </span>
          <span className="w-px h-4 bg-zinc-200 dark:bg-zinc-700" />
          <span className="text-zinc-500 dark:text-zinc-400 inline-flex items-center gap-1.5 flex-wrap">
            План:{' '}
            <KbHover
              metricKey="plan_total"
              live={`${formatMoney(planTotal)} — сумма плановых итогов по строкам текущей выборки (их ${filtered.length}).\nПервичка: колонка «ИТОГО план» книг управлений.\nЭто не показатель листа СВОД: выборка сужена фильтрами.\n\n${planSemanticsHoverText(planSemantics)}`}
            >
              <span className="font-medium text-zinc-700 dark:text-zinc-300 tabular-nums">{formatMoney(planTotal)}</span>
            </KbHover>
            {/* Сумма по строкам разных книг: у УДТХ в плановой колонке лимит, у
                остальных НМЦК — подпись идёт вплотную к числу (канон п.102). */}
            <PlanSemanticsNote compact />
          </span>
          <span className="w-px h-4 bg-zinc-200 dark:bg-zinc-700" />
          <span className="text-zinc-500 dark:text-zinc-400">
            Факт:{' '}
            <KbHover
              metricKey="fact_total"
              live={`${formatMoney(factTotal)} — сумма фактических итогов по строкам текущей выборки (их ${filtered.length}).\nПервичка: колонка «ИТОГО факт» книг управлений.\nСтроки без заключённого контракта дают ноль и сумму не поднимают.`}
            >
              <span className="font-medium text-zinc-700 dark:text-zinc-300 tabular-nums">{formatMoney(factTotal)}</span>
            </KbHover>
          </span>
          {severity.critical > 0 && severity.warning > 0 && (
            <>
              <span className="w-px h-4 bg-zinc-200 dark:bg-zinc-700" />
              <span className="text-amber-600 dark:text-amber-400">
                и ещё {severity.warning} {pluralRu(severity.warning, 'строка', 'строки', 'строк')} с предупреждениями
              </span>
            </>
          )}
          <span className="ml-auto flex items-center gap-3 flex-wrap">
            {/* Шов Реестр → Свод (канон п.91-8): итоги той же выборки в сетке
                Свода. Общие фильтры (управления, период, способ, бюджет)
                переезжают сами — они живут в шапке; локальные фильтры этой
                страницы (признаки, поиск по признакам) действуют только здесь. */}
            {!bucket && (
              <button
                type="button"
                onClick={() => navigateTo('svod')}
                title="Открыть вкладку «Свод» с теми же фильтрами шапки: управления, период, способ и бюджет сохранятся. Фильтр по признакам строк действует только в Реестре."
                className="text-cyan-700 dark:text-cyan-300 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 rounded-sm"
              >
                Итоги выборки — в сетке Свода
              </button>
            )}
            {/* Подпись периметра (канон п.58): числа строки подчиняются
                фильтрам периода из шапки — плашка честная. Рядом момент, на
                который эти числа верны: книги живут, и без него читатель не
                отличит «сегодня так» от «так было во вторник». */}
            <ReadMomentNote />
            <PeriodBadge />
          </span>
        </div>
      )}

      {/* ── Организации управления (режим подведов, приказ владельца 20.08) ──
           Реестр — единственное место, где разрез по учреждениям НАСТОЯЩИЙ:
           заказчик записан в самой строке книги (колонка C), делить готовые
           итоги пропорцией не приходится. Поэтому здесь карточка не «одна
           строка ГРБС», а разбивка: аппарат первым, дальше учреждения по
           алфавиту. Щелчок по строке сужает таблицу до этой организации. */}
      {!loadingRows && orgMode.mode !== 'district' && (
        <section
          aria-label="Организации управления"
          className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-200/60 dark:border-zinc-700/50 p-4 space-y-2"
        >
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                  Организации управления
                </h2>
                {/* Происхождение числа: суммы сложены по строкам книг, а не
                    взяты с официального листа (канон двухисточниковости). */}
                <span title="Числа сложены по строкам книг управления: заказчик берётся из колонки C, суммы — из плановых и фактических итогов строки.">
                  <SourceBadge source="calc" />
                </span>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed max-w-3xl">
                Строки текущей выборки, разложенные по заказчику: аппарат управления первой
                строкой, дальше подведомственные учреждения по алфавиту.
              </p>
            </div>
            {/* Подпись периметра (канон п.58): разбивка считается по той же
                выборке, что и таблица, — период у неё общий с шапкой. */}
            <PeriodBadge />
          </div>

          {orgMode.mode === 'grbs' ? (
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-snug">
              {orgBreakdown.hasSubs
                ? 'Выбран режим «только управление»: в таблице остались закупки аппарата, строки учреждений скрыты этим режимом. Вернуть разбивку — переключить управление в фильтре на «с подведомственными».'
                : 'Выбран режим «только управление». Подведомственных учреждений у него нет, поэтому режим ничего не убирает: в таблице те же строки.'}
            </p>
          ) : !orgBreakdown.hasSubs ? (
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-snug">
              У этого управления подведомственных учреждений нет: все строки выборки — закупки
              самого аппарата, и раскладывать их не на что.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto -mx-1 px-1 max-h-72 overflow-y-auto">
                <table className="w-full text-xs">
                  <caption className="sr-only">
                    Строки выборки по организациям управления: число строк, план, факт и экономия
                  </caption>
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                      <th scope="col" className="py-1.5 pr-3 font-medium">Организация</th>
                      <th scope="col" className="py-1.5 px-2 font-medium text-right">Строк</th>
                      <th scope="col" className="py-1.5 px-2 font-medium text-right">План, {moneyUnit} ₽</th>
                      <th scope="col" className="py-1.5 px-2 font-medium text-right">Факт, {moneyUnit} ₽</th>
                      <th scope="col" className="py-1.5 pl-2 font-medium text-right">Экономия, {moneyUnit} ₽</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
                    {orgGroups.map((group) => {
                      const focused = subFocus === group.key;
                      return (
                        <tr
                          key={group.key}
                          className={clsx(
                            'transition',
                            focused
                              ? 'bg-blue-50/60 dark:bg-zinc-700/40'
                              : group.rows > 0 && 'hover:bg-blue-50/30 dark:hover:bg-zinc-700/30',
                          )}
                        >
                          <th scope="row" className="py-1.5 pr-3 text-left font-medium text-zinc-700 dark:text-zinc-200">
                            {group.rows > 0 ? (
                              <button
                                type="button"
                                aria-pressed={focused}
                                onClick={() => setSubFocus(focused ? null : group.key)}
                                title={focused
                                  ? 'Снять сужение: вернуть в таблицу строки всех организаций управления'
                                  : `Оставить в таблице только строки этой организации (${group.rows})`}
                                className="text-left hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 rounded-sm"
                              >
                                {group.label}
                              </button>
                            ) : (
                              <span className="text-zinc-500 dark:text-zinc-400">{group.label}</span>
                            )}
                          </th>
                          {group.rows === 0 ? (
                            // Честная пустота: организация из перечня не исчезает,
                            // а говорит, что строк у неё в выборке нет.
                            <td colSpan={4} className="py-1.5 px-2 text-right text-[11px] text-zinc-400 dark:text-zinc-500">
                              строк этой организации в выборке нет
                            </td>
                          ) : (
                            <>
                              <td className="py-1.5 px-2 text-right tabular-nums text-zinc-500 dark:text-zinc-400">{group.rows}</td>
                              <td className="py-1.5 px-2 text-right tabular-nums text-zinc-700 dark:text-zinc-200">{formatMoney(group.plan)}</td>
                              <td className="py-1.5 px-2 text-right tabular-nums text-zinc-700 dark:text-zinc-200">{formatMoney(group.fact)}</td>
                              <td className="py-1.5 pl-2 text-right tabular-nums text-emerald-700 dark:text-emerald-400">
                                {group.economy > 0 ? formatMoney(group.economy) : <span className="text-zinc-400 dark:text-zinc-500">нет</span>}
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-zinc-400 dark:text-zinc-500 leading-snug">
                Разбивка появилась потому, что в фильтре выбрано одно управление «с
                подведомственными». Организация без строк из перечня не исчезает: пустая строка
                значит «закупок в выборке нет», а не «учреждения нет».
              </p>
              {subFocusLabel && (
                <p className="text-[11px] text-zinc-600 dark:text-zinc-300 flex items-center gap-2 flex-wrap">
                  В таблице ниже — только строки организации «{subFocusLabel}».
                  <button
                    type="button"
                    onClick={() => setSubFocus(null)}
                    className="inline-flex items-center gap-1 text-cyan-700 dark:text-cyan-300 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 rounded-sm"
                  >
                    <X size={11} aria-hidden="true" /> вернуть все организации
                  </button>
                </p>
              )}
            </>
          )}
        </section>
      )}

      {/* Таблица */}
      <div className="relative bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 overflow-hidden">
        {/* Прокрутка живёт здесь: прилипшая шапка держится только за собственную
            прокручиваемую область, а не за прокрутку страницы. */}
        <div ref={scrollRef} className={TABLE_SCROLL_AREA}>
          <table className="w-full text-sm">
            <caption className="sr-only">Реестр строк закупок по текущим фильтрам</caption>
            <thead>
              <tr className="text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                {([
                  ['id', '№', 'pl-5 pr-2 py-3 w-10', ''],
                  ['subject', 'Предмет закупки', 'px-3 py-3', ''],
                  ['method', 'Способ', 'px-3 py-3 w-16', ''],
                  // Единица в подписи берётся из шапки: при переключении на млн
                  // застывшее «тыс.» превращало верную цифру в неверное утверждение.
                  ['planSum', `План, ${moneyUnit} ₽`, 'px-3 py-3 w-28', 'text-right'],
                  ['factSum', `Факт, ${moneyUnit} ₽`, 'px-3 py-3 w-28', 'text-right'],
                  // Единица у столбца экономии — та же, что у плана и факта:
                  // без неё столбец единственный на таблице читался безразмерным.
                  // В срезе, где экономия читается по числам, подпись сразу
                  // называет вторую величину столбца — долю от плана: число
                  // без имени читатель достраивает сам и обычно неверно.
                  [
                    'economy',
                    slicePreset?.economyByNumbers === true
                      ? `Экономия, ${moneyUnit} ₽ · % плана`
                      : `Экономия, ${moneyUnit} ₽`,
                    'px-3 py-3 w-28',
                    'text-right',
                  ],
                  ['status', 'Статус', 'px-3 py-3 w-28', ''],
                ] as [SortKey, string, string, string][]).map(([key, label, cls, align], colIdx) => (
                  <th
                    key={key}
                    scope="col"
                    aria-sort={sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    className={clsx(
                      cls,
                      align,
                      'sticky top-0 bg-zinc-50 dark:bg-zinc-900',
                      // Номер строки не уезжает вбок: на широкой таблице читатель
                      // иначе теряет, о какой строке речь.
                      colIdx === 0 ? `left-0 z-30 ${STICKY_SEAM}` : 'z-20',
                    )}
                  >
                    {/* Кнопка, а не onClick на ячейке: сортировка обязана быть доступна с клавиатуры */}
                    <button
                      type="button"
                      onClick={() => toggleSort(key)}
                      aria-label={`Сортировать по столбцу «${label}»`}
                      className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-zinc-700 dark:hover:text-zinc-200 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 rounded-sm"
                    >
                      {label}
                      {sortKey === key
                        ? (sortDir === 'asc' ? <ArrowUp size={11} aria-hidden="true" /> : <ArrowDown size={11} aria-hidden="true" />)
                        : <ArrowUpDown size={11} className="opacity-30" aria-hidden="true" />}
                    </button>
                  </th>
                ))}
                <th scope="col" className="px-3 py-3 sticky top-0 z-20 bg-zinc-50 dark:bg-zinc-900">
                  Признаки строки
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
              {!loadingRows && paged.map((row, i) => {
                const noDate = !rowHasPeriodDate(row);
                const noYear = !row.planYear;
                const isCursor = i === cursor;
                // Прямой эфир: строку только что правили в книге. Подсветка
                // держится несколько секунд и гаснет сама — след правки, а не
                // постоянная метка.
                const justChanged = liveChangedRows.get(changedRowKey(row.dept, row.rowIndex ?? -1));
                // Экономия по числам (план минус факт) — только в срезе, где
                // графы экономии книги пусты по построению; условие и порог
                // шума приходят из канона явления, а не переписаны здесь.
                const economyByNumbers = slicePreset?.economyByNumbers === true
                  ? numericEconomyOf(row as SliceRow)
                  : null;
                // Доля показанной экономии от плана — вторая величина столбца
                // в том же срезе: она объясняет размер вопроса быстрее суммы.
                const economyShare = slicePreset?.economyByNumbers === true && row.planSum > 0
                  ? (row.economy / row.planSum) * 100
                  : null;
                return (
                <tr
                  key={`${row.dept}-${row.rowIndex ?? row.id}-${i}`}
                  ref={el => { rowRefs.current[i] = el; }}
                  // Строка сама принимает фокус: без этого стрелки некуда было бы
                  // привести, а экранный диктор не назвал бы текущую строку.
                  tabIndex={isCursor ? 0 : -1}
                  aria-current={isCursor ? 'true' : undefined}
                  onFocus={() => setCursor(i)}
                  className={clsx(
                    'transition group cursor-pointer scroll-mt-12',
                    // Тихая подсветка: полоса слева, а не заливка — по сотням строк
                    // курсор ходит часто, громкая подсветка превратилась бы в мельтешение.
                    isCursor
                      ? 'bg-blue-50/60 dark:bg-zinc-700/40 outline-none'
                      : 'hover:bg-blue-50/30 dark:hover:bg-zinc-700/30',
                    justChanged && 'live-row-changed',
                  )}
                  title={justChanged ? `Только что изменено — ${rowChangeHint(justChanged)}` : undefined}
                  onClick={() => { setCursor(i); setSelectedRow(row); }}
                >
                  <td className={clsx(
                    'pl-5 pr-2 py-3 text-zinc-400 dark:text-zinc-500 tabular-nums sticky left-0 z-10',
                    STICKY_SEAM,
                    isCursor ? 'bg-blue-50 dark:bg-zinc-700' : `${STICKY_SURFACE} group-hover:bg-zinc-50 dark:group-hover:bg-zinc-800`,
                  )}>
                    {/* Полоса-указатель текущей строки: цвет не единственный её признак */}
                    {isCursor && (
                      <span className="absolute left-0 top-0 h-full w-0.5 bg-blue-500 dark:bg-blue-400" aria-hidden="true" />
                    )}
                    {row.id !== null && row.id !== undefined && row.id !== ''
                      ? row.id
                      : <span title="Порядковый номер в книге не проставлен">б/н</span>}
                  </td>
                  <td className="px-3 py-3">
                    {/* Кнопка внутри строки: карточка строки открывается и с клавиатуры */}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setSelectedRow(row); }}
                      className="block text-left font-medium text-zinc-700 dark:text-zinc-200 truncate max-w-xs hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 rounded-sm"
                    >
                      {row.subject || 'Предмет закупки не указан'}
                    </button>
                    {/* Бейджи стадий переносятся на новую строку, а не режутся
                        обрезанием текста: на экране 360–430 px «truncate» съедал
                        подпись стадии целиком (критерий п.91-5). Обрезается
                        только имя управления с видом деятельности. */}
                    <div className="text-[10px] text-zinc-400 dark:text-zinc-500 max-w-xs flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                      <span className="truncate max-w-full">
                        {deptDisplayName(row.dept)} • {activityRowLabel(row.type, row.programName)}
                      </span>
                      {/* Стадия «в течение года» (п.71б): собственная подпись
                          вместо лживого «есть факт»; вне стадии бейджа нет. */}
                      <YearlongBadge row={row} />
                      {isInitiativeMarker(row.commentGRBS) && (
                        <span
                          className="px-1 py-px rounded bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-400"
                          title="Стадия «инициативная заявка без подтверждённой потребности»: примечание строки целиком равно маркеру словаря «хотелки» (п.76). План виден, но подписывается отдельно и в риск-списки не шумит."
                        >
                          инициативная заявка
                        </span>
                      )}
                      {noDate && (
                        <span
                          className="px-1 py-px rounded bg-zinc-100 dark:bg-zinc-700/50 text-zinc-500 dark:text-zinc-400"
                          title="Ни плановая, ни фактическая дата не заполнены: фильтр периода такую строку не проверял"
                        >
                          без даты
                        </span>
                      )}
                      {!noDate && noYear && (
                        <span
                          className="px-1 py-px rounded bg-zinc-100 dark:bg-zinc-700/50 text-zinc-500 dark:text-zinc-400"
                          title="Год плана в книге не проставлен: годовой фильтр такую строку не проверял"
                        >
                          без года плана
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    {row.method ? (
                      <span className={clsx(
                        'inline-block px-1.5 py-0.5 rounded text-[10px] font-bold',
                        row.method === 'ЕП' ? 'bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400' : 'bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400'
                      )}>
                        {row.method}
                      </span>
                    ) : (
                      <span className="text-[10px] text-zinc-400 dark:text-zinc-500" title="Способ определения поставщика в книге не заполнен">
                        не указан
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                    {row.planSum > 0
                      ? formatMoney(row.planSum)
                      : <span className="text-zinc-400 dark:text-zinc-500" title="Плановые суммы в книге не заполнены">нет плана</span>}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                    {row.factSum > 0
                      ? formatMoney(row.factSum)
                      : <span className="text-zinc-400 dark:text-zinc-500" title="Контракт не заключён или его сумма не внесена">нет факта</span>}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {row.economy > 0 ? (
                      <>
                        <span className="text-emerald-600 dark:text-emerald-400 font-medium">{formatMoney(row.economy)}</span>
                        {economyShare !== null && (
                          <span className="block text-[10px] font-normal text-zinc-500 dark:text-zinc-400">
                            {formatPct(economyShare)} плана
                          </span>
                        )}
                      </>
                    ) : row.economy < 0 ? (
                      // Отрицательная экономия не прячется под «не отмечена»:
                      // так быть не должно, и молчание об этом — потеря случая,
                      // ради которого на столбец и смотрят.
                      <span
                        className="text-red-600 dark:text-red-400 font-medium"
                        title="Экономия отрицательная: факт превысил план. Проверьте суммы строки — либо план занижен правкой задним числом, либо в факт попала не та сумма."
                      >
                        {formatMoney(row.economy)}
                      </span>
                    ) : economyByNumbers !== null ? (
                      // Срез «Экономия без отметки»: графы экономии книги пусты
                      // по построению — формула листа заполняет их только после
                      // отметки «да». Показываем разность плана и факта и прямо
                      // говорим, откуда взято число (канон п.58).
                      <span
                        title={
                          'Число прочитано как план минус факт на момент чтения книг: графы экономии книги '
                          + '(Z/AA/AB) заполняются формулой листа только после отметки «да» в графе «Статус», '
                          + 'а её у этой строки нет.'
                        }
                      >
                        <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                          {formatMoney(economyByNumbers.economy)}
                        </span>
                        <span className="block text-[10px] font-normal text-zinc-500 dark:text-zinc-400">
                          {formatPct(economyByNumbers.sharePct)} плана · по числам
                        </span>
                      </span>
                    ) : (
                      <span
                        className="text-zinc-400 dark:text-zinc-500"
                        title={row.factSum > 0
                          ? 'Экономия не зафиксирована: столбцы экономии пусты или признак экономии не проставлен'
                          : 'Экономия появится после заключения контракта'}
                      >
                        {row.factSum > 0 ? 'не отмечена' : 'нет факта'}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {row.status ? (
                      <span className={clsx(
                        'inline-flex items-center gap-1 text-xs font-medium',
                        row.status === 'Подписан' && 'text-emerald-600 dark:text-emerald-400',
                        row.status === 'Отменён' && 'text-zinc-400 dark:text-zinc-500',
                        row.status === 'Планирование' && 'text-blue-600 dark:text-blue-400',
                        row.status === 'Исполнение' && 'text-amber-600 dark:text-amber-400',
                        row.status === 'Просрочен' && 'text-red-600 dark:text-red-400',
                        row.status === 'Скоро срок' && 'text-yellow-600 dark:text-yellow-400',
                        row.status === 'Ошибка' && 'text-red-600 dark:text-red-400',
                        row.status === 'Открыт' && 'text-zinc-500 dark:text-zinc-400',
                      )}>
                        {row.status === 'Подписан' && <CheckCircle2 size={13} aria-hidden="true" />}
                        {row.status === 'Отменён' && <XCircle size={13} aria-hidden="true" />}
                        {row.status === 'Планирование' && <Clock size={13} aria-hidden="true" />}
                        {row.status === 'Просрочен' && <AlertCircle size={13} aria-hidden="true" />}
                        {row.status === 'Ошибка' && <AlertCircle size={13} aria-hidden="true" />}
                        {row.status}
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-400 dark:text-zinc-500" title="Состояние не рассчитано: в строке нет ни сроков, ни сумм">
                        не рассчитан
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(row.signals ?? []).length === 0 && (
                        <span className="text-[10px] text-zinc-400 dark:text-zinc-500" title="Проверки к этой строке замечаний не нашли">
                          замечаний нет
                        </span>
                      )}
                      {(row.signals ?? []).map((sig: string) => {
                        const chip = signalChipText(sig);
                        const tone = signalTone(sig);
                        return (
                          <span
                            key={sig}
                            title={chip.hint}
                            className={clsx('px-1.5 py-0.5 rounded text-[10px] font-medium', tone.bg, tone.text)}
                          >
                            {chip.text}
                          </span>
                        );
                      })}
                    </div>
                  </td>
                </tr>
                );
              })}

              {/* Загрузка — спокойный скелет вместо крутящегося колеса */}
              {loadingRows && Array.from({ length: 6 }).map((_, i) => (
                <tr key={`skeleton-${i}`} aria-hidden="true">
                  {Array.from({ length: 8 }).map((__, j) => (
                    <td key={j} className="px-3 py-3">
                      <div className="h-2.5 rounded bg-zinc-100 dark:bg-zinc-700/40 animate-pulse" style={{ opacity: 1 - i * 0.12 }} />
                    </td>
                  ))}
                </tr>
              ))}
              {loadingRows && (
                <tr>
                  <td colSpan={8} className="px-5 pb-6 pt-2 text-center">
                    <p className="text-xs text-zinc-500 dark:text-zinc-400" aria-live="polite">
                      Читаем книги управлений — это занимает несколько секунд
                    </p>
                  </td>
                </tr>
              )}

              {/* Пустоты: у каждой названа причина и следующий шаг */}
              {!loadingRows && everythingFailed && (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center">
                    <AlertCircle className="mx-auto text-red-400 mb-3" size={32} aria-hidden="true" />
                    <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Реестр не загрузился</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 max-w-md mx-auto">
                      Ни одна книга управления не прочитана. Проверьте доступ к книгам и обновите данные
                      кнопкой в шапке; если сервер перезапускается, повторите через минуту.
                    </p>
                    {trouble.reason && (
                      <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-2">({trouble.reason})</p>
                    )}
                  </td>
                </tr>
              )}
              {!loadingRows && !everythingFailed && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center">
                    <Table2 className="mx-auto text-zinc-300 dark:text-zinc-600 mb-3" size={32} aria-hidden="true" />
                    <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                      Сервер не вернул ни одной строки
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 max-w-md mx-auto">
                      {requestFilters.length > 0
                        ? `Под фильтры запроса (${requestFilters.join(', ')}) в книгах нет ни одной строки. Снимите часть фильтров в шапке.`
                        : 'Книги управлений прочитаны, но строк закупок в них не нашлось. Проверьте, те ли листы выбраны, и обновите данные.'}
                    </p>
                  </td>
                </tr>
              )}
              {!loadingRows && rows.length > 0 && filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center">
                    <Filter className="mx-auto text-zinc-300 dark:text-zinc-600 mb-3" size={32} aria-hidden="true" />
                    <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                      Загружено {rows.length} {pluralRu(rows.length, 'строка', 'строки', 'строк')}, но на экране их скрыли фильтры
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 max-w-md mx-auto">
                      {screenFilters.length > 0
                        ? `Отсекают: ${screenFilters.join(', ')}. Снимите лишнее — строки вернутся без перезагрузки.`
                        : 'Причина не в фильтрах экрана — обновите страницу и сообщите о случае.'}
                    </p>
                    {signalFilter.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSignalFilter([])}
                        className="mt-3 px-3 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/40 transition"
                      >
                        Снять фильтр по признакам
                      </button>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Возврат к началу — только после первого экрана, чтобы не мозолить глаза.
            Живёт над областью прокрутки, а не внутри: внутри его уносило бы вбок
            вместе с горизонтальной прокруткой широкой таблицы. */}
        {showBackToTop && (
          <button
            type="button"
            onClick={scrollToTop}
            className="absolute bottom-3 right-4 z-40 flex items-center justify-center w-9 h-9 rounded-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-700 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
            title="В начало реестра"
            aria-label="Прокрутить реестр в начало"
          >
            <ArrowUpToLine size={15} aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Подпись под таблицей: три ступени счёта — экран, выборка, загрузка.
          Во время чтения книг её нет вовсе: «Показано 0 из 0» было бы утверждением
          о данных, которых ещё никто не видел. */}
      {!loadingRows && (
      <div className="flex items-start justify-between gap-4 text-xs text-zinc-500 dark:text-zinc-400">
        <div className="space-y-0.5">
          <div className="flex items-center gap-3 flex-wrap">
            <span>{counts.shown}</span>
            {counts.hiddenOnScreen && <span className="text-zinc-400 dark:text-zinc-500">{counts.hiddenOnScreen}</span>}
          </div>
          <div className="text-zinc-400 dark:text-zinc-500">{counts.loaded}</div>
          {/* Место под подпись занято всегда — см. тот же приём в редакторе:
              исчезающая строка меняла бы высоту страницы, а та — сам счёт. */}
          <div className="text-zinc-400 dark:text-zinc-500 tabular-nums min-h-4">{rowsBelowNote}</div>
          {uncheckedNote && (
            <div className="text-amber-600 dark:text-amber-400">{uncheckedNote}</div>
          )}
          <div aria-live="polite" className={clsx(copyNote === COPY_REFUSED_NOTE && 'text-amber-600 dark:text-amber-400')}>
            {copyNote}
          </div>
          <div className="text-zinc-400 dark:text-zinc-500">
            Стрелки — по строкам, Enter — карточка строки, «?» — все клавиши
          </div>
        </div>
        {pager}
      </div>
      )}

      {selectedRow && <RowDetailCard row={selectedRow} onClose={() => setSelectedRow(null)} />}
      </>
      )}
    </div>
  );
}
