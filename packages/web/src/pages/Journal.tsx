import { useState, useMemo, useEffect } from 'react';
import { useStore } from '../store';
import { api } from '../api';
import { BookOpen, Search, Filter, Inbox, Database, FileEdit, AlertTriangle, Settings, RefreshCw, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import clsx from 'clsx';

type EventType = 'import' | 'edit' | 'issue' | 'issue_create' | 'issue_status' | 'normalize' | 'input_error' | 'mapping_change' | 'error' | 'system';

interface JournalEntry {
  id: string;
  type: EventType;
  timestamp: string;
  actor: string;
  action: string;
  details: string;
  dept?: string;
}

const TYPE_CONFIG: Record<string, { label: string; bg: string; text: string; icon: typeof Database }> = {
  import: { label: 'Импорт', bg: 'bg-blue-50 dark:bg-blue-950/30', text: 'text-blue-700 dark:text-blue-400', icon: Database },
  edit: { label: 'Правка', bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-400', icon: FileEdit },
  issue: { label: 'Замечание', bg: 'bg-amber-50 dark:bg-amber-950/30', text: 'text-amber-700 dark:text-amber-400', icon: AlertTriangle },
  issue_create: { label: 'Замечание', bg: 'bg-amber-50 dark:bg-amber-950/30', text: 'text-amber-700 dark:text-amber-400', icon: AlertTriangle },
  issue_status: { label: 'Статус', bg: 'bg-amber-50 dark:bg-amber-950/30', text: 'text-amber-700 dark:text-amber-400', icon: AlertTriangle },
  normalize: { label: 'Нормализация', bg: 'bg-zinc-50 dark:bg-zinc-700/50', text: 'text-zinc-600 dark:text-zinc-400', icon: Settings },
  input_error: { label: 'Ошибка ввода', bg: 'bg-red-50 dark:bg-red-950/30', text: 'text-red-700 dark:text-red-400', icon: AlertTriangle },
  mapping_change: { label: 'Маппинг', bg: 'bg-indigo-50 dark:bg-indigo-950/30', text: 'text-indigo-700 dark:text-indigo-400', icon: Settings },
  error: { label: 'Ошибка', bg: 'bg-red-50 dark:bg-red-950/30', text: 'text-red-700 dark:text-red-400', icon: AlertTriangle },
  system: { label: 'Система', bg: 'bg-purple-50 dark:bg-purple-950/30', text: 'text-purple-700 dark:text-purple-400', icon: RefreshCw },
};

const PAGE_SIZE = 10;

export function JournalPage() {
  const { selectedDepartments } = useStore();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<Set<EventType>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalFromApi, setTotalFromApi] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params: Record<string, string> = {
      page: String(currentPage),
      limit: String(PAGE_SIZE),
    };
    if (search) params.search = search;
    if (typeFilter.size > 0) params.action = [...typeFilter][0]; // API supports single action filter
    if (selectedDepartments.size > 0) params.dept = [...selectedDepartments].join(',');

    api.getJournal(params).then((data: any) => {
      if (cancelled) return;
      const entries = (data.entries ?? []).map((e: any) => ({
        id: e.id,
        type: e.type ?? 'system',
        timestamp: e.timestamp ?? '',
        actor: e.actor ?? 'Система',
        action: e.action ?? '',
        details: e.details ?? '',
        dept: e.departmentId ?? undefined,
      }));
      setJournalEntries(entries);
      setTotalFromApi(data.pagination?.total ?? entries.length);
    }).catch(() => {
      if (!cancelled) setJournalEntries([]);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [currentPage, search, typeFilter, selectedDepartments]);

  const toggleType = (t: EventType) => {
    const next = new Set(typeFilter);
    next.has(t) ? next.delete(t) : next.add(t);
    setTypeFilter(next);
    setCurrentPage(1);
  };

  // Data is already filtered/paginated by API
  const totalPages = Math.ceil(totalFromApi / PAGE_SIZE);
  const pageItems = journalEntries;

  const todayCount = journalEntries.filter(e => e.timestamp?.startsWith(new Date().toISOString().slice(0, 10))).length;
  const errorCount = journalEntries.filter(e => e.type === 'error' || e.type === 'input_error').length;
  const importCount = journalEntries.filter(e => e.type === 'import').length;

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="flex flex-wrap gap-6 text-xs bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 px-5 py-3">
        <div className="flex items-center gap-2">
          <BookOpen size={14} className="text-blue-500" />
          <span className="text-zinc-500 dark:text-zinc-400">Всего событий: <strong className="text-zinc-700 dark:text-zinc-200">{totalFromApi}</strong></span>
        </div>
        <span className="text-zinc-500 dark:text-zinc-400">Сегодня: <strong className="text-zinc-700 dark:text-zinc-200">{todayCount}</strong></span>
        <span className="text-zinc-500 dark:text-zinc-400">Ошибок: <strong className="text-red-600 dark:text-red-400">{errorCount}</strong></span>
        <span className="text-zinc-500 dark:text-zinc-400">Импортов: <strong className="text-blue-600 dark:text-blue-400">{importCount}</strong></span>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -tranzinc-y-1/2 text-zinc-400" />
            <input
              type="text"
              placeholder="Поиск по действию, деталям, отделу..."
              value={search}
              onChange={e => { setSearch(e.target.value); setCurrentPage(1); }}
              className="w-full pl-9 pr-3 py-2 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900/50 text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div className="flex items-center gap-1">
            <Filter size={13} className="text-zinc-400 mr-1" />
            {(Object.entries(TYPE_CONFIG) as [EventType, typeof TYPE_CONFIG[EventType]][]).map(([type, cfg]) => (
              <button
                key={type}
                onClick={() => toggleType(type)}
                className={clsx(
                  'px-2.5 py-1 text-xs rounded-full border transition font-medium',
                  typeFilter.has(type) ? `${cfg.bg} ${cfg.text} border-current` : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700/30'
                )}
              >
                {cfg.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Table or Empty State */}
      <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <Loader2 className="mx-auto text-blue-400 mb-3 animate-spin" size={32} />
            <p className="text-sm text-zinc-400 dark:text-zinc-500">Загрузка журнала...</p>
          </div>
        ) : pageItems.length === 0 ? (
          <div className="p-12 text-center">
            <Inbox className="mx-auto text-zinc-300 dark:text-zinc-600 mb-4" size={48} />
            <h2 className="text-lg font-semibold text-zinc-600 dark:text-zinc-300 mb-2">Журнал событий пока пуст</h2>
            <p className="text-sm text-zinc-400 dark:text-zinc-500 max-w-md mx-auto">
              События будут записываться при обновлении данных и изменении статусов замечаний.
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-zinc-50 dark:bg-zinc-900/50 text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                    <th className="px-5 py-3 text-left">Время</th>
                    <th className="px-4 py-3 text-left">Кто</th>
                    <th className="px-4 py-3 text-center">Тип</th>
                    <th className="px-4 py-3 text-left">Действие</th>
                    <th className="px-4 py-3 text-left">Детали</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
                  {pageItems.map(entry => {
                    const cfg = TYPE_CONFIG[entry.type];
                    const Icon = cfg.icon;
                    return (
                      <tr key={entry.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-700/30 transition">
                        <td className="px-5 py-3 text-xs text-zinc-500 dark:text-zinc-400 font-mono whitespace-nowrap">{entry.timestamp}</td>
                        <td className="px-4 py-3 text-xs text-zinc-600 dark:text-zinc-300 font-medium">{entry.actor}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium', cfg.bg, cfg.text)}>
                            <Icon size={10} /> {cfg.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-zinc-700 dark:text-zinc-200 font-medium">
                          {entry.action}
                          {entry.dept && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400">{entry.dept}</span>}
                        </td>
                        <td className="px-4 py-3 text-xs text-zinc-500 dark:text-zinc-400 max-w-xs truncate">{entry.details}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-zinc-100 dark:border-zinc-700/50 bg-zinc-50/50 dark:bg-zinc-900/30">
                <span className="text-xs text-zinc-400 dark:text-zinc-500">
                  Показано {(currentPage - 1) * PAGE_SIZE + 1}-{Math.min(currentPage * PAGE_SIZE, totalFromApi)} из {totalFromApi}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="p-1.5 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-30 transition"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => (
                    <button
                      key={i}
                      onClick={() => setCurrentPage(i + 1)}
                      className={clsx(
                        'w-7 h-7 text-xs rounded-lg transition font-medium',
                        currentPage === i + 1 ? 'bg-blue-600 text-white' : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                      )}
                    >
                      {i + 1}
                    </button>
                  ))}
                  <button
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="p-1.5 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-30 transition"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
