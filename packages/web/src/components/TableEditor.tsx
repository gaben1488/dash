import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  Save, Undo2, PlusCircle,
  ArrowUpDown, ArrowUp, ArrowDown,
  AlertCircle, Info,
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
}

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

  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);

  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus();
      if (inputRef.current instanceof HTMLInputElement) {
        inputRef.current.select();
      }
    }
  }, [editingCell]);

  // ── Сортировка ──
  const toggleSort = useCallback((key: string) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }, [sortKey]);

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
      const editableCols = columns.filter(c => c.editable !== false);
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
  }, [editingCell, cancelEdit, commitEdit, columns, processedRows, startEdit]);

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
  const colSpan = columns.length + (readOnly ? 0 : 1);

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
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200/70 dark:border-zinc-700/50 text-[11px] text-zinc-600 dark:text-zinc-300">
          <Info size={13} className="mt-px flex-shrink-0 text-zinc-400" aria-hidden="true" />
          <span>{notice}</span>
        </div>
      )}

      {/* Отказы записи — над таблицей, чтобы их нельзя было пропустить */}
      {failedCount > 0 && (
        <div className="px-3 py-2 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-xs space-y-1" role="alert">
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
        <div className="bg-white dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 space-y-3">
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
                className="px-3 py-1.5 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200"
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
      <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 overflow-hidden">
        <div className="overflow-x-auto" onKeyDown={handleKeyDown}>
          <table className="w-full text-sm">
            <caption className="sr-only">Редактор строк книги управления</caption>
            {/* Шапка */}
            <thead>
              <tr className="bg-zinc-50 dark:bg-zinc-900/50 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                {columns.map(col => (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    className={clsx(
                      'px-3 py-2.5 select-none',
                      col.width ?? '',
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
                  </th>
                ))}
                {!readOnly && (
                  <th scope="col" className="px-3 py-2.5 w-28 text-center">Действия</th>
                )}
              </tr>
              {/* Строка фильтров */}
              <tr className="dark:bg-zinc-900/30 border-b border-zinc-100 dark:border-zinc-700/50">
                {columns.map(col => (
                  <th key={`filter-${col.key}`} className="px-2 py-1.5">
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
                {!readOnly && <th />}
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

              {!loading && processedRows.map(row => {
                const rowId = row._id;
                const rowDirty = isDirtyRow(rowId);
                const rowHasErrors = hasRowErrors(rowId);
                const rowSaveError = saveErrors[rowId];
                const isSaving = savingRows.has(rowId);
                const justSaved = savedRows.includes(rowId);

                return (
                  <tr
                    key={rowId}
                    className={clsx(
                      'transition group',
                      (rowHasErrors || rowSaveError) && 'bg-red-50/40 dark:bg-red-950/10',
                      rowDirty && !rowHasErrors && !rowSaveError && 'bg-amber-50/40 dark:bg-amber-950/10',
                      !rowDirty && !rowHasErrors && !rowSaveError && 'hover:bg-blue-50/30 dark:hover:bg-zinc-700/20',
                    )}
                  >
                    {columns.map(col => {
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
                            'px-3 py-2 relative',
                            isNumeric && 'text-right tabular-nums',
                            cellDirty && !cellError && 'bg-amber-100/50 dark:bg-amber-900/20',
                            cellError && 'bg-red-100/50 dark:bg-red-900/20',
                            col.editable === false && 'text-zinc-400 dark:text-zinc-500',
                            editable && 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500',
                          )}
                          // Ячейка доступна с клавиатуры: Enter или F2 открывают правку —
                          // без этого редактор работал только мышью.
                          tabIndex={editable && !isEditing ? 0 : undefined}
                          onKeyDown={(e) => {
                            if (!editable || isEditing) return;
                            if (e.key === 'Enter' || e.key === 'F2') {
                              e.preventDefault();
                              startEdit(rowId, col.key, value);
                            }
                          }}
                          onClick={() => {
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
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
