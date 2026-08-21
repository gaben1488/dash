import { useState, useCallback, useRef, useEffect, useMemo, type RefObject } from 'react';
import {
  Save, Undo2, PlusCircle,
  ArrowUpDown, ArrowUp, ArrowDown, ArrowUpToLine,
  AlertCircle, Info, Columns3, Copy, MapPin, X,
} from 'lucide-react';
import clsx from 'clsx';
import { formatDateCell } from '../lib/sheet-date';
import { pluralRu } from '../lib/economy-copy';

// ────────────────────────────────────────────────────────────
// Типы
// ────────────────────────────────────────────────────────────

export type CellType = 'text' | 'number' | 'currency' | 'date' | 'select';

export interface ColumnConfig {
  key: string;
  label: string;
  type: CellType;
  width?: string;
  editable?: boolean;
  /** Варианты для типа «выбор». */
  options?: string[];
  /** Проверка значения — текст ошибки по-русски либо null. */
  validate?: (value: unknown) => string | null;
  /** Столбец добавлен пользователем на этом экране (в книгу не пишется). */
  custom?: boolean;
}

export interface RowData {
  _id: string;
  [key: string]: unknown;
}

export interface TableEditorProps {
  columns: ColumnConfig[];
  rows: RowData[];
  onCellChange?: (rowId: string, columnKey: string, value: unknown) => void;
  onSaveRow?: (rowId: string, data: Record<string, unknown>) => Promise<void>;
  onRevertRow?: (rowId: string) => void;
  onAddColumn?: (column: ColumnConfig) => void;
  loading?: boolean;
  readOnly?: boolean;
  /**
   * Почему строк нет — фраза владельца данных. Без неё пустой редактор
   * говорил бы «Нет данных», не называя ни причины, ни следующего шага.
   */
  emptyReason?: string;
  /** Постоянная оговорка о границах редактора (что он умеет, а что делается в книге). */
  notice?: string;
  /**
   * Адрес строки в книге («лист · строка») — редактор его не выводит сам:
   * он не знает, из какого листа пришла строка, и выдумывать не станет.
   */
  rowAddress?: (row: RowData) => string | null;
  /**
   * Имя набора настроек вида (ширины, скрытые столбцы, сортировка) в хранилище
   * браузера. Без него вид не переживает перезагрузку — и это осознанный выбор
   * вызывающего, а не молчаливая потеря.
   */
  prefsName?: string;
}

/** Настройки вида таблицы, переживающие перезагрузку страницы. */
interface EditorViewPrefs {
  widths: Record<string, number>;
  hidden: string[];
  sortKey: string | null;
  sortDir: SortDir;
}

/** Уже, чем это, столбец превращается в полоску без содержимого. */
const MIN_COLUMN_WIDTH = 56;

type SortDir = 'asc' | 'desc';

interface CellEdit {
  rowId: string;
  colKey: string;
}

// ────────────────────────────────────────────────────────────
// Вспомогательное
// ────────────────────────────────────────────────────────────

/** Пустая ячейка книги: показываем прочерк, а причину — подсказкой при наведении. */
const EMPTY_CELL = '—';
const EMPTY_CELL_HINT = 'В книге значение не заполнено';

/**
 * Деньги книги — тысячи рублей (тот же масштаб, что у расчёта: «ИТОГО план»
 * листа управления). Раньше подпись говорила «₽» и занижала суммы в тысячу
 * раз на глаз. Переключатель единиц из шапки здесь намеренно не применяется:
 * в ячейку уедет ровно то число, которое видит и правит оператор.
 */
function formatCurrency(value: unknown): string {
  const num = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  if (isNaN(num)) return EMPTY_CELL;
  return num.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' тыс. ₽';
}

// Дата: DTO отдаёт ISO «YYYY-MM-DD» | null; локализация в дд.мм.гггг — здесь.
// formatDateCell дополнительно понимает legacy-серийники (46034 ≠ «01.01.46034»).
const formatDate = formatDateCell;

function displayValue(value: unknown, type: CellType): string {
  if (value === null || value === undefined || value === '') return EMPTY_CELL;
  switch (type) {
    case 'currency': return formatCurrency(value);
    case 'number': {
      const n = typeof value === 'number' ? value : parseFloat(String(value));
      return isNaN(n) ? String(value) : n.toLocaleString('ru-RU');
    }
    case 'date': {
      const formatted = formatDate(value);
      return formatted === '' ? EMPTY_CELL : formatted;
    }
    default: return String(value);
  }
}

function omitRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record;
  return rest;
}

function omitRecordKeys<T>(
  record: Record<string, T>,
  shouldOmit: (key: string) => boolean,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => !shouldOmit(key)),
  ) as Record<string, T>;
}

/**
 * Человеческая причина отказа записи. Сервер объясняет отказы по-русски
 * («Строка 1481 за пределами листа»), но сквозь него может пролететь текст
 * чужого движка — английский и без действия для пользователя. Такой текст
 * уходит в скобки, а заголовком становится русская фраза.
 */
function humanSaveError(err: unknown): string {
  const raw = (err instanceof Error ? err.message : String(err)).trim();
  if (/failed to fetch|networkerror|load failed|ERR_NETWORK|ERR_CONNECTION/i.test(raw)) {
    return 'Нет связи с сервером — правка не сохранена. Проверьте подключение и повторите.';
  }
  if (/aborted|timeout/i.test(raw)) return 'Сервер не ответил вовремя — правка не сохранена, повторите.';
  if (!/[А-Яа-яЁё]/.test(raw)) {
    return `Книга отклонила правку по технической причине — повторите позже или сообщите администратору (ответ сервера: ${raw})`;
  }
  return raw;
}

// ────────────────────────────────────────────────────────────
// Общие механизмы больших таблиц
//
// Живут в этом файле, а не в отдельном модуле: потребителей ровно два —
// редактор и реестр, а реестр уже связан с редактором импортом. Заводить дом
// ради двух соседей значило бы плодить пустой дом.
// ────────────────────────────────────────────────────────────

/**
 * Значение для буфера обмена. Табуляция и перевод строки внутри значения
 * разорвали бы одну ячейку на несколько, поэтому такое значение берётся в
 * кавычки по правилу, которое одинаково понимают Excel и Р7-Офис.
 */
