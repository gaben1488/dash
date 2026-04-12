import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  Save, Undo2, Trash2, Plus, PlusCircle,
  ArrowUpDown, ArrowUp, ArrowDown,
  AlertCircle, Check, Loader2,
} from 'lucide-react';
import clsx from 'clsx';

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export type CellType = 'text' | 'number' | 'currency' | 'date' | 'select';

export interface ColumnConfig {
  key: string;
  label: string;
  type: CellType;
  width?: string;
  editable?: boolean;
  /** Options for select type */
  options?: string[];
  /** Validation fn — return error string or null */
  validate?: (value: unknown) => string | null;
  /** Whether this is a custom (user-added) column */
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
  onAddRow?: () => void;
  onDeleteRow?: (rowId: string) => void;
  onSaveRow?: (rowId: string, data: Record<string, unknown>) => Promise<void>;
  onRevertRow?: (rowId: string) => void;
  onAddColumn?: (column: ColumnConfig) => void;
  loading?: boolean;
  readOnly?: boolean;
}

type SortDir = 'asc' | 'desc';

interface CellEdit {
  rowId: string;
  colKey: string;
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function formatCurrency(value: unknown): string {
  const num = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  if (isNaN(num)) return '—';
  return num.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' \u20BD';
}

function formatDate(value: unknown): string {
  if (!value) return '';
  const s = String(value);
  // Already DD.MM.YYYY
  if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(s)) return s;
  // ISO → DD.MM.YYYY
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  }
  return s;
}

function displayValue(value: unknown, type: CellType): string {
  if (value === null || value === undefined || value === '') return '—';
  switch (type) {
    case 'currency': return formatCurrency(value);
    case 'number': {
      const n = typeof value === 'number' ? value : parseFloat(String(value));
      return isNaN(n) ? String(value) : n.toLocaleString('ru-RU');
    }
    case 'date': return formatDate(value);
    default: return String(value);
  }
}

// ────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────

