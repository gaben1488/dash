import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useStore } from '../store';
import { useFilteredData } from '../hooks/useFilteredData';
import { api } from '../api';
import { AlertTriangle, CheckCircle2, Clock, XCircle, Search, Filter, ChevronDown, ChevronUp, MessageSquare, Loader2, Send, GitCommit, Edit3, PlusCircle, Download } from 'lucide-react';
import clsx from 'clsx';

type Severity = 'critical' | 'significant' | 'warning' | 'info';
type Status = 'open' | 'acknowledged' | 'in_progress' | 'resolved' | 'wont_fix' | 'false_positive';

interface DisplayIssue {
  id: string;
  severity: Severity;
  title: string;
  description: string;
  dept: string;
  row?: number;
  cell?: string;
  status: Status;
  detectedAt: string;
  recommendation?: string;
  comments: { text: string; author: string; at: string }[];
}

const SEV_CONFIG: Record<Severity, { label: string; bg: string; text: string; icon: typeof AlertTriangle }> = {
  critical: { label: 'Критическое', bg: 'bg-red-50 dark:bg-red-950/30', text: 'text-red-700 dark:text-red-400', icon: AlertTriangle },
  significant: { label: 'Существенное', bg: 'bg-orange-50 dark:bg-orange-950/30', text: 'text-orange-700 dark:text-orange-400', icon: AlertTriangle },
  warning: { label: 'Предупреждение', bg: 'bg-amber-50 dark:bg-amber-950/30', text: 'text-amber-700 dark:text-amber-400', icon: Clock },
  info: { label: 'Информация', bg: 'bg-zinc-50 dark:bg-zinc-700/50', text: 'text-zinc-600 dark:text-zinc-400', icon: MessageSquare },
};

const STATUS_CONFIG: Record<Status, { label: string; bg: string; text: string; icon: typeof CheckCircle2 }> = {
  open: { label: 'Открыто', bg: 'bg-red-100 dark:bg-red-950/30', text: 'text-red-700 dark:text-red-400', icon: AlertTriangle },
  acknowledged: { label: 'Принято', bg: 'bg-blue-100 dark:bg-blue-950/30', text: 'text-blue-700 dark:text-blue-400', icon: CheckCircle2 },
  in_progress: { label: 'В работе', bg: 'bg-amber-100 dark:bg-amber-950/30', text: 'text-amber-700 dark:text-amber-400', icon: Clock },
  resolved: { label: 'Исправлено', bg: 'bg-emerald-100 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-400', icon: CheckCircle2 },
  wont_fix: { label: 'Не будет исправлено', bg: 'bg-zinc-100 dark:bg-zinc-700/50', text: 'text-zinc-600 dark:text-zinc-400', icon: XCircle },
  false_positive: { label: 'Ложное срабатывание', bg: 'bg-purple-100 dark:bg-purple-950/30', text: 'text-purple-700 dark:text-purple-400', icon: XCircle },
};

interface HistoryEntry {
  type: 'created' | 'status_change' | 'comment';
  at: string;
  author?: string;
  text?: string;
  from?: string;
  to?: string;
  reason?: string;
}

const HISTORY_ICON: Record<string, typeof GitCommit> = {
  created: PlusCircle,
  status_change: Edit3,
  comment: MessageSquare,
};