export function tsvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  return /["\t\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

/** Строка таблицы для вставки в лист: значения через табуляцию. */
export function rowToTsv(values: readonly unknown[]): string {
  return values.map(tsvCell).join('\t');
}

/**
 * Адрес строки для разговора и письма: «лист · строка». Нет имени листа или
 * номера — адреса нет вовсе: выдуманный адрес хуже отсутствующего, по нему
 * пойдут искать не туда.
 */
export function formatRowAddress(sheet: unknown, rowIndex: unknown): string | null {
  const name = String(sheet ?? '').trim();
  const num = typeof rowIndex === 'number' ? rowIndex : Number(rowIndex);
  if (!name || !Number.isFinite(num) || num <= 0) return null;
  return `${name} · строка ${Math.trunc(num)}`;
}

/**
 * Копирование в буфер обмена. Современный путь требует защищённого протокола и
 * разрешения, а дэш в казённом контуре открывают и по http — отсюда запасной
 * путь через скрытое поле. Возвращается признак успеха: молчаливый отказ буфера
 * заставляет вставлять пустоту и гадать, почему.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Запрет буфера — не отказ: ниже запасной путь.
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/** Что сказать после попытки копирования — включая честное признание отказа. */
export const COPY_REFUSED_NOTE =
  'Браузер не дал доступ к буферу обмена — скопируйте выделение вручную.';

/** Версия схемы хранимых настроек таблиц: смена ключа обнуляет их намеренно. */
const TABLE_PREFS_SCHEMA = 1;

/**
 * Отпечаток набора колонок. Настройки вида (ширины, скрытые столбцы,
 * сортировка) привязаны к нему: если набор колонок сменился, прежние настройки
 * описывают уже не эту таблицу — их надо забыть, а не натягивать на новый вид.
 */
export function columnsFingerprint(keys: readonly string[]): string {
  return [...keys].sort().join('|');
}

function prefsStorageKey(name: string): string {
  return `aemr.table.${name}.v${TABLE_PREFS_SCHEMA}`;
}

/** Настройки таблицы из хранилища браузера; при любом сомнении — null, то есть вид по умолчанию. */
export function readTablePrefs<T>(name: string, fingerprint: string): T | null {
  try {
    const raw = localStorage.getItem(prefsStorageKey(name));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { fingerprint?: string; value?: T } | null;
    if (!parsed || parsed.fingerprint !== fingerprint) return null;
    return (parsed.value ?? null) as T | null;
  } catch {
    // Приватный режим, чужой формат, испорченная запись — вид по умолчанию.
    return null;
  }
}

export function writeTablePrefs<T>(name: string, fingerprint: string, value: T): void {
  try {
    localStorage.setItem(prefsStorageKey(name), JSON.stringify({ fingerprint, value }));
  } catch {
    // Переполненное или запрещённое хранилище — не повод ронять экран.
  }
}

/** Ширина колонки по умолчанию: из класса вида `w-28` (шаг Tailwind — 4 пикселя). */
export function defaultColumnWidth(column: { width?: string; type?: CellType }): number {
  const match = /^w-(\d+)$/.exec(column.width ?? '');
  if (match) return Number(match[1]) * 4;
  return column.type === 'text' ? 240 : 140;
}

/**
 * Сколько строк осталось ниже видимой части. Поиск делением пополам, а не
 * перебором: в реестре бывают тысячи строк, а счёт идёт на каждом кадре
 * прокрутки — перебор превратил бы индикатор в тормоз.
 */
export function countRowsBelow(
  count: number,
  topAt: (index: number) => number | null,
  viewportBottom: number,
): number {
  let lo = 0;
  let hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const top = topAt(mid);
    if (top !== null && top >= viewportBottom) hi = mid;
    else lo = mid + 1;
  }
  return Math.max(0, count - lo);
}

/**
 * Подпись индикатора прокрутки. Ниже ничего нет — подписи нет вовсе: строка
 * «Конец списка» под каждой короткой таблицей была бы шумом, а не сведением.
 */
export function describeRowsBelow(rowsBelow: number): string | null {
  if (rowsBelow <= 0) return null;
  return `Ниже ещё ${rowsBelow} ${pluralRu(rowsBelow, 'строка', 'строки', 'строк')}`;
}

export interface TableScrollState {
  /** Строк, чей верхний край ниже видимой части. */
  rowsBelow: number;
  /** Прокручено больше экрана — пора предлагать возврат наверх. */
  showBackToTop: boolean;
  scrollToTop: () => void;
}

/** Глубина прокрутки области таблицы: индикатор «сколько ниже» и кнопка «наверх». */
export function useTableScroll(
  containerRef: RefObject<HTMLDivElement | null>,
  rowRefs: RefObject<(HTMLTableRowElement | null)[]>,
  rowCount: number,
): TableScrollState {
  const [rowsBelow, setRowsBelow] = useState(0);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const frameRef = useRef<number | null>(null);

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    // Сравниваем в координатах окна, а не через offsetTop: точка отсчёта у
    // offsetTop — ближайший позиционированный предок, и он не обязан совпадать
    // с областью прокрутки, отчего счёт молча смещался бы на высоту карточки.
    const bottom = el.getBoundingClientRect().bottom;
    setRowsBelow(countRowsBelow(
      rowCount,
      (i) => rowRefs.current?.[i]?.getBoundingClientRect().top ?? null,
      bottom,
    ));
    setShowBackToTop(el.scrollTop > el.clientHeight);
  }, [containerRef, rowRefs, rowCount]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      // Замер отложен до кадра отрисовки: события прокрутки летят чаще кадров,
      // а замер читает геометрию и заставляет браузер пересчитывать раскладку.
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        measure();
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    const observer = new ResizeObserver(onScroll);
    observer.observe(el);
    measure();
    return () => {
      el.removeEventListener('scroll', onScroll);
      observer.disconnect();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [containerRef, measure]);

  const scrollToTop = useCallback(() => {
    const reduce = typeof matchMedia === 'function'
      && matchMedia('(prefers-reduced-motion: reduce)').matches;
    containerRef.current?.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  }, [containerRef]);

  return { rowsBelow, showBackToTop, scrollToTop };
}

/**
 * Ввод ли это. Горячие клавиши экрана не должны срабатывать, пока человек
 * набирает текст: «/» в поле поиска обязано остаться символом, а не командой.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** Общая обёртка прокручиваемой области таблицы: прилипшая шапка живёт только внутри неё. */
