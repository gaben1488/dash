import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useStore } from '../store';
import { api } from '../api';
import { Table2, Download, ChevronLeft, ChevronRight, AlertCircle, CheckCircle2, Clock, XCircle, ArrowUpDown, ArrowUp, ArrowDown, Loader2, Filter, X, Edit3, Eye } from 'lucide-react';
import clsx from 'clsx';
import { RowDetailCard } from '../components/RowDetailCard';
import { TableEditor, type ColumnConfig, type RowData } from '../components/TableEditor';

type ViewMode = 'browse' | 'editor';

type SortKey = 'id' | 'subject' | 'method' | 'planSum' | 'factSum' | 'economy' | 'status' | 'dept';
type SortDir = 'asc' | 'desc';

/**
 * Полный маппинг сигналов RowSignals → цвета и метки.
 * Ключи точно соответствуют свойствам интерфейса RowSignals из @aemr/core.
 */
const SIGNAL_COLORS: Record<string, { bg: string; text: string }> = {
  // Зелёные (позитивные)
  signed:           { bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-400' },
  hasFact:          { bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-400' },
  economyFlag:      { bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-400' },
  // Красные (критические)
  overdue:          { bg: 'bg-red-50 dark:bg-red-950/30', text: 'text-red-700 dark:text-red-400' },
  epRisk:           { bg: 'bg-red-50 dark:bg-red-950/30', text: 'text-red-700 dark:text-red-400' },
  highEconomy:      { bg: 'bg-red-50 dark:bg-red-950/30', text: 'text-red-700 dark:text-red-400' },
  economyConflict:  { bg: 'bg-red-50 dark:bg-red-950/30', text: 'text-red-700 dark:text-red-400' },
  factExceedsPlan:  { bg: 'bg-red-50 dark:bg-red-950/30', text: 'text-red-700 dark:text-red-400' },
  formulaBroken:    { bg: 'bg-red-50 dark:bg-red-950/30', text: 'text-red-700 dark:text-red-400' },
  budgetMismatch:   { bg: 'bg-purple-50 dark:bg-purple-950/30', text: 'text-purple-700 dark:text-purple-400' },
  // Жёлтые/оранжевые (предупреждения)
  stalledContract:  { bg: 'bg-orange-50 dark:bg-orange-950/30', text: 'text-orange-700 dark:text-orange-400' },
  earlyClosure:     { bg: 'bg-amber-50 dark:bg-amber-950/30', text: 'text-amber-700 dark:text-amber-400' },
  financeDelay:     { bg: 'bg-amber-50 dark:bg-amber-950/30', text: 'text-amber-700 dark:text-amber-400' },
  planSoon:         { bg: 'bg-yellow-50 dark:bg-yellow-950/30', text: 'text-yellow-700 dark:text-yellow-400' },
  lowCompetition:   { bg: 'bg-yellow-50 dark:bg-yellow-950/30', text: 'text-yellow-700 dark:text-yellow-400' },
  singleParticipant:{ bg: 'bg-yellow-50 dark:bg-yellow-950/30', text: 'text-yellow-700 dark:text-yellow-400' },
  dataQuality:      { bg: 'bg-zinc-100 dark:bg-zinc-700/50', text: 'text-zinc-600 dark:text-zinc-400' },
  // Синие (информационные)
  planning:         { bg: 'bg-blue-50 dark:bg-blue-950/30', text: 'text-blue-700 dark:text-blue-400' },
  notDue:           { bg: 'bg-blue-50 dark:bg-blue-950/30', text: 'text-blue-700 dark:text-blue-400' },
  // Серые
  canceled:         { bg: 'bg-zinc-100 dark:bg-zinc-700/50', text: 'text-zinc-500 dark:text-zinc-400' },
};

/**
 * Русскоязычные метки для ВСЕХ сигналов RowSignals.
 * Соответствуют бейджам из getSignalBadges() в @aemr/core.
 */
const SIGNAL_LABELS: Record<string, string> = {
  // Позитивные
  signed:            'Подписан',
  hasFact:           'Есть факт',
  economyFlag:       'Экономия',
  // Критические
  overdue:           'Просрочен',
  epRisk:            'ЕП-риск',
  highEconomy:       'Высокая экономия >25%',
  economyConflict:   'Флаг экономии',
  factExceedsPlan:   'Факт > план',
  formulaBroken:     'Ошибка формулы',
  budgetMismatch:    'Расхождение бюджета',
  // Предупреждения
  stalledContract:   'Подвисший контракт',
  earlyClosure:      'Раннее закрытие',
  financeDelay:      'Задержка финансирования',
  planSoon:          'Скоро срок',
  lowCompetition:    'Низкая конкуренция <2%',
  singleParticipant: '1 участник',
  dataQuality:       'Пустые поля',
  // Информационные
  planning:          'Планирование',
  notDue:            'Срок не наступил',
  // Серые
  canceled:          'Отменён',
};

export function DataBrowserPage() {
  const { formatMoney, selectedDepartments, selectedSubordinates, activityFilter, procurementFilter, period, activeMonths, searchQuery, subordinatesMap } = useStore();
  const [viewMode, setViewMode] = useState<ViewMode>('browse');
  const [pageNum, setPageNum] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortKey, setSortKey] = useState<SortKey>('id');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [rows, setRows] = useState<any[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<any>(null);
  const [signalFilter, setSignalFilter] = useState<string[]>([]);
  const [signalDropdownOpen, setSignalDropdownOpen] = useState(false);
  const signalDropdownRef = useRef<HTMLDivElement>(null);

  // ── Table Editor state ──
  const [editorRows, setEditorRows] = useState<RowData[]>([]);
  const [editorColumns, setEditorColumns] = useState<ColumnConfig[]>([]);
  const [editorOriginals, setEditorOriginals] = useState<Record<string, RowData>>({});

  // Default columns for the editor
  const defaultEditorColumns: ColumnConfig[] = useMemo(() => [
    { key: 'id', label: '№', type: 'text', width: 'w-14', editable: false },
    { key: 'dept', label: 'Управление', type: 'text', width: 'w-20', editable: false },
    { key: 'subject', label: 'Предмет закупки', type: 'text' },
    { key: 'method', label: 'Способ', type: 'select', width: 'w-20', options: ['ЭА', 'ЭК', 'ЭЗК', 'ЕП'] },
    { key: 'planFB', label: 'План ФБ', type: 'currency', width: 'w-28',
      validate: (v) => { const n = parseFloat(String(v ?? '')); return (v !== null && v !== '' && isNaN(n)) ? 'Ожидается число' : null; } },
    { key: 'planKB', label: 'План КБ', type: 'currency', width: 'w-28',
      validate: (v) => { const n = parseFloat(String(v ?? '')); return (v !== null && v !== '' && isNaN(n)) ? 'Ожидается число' : null; } },
    { key: 'planMB', label: 'План МБ', type: 'currency', width: 'w-28',
      validate: (v) => { const n = parseFloat(String(v ?? '')); return (v !== null && v !== '' && isNaN(n)) ? 'Ожидается число' : null; } },
    { key: 'planSum', label: 'План итого', type: 'currency', width: 'w-28', editable: false },
    { key: 'factFB', label: 'Факт ФБ', type: 'currency', width: 'w-28',
      validate: (v) => { const n = parseFloat(String(v ?? '')); return (v !== null && v !== '' && isNaN(n)) ? 'Ожидается число' : null; } },
    { key: 'factKB', label: 'Факт КБ', type: 'currency', width: 'w-28',
      validate: (v) => { const n = parseFloat(String(v ?? '')); return (v !== null && v !== '' && isNaN(n)) ? 'Ожидается число' : null; } },
    { key: 'factMB', label: 'Факт МБ', type: 'currency', width: 'w-28',
      validate: (v) => { const n = parseFloat(String(v ?? '')); return (v !== null && v !== '' && isNaN(n)) ? 'Ожидается число' : null; } },
    { key: 'factSum', label: 'Факт итого', type: 'currency', width: 'w-28', editable: false },
    { key: 'planDate', label: 'Дата план', type: 'date', width: 'w-28' },
    { key: 'factDate', label: 'Дата факт', type: 'date', width: 'w-28' },
    { key: 'status', label: 'Статус', type: 'text', width: 'w-24', editable: false },
    { key: 'flag', label: 'Флаг', type: 'text', width: 'w-24' },
    { key: 'commentGRBS', label: 'Комментарий ГРБС', type: 'text' },
  ], []);

  // Sync rows to editor format when switching to editor mode
  useEffect(() => {
    if (viewMode === 'editor' && rows.length > 0) {
      const mapped: RowData[] = rows.map((r, idx) => ({
        _id: `${r.dept}-${r.rowIndex ?? idx}`,
        _dept: r.dept,
        _rowIndex: r.rowIndex,
        id: r.id,
        dept: r.dept,
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
      // Store originals for revert
      const origMap: Record<string, RowData> = {};
      for (const row of mapped) {
        origMap[row._id] = { ...row };
      }
      setEditorOriginals(origMap);
      if (editorColumns.length === 0) {
        setEditorColumns(defaultEditorColumns);
      }
    }
  }, [viewMode, rows, defaultEditorColumns, editorColumns.length]);

  // Editor callbacks
  const handleEditorCellChange = useCallback((rowId: string, colKey: string, value: unknown) => {
    setEditorRows(prev => prev.map(r =>
      r._id === rowId ? { ...r, [colKey]: value } : r
    ));
  }, []);

  const handleEditorSaveRow = useCallback(async (rowId: string, data: Record<string, unknown>) => {
    const original = editorOriginals[rowId];
    if (!original) return;

    // Compute changed fields — map from editor keys to sheet columns
    const FIELD_TO_COL: Record<string, string> = {
      subject: 'G', method: 'L',
      planFB: 'H', planKB: 'I', planMB: 'J',
      factFB: 'V', factKB: 'W', factMB: 'X',
      planDate: 'N', factDate: 'Q',
      flag: 'AD', commentGRBS: 'AE',
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

    await api.saveRows([{ deptId, rowIndex, changes }]);

    // Update originals after successful save
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

  const handleEditorAddRow = useCallback(() => {
    const newId = `new-${Date.now()}`;
    const firstDept = rows[0]?.dept ?? '';
    setEditorRows(prev => [
      ...prev,
      {
        _id: newId,
        _dept: firstDept,
        _rowIndex: 0,
        id: '',
        dept: firstDept,
        subject: '',
        method: '',
        planFB: 0,
        planKB: 0,
        planMB: 0,
        planSum: 0,
        factFB: 0,
        factKB: 0,
        factMB: 0,
        factSum: 0,
        planDate: '',
        factDate: '',
        status: '',
        flag: '',
        commentGRBS: '',
      },
    ]);
  }, [rows]);

  const handleEditorDeleteRow = useCallback((rowId: string) => {
    setEditorRows(prev => prev.filter(r => r._id !== rowId));
  }, []);

  const handleEditorAddColumn = useCallback((col: ColumnConfig) => {
    setEditorColumns(prev => [...prev, col]);
  }, []);

  // Determine which departments to load (from subordinatesMap keys — always up-to-date)
  const allDepartments = useMemo(() => Object.keys(subordinatesMap), [subordinatesMap]);
  const deptsToLoad = useMemo(() => {
    return selectedDepartments.size > 0 ? [...selectedDepartments] : allDepartments;
  }, [selectedDepartments, allDepartments]);

  useEffect(() => {
    let cancelled = false;
    setLoadingRows(true);
    setRowError(null);

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

    // Load data from all selected departments (or all if none selected)
    Promise.all(
      deptsToLoad.map(dept =>
        api.getRows(dept, { limit: '1000', ...params })
          .then((data: any) => {
            const deptRows = Array.isArray(data) ? data : data?.rows ?? [];
            return deptRows.map((r: any) => ({ ...r, dept: r.dept || dept }));
          })
          .catch(() => [] as Record<string, unknown>[])
      )
    ).then(results => {
      if (!cancelled) {
        setRows(results.flat());
      }
    }).catch((err: any) => {
      if (!cancelled) {
        setRowError(err?.message ?? 'Ошибка загрузки данных');
        setRows([]);
      }
    }).finally(() => {
      if (!cancelled) setLoadingRows(false);
    });

    return () => { cancelled = true; };
  }, [deptsToLoad, selectedSubordinates, activityFilter, procurementFilter]);

  // Reset page on filter changes
  useEffect(() => { setPageNum(1); }, [searchQuery, selectedDepartments, selectedSubordinates, activityFilter, signalFilter]);

  // Close signal dropdown on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (signalDropdownRef.current && !signalDropdownRef.current.contains(e.target as Node)) {
        setSignalDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
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

  const filtered = useMemo(() => {
    let data = [...rows];
    // Period filter: filter by quarter
    if (period !== 'year') {
      const qMonths: Record<string, number[]> = { q1: [1,2,3], q2: [4,5,6], q3: [7,8,9], q4: [10,11,12] };
      const months = qMonths[period];
      if (months) {
        data = data.filter(r => {
          const d = r.planDate ?? r.factDate ?? r.date;
          if (!d) return true;
          const m = new Date(d).getMonth() + 1;
          return months.includes(m);
        });
      }
    }
    // Active months filter (fine-grained)
    if (activeMonths.size > 0) {
      data = data.filter(r => {
        const d = r.planDate ?? r.factDate ?? r.date;
        if (!d) return true;
        const m = new Date(d).getMonth() + 1;
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
    // Signal filter
    if (signalFilter.length > 0) {
      data = data.filter(r => {
        const sigs = r.signals ?? [];
        return signalFilter.some(s => sigs.includes(s));
      });
    }
    data.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av;
      const as = String(av ?? ''), bs = String(bv ?? '');
      return sortDir === 'asc' ? as.localeCompare(bs, 'ru') : bs.localeCompare(as, 'ru');
    });
    return data;
  }, [rows, searchQuery, sortKey, sortDir, period, activeMonths, signalFilter]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const paged = filtered.slice((pageNum - 1) * pageSize, pageNum * pageSize);
  const errorCount = filtered.filter(r => (r.signals ?? []).includes('dataQuality')).length;
  const overdueCount = filtered.filter(r => (r.signals ?? []).includes('overdue')).length;

  const downloadCSV = useCallback(() => {
    if (filtered.length === 0) return;
    const headers = ['№', 'Предмет закупки', 'Управление', 'Способ', 'План тыс. ₽', 'Факт тыс. ₽', 'Экономия', 'Статус', 'Сигналы'];
    const csvRows = filtered.map(r => [
      r.id,
      `"${String(r.subject ?? '').replace(/"/g, '""')}"`,
      r.dept ?? '',
      r.method ?? '',
      r.planSum ?? '',
      r.factSum ?? '',
      r.economy ?? '',
      r.status ?? '',
      `"${(r.signals ?? []).map((s: string) => SIGNAL_LABELS[s] ?? s).join(', ')}"`,
    ].join(';'));
    const bom = '\uFEFF';
    const csv = bom + headers.join(';') + '\n' + csvRows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const today = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `data_${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filtered]);

  return (
    <div className="space-y-4">
      {/* View mode tabs */}
      <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800/60 rounded-lg p-0.5 w-fit">
        <button
          onClick={() => setViewMode('browse')}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition',
            viewMode === 'browse'
              ? 'bg-white dark:bg-zinc-700 text-zinc-800 dark:text-white shadow-sm'
              : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200',
          )}
        >
          <Eye size={13} /> Просмотр
        </button>
        <button
          onClick={() => setViewMode('editor')}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition',
            viewMode === 'editor'
              ? 'bg-white dark:bg-zinc-700 text-zinc-800 dark:text-white shadow-sm'
              : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200',
          )}
        >
          <Edit3 size={13} /> Редактор таблиц
        </button>
      </div>

      {viewMode === 'editor' ? (
        <TableEditor
          columns={editorColumns}
          rows={editorRows}
          loading={loadingRows}
          onCellChange={handleEditorCellChange}
          onSaveRow={handleEditorSaveRow}
          onRevertRow={handleEditorRevertRow}
          onAddRow={handleEditorAddRow}
          onDeleteRow={handleEditorDeleteRow}
          onAddColumn={handleEditorAddColumn}
        />
      ) : (
      <>
      {/* Compact toolbar — only pagination and export (filters are in Header FilterBar) */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <select
            value={pageSize}
            onChange={e => { setPageSize(Number(e.target.value)); setPageNum(1); }}
            className="px-3 py-1.5 text-xs border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800/60 text-zinc-800 dark:text-zinc-200"
          >
            <option value={25}>25 строк</option>
            <option value={50}>50 строк</option>
            <option value={100}>100 строк</option>
          </select>
          {/* Signal filter dropdown */}
          <div className="relative" ref={signalDropdownRef}>
            <button
              onClick={() => setSignalDropdownOpen(v => !v)}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-lg transition',
                signalFilter.length > 0
                  ? 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800'
                  : 'text-zinc-600 dark:text-zinc-300 bg-white dark:bg-zinc-800/60 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-700/30',
              )}
            >
              <Filter size={13} />
              Сигналы
              {signalFilter.length > 0 && (
                <span className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-600 text-[10px] font-bold text-white leading-none">
                  {signalFilter.length}
                </span>
              )}
            </button>
            {signalDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 z-50 w-56 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg py-1">
                <div className="max-h-64 overflow-y-auto">
                  {Object.entries(SIGNAL_LABELS).map(([key, label]) => (
                    <label
                      key={key}
                      className="flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700/40 cursor-pointer transition"
                    >
                      <input
                        type="checkbox"
                        checked={signalFilter.includes(key)}
                        onChange={() => {
                          setSignalFilter(prev =>
                            prev.includes(key) ? prev.filter(s => s !== key) : [...prev, key]
                          );
                        }}
                        className="rounded border-zinc-300 dark:border-zinc-600 text-blue-600 focus:ring-blue-500"
                      />
                      <span
                        className={clsx(
                          'px-1.5 py-0.5 rounded text-[10px] font-medium',
                          SIGNAL_COLORS[key]?.bg ?? 'bg-zinc-100',
                          SIGNAL_COLORS[key]?.text ?? 'text-zinc-600',
                        )}
                      >
                        {label}
                      </span>
                    </label>
                  ))}
                </div>
                {signalFilter.length > 0 && (
                  <div className="border-t border-zinc-100 dark:border-zinc-700 mt-1 pt-1 px-3 pb-1">
                    <button
                      onClick={() => { setSignalFilter([]); setSignalDropdownOpen(false); }}
                      className="flex items-center gap-1 text-xs text-zinc-500 hover:text-red-500 dark:text-zinc-400 dark:hover:text-red-400 transition"
                    >
                      <X size={12} /> Сброс
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
          <span className="text-xs text-zinc-400">{filtered.length} записей</span>
        </div>

        <button
          onClick={downloadCSV}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 bg-white dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700/30 transition"
        >
          <Download size={13} /> Экспорт CSV
        </button>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-50 dark:bg-zinc-900/50 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                {([
                  ['id', '№', 'pl-5 pr-2 py-3 w-10', ''],
                  ['subject', 'Предмет закупки', 'px-3 py-3', ''],
                  ['method', 'Способ', 'px-3 py-3 w-16', ''],
                  ['planSum', 'План, тыс. ₽', 'px-3 py-3 w-28', 'text-right'],
                  ['factSum', 'Факт, тыс. ₽', 'px-3 py-3 w-28', 'text-right'],
                  ['economy', 'Экономия', 'px-3 py-3 w-28', 'text-right'],
                  ['status', 'Статус', 'px-3 py-3 w-28', ''],
                ] as [SortKey, string, string, string][]).map(([key, label, cls, align]) => (
                  <th
                    key={key}
                    className={clsx(cls, 'cursor-pointer select-none hover:text-zinc-700 dark:hover:text-zinc-200 transition', align)}
                    onClick={() => toggleSort(key)}
                  >
                    <span className="inline-flex items-center gap-1">
                      {label}
                      {sortKey === key
                        ? (sortDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)
                        : <ArrowUpDown size={11} className="opacity-30" />}
                    </span>
                  </th>
                ))}
                <th className="px-3 py-3">Сигналы</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
              {paged.map((row, i) => (
                <tr key={`${row.dept}-${row.rowIndex ?? row.id}-${i}`} className="hover:bg-blue-50/30 dark:hover:bg-zinc-700/30 transition group cursor-pointer" onClick={() => setSelectedRow(row)}>
                  <td className="pl-5 pr-2 py-3 text-zinc-400 dark:text-zinc-500 tabular-nums">{row.id}</td>
                  <td className="px-3 py-3">
                    <div className="font-medium text-zinc-700 dark:text-zinc-200 truncate max-w-xs">{row.subject}</div>
                    <div className="text-[10px] text-zinc-400 dark:text-zinc-500">{row.dept} • {row.type}</div>
                  </td>
                  <td className="px-3 py-3">
                    <span className={clsx(
                      'inline-block px-1.5 py-0.5 rounded text-[10px] font-bold',
                      row.method === 'ЕП' ? 'bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400' : 'bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400'
                    )}>
                      {row.method || '—'}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-300">{formatMoney(row.planSum)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-300">{row.factSum > 0 ? formatMoney(row.factSum) : <span className="text-zinc-300 dark:text-zinc-600">—</span>}</td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {row.economy > 0
                      ? <span className="text-emerald-600 dark:text-emerald-400 font-medium">{formatMoney(row.economy)}</span>
                      : <span className="text-zinc-300 dark:text-zinc-600">—</span>}
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
                        {row.status === 'Подписан' && <CheckCircle2 size={13} />}
                        {row.status === 'Отменён' && <XCircle size={13} />}
                        {row.status === 'Планирование' && <Clock size={13} />}
                        {row.status === 'Просрочен' && <AlertCircle size={13} />}
                        {row.status === 'Ошибка' && <AlertCircle size={13} />}
                        {row.status}
                      </span>
                    ) : <span className="text-zinc-300 dark:text-zinc-600 text-xs">—</span>}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(row.signals ?? []).map((sig: string) => (
                        <span
                          key={sig}
                          className={clsx(
                            'px-1.5 py-0.5 rounded text-[10px] font-medium',
                            SIGNAL_COLORS[sig]?.bg ?? 'bg-zinc-100',
                            SIGNAL_COLORS[sig]?.text ?? 'text-zinc-600',
                          )}
                        >
                          {SIGNAL_LABELS[sig] ?? sig}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
              {loadingRows && (
                <tr>
                  <td colSpan={8} className="px-5 py-16 text-center">
                    <Loader2 className="mx-auto text-blue-400 mb-3 animate-spin" size={32} />
                    <p className="text-sm text-zinc-400 dark:text-zinc-500">Загрузка данных...</p>
                  </td>
                </tr>
              )}
              {!loadingRows && rowError && (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center">
                    <AlertCircle className="mx-auto text-red-400 mb-3" size={36} />
                    <p className="text-sm text-red-500 dark:text-red-400">{rowError}</p>
                  </td>
                </tr>
              )}
              {!loadingRows && !rowError && paged.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center">
                    <Table2 className="mx-auto text-zinc-300 dark:text-zinc-600 mb-3" size={36} />
                    <p className="text-sm text-zinc-400 dark:text-zinc-500">
                      Нет данных по текущим фильтрам. Попробуйте изменить параметры.
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
        <div className="flex items-center gap-4">
          <span>Показано {paged.length} из {filtered.length} строк</span>
          {errorCount > 0 && (
            <span className="flex items-center gap-1 text-red-500">
              <AlertCircle size={13} /> {errorCount} с ошибками
            </span>
          )}
          {overdueCount > 0 && (
            <span className="flex items-center gap-1 text-amber-500">
              <Clock size={13} /> {overdueCount} просроченных
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPageNum(Math.max(1, pageNum - 1))}
            disabled={pageNum <= 1}
            className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700 disabled:opacity-30 transition"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="px-2 font-medium">{pageNum} / {totalPages || 1}</span>
          <button
            onClick={() => setPageNum(Math.min(totalPages, pageNum + 1))}
            disabled={pageNum >= totalPages}
            className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700 disabled:opacity-30 transition"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {selectedRow && <RowDetailCard row={selectedRow} onClose={() => setSelectedRow(null)} />}
      </>
      )}
    </div>
  );
}