export function TableEditor({
  columns,
  rows,
  onCellChange,
  onAddRow,
  onDeleteRow,
  onSaveRow,
  onRevertRow,
  onAddColumn,
  loading = false,
  readOnly = false,
}: TableEditorProps) {
  // Dirty tracking: map of rowId → set of changed column keys
  const [dirty, setDirty] = useState<Record<string, Set<string>>>({});
  // Validation errors: map of "rowId:colKey" → error message
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Currently editing cell
  const [editingCell, setEditingCell] = useState<CellEdit | null>(null);
  // Edit value buffer
  const [editValue, setEditValue] = useState<string>('');
  // Sort state
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  // Column filter values
  const [filters, setFilters] = useState<Record<string, string>>({});
  // Saving rows
  const [savingRows, setSavingRows] = useState<Set<string>>(new Set());
  // Add column dialog
  const [showAddColumn, setShowAddColumn] = useState(false);
  const [newColLabel, setNewColLabel] = useState('');
  const [newColType, setNewColType] = useState<CellType>('text');

  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);

  // Focus input when editing cell changes
  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus();
      if (inputRef.current instanceof HTMLInputElement) {
        inputRef.current.select();
      }
    }
  }, [editingCell]);

  // ── Sorting ──
  const toggleSort = useCallback((key: string) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }, [sortKey]);

  // ── Filtered + sorted rows ──
  const processedRows = useMemo(() => {
    let result = [...rows];

    // Apply column filters
    for (const [key, filterVal] of Object.entries(filters)) {
      if (!filterVal) continue;
      const q = filterVal.toLowerCase();
      result = result.filter(r => {
        const v = r[key];
        if (v === null || v === undefined) return false;
        return String(v).toLowerCase().includes(q);
      });
    }

    // Apply sort
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

  // ── Cell edit handlers ──
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

    // Parse value based on type
    let parsedValue: unknown = editValue;
    if (col?.type === 'number' || col?.type === 'currency') {
      const cleaned = editValue.replace(/\s/g, '').replace(/,/g, '.').replace(/\u20BD/g, '').trim();
      if (cleaned === '' || cleaned === '—') {
        parsedValue = null;
      } else {
        const num = parseFloat(cleaned);
        parsedValue = isNaN(num) ? editValue : num;
      }
    }

    // Validate
    const errKey = `${rowId}:${colKey}`;
    if (col?.validate) {
      const err = col.validate(parsedValue);
      if (err) {
        setErrors(prev => ({ ...prev, [errKey]: err }));
      } else {
        setErrors(prev => {
          const next = { ...prev };
          delete next[errKey];
          return next;
        });
      }
    }

    // Mark dirty
    setDirty(prev => {
      const rowDirty = new Set(prev[rowId] ?? []);
      rowDirty.add(colKey);
      return { ...prev, [rowId]: rowDirty };
    });

    // Notify parent
    onCellChange?.(rowId, colKey, parsedValue);
    setEditingCell(null);
  }, [editingCell, editValue, columns, onCellChange]);

  const cancelEdit = useCallback(() => {
    setEditingCell(null);
    setEditValue('');
  }, []);

  // ── Keyboard navigation ──
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!editingCell) return;

    if (e.key === 'Escape') {
      cancelEdit();
      return;
    }

    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      commitEdit();

      // Navigate to next cell
      const { rowId, colKey } = editingCell;
      const editableCols = columns.filter(c => c.editable !== false);
      const colIdx = editableCols.findIndex(c => c.key === colKey);
      const rowIdx = processedRows.findIndex(r => r._id === rowId);

      if (e.key === 'Tab') {
        if (e.shiftKey) {
          // Previous cell
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
          // Next cell
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
        // Move down
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

  // ── Row actions ──
  const handleSaveRow = useCallback(async (rowId: string) => {
    if (!onSaveRow) return;
    const row = rows.find(r => r._id === rowId);
    if (!row) return;

    // Check for validation errors in this row
    const rowErrors = Object.keys(errors).filter(k => k.startsWith(`${rowId}:`));
    if (rowErrors.length > 0) return;

    setSavingRows(prev => new Set(prev).add(rowId));
    try {
      await onSaveRow(rowId, { ...row });
      // Clear dirty state on success
      setDirty(prev => {
        const next = { ...prev };
        delete next[rowId];
        return next;
      });
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
    setDirty(prev => {
      const next = { ...prev };
      delete next[rowId];
      return next;
    });
    // Clear errors for this row
    setErrors(prev => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        if (k.startsWith(`${rowId}:`)) delete next[k];
      }
      return next;
    });
  }, [onRevertRow]);

  // ── Add column handler ──
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

  // ── Render ──
  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-400 dark:text-zinc-500">
            {processedRows.length} {processedRows.length === 1 ? 'запись' : 'записей'}
          </span>
          {Object.keys(dirty).length > 0 && (
            <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
              {Object.keys(dirty).length} {Object.keys(dirty).length === 1 ? 'строка изменена' : 'строк изменено'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onAddColumn && (
            <button
              onClick={() => setShowAddColumn(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 bg-white dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700/30 transition"
            >
              <PlusCircle size={13} /> Добавить столбец
            </button>
          )}
          {onAddRow && !readOnly && (
            <button
              onClick={onAddRow}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition"
            >
              <Plus size={13} /> Добавить строку
            </button>
          )}
        </div>
      </div>

      {/* Add column dialog */}
      {showAddColumn && (
        <div className="bg-white dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">
              Название столбца
            </label>
            <input
              type="text"
              value={newColLabel}
              onChange={e => setNewColLabel(e.target.value)}
              placeholder="Новый столбец..."
              className="w-full px-3 py-1.5 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              onKeyDown={e => { if (e.key === 'Enter') handleAddColumn(); }}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">
              Тип
            </label>
            <select
              value={newColType}
              onChange={e => setNewColType(e.target.value as CellType)}
              className="px-3 py-1.5 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200"
            >
              <option value="text">Текст</option>
              <option value="number">Число</option>
              <option value="currency">Сумма (\u20BD)</option>
              <option value="date">Дата</option>
            </select>
          </div>
          <button
            onClick={handleAddColumn}
            disabled={!newColLabel.trim()}
            className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-40 transition"
          >
            Добавить
          </button>
          <button
            onClick={() => setShowAddColumn(false)}
            className="px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition"
          >
            Отмена
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 overflow-hidden">
        <div className="overflow-x-auto" onKeyDown={handleKeyDown}>
          <table className="w-full text-sm">
            {/* Header */}
            <thead>
              <tr className="bg-zinc-50 dark:bg-zinc-900/50 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                {columns.map(col => (
                  <th
                    key={col.key}
                    className={clsx(
                      'px-3 py-2.5 select-none',
                      col.width ?? '',
                      (col.type === 'number' || col.type === 'currency') && 'text-right',
                    )}
                  >
                    <div
                      className="flex items-center gap-1 cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-200 transition"
                      onClick={() => toggleSort(col.key)}
                    >
                      {(col.type === 'number' || col.type === 'currency') && <span className="flex-1" />}
                      <span className="truncate">{col.label}</span>
                      {sortKey === col.key
                        ? (sortDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)
                        : <ArrowUpDown size={11} className="opacity-30" />}
                      {col.custom && (
                        <span className="ml-1 text-[9px] bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 px-1 rounded">
                          NEW
                        </span>
                      )}
                    </div>
                  </th>
                ))}
                {!readOnly && (
                  <th className="px-3 py-2.5 w-28 text-center">Действия</th>
                )}
              </tr>
              {/* Filter row */}
              <tr className="bg-zinc-25 dark:bg-zinc-900/30 border-b border-zinc-100 dark:border-zinc-700/50">
                {columns.map(col => (
                  <th key={`filter-${col.key}`} className="px-2 py-1.5">
                    <input
                      type="text"
                      placeholder="Фильтр..."
                      value={filters[col.key] ?? ''}
                      onChange={e => setFilters(prev => ({ ...prev, [col.key]: e.target.value }))}
                      className="w-full px-2 py-1 text-xs font-normal border border-zinc-200 dark:border-zinc-700 rounded bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 placeholder:text-zinc-300 dark:placeholder:text-zinc-600 focus:ring-1 focus:ring-blue-400 focus:border-transparent outline-none"
                    />
                  </th>
                ))}
                {!readOnly && <th />}
              </tr>
            </thead>

            {/* Body */}
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
              {loading && (
                <tr>
                  <td colSpan={columns.length + (readOnly ? 0 : 1)} className="px-5 py-16 text-center">
                    <Loader2 className="mx-auto text-blue-400 mb-3 animate-spin" size={32} />
                    <p className="text-sm text-zinc-400">Загрузка данных...</p>
                  </td>
                </tr>
              )}
              {!loading && processedRows.length === 0 && (
                <tr>
                  <td colSpan={columns.length + (readOnly ? 0 : 1)} className="px-5 py-12 text-center">
                    <p className="text-sm text-zinc-400 dark:text-zinc-500">Нет данных</p>
                  </td>
                </tr>
              )}
              {!loading && processedRows.map(row => {
                const rowId = row._id;
                const rowDirty = isDirtyRow(rowId);
                const rowHasErrors = hasRowErrors(rowId);
                const isSaving = savingRows.has(rowId);

                return (
                  <tr
                    key={rowId}
                    className={clsx(
                      'transition group',
                      rowDirty && !rowHasErrors && 'bg-amber-50/40 dark:bg-amber-950/10',
                      rowHasErrors && 'bg-red-50/40 dark:bg-red-950/10',
                      !rowDirty && !rowHasErrors && 'hover:bg-blue-50/30 dark:hover:bg-zinc-700/20',
                    )}
                  >
                    {columns.map(col => {
                      const cellKey = `${rowId}:${col.key}`;
                      const isEditing = editingCell?.rowId === rowId && editingCell?.colKey === col.key;
                      const cellDirty = isDirtyCell(rowId, col.key);
                      const cellError = errors[cellKey];
                      const value = row[col.key];
                      const isNumeric = col.type === 'number' || col.type === 'currency';

                      return (
                        <td
                          key={col.key}
                          className={clsx(
                            'px-3 py-2 relative',
                            isNumeric && 'text-right tabular-nums',
                            cellDirty && !cellError && 'bg-amber-100/50 dark:bg-amber-900/20',
                            cellError && 'bg-red-100/50 dark:bg-red-900/20',
                            col.editable === false && 'text-zinc-400 dark:text-zinc-500',
                          )}
                          onClick={() => {
                            if (!isEditing && col.editable !== false) {
                              startEdit(rowId, col.key, value);
                            }
                          }}
                          title={cellError ?? undefined}
                        >
                          {isEditing ? (
                            col.type === 'select' && col.options ? (
                              <select
                                ref={el => { inputRef.current = el; }}
                                value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                onBlur={commitEdit}
                                className="w-full px-2 py-0.5 text-sm border-2 border-blue-400 rounded bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 outline-none"
                              >
                                <option value="">—</option>
                                {col.options.map(opt => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                            ) : (
                              <input
                                ref={el => { inputRef.current = el; }}
                                type={col.type === 'date' ? 'text' : (isNumeric ? 'text' : 'text')}
                                value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                onBlur={commitEdit}
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
                              col.editable !== false && !readOnly && 'cursor-text hover:bg-zinc-100/50 dark:hover:bg-zinc-700/30 rounded px-1 -mx-1 transition',
                              cellDirty && 'font-medium',
                            )}>
                              {displayValue(value, col.type)}
                            </span>
                          )}
                          {/* Error indicator */}
                          {cellError && !isEditing && (
                            <div className="absolute top-0.5 right-0.5" title={cellError}>
                              <AlertCircle size={12} className="text-red-500" />
                            </div>
                          )}
                          {/* Dirty indicator */}
                          {cellDirty && !cellError && !isEditing && (
                            <div className="absolute top-0 left-0 w-1 h-full bg-amber-400 dark:bg-amber-500 rounded-r" />
                          )}
                        </td>
                      );
                    })}

                    {/* Row actions */}
                    {!readOnly && (
                      <td className="px-2 py-2 text-center">
                        <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition">
                          {rowDirty && (
                            <>
                              <button
                                onClick={() => handleSaveRow(rowId)}
                                disabled={isSaving || rowHasErrors}
                                title="Сохранить"
                                className={clsx(
                                  'p-1 rounded transition',
                                  rowHasErrors
                                    ? 'text-zinc-300 dark:text-zinc-600 cursor-not-allowed'
                                    : 'text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30',
                                )}
                              >
                                {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                              </button>
                              <button
                                onClick={() => handleRevertRow(rowId)}
                                title="Отменить изменения"
                                className="p-1 rounded text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition"
                              >
                                <Undo2 size={14} />
                              </button>
                            </>
                          )}
                          {onDeleteRow && (
                            <button
                              onClick={() => onDeleteRow(rowId)}
                              title="Удалить строку"
                              className="p-1 rounded text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                          {!rowDirty && !onDeleteRow && (
                            <span className="text-zinc-300 dark:text-zinc-600">
                              <Check size={14} />
                            </span>
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