export const TABLE_SCROLL_AREA = 'relative overflow-auto max-h-[68vh]';
/** Непрозрачная поверхность прилипших ячеек: сквозь полупрозрачную просвечивают строки. */
export const STICKY_SURFACE = 'bg-white dark:bg-zinc-900';
/** Шов прилипшего первого столбца — тенью, а не рамкой: рамка прилипшей ячейки не рисуется. */
export const STICKY_SEAM =
  'shadow-[inset_-1px_0_0_0_rgba(0,0,0,0.07)] dark:shadow-[inset_-1px_0_0_0_rgba(255,255,255,0.07)]';

// ────────────────────────────────────────────────────────────
// Компонент
// ────────────────────────────────────────────────────────────

export function TableEditor({
  columns,
  rows,
  onCellChange,
  onSaveRow,
  onRevertRow,
  onAddColumn,
  loading = false,
  readOnly = false,
  emptyReason,
  notice,
  rowAddress,
  prefsName,
}: TableEditorProps) {
  // Правки: строка → набор изменённых столбцов
  const [dirty, setDirty] = useState<Record<string, Set<string>>>({});
  // Ошибки проверки: «строка:столбец» → текст
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Отказы записи: строка → человеческая причина
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  // Успешно записанные строки — короткое подтверждение под таблицей
  const [savedRows, setSavedRows] = useState<string[]>([]);
  // Редактируемая сейчас ячейка
  const [editingCell, setEditingCell] = useState<CellEdit | null>(null);
  // Буфер ввода
  const [editValue, setEditValue] = useState<string>('');
  // Сортировка
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  // Фильтры по столбцам
  const [filters, setFilters] = useState<Record<string, string>>({});
  // Строки в процессе записи
  const [savingRows, setSavingRows] = useState<Set<string>>(new Set());
  // Диалог добавления столбца
  const [showAddColumn, setShowAddColumn] = useState(false);
  const [newColLabel, setNewColLabel] = useState('');
  const [newColType, setNewColType] = useState<CellType>('text');
  // Вид таблицы: ширины столбцов и скрытые столбцы (переживают перезагрузку)
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [hidden, setHidden] = useState<string[]>([]);
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
  // Ячейка под курсором клавиатуры — её копирует Ctrl+C
  const [focusedCell, setFocusedCell] = useState<CellEdit | null>(null);
  // Короткий отчёт о копировании: удалось или почему нет
  const [copyNote, setCopyNote] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  const columnsMenuRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  const headerRowRef = useRef<HTMLTableRowElement>(null);
  // Высота первой строки шапки: на неё опускается прилипшая строка фильтров.
  // Замеряется, а не задаётся числом, — подписи столбцов переносятся по-разному.
  const [headerHeight, setHeaderHeight] = useState(0);

  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus();
      if (inputRef.current instanceof HTMLInputElement) {
        inputRef.current.select();
      }
    }
  }, [editingCell]);

  useEffect(() => {
    const el = headerRowRef.current;
    if (!el) return;
    // Высота округляется до целого, и равное значение не записывается: замеренная
    // высота дробная, а от неё зависит положение прилипшей строки фильтров —
    // дробь качалась бы на сотые доли, наблюдатель размера будил бы перерисовку,
    // та меняла бы дробь, и так без конца.
    const sync = () => {
      const next = Math.round(el.getBoundingClientRect().height);
      setHeaderHeight(prev => (prev === next ? prev : next));
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Закрытие списка столбцов щелчком мимо и клавишей Esc
  useEffect(() => {
    if (!columnsMenuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (columnsMenuRef.current && !columnsMenuRef.current.contains(e.target as Node)) {
        setColumnsMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setColumnsMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [columnsMenuOpen]);

  // Сообщение о копировании живёт несколько секунд и уходит само
  useEffect(() => {
    if (!copyNote) return;
    const timer = setTimeout(() => setCopyNote(null), 4000);
    return () => clearTimeout(timer);
  }, [copyNote]);

  // ── Сортировка ──
  const toggleSort = useCallback((key: string) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }, [sortKey]);

  // ── Вид таблицы, переживающий перезагрузку ──
  const fingerprint = useMemo(
    () => columnsFingerprint(columns.map(c => c.key)),
    [columns],
  );

  // Настройки читаются не один раз при монтировании, а на каждую смену набора
  // столбцов: столбцы приезжают позже первого кадра (строки грузятся с сервера),
  // и однократное чтение всегда попадало бы в пустой набор.
  useEffect(() => {
    if (!prefsName || columns.length === 0) return;
    const stored = readTablePrefs<EditorViewPrefs>(prefsName, fingerprint);
    setWidths(stored?.widths ?? {});
    setHidden(stored?.hidden ?? []);
    setSortKey(stored?.sortKey ?? null);
    setSortDir(stored?.sortDir === 'desc' ? 'desc' : 'asc');
  }, [prefsName, fingerprint, columns.length]);

  useEffect(() => {
    if (!prefsName || columns.length === 0) return;
    writeTablePrefs<EditorViewPrefs>(prefsName, fingerprint, { widths, hidden, sortKey, sortDir });
  }, [prefsName, fingerprint, columns.length, widths, hidden, sortKey, sortDir]);

  /** Скрыть все столбцы нельзя: пустая таблица не «настройка вида», а поломка. */
  const visibleColumns = useMemo(() => {
    const shown = columns.filter(c => !hidden.includes(c.key));
    return shown.length > 0 ? shown : columns;
  }, [columns, hidden]);

  const widthOf = useCallback((col: ColumnConfig): number => {
    return widths[col.key] ?? defaultColumnWidth(col);
  }, [widths]);

  /** Общая ширина таблицы: без неё столбцы сжались бы по ширине окна и правка ширин была бы бессмысленной. */
  const tableWidth = useMemo(
    () => visibleColumns.reduce((sum, col) => sum + widthOf(col), 0) + (readOnly ? 0 : 128),
    [visibleColumns, widthOf, readOnly],
  );

  const toggleColumn = useCallback((key: string) => {
    const wasHidden = hidden.includes(key);
    setHidden(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]));
    // Спрятанный столбец не должен продолжать отбирать строки невидимым фильтром.
    if (!wasHidden) setFilters(prev => omitRecordKey(prev, key));
  }, [hidden]);

  const startResize = useCallback((col: ColumnConfig, event: React.PointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const startX = event.clientX;
    const startWidth = widthOf(col);
    handle.setPointerCapture(event.pointerId);
    const onMove = (e: PointerEvent) => {
      const next = Math.max(MIN_COLUMN_WIDTH, Math.round(startWidth + e.clientX - startX));
      setWidths(prev => ({ ...prev, [col.key]: next }));
    };
    const onUp = () => {
      handle.releasePointerCapture(event.pointerId);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }, [widthOf]);

  /** Ширина правится и с клавиатуры: мышью тянуть умеют не все, а столбец узкий у всех. */
  const resizeByKey = useCallback((col: ColumnConfig, delta: number) => {
    setWidths(prev => ({
      ...prev,
      [col.key]: Math.max(MIN_COLUMN_WIDTH, (prev[col.key] ?? defaultColumnWidth(col)) + delta),
    }));
  }, []);

  // ── Отбор и сортировка строк ──
  const processedRows = useMemo(() => {
    let result = [...rows];

    for (const [key, filterVal] of Object.entries(filters)) {
      if (!filterVal) continue;
      const q = filterVal.toLowerCase();
      result = result.filter(r => {
        const v = r[key];
        if (v === null || v === undefined) return false;
        return String(v).toLowerCase().includes(q);
      });
    }

    if (sortKey) {
      const col = columns.find(c => c.key === sortKey);
      result.sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        if (col?.type === 'number' || col?.type === 'currency') {
          const an = parseFloat(String(av ?? '0')) || 0;
          const bn = parseFloat(String(bv ?? '0')) || 0;
          return sortDir === 'asc' ? an - bn : bn - an;
        }
        const as = String(av ?? '');
        const bs = String(bv ?? '');
        return sortDir === 'asc' ? as.localeCompare(bs, 'ru') : bs.localeCompare(as, 'ru');
      });
    }

    return result;
  }, [rows, filters, sortKey, sortDir, columns]);

  /** Названия столбцов, которые сейчас отбирают строки — для честной подписи пустоты. */
  const activeColumnFilters = useMemo(
    () => Object.entries(filters)
      .filter(([, v]) => v.trim())
      .map(([key]) => columns.find(c => c.key === key)?.label ?? key),
    [filters, columns],
  );

  // ── Правка ячейки ──
  const startEdit = useCallback((rowId: string, colKey: string, currentValue: unknown) => {
    if (readOnly) return;
    const col = columns.find(c => c.key === colKey);
    if (col && col.editable === false) return;
    setEditingCell({ rowId, colKey });
    setEditValue(currentValue === null || currentValue === undefined ? '' : String(currentValue));
  }, [readOnly, columns]);

  const commitEdit = useCallback(() => {
    if (!editingCell) return;
    const { rowId, colKey } = editingCell;
    const col = columns.find(c => c.key === colKey);

    let parsedValue: unknown = editValue;
    if (col?.type === 'number' || col?.type === 'currency') {
      const cleaned = editValue.replace(/\s/g, '').replace(/,/g, '.').replace(/₽/g, '').trim();
      if (cleaned === '' || cleaned === EMPTY_CELL) {
        parsedValue = null;
      } else {
        const num = parseFloat(cleaned);
        parsedValue = isNaN(num) ? editValue : num;
      }
    }

    const errKey = `${rowId}:${colKey}`;
    if (col?.validate) {
      const err = col.validate(parsedValue);
      if (err) {
        setErrors(prev => ({ ...prev, [errKey]: err }));
      } else {
        setErrors(prev => omitRecordKey(prev, errKey));
      }
    }

    setDirty(prev => {
      const rowDirty = new Set(prev[rowId] ?? []);
      rowDirty.add(colKey);
      return { ...prev, [rowId]: rowDirty };
    });

    // Новая правка снимает прежний отказ записи: он относился к прошлому значению.
    setSaveErrors(prev => omitRecordKey(prev, rowId));
    setSavedRows(prev => prev.filter(id => id !== rowId));

    onCellChange?.(rowId, colKey, parsedValue);
    setEditingCell(null);
  }, [editingCell, editValue, columns, onCellChange]);

  const cancelEdit = useCallback(() => {
    setEditingCell(null);
    setEditValue('');
  }, []);

  // ── Клавиатура ──
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!editingCell) return;

    if (e.key === 'Escape') {
      cancelEdit();
      return;
    }

    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      commitEdit();

      const { rowId, colKey } = editingCell;
      // Обход по видимым столбцам: прыжок в спрятанный столбец выглядел бы
      // как потеря фокуса — правка идёт там, куда пользователь не смотрит.
      const editableCols = visibleColumns.filter(c => c.editable !== false);
      const colIdx = editableCols.findIndex(c => c.key === colKey);
      const rowIdx = processedRows.findIndex(r => r._id === rowId);

      if (e.key === 'Tab') {
        if (e.shiftKey) {
          if (colIdx > 0) {
            const prevCol = editableCols[colIdx - 1];
            const row = processedRows[rowIdx];
            if (row) {
              setTimeout(() => startEdit(row._id, prevCol.key, row[prevCol.key]), 0);
            }
          } else if (rowIdx > 0) {
            const prevRow = processedRows[rowIdx - 1];
            const lastCol = editableCols[editableCols.length - 1];
            if (prevRow && lastCol) {
              setTimeout(() => startEdit(prevRow._id, lastCol.key, prevRow[lastCol.key]), 0);
            }
          }
        } else {
          if (colIdx < editableCols.length - 1) {
            const nextCol = editableCols[colIdx + 1];
            const row = processedRows[rowIdx];
            if (row) {
              setTimeout(() => startEdit(row._id, nextCol.key, row[nextCol.key]), 0);
            }
          } else if (rowIdx < processedRows.length - 1) {
            const nextRow = processedRows[rowIdx + 1];
            const firstCol = editableCols[0];
            if (nextRow && firstCol) {
              setTimeout(() => startEdit(nextRow._id, firstCol.key, nextRow[firstCol.key]), 0);
            }
          }
        }
      } else if (e.key === 'Enter') {
        if (rowIdx < processedRows.length - 1) {
          const nextRow = processedRows[rowIdx + 1];
          const sameCol = columns.find(c => c.key === colKey);
          if (nextRow && sameCol && sameCol.editable !== false) {
            setTimeout(() => startEdit(nextRow._id, colKey, nextRow[colKey]), 0);
          }
        }
      }
    }
  }, [editingCell, cancelEdit, commitEdit, columns, visibleColumns, processedRows, startEdit]);

  // ── Запись строки ──
  const handleSaveRow = useCallback(async (rowId: string) => {
    if (!onSaveRow) return;
    const row = rows.find(r => r._id === rowId);
    if (!row) return;

    const rowErrors = Object.keys(errors).filter(k => k.startsWith(`${rowId}:`));
    if (rowErrors.length > 0) return;

    setSavingRows(prev => new Set(prev).add(rowId));
    setSaveErrors(prev => omitRecordKey(prev, rowId));
    try {
      await onSaveRow(rowId, { ...row });
      // Отметка «изменено» снимается ТОЛЬКО после успеха: раньше отказ записи
      // молча гасил её, и правка выглядела сохранённой, не попав в книгу.
      setDirty(prev => omitRecordKey(prev, rowId));
      setSavedRows(prev => (prev.includes(rowId) ? prev : [...prev, rowId]));
    } catch (err) {
      setSaveErrors(prev => ({ ...prev, [rowId]: humanSaveError(err) }));
    } finally {
      setSavingRows(prev => {
        const next = new Set(prev);
        next.delete(rowId);
        return next;
      });
    }
  }, [onSaveRow, rows, errors]);

  const handleRevertRow = useCallback((rowId: string) => {
    onRevertRow?.(rowId);
    setDirty(prev => omitRecordKey(prev, rowId));
    setErrors(prev => omitRecordKeys(prev, key => key.startsWith(`${rowId}:`)));
    setSaveErrors(prev => omitRecordKey(prev, rowId));
  }, [onRevertRow]);

  // ── Добавление столбца ──
  const handleAddColumn = useCallback(() => {
    if (!newColLabel.trim() || !onAddColumn) return;
    const key = `custom_${Date.now()}`;
    onAddColumn({
      key,
      label: newColLabel.trim(),
      type: newColType,
      editable: true,
      custom: true,
    });
    setNewColLabel('');
    setNewColType('text');
    setShowAddColumn(false);
  }, [newColLabel, newColType, onAddColumn]);

  // ── Копирование ──
  const report = useCallback(async (text: string, done: string) => {
    setCopyNote(await copyText(text) ? done : COPY_REFUSED_NOTE);
  }, []);

  /** Строка целиком — в том виде, в каком её показывает экран, через табуляцию. */
  const copyRow = useCallback((row: RowData) => {
    const values = visibleColumns.map(col => displayValue(row[col.key], col.type));
    void report(rowToTsv(values), 'Строка скопирована — вставьте её в лист.');
  }, [visibleColumns, report]);

  const copyAddress = useCallback((row: RowData) => {
    const address = rowAddress?.(row) ?? null;
    if (!address) {
      setCopyNote('Адрес строки неизвестен: в строке нет ни листа, ни номера.');
      return;
    }
    void report(address, `Адрес скопирован: ${address}`);
  }, [rowAddress, report]);

  // Ctrl+C копирует ячейку под курсором клавиатуры. Своё выделение текста
  // важнее: если человек выделил кусок мышью, копируется именно он.
  useEffect(() => {
    const onCopyKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'c') return;
      if (editingCell || isTypingTarget(e.target)) return;
      if ((getSelection()?.toString() ?? '').length > 0) return;
      if (!focusedCell) return;
      const row = rows.find(r => r._id === focusedCell.rowId);
      const col = columns.find(c => c.key === focusedCell.colKey);
      if (!row || !col) return;
      e.preventDefault();
      void report(displayValue(row[col.key], col.type), `Ячейка «${col.label}» скопирована.`);
    };
    document.addEventListener('keydown', onCopyKey);
    return () => document.removeEventListener('keydown', onCopyKey);
  }, [editingCell, focusedCell, rows, columns, report]);

  const { rowsBelow, showBackToTop, scrollToTop } = useTableScroll(
    scrollRef,
    rowRefs,
    processedRows.length,
  );

  const isDirtyRow = useCallback((rowId: string) => {
    return dirty[rowId] && dirty[rowId].size > 0;
  }, [dirty]);

  const isDirtyCell = useCallback((rowId: string, colKey: string) => {
    return dirty[rowId]?.has(colKey) ?? false;
  }, [dirty]);

  const hasRowErrors = useCallback((rowId: string) => {
    return Object.keys(errors).some(k => k.startsWith(`${rowId}:`));
  }, [errors]);

  const dirtyCount = Object.keys(dirty).length;
  const failedCount = Object.keys(saveErrors).length;
  const colSpan = visibleColumns.length + (readOnly ? 0 : 1);
  const hiddenCount = columns.length - visibleColumns.length;
  const rowsBelowNote = describeRowsBelow(rowsBelow);

  // ── Разметка ──
  return (
    <div className="space-y-3">
      {/* Панель */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {processedRows.length} {pluralRu(processedRows.length, 'строка', 'строки', 'строк')}
          </span>
          {dirtyCount > 0 && (
            <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
              {dirtyCount} {pluralRu(
                dirtyCount,
                'строка изменена и ещё не записана в книгу',
                'строки изменены и ещё не записаны в книгу',
                'строк изменено и ещё не записано в книгу',
              )}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Выбор столбцов: у книги семнадцать колонок, а разбирают обычно три-четыре */}
          <div className="relative" ref={columnsMenuRef}>
            <button
              type="button"
              aria-expanded={columnsMenuOpen}
              aria-haspopup="true"
              disabled={columns.length === 0}
              onClick={() => setColumnsMenuOpen(v => !v)}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-lg transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-40',
                hiddenCount > 0
                  ? 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-transparent'
                  : 'text-zinc-600 dark:text-zinc-300 bg-white dark:bg-zinc-800/60 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-700/30',
              )}
            >
              <Columns3 size={13} aria-hidden="true" />
              Столбцы
              {hiddenCount > 0 && (
                <span className="ml-1 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-blue-600 text-[10px] font-bold text-white leading-none tabular-nums">
                  {hiddenCount}
                </span>
              )}
            </button>
            {columnsMenuOpen && (
              <div className="absolute top-full right-0 mt-1 z-50 w-64 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-transparent rounded-lg shadow-lg py-1">
                <p className="px-3 py-1.5 text-[10px] text-zinc-500 dark:text-zinc-400 border-b border-zinc-100 dark:border-zinc-700">
                  Снятый столбец только прячется с экрана: значения в книге остаются, а его фильтр
                  снимается вместе с ним. Выбор и ширины столбцов сохраняются в этом браузере.
                </p>
                <div className="max-h-64 overflow-y-auto">
                  {columns.map(col => {
                    const shown = !hidden.includes(col.key);
                    const lastOne = shown && visibleColumns.length === 1;
                    return (
                      <label
                        key={col.key}
                        title={lastOne ? 'Последний столбец спрятать нельзя' : undefined}
                        className={clsx(
                          'flex items-center gap-2 px-3 py-1.5 text-xs transition',
                          lastOne
                            ? 'opacity-45 cursor-not-allowed'
                            : 'text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700/40 cursor-pointer',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={shown}
                          disabled={lastOne}
                          onChange={() => toggleColumn(col.key)}
                          className="rounded border-zinc-300 dark:border-zinc-600 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="truncate">{col.label}</span>
                      </label>
                    );
                  })}
                </div>
                {hiddenCount > 0 && (
                  <div className="border-t border-zinc-100 dark:border-zinc-700 mt-1 pt-1 px-3 pb-1">
                    <button
                      type="button"
                      onClick={() => setHidden([])}
                      className="flex items-center gap-1 text-xs text-zinc-500 hover:text-blue-600 dark:text-zinc-400 dark:hover:text-blue-400 transition"
                    >
                      <X size={12} aria-hidden="true" /> Показать все столбцы
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
          {onAddColumn && (
            <button
              type="button"
              onClick={() => setShowAddColumn(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 bg-white dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700/30 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
            >
              <PlusCircle size={13} aria-hidden="true" /> Добавить столбец
            </button>
          )}
        </div>
      </div>

      {/* Границы редактора — честная оговорка, а не молчание */}
      {notice && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200/70 dark:border-transparent text-[11px] text-zinc-600 dark:text-zinc-300">
          <Info size={13} className="mt-px flex-shrink-0 text-zinc-400" aria-hidden="true" />
          <span>{notice}</span>
        </div>
      )}

      {/* Отказы записи — над таблицей, чтобы их нельзя было пропустить */}
      {failedCount > 0 && (
        <div className="px-3 py-2 rounded-lg border border-red-200 dark:border-transparent bg-red-50 dark:bg-red-950/30 text-xs space-y-1" role="alert">
          <p className="font-medium text-red-700 dark:text-red-300">
            Книга не приняла {failedCount} {pluralRu(failedCount, 'правку', 'правки', 'правок')} — они остались только на экране
          </p>
          {Object.entries(saveErrors).map(([rowId, message]) => (
            <p key={rowId} className="text-red-700/90 dark:text-red-300/80">{message}</p>
          ))}
        </div>
      )}

      {/* Диалог добавления столбца */}
      {showAddColumn && (
        <div className="bg-white dark:bg-zinc-800/80 border border-zinc-200 dark:border-transparent rounded-lg p-4 space-y-3">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1" htmlFor="new-column-label">
                Название столбца
              </label>
              <input
                id="new-column-label"
                type="text"
                value={newColLabel}
                onChange={e => setNewColLabel(e.target.value)}
                placeholder="Например: ответственный"
                className="w-full px-3 py-1.5 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                onKeyDown={e => { if (e.key === 'Enter') handleAddColumn(); }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1" htmlFor="new-column-type">
                Тип
              </label>
              <select
                id="new-column-type"
                value={newColType}
                onChange={e => setNewColType(e.target.value as CellType)}
                className="px-3 py-1.5 text-sm border border-zinc-200 dark:border-transparent rounded-lg bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200"
              >
                <option value="text">Текст</option>
                <option value="number">Число</option>
                <option value="currency">Сумма (тыс. ₽)</option>
                <option value="date">Дата</option>
              </select>
            </div>
            <button
              type="button"
              onClick={handleAddColumn}
              disabled={!newColLabel.trim()}
              className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-40 transition"
            >
              Добавить
            </button>
            <button
              type="button"
              onClick={() => setShowAddColumn(false)}
              className="px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition"
            >
              Отмена
            </button>
          </div>
          {/* Столбец нигде не хранится: сказать это до, а не после потери заметок */}
          <p className="text-[11px] text-amber-700 dark:text-amber-400">
            Такой столбец живёт только на этом экране: в книгу управления он не попадёт, а при обновлении
            страницы исчезнет вместе с введёнными в него значениями.
          </p>
        </div>
      )}

      {/* Таблица */}
      <div className="relative bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-transparent overflow-hidden">
        {/* Прокрутка живёт здесь: прилипшая шапка держится только за собственную
            прокручиваемую область, а не за прокрутку страницы. */}
        <div ref={scrollRef} className={TABLE_SCROLL_AREA} onKeyDown={handleKeyDown}>
          <table
            className="text-sm table-fixed"
            style={{ width: tableWidth, minWidth: '100%' }}
          >
            <caption className="sr-only">Редактор строк книги управления</caption>
            {/* Ширины столбцов заданы явно: иначе их правка мышью ни на что не влияет */}
            <colgroup>
              {visibleColumns.map(col => (
                <col key={col.key} style={{ width: widthOf(col) }} />
              ))}
              {!readOnly && <col style={{ width: 128 }} />}
            </colgroup>
            {/* Шапка */}
            <thead>
              <tr
                ref={headerRowRef}
                className="text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider"
              >
                {visibleColumns.map((col, colIdx) => (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    className={clsx(
                      'px-3 py-2.5 select-none sticky top-0 bg-zinc-50 dark:bg-zinc-900',
                      colIdx === 0 ? `left-0 z-30 ${STICKY_SEAM}` : 'z-20',
                      (col.type === 'number' || col.type === 'currency') && 'text-right',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      aria-label={`Сортировать по столбцу «${col.label}»`}
                      className="flex items-center gap-1 w-full uppercase tracking-wider hover:text-zinc-700 dark:hover:text-zinc-200 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 rounded-sm"
                    >
                      {(col.type === 'number' || col.type === 'currency') && <span className="flex-1" />}
                      <span className="truncate">{col.label}</span>
                      {sortKey === col.key
                        ? (sortDir === 'asc' ? <ArrowUp size={11} aria-hidden="true" /> : <ArrowDown size={11} aria-hidden="true" />)
                        : <ArrowUpDown size={11} className="opacity-30" aria-hidden="true" />}
                      {col.custom && (
                        <span
                          className="ml-1 text-[9px] bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 px-1 rounded normal-case"
                          title="Столбец добавлен на этом экране и в книгу не записывается"
                        >
                          не сохраняется
                        </span>
                      )}
                    </button>
                    {/* Разделитель-ручка: тянется мышью, правится стрелками с клавиатуры */}
                    <span
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`Ширина столбца «${col.label}»: ${widthOf(col)} пикселей`}
                      tabIndex={0}
                      onPointerDown={e => startResize(col, e)}
                      onKeyDown={e => {
                        if (e.key === 'ArrowLeft') { e.preventDefault(); resizeByKey(col, -16); }
                        if (e.key === 'ArrowRight') { e.preventDefault(); resizeByKey(col, 16); }
                      }}
                      onDoubleClick={() => setWidths(prev => omitRecordKey(prev, col.key))}
                      title="Потяните, чтобы изменить ширину; двойной щелчок вернёт исходную"
                      className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize touch-none hover:bg-blue-400/60 focus-visible:bg-blue-500 focus-visible:outline-none"
                    />
                  </th>
                ))}
                {!readOnly && (
                  <th scope="col" className="px-3 py-2.5 text-center sticky top-0 z-20 bg-zinc-50 dark:bg-zinc-900">
                    Действия
                  </th>
                )}
              </tr>
              {/* Строка фильтров — прилипает под первой строкой шапки, на её замеренной высоте */}
              <tr className="border-b border-zinc-100 dark:border-zinc-700/50">
                {visibleColumns.map((col, colIdx) => (
                  <th
                    key={`filter-${col.key}`}
                    style={{ top: headerHeight }}
                    className={clsx(
                      'px-2 py-1.5 sticky bg-zinc-50 dark:bg-zinc-900',
                      colIdx === 0 ? `left-0 z-30 ${STICKY_SEAM}` : 'z-20',
                    )}
                  >
                    <input
                      type="text"
                      placeholder="Фильтр"
                      aria-label={`Фильтр по столбцу «${col.label}»`}
                      value={filters[col.key] ?? ''}
                      onChange={e => setFilters(prev => ({ ...prev, [col.key]: e.target.value }))}
                      className="w-full px-2 py-1 text-xs font-normal border border-zinc-200 dark:border-zinc-700 rounded bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 placeholder:text-zinc-300 dark:placeholder:text-zinc-600 focus:ring-1 focus:ring-blue-400 focus:border-transparent outline-none"
                    />
                  </th>
                ))}
                {!readOnly && (
                  <th style={{ top: headerHeight }} className="sticky z-20 bg-zinc-50 dark:bg-zinc-900" />
                )}
              </tr>
            </thead>

            {/* Тело */}
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
              {loading && Array.from({ length: 6 }).map((_, i) => (
                <tr key={`skeleton-${i}`} aria-hidden="true">
                  {Array.from({ length: colSpan }).map((__, j) => (
                    <td key={j} className="px-3 py-2.5">
                      <div className="h-2.5 rounded bg-zinc-100 dark:bg-zinc-700/40 animate-pulse" style={{ opacity: 1 - i * 0.12 }} />
                    </td>
                  ))}
                </tr>
              ))}
              {loading && (
                <tr>
                  <td colSpan={colSpan} className="px-5 pb-6 pt-2 text-center">
                    <p className="text-xs text-zinc-500 dark:text-zinc-400" aria-live="polite">
                      Читаем книги управлений — это занимает несколько секунд
                    </p>
                  </td>
                </tr>
              )}

              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={colSpan} className="px-5 py-12 text-center">
                    <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Править нечего</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 max-w-md mx-auto">
                      {emptyReason ?? 'Строки не загружены. Проверьте фильтры в шапке и обновите данные.'}
                    </p>
                  </td>
                </tr>
              )}
              {!loading && rows.length > 0 && processedRows.length === 0 && (
                <tr>
                  <td colSpan={colSpan} className="px-5 py-12 text-center">
                    <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                      Загружено {rows.length} {pluralRu(rows.length, 'строка', 'строки', 'строк')}, но фильтры столбцов скрыли все
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                      {activeColumnFilters.length > 0
                        ? `Отбирают столбцы: ${activeColumnFilters.join(', ')} — очистите поля фильтров под шапкой.`
                        : 'Фильтры столбцов пусты — обновите страницу и сообщите о случае.'}
                    </p>
                    <button
                      type="button"
                      onClick={() => setFilters({})}
                      className="mt-3 px-3 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/40 transition"
                    >
                      Очистить фильтры столбцов
                    </button>
                  </td>
                </tr>
              )}

              {!loading && processedRows.map((row, rowIdx) => {
                const rowId = row._id;
                const rowDirty = isDirtyRow(rowId);
                const rowHasErrors = hasRowErrors(rowId);
                const rowSaveError = saveErrors[rowId];
                const isSaving = savingRows.has(rowId);
                const justSaved = savedRows.includes(rowId);

                return (
                  <tr
                    key={rowId}
                    ref={el => { rowRefs.current[rowIdx] = el; }}
                    className={clsx(
                      'transition group',
                      (rowHasErrors || rowSaveError) && 'bg-red-50/40 dark:bg-red-950/10',
                      rowDirty && !rowHasErrors && !rowSaveError && 'bg-amber-50/40 dark:bg-amber-950/10',
                      !rowDirty && !rowHasErrors && !rowSaveError && 'hover:bg-blue-50/30 dark:hover:bg-zinc-700/20',
                    )}
                  >
                    {visibleColumns.map((col, colIdx) => {
                      const cellKey = `${rowId}:${col.key}`;
                      const isEditing = editingCell?.rowId === rowId && editingCell?.colKey === col.key;
                      const cellDirty = isDirtyCell(rowId, col.key);
                      const cellError = errors[cellKey];
                      const value = row[col.key];
                      const isNumeric = col.type === 'number' || col.type === 'currency';
                      const isEmpty = value === null || value === undefined || value === '';
                      const editable = col.editable !== false && !readOnly;

                      return (
                        <td
                          key={col.key}
                          className={clsx(
                            'px-3 py-2',
                            // Первый столбец не уезжает при боковой прокрутке: на широкой
                            // таблице читатель иначе теряет, чья это строка.
                            colIdx === 0
                              ? `sticky left-0 z-10 ${STICKY_SEAM} ${!cellDirty && !cellError ? STICKY_SURFACE : ''}`
                              : 'relative',
                            isNumeric && 'text-right tabular-nums',
                            cellDirty && !cellError && 'bg-amber-100/50 dark:bg-amber-900/20',
                            cellError && 'bg-red-100/50 dark:bg-red-900/20',
                            col.editable === false && 'text-zinc-400 dark:text-zinc-500',
                            editable && 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500',
                          )}
                          // Ячейка доступна с клавиатуры: Enter или F2 открывают правку —
                          // без этого редактор работал только мышью.
                          tabIndex={editable && !isEditing ? 0 : undefined}
                          onFocus={() => setFocusedCell({ rowId, colKey: col.key })}
                          onKeyDown={(e) => {
                            if (!editable || isEditing) return;
                            if (e.key === 'Enter' || e.key === 'F2') {
                              e.preventDefault();
                              startEdit(rowId, col.key, value);
                            }
                          }}
                          onClick={() => {
                            setFocusedCell({ rowId, colKey: col.key });
                            if (!isEditing && editable) {
                              startEdit(rowId, col.key, value);
                            }
                          }}
                          title={cellError ?? (isEmpty ? EMPTY_CELL_HINT : undefined)}
                        >
                          {isEditing ? (
                            col.type === 'select' && col.options ? (
                              <select
                                ref={el => { inputRef.current = el; }}
                                value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                onBlur={commitEdit}
                                aria-label={`${col.label}: выбор значения`}
                                className="w-full px-2 py-0.5 text-sm border-2 border-blue-400 rounded bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 outline-none"
                              >
                                <option value="">не указан</option>
                                {col.options.map(opt => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                            ) : (
                              <input
                                ref={el => { inputRef.current = el; }}
                                type="text"
                                value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                onBlur={commitEdit}
                                aria-label={`${col.label}: значение`}
                                aria-invalid={cellError ? true : undefined}
                                placeholder={col.type === 'date' ? 'ДД.ММ.ГГГГ' : ''}
                                className={clsx(
                                  'w-full px-2 py-0.5 text-sm border-2 rounded outline-none',
                                  cellError
                                    ? 'border-red-400 bg-red-50 dark:bg-red-950/30'
                                    : 'border-blue-400 bg-white dark:bg-zinc-900',
                                  'text-zinc-800 dark:text-zinc-200',
                                  isNumeric && 'text-right',
                                )}
                              />
                            )
                          ) : (
                            <span className={clsx(
                              'block truncate cursor-default',
                              editable && 'cursor-text hover:bg-zinc-100/50 dark:hover:bg-zinc-700/30 rounded px-1 -mx-1 transition',
                              cellDirty && 'font-medium',
                            )}>
                              {displayValue(value, col.type)}
                            </span>
                          )}
                          {cellError && !isEditing && (
                            <div className="absolute top-0.5 right-0.5" title={cellError}>
                              <AlertCircle size={12} className="text-red-500" aria-hidden="true" />
                              <span className="sr-only">{cellError}</span>
                            </div>
                          )}
                          {cellDirty && !cellError && !isEditing && (
                            <div className="absolute top-0 left-0 w-1 h-full bg-amber-400 dark:bg-amber-500 rounded-r" aria-hidden="true" />
                          )}
                        </td>
                      );
                    })}

                    {/* Действия со строкой */}
                    {!readOnly && (
                      <td className="px-2 py-2 text-center">
                        {/* focus-within: кнопки обязаны появляться и при обходе клавиатурой */}
                        <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition">
                          {rowDirty && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleSaveRow(rowId)}
                                disabled={isSaving || rowHasErrors}
                                aria-label={rowHasErrors ? 'Записать нельзя: в строке есть ошибка' : 'Записать строку в книгу'}
                                title={rowHasErrors ? 'Сначала исправьте ошибку в строке' : 'Записать в книгу управления'}
                                className={clsx(
                                  'p-1 rounded transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500',
                                  rowHasErrors
                                    ? 'text-zinc-300 dark:text-zinc-600 cursor-not-allowed'
                                    : 'text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30',
                                )}
                              >
                                {isSaving
                                  ? <span className="block w-3.5 h-3.5 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin" aria-hidden="true" />
                                  : <Save size={14} aria-hidden="true" />}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRevertRow(rowId)}
                                aria-label="Вернуть значения строки"
                                title="Вернуть значения, которые были в книге"
                                className="p-1 rounded text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
                              >
                                <Undo2 size={14} aria-hidden="true" />
                              </button>
                            </>
                          )}
                          {!rowDirty && justSaved && (
                            <span className="text-[10px] text-emerald-600 dark:text-emerald-400">записано</span>
                          )}
                          <button
                            type="button"
                            onClick={() => copyRow(row)}
                            aria-label="Скопировать строку"
                            title="Скопировать строку — вставляется в лист как есть"
                            className="p-1 rounded text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700/40 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
                          >
                            <Copy size={14} aria-hidden="true" />
                          </button>
                          {rowAddress && (
                            <button
                              type="button"
                              onClick={() => copyAddress(row)}
                              aria-label="Скопировать адрес строки"
                              title="Скопировать адрес строки — лист и номер"
                              className="p-1 rounded text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700/40 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
                            >
                              <MapPin size={14} aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
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
            title="В начало таблицы"
            aria-label="Прокрутить таблицу в начало"
          >
            <ArrowUpToLine size={15} aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Подпись под таблицей: глубина прокрутки, отчёт о копировании и клавиши */}
      <div className="flex items-start justify-between gap-4 text-[11px] text-zinc-500 dark:text-zinc-400 flex-wrap">
        <div className="space-y-0.5">
          {/* Место под подпись занято всегда: появляясь и исчезая, строка меняла бы
              высоту страницы, та — ширину области прокрутки, а ширина — сам счёт,
              и подпись гонялась бы за собственным хвостом. */}
          <div className="min-h-4 tabular-nums">{!loading && rowsBelowNote}</div>
          <div aria-live="polite" className={clsx(copyNote === COPY_REFUSED_NOTE && 'text-amber-600 dark:text-amber-400')}>
            {copyNote}
          </div>
        </div>
        <div className="text-zinc-400 dark:text-zinc-500">
          Enter или F2 — правка ячейки · Tab — следующая ячейка · Esc — отмена · Ctrl+C — копировать ячейку
        </div>
      </div>
    </div>
  );
}
