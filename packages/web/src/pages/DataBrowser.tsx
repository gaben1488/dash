import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { BUDGET_SOURCE_META, productLabel } from '@aemr/shared';
import { useStore } from '../store';
import { api, humanizeRequestError } from '../api';
import { Table2, Download, ChevronLeft, ChevronRight, AlertCircle, CheckCircle2, Clock, XCircle, ArrowUpDown, ArrowUp, ArrowDown, Filter, X, Edit3, Eye } from 'lucide-react';
import clsx from 'clsx';
import { RowDetailCard } from '../components/RowDetailCard';
import { TableEditor, type ColumnConfig, type RowData } from '../components/TableEditor';
import { KbHover } from '../components/contract/KbHover';
import { filterRowsByBudgets } from '../lib/rows-filter';
import { collectAllPages } from '../lib/rows/collect-pages';
import { monthOfDateValue, formatDateCell } from '../lib/sheet-date';
import { toCanonicalDeptId } from '../lib/dept-key';
import { pluralRu } from '../lib/economy-copy';
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

type SortKey = 'id' | 'subject' | 'method' | 'planSum' | 'factSum' | 'economy' | 'status' | 'dept';
type SortDir = 'asc' | 'desc';

/** Строк на один запрос к серверу — его же потолок (rows.ts: min(1000, limit)). */
const ROWS_PER_REQUEST = 1000;

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