function IssueTimeline({ issueId }: { issueId: string }) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [commentText, setCommentText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchHistory = useCallback(async () => {
    try {
      const data = await api.getIssueHistory(issueId);
      setHistory(Array.isArray(data) ? data : data?.history ?? []);
    } catch (err) {
      console.error('Failed to fetch issue history:', err);
    } finally {
      setLoading(false);
    }
  }, [issueId]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const handleSubmitComment = async () => {
    const trimmed = commentText.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await api.addIssueComment(issueId, trimmed);
      setCommentText('');
      await fetchHistory();
    } catch (err) {
      console.error('Failed to add comment:', err);
    } finally {
      setSubmitting(false);
      inputRef.current?.focus();
    }
  };

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  };

  const statusLabel = (s: string) => {
    const map: Record<string, string> = { open: 'Открыто', acknowledged: 'Принято', in_progress: 'В работе', resolved: 'Исправлено', wont_fix: 'Не будет исправлено', false_positive: 'Ложное срабатывание' };
    return map[s] ?? s;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 size={16} className="animate-spin text-zinc-400" />
        <span className="ml-2 text-xs text-zinc-400">Загрузка истории...</span>
      </div>
    );
  }

  return (
    <div>
      <p className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300 mb-3">История и комментарии</p>

      {/* Timeline */}
      {history.length > 0 ? (
        <div className="relative ml-3 border-l-2 border-zinc-200 dark:border-zinc-700 space-y-3 mb-4">
          {history.map((entry, i) => {
            const Icon = HISTORY_ICON[entry.type] ?? GitCommit;
            const isComment = entry.type === 'comment';
            const isStatusChange = entry.type === 'status_change';
            return (
              <div key={i} className="relative pl-5">
                <span className={clsx(
                  'absolute -left-[9px] top-0.5 w-4 h-4 rounded-full flex items-center justify-center',
                  isComment ? 'bg-blue-100 dark:bg-blue-900/40' : isStatusChange ? 'bg-amber-100 dark:bg-amber-900/40' : 'bg-emerald-100 dark:bg-emerald-900/40'
                )}>
                  <Icon size={10} className={clsx(
                    isComment ? 'text-blue-500 dark:text-blue-400' : isStatusChange ? 'text-amber-500 dark:text-amber-400' : 'text-emerald-500 dark:text-emerald-400'
                  )} />
                </span>
                <div className="text-[11px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    {entry.author && <span className="font-medium text-zinc-700 dark:text-zinc-200">{entry.author}</span>}
                    <span className="text-zinc-400 dark:text-zinc-500">{formatDate(entry.at)}</span>
                  </div>
                  {entry.type === 'created' && (
                    <p className="text-zinc-500 dark:text-zinc-400 mt-0.5">Замечание создано</p>
                  )}
                  {isStatusChange && (
                    <p className="text-zinc-500 dark:text-zinc-400 mt-0.5">
                      Статус: <span className="font-medium text-zinc-700 dark:text-zinc-200">{statusLabel(entry.from ?? '')}</span>
                      {' → '}
                      <span className="font-medium text-zinc-700 dark:text-zinc-200">{statusLabel(entry.to ?? '')}</span>
                      {entry.reason && <span className="ml-1 text-zinc-400 dark:text-zinc-500">({entry.reason})</span>}
                    </p>
                  )}
                  {isComment && entry.text && (
                    <p className="text-zinc-600 dark:text-zinc-300 mt-0.5 bg-white dark:bg-zinc-800/60 rounded-lg px-3 py-2 border border-zinc-100 dark:border-zinc-700/50">{entry.text}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mb-4">Нет записей в истории</p>
      )}

      {/* Comment input */}
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          placeholder="Добавить комментарий..."
          value={commentText}
          onChange={e => setCommentText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSubmitComment(); }}
          disabled={submitting}
          className="flex-1 px-3 py-1.5 text-xs border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900/50 text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
        />
        <button
          onClick={handleSubmitComment}
          disabled={!commentText.trim() || submitting}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
          Добавить
        </button>
      </div>
    </div>
  );
}

export function IssuesPage() {
  const { dashboardData, navigateTo, searchQuery } = useStore();
  const fd = useFilteredData();

  const [search, setSearch] = useState(searchQuery);
  // Sync local search from global searchQuery when navigating
  useEffect(() => { if (searchQuery) setSearch(searchQuery); }, [searchQuery]);
  const [sevFilter, setSevFilter] = useState<Set<Severity>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<Status>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [statusUpdating, setStatusUpdating] = useState<string | null>(null);
  const [statusOverrides, setStatusOverrides] = useState<Record<string, Status>>({});

  const handleStatusChange = useCallback(async (issueId: string, newStatus: Status) => {
    setStatusUpdating(issueId);
    try {
      const reason = (newStatus === 'wont_fix' || newStatus === 'false_positive') ? 'Изменено через интерфейс' : undefined;
      await api.updateIssueStatus(issueId, newStatus, reason);
      setStatusOverrides(prev => ({ ...prev, [issueId]: newStatus }));
    } catch (err) {
      console.error('Failed to update issue status:', err);
    } finally {
      setStatusUpdating(null);
    }
  }, []);

  // Use centralized filtered issues (respects dept, subordinate, search filters)
  const issues: DisplayIssue[] = useMemo(() => {
    const raw = fd.issues;
    const detectedAt = dashboardData?.lastRefreshed ?? '';
    return raw.map((iss: any) => ({
      id: iss.id,
      severity: iss.severity as Severity,
      title: iss.title,
      description: iss.description,
      dept: iss.departmentId || iss.sheet || '—',
      row: iss.row,
      cell: iss.cell,
      status: statusOverrides[iss.id] ?? ((iss.status as Status) || 'open'),
      detectedAt,
      recommendation: iss.recommendation,
      comments: [],
    }));
  }, [fd.issues, dashboardData, statusOverrides]);

  if (!dashboardData) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center">
          <AlertTriangle size={40} className="mx-auto mb-3 text-zinc-300 dark:text-zinc-600" />
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Нет данных — загрузите дашборд</p>
        </div>
      </div>
    );
  }

  if (issues.length === 0) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center">
          <CheckCircle2 size={40} className="mx-auto mb-3 text-emerald-400 dark:text-emerald-500" />
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Замечаний не обнаружено</p>
          <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">Все проверки пройдены успешно</p>
        </div>
      </div>
    );
  }

  // Local search (on top of global search from useFilteredData)
  const filtered = issues.filter(iss => {
    if (search && !iss.title.toLowerCase().includes(search.toLowerCase()) && !iss.dept.toLowerCase().includes(search.toLowerCase()) && !iss.description.toLowerCase().includes(search.toLowerCase())) return false;
    if (sevFilter.size > 0 && !sevFilter.has(iss.severity)) return false;
    if (statusFilter.size > 0 && !statusFilter.has(iss.status)) return false;
    return true;
  });

  const counts = {
    open: issues.filter(i => i.status === 'open').length,
    acknowledged: issues.filter(i => i.status === 'acknowledged').length,
    in_progress: issues.filter(i => i.status === 'in_progress').length,
    resolved: issues.filter(i => i.status === 'resolved').length,
    wont_fix: issues.filter(i => i.status === 'wont_fix').length,
    false_positive: issues.filter(i => i.status === 'false_positive').length,
  };

  const toggleSev = (s: Severity) => {
    const next = new Set(sevFilter);
    next.has(s) ? next.delete(s) : next.add(s);
    setSevFilter(next);
  };

  const toggleStatus = (s: Status) => {
    const next = new Set(statusFilter);
    next.has(s) ? next.delete(s) : next.add(s);
    setStatusFilter(next);
  };

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="flex flex-wrap gap-3">
        {(Object.entries(counts) as [Status, number][]).map(([status, count]) => {
          const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.open;
          const Icon = cfg.icon;
          return (
            <button
              key={status}
              onClick={() => toggleStatus(status)}
              className={clsx(
                'flex items-center gap-2 px-4 py-2 rounded-xl border transition text-sm font-medium',
                statusFilter.has(status) ? `${cfg.bg} ${cfg.text} border-current` : 'bg-white dark:bg-zinc-800/60 border-zinc-200 dark:border-zinc-700/50 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700/30'
              )}
            >
              <Icon size={14} />
              {cfg.label}: {count}
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -tranzinc-y-1/2 text-zinc-400" />
            <input
              type="text"
              placeholder="Поиск по заголовку, отделу..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900/50 text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div className="flex items-center gap-1">
            <Filter size={13} className="text-zinc-400" />
            {(['critical', 'significant', 'warning', 'info'] as Severity[]).map(s => {
              const cfg = SEV_CONFIG[s];
              return (
                <button
                  key={s}
                  onClick={() => toggleSev(s)}
                  className={clsx(
                    'px-2.5 py-1 text-xs rounded-full border transition font-medium',
                    sevFilter.has(s) ? `${cfg.bg} ${cfg.text} border-current` : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700/30'
                  )}
                >
                  {cfg.label}
                </button>
              );
            })}
          </div>
          <a
            href={api.exportIssuesUrl(
              sevFilter.size > 0 ? { severity: [...sevFilter][0] } : undefined
            )}
            download
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-600 transition"
          >
            <Download size={13} />
            Экспорт CSV
          </a>
        </div>
      </div>

      {/* Issues list */}
      <div className="space-y-3">
        {filtered.map(iss => {
          const sev = SEV_CONFIG[iss.severity] ?? SEV_CONFIG.info;
          const stat = STATUS_CONFIG[iss.status] ?? STATUS_CONFIG.open;
          const SevIcon = sev.icon;
          const StatIcon = stat.icon;
          const expanded = expandedId === iss.id;

          return (
            <div key={iss.id} className={clsx('bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border overflow-hidden transition', expanded ? 'border-blue-200 dark:border-blue-500/30' : 'border-zinc-100 dark:border-zinc-700/50')}>
              <div
                className="flex items-start gap-4 p-4 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-700/30 transition"
                onClick={() => setExpandedId(expanded ? null : iss.id)}
              >
                <span className={clsx('flex-shrink-0 mt-0.5 p-1.5 rounded-lg', sev.bg)}>
                  <SevIcon size={16} className={sev.text} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500">{iss.id}</span>
                    <span className={clsx('text-[10px] px-1.5 py-0.5 rounded-full font-medium', sev.bg, sev.text)}>{sev.label}</span>
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 font-medium cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/30 hover:text-blue-600 dark:hover:text-blue-400 transition"
                      onClick={(e) => { e.stopPropagation(); if (iss.dept !== '—') navigateTo('data', { department: iss.dept }); }}
                    >{iss.dept}</span>
                  </div>
                  <h4 className="text-sm font-medium text-zinc-800 dark:text-white truncate">{iss.title}</h4>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 line-clamp-1">{iss.description}</p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', stat.bg, stat.text)}>
                    <StatIcon size={11} /> {stat.label}
                  </span>
                  {expanded ? <ChevronUp size={14} className="text-zinc-400" /> : <ChevronDown size={14} className="text-zinc-400" />}
                </div>
              </div>

              {expanded && (
                <div className="border-t border-zinc-100 dark:border-zinc-700/50 px-4 py-4 bg-zinc-50/50 dark:bg-zinc-900/30">
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">{iss.description}</p>
                      {iss.recommendation && (
                        <p className="text-xs text-blue-600 dark:text-blue-400 mb-2">Рекомендация: {iss.recommendation}</p>
                      )}
                      <div className="flex flex-wrap gap-3 text-[11px] text-zinc-500 dark:text-zinc-400">
                        {iss.cell && <span>Ячейка: <strong className="text-zinc-700 dark:text-zinc-200 font-mono">{iss.dept}!{iss.cell}</strong></span>}
                        {iss.row && <span>Строка: <strong className="text-zinc-700 dark:text-zinc-200">{iss.row}</strong></span>}
                        {iss.detectedAt && <span>Обнаружено: <strong className="text-zinc-700 dark:text-zinc-200">{iss.detectedAt}</strong></span>}
                      </div>
                    </div>
                    <div>
                      <p className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300 mb-2">Действия</p>
                      <div className="flex flex-wrap gap-2">
                        {statusUpdating === iss.id && (
                          <Loader2 size={14} className="animate-spin text-zinc-400" />
                        )}
                        {iss.status === 'open' && statusUpdating !== iss.id && (
                          <>
                            <button onClick={() => handleStatusChange(iss.id, 'acknowledged')} className="px-3 py-1 text-xs font-medium bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition">Принять</button>
                            <button onClick={() => handleStatusChange(iss.id, 'in_progress')} className="px-3 py-1 text-xs font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition">В работу</button>
                          </>
                        )}
                        {(iss.status === 'open' || iss.status === 'acknowledged' || iss.status === 'in_progress') && statusUpdating !== iss.id && (
                          <>
                            <button onClick={() => handleStatusChange(iss.id, 'resolved')} className="px-3 py-1 text-xs font-medium bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition">Исправлено</button>
                            <button onClick={() => handleStatusChange(iss.id, 'wont_fix')} className="px-3 py-1 text-xs font-medium bg-zinc-400 text-white rounded-lg hover:bg-zinc-500 transition">Не исправлять</button>
                            <button onClick={() => handleStatusChange(iss.id, 'false_positive')} className="px-3 py-1 text-xs font-medium bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition">Ложное</button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-zinc-200 dark:border-zinc-700 pt-3">
                    <IssueTimeline issueId={iss.id} />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Status bar */}
      <div className="text-xs text-zinc-400 dark:text-zinc-500 text-center">
        Показано {filtered.length} из {issues.length} замечаний
      </div>
    </div>
  );
}