export function DataBrowserPage() {
  const { formatMoney, moneyUnit, selectedDepartments, selectedSubordinates, activityFilter, procurementFilter, period, activeMonths, searchQuery, subordinatesMap, year, selectedBudgets } = useStore();
  const [viewMode, setViewMode] = useState<ViewMode>('browse');
  const [pageNum, setPageNum] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortKey, setSortKey] = useState<SortKey>('id');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [rows, setRows] = useState<any[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [trouble, setTrouble] = useState<LoadTrouble>(NO_TROUBLE);
  const [selectedRow, setSelectedRow] = useState<any>(null);
  const [signalFilter, setSignalFilter] = useState<string[]>([]);
  const [signalDropdownOpen, setSignalDropdownOpen] = useState(false);
  const signalDropdownRef = useRef<HTMLDivElement>(null);

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
    { key: 'id', label: '№', type: 'text', width: 'w-14', editable: false },
    { key: 'dept', label: 'Управление', type: 'text', width: 'w-20', editable: false },
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
    { key: 'status', label: 'Статус', type: 'text', width: 'w-24', editable: false },
    { key: 'flag', label: 'Признак экономии', type: 'text', width: 'w-24' },
    { key: 'commentGRBS', label: 'Комментарий управления', type: 'text' },
  ], [moneyCell]);

  // Строки реестра → строки редактора при переходе на вкладку правки
  useEffect(() => {
    if (viewMode === 'editor' && rows.length > 0) {
      const mapped: RowData[] = rows.map((r, idx) => ({
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
    }
  }, [viewMode, rows, defaultEditorColumns, editorColumns.length]);

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
  useEffect(() => { setPageNum(1); }, [searchQuery, selectedDepartments, selectedSubordinates, activityFilter, signalFilter, selectedBudgets]);

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

  const filtered = useMemo(() => {
    let data = [...rows];
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
    // Источники финансирования: строка проходит, если имеет план ИЛИ факт в выбранном
    data = filterRowsByBudgets(data, selectedBudgets);
    data.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av;
      const as = String(av ?? ''), bs = String(bv ?? '');
      return sortDir === 'asc' ? as.localeCompare(bs, 'ru') : bs.localeCompare(as, 'ru');
    });
    return data;
  }, [rows, searchQuery, sortKey, sortDir, period, activeMonths, signalFilter, selectedBudgets]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  // Выборка могла ужаться сильнее, чем сбрасывается номер страницы (например,
  // после смены числа строк) — пустая страница при непустой выборке была бы
  // ложной пустотой, поэтому номер прижимается к последней существующей.
  useEffect(() => {
    if (pageNum > totalPages) setPageNum(totalPages);
  }, [pageNum, totalPages]);
  const safePage = Math.min(pageNum, totalPages);
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const severity = useMemo(() => countBySeverity(filtered), [filtered]);
  const occurrences = useMemo(() => signalOccurrences(rows), [rows]);
  const unchecked = useMemo(() => countUncheckedByPeriod(filtered), [filtered]);

  const requestFilters = useMemo(() => requestFilterNames({
    departments: selectedDepartments.size,
    subordinates: selectedSubordinates.size,
    activity: activityFilter,
    procurement: procurementFilter,
    year,
  }), [selectedDepartments.size, selectedSubordinates.size, activityFilter, procurementFilter, year]);

  const screenFilters = useMemo(() => screenFilterNames({
    period,
    months: activeMonths.size,
    search: searchQuery,
    signals: signalFilter.length,
    budgets: selectedBudgets.size,
  }), [period, activeMonths.size, searchQuery, signalFilter.length, selectedBudgets.size]);

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
  const factTotal = useMemo(() => filtered.reduce((s: number, r: { factSum?: number }) => s + (r.factSum || 0), 0), [filtered]);

  const downloadTable = useCallback(() => {
    if (filtered.length === 0) return;
    const headers = ['№', 'Предмет закупки', 'Управление', 'Вид деятельности', 'Способ', 'План, тыс. ₽', 'Факт, тыс. ₽', 'Экономия, тыс. ₽', 'Дата плана', 'Дата факта', 'Статус', 'Признаки'];
    const csvRows = filtered.map(r => [
      r.id,
      `"${String(r.subject ?? '').replace(/"/g, '""')}"`,
      deptDisplayName(r.dept),
      `"${activityRowLabel(r.type, r.programName)}"`,
      r.method ?? '',
      r.planSum ?? '',
      r.factSum ?? '',
      r.economy ?? '',
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
    a.href = url;
    a.download = `Реестр закупок ${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filtered]);

  /** Утверждение о выборке — оно же заголовок сводной строки. */
  const summaryClaim = severity.critical > 0
    ? `${severity.critical} ${pluralRu(severity.critical, 'строка требует', 'строки требуют', 'строк требуют')} разбора`
    : severity.warning > 0
      ? `${severity.warning} ${pluralRu(severity.warning, 'строка под', 'строки под', 'строк под')} наблюдением`
      : 'Критических признаков в выборке нет';

  const everythingFailed = trouble.failedDepts.length > 0 && rows.length === 0;

  return (
    <div className="space-y-4">
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
        <div className="flex items-start gap-2.5 px-4 py-3 rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 text-xs">
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
                : undefined
          }
          notice="Строки заводятся и удаляются в самой книге управления: редактор правит существующие ячейки и пишет их в лист."
        />
      ) : (
      <>
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
            <option value={25}>25 строк</option>
            <option value={50}>50 строк</option>
            <option value={100}>100 строк</option>
            <option value={500}>500 строк</option>
            {/* «Все» — по просьбе пользователей: реестр целиком, без листания */}
            <option value={1000000}>Все строки</option>
          </select>

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
                {signalFilter.length > 0 && (
                  <div className="border-t border-zinc-100 dark:border-zinc-700 mt-1 pt-1 px-3 pb-1">
                    <button
                      type="button"
                      onClick={() => { setSignalFilter([]); setSignalDropdownOpen(false); }}
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
          <span className="text-zinc-500 dark:text-zinc-400">
            План:{' '}
            <KbHover
              metricKey="plan_total"
              live={`${formatMoney(planTotal)} — сумма плановых итогов по строкам текущей выборки (их ${filtered.length}).\nПервичка: колонка «ИТОГО план» книг управлений.\nЭто не показатель листа СВОД: выборка сужена фильтрами.`}
            >
              <span className="font-medium text-zinc-700 dark:text-zinc-300 tabular-nums">{formatMoney(planTotal)}</span>
            </KbHover>
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
        </div>
      )}

      {/* Таблица */}
      <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Реестр строк закупок по текущим фильтрам</caption>
            <thead>
              <tr className="bg-zinc-50 dark:bg-zinc-900/50 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                {([
                  ['id', '№', 'pl-5 pr-2 py-3 w-10', ''],
                  ['subject', 'Предмет закупки', 'px-3 py-3', ''],
                  ['method', 'Способ', 'px-3 py-3 w-16', ''],
                  // Единица в подписи берётся из шапки: при переключении на млн
                  // застывшее «тыс.» превращало верную цифру в неверное утверждение.
                  ['planSum', `План, ${moneyUnit} ₽`, 'px-3 py-3 w-28', 'text-right'],
                  ['factSum', `Факт, ${moneyUnit} ₽`, 'px-3 py-3 w-28', 'text-right'],
                  ['economy', 'Экономия', 'px-3 py-3 w-28', 'text-right'],
                  ['status', 'Статус', 'px-3 py-3 w-28', ''],
                ] as [SortKey, string, string, string][]).map(([key, label, cls, align]) => (
                  <th
                    key={key}
                    scope="col"
                    aria-sort={sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    className={clsx(cls, align)}
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
                <th scope="col" className="px-3 py-3">Признаки строки</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
              {!loadingRows && paged.map((row, i) => {
                const noDate = !rowHasPeriodDate(row);
                const noYear = !row.planYear;
                return (
                <tr key={`${row.dept}-${row.rowIndex ?? row.id}-${i}`} className="hover:bg-blue-50/30 dark:hover:bg-zinc-700/30 transition group cursor-pointer" onClick={() => setSelectedRow(row)}>
                  <td className="pl-5 pr-2 py-3 text-zinc-400 dark:text-zinc-500 tabular-nums">
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
                    <div className="text-[10px] text-zinc-400 dark:text-zinc-500 truncate max-w-xs">
                      {deptDisplayName(row.dept)} • {activityRowLabel(row.type, row.programName)}
                      {noDate && (
                        <span
                          className="ml-1.5 px-1 py-px rounded bg-zinc-100 dark:bg-zinc-700/50 text-zinc-500 dark:text-zinc-400"
                          title="Ни плановая, ни фактическая дата не заполнены: фильтр периода такую строку не проверял"
                        >
                          без даты
                        </span>
                      )}
                      {!noDate && noYear && (
                        <span
                          className="ml-1.5 px-1 py-px rounded bg-zinc-100 dark:bg-zinc-700/50 text-zinc-500 dark:text-zinc-400"
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
                    {row.economy > 0
                      ? <span className="text-emerald-600 dark:text-emerald-400 font-medium">{formatMoney(row.economy)}</span>
                      : (
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
          {uncheckedNote && (
            <div className="text-amber-600 dark:text-amber-400">{uncheckedNote}</div>
          )}
        </div>
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
      </div>
      )}

      {selectedRow && <RowDetailCard row={selectedRow} onClose={() => setSelectedRow(null)} />}
      </>
      )}
    </div>
  );
}
