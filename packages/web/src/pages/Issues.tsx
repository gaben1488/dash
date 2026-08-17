import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { SEVERITY_LABELS, productLabel } from '@aemr/shared';
import { useStore } from '../store';
import { useFilteredData } from '../hooks/useFilteredData';
import { api, humanizeRequestError } from '../api';
import { issueAxesWithoutData } from '../lib/selectors/issues-filtering';
import {
  allowedIssueTransitions,
  issueStatusLabel,
  issueTransitionNeedsReason,
  issueTransitionRefusal,
} from '../lib/selectors/issue-transitions';
import { formatEventTime } from '../lib/selectors/event-time';
import { groupIssuesByMechanism, type MechanismGroup } from '../lib/diagnostics/mechanism-groups';
import { natureOf, NATURE_ORDER, NATURE_CATEGORIES, type NatureCategory } from '../lib/diagnostics/nature-categories';
import { pluralRu } from '../lib/economy-copy';
import { AlertTriangle, CheckCircle2, Clock, XCircle, Search, Filter, ChevronDown, ChevronUp, MessageSquare, Loader2, Send, GitCommit, Edit3, PlusCircle, Download, Info, ExternalLink, RotateCcw } from 'lucide-react';
import clsx from 'clsx';

type Severity = 'critical' | 'significant' | 'warning' | 'info';
type Status = 'open' | 'acknowledged' | 'in_progress' | 'resolved' | 'wont_fix' | 'false_positive';

interface DisplayIssue {
  id: string;
  severity: Severity;
  title: string;
  description: string;
  /** Ключ управления; пустая строка = управление у замечания не проставлено. */
  dept: string;
  row?: number;
  cell?: string;
  /** Ключ сигнала/проверки — для группировки по механизму (канон п.53). */
  signal?: string;
  checkId?: string;
  /** Механизм простыми словами из реестра проверок. */
  kbHint?: string;
  status: Status;
  /** Момент прогона проверок (ISO). Это НЕ момент появления проблемы в книге. */
  detectedAt: string;
  recommendation?: string;
  comments: { text: string; author: string; at: string }[];
}

/** Управление без ключа называется словами, а не прочерком (критерий пустоты). */
const DEPT_UNKNOWN_LABEL = 'Управление не указано';

function deptLabel(dept: string): string {
  return dept ? productLabel(dept) : DEPT_UNKNOWN_LABEL;
}

/**
 * Оформление серьёзности. Подписи — из SEVERITY_LABELS (@aemr/shared), тот же
 * дом, что у печатного отчёта: «Критично» на одной вкладке и «Критическое» на
 * другой — это два названия одной вещи, чего быть не должно. Локально остаются
 * только цвет и значок.
 */
const SEV_CONFIG: Record<Severity, { label: string; bg: string; text: string; icon: typeof AlertTriangle }> = {
  critical: { label: SEVERITY_LABELS.critical.label, bg: 'bg-red-50 dark:bg-red-950/30', text: 'text-red-700 dark:text-red-400', icon: AlertTriangle },
  significant: { label: SEVERITY_LABELS.significant.label, bg: 'bg-orange-50 dark:bg-orange-950/30', text: 'text-orange-700 dark:text-orange-400', icon: AlertTriangle },
  warning: { label: SEVERITY_LABELS.warning.label, bg: 'bg-amber-50 dark:bg-amber-950/30', text: 'text-amber-700 dark:text-amber-400', icon: Clock },
  info: { label: SEVERITY_LABELS.info.label, bg: 'bg-zinc-50 dark:bg-zinc-700/50', text: 'text-zinc-600 dark:text-zinc-400', icon: MessageSquare },
};

/**
 * Оформление статуса замечания. Подписи не дублируются: их дом —
 * ISSUE_STATUS_LABELS в @aemr/shared, доступный через issueStatusLabel.
 * Раньше у одного решения было три названия — словарное в бейдже, «Не
 * исправлять» на кнопке и сырой ключ `wont_fix` в журнале; фраза обязана быть
 * одна, потому что статус читают и здесь, и в истории, и в выгрузке.
 */
const STATUS_CONFIG: Record<Status, { label: string; bg: string; text: string; icon: typeof CheckCircle2 }> = {
  open: { label: issueStatusLabel('open'), bg: 'bg-red-100 dark:bg-red-950/30', text: 'text-red-700 dark:text-red-400', icon: AlertTriangle },
  acknowledged: { label: issueStatusLabel('acknowledged'), bg: 'bg-blue-100 dark:bg-blue-950/30', text: 'text-blue-700 dark:text-blue-400', icon: CheckCircle2 },
  in_progress: { label: issueStatusLabel('in_progress'), bg: 'bg-amber-100 dark:bg-amber-950/30', text: 'text-amber-700 dark:text-amber-400', icon: Clock },
  resolved: { label: issueStatusLabel('resolved'), bg: 'bg-emerald-100 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-400', icon: CheckCircle2 },
  wont_fix: { label: issueStatusLabel('wont_fix'), bg: 'bg-zinc-100 dark:bg-zinc-700/50', text: 'text-zinc-600 dark:text-zinc-400', icon: XCircle },
  false_positive: { label: issueStatusLabel('false_positive'), bg: 'bg-purple-100 dark:bg-purple-950/30', text: 'text-purple-700 dark:text-purple-400', icon: XCircle },
};

/** Оформление кнопки перехода — по смыслу целевого статуса, подпись из словаря. */
const TRANSITION_STYLE: Record<Status, string> = {
  open: 'bg-zinc-500 hover:bg-zinc-600',
  acknowledged: 'bg-blue-500 hover:bg-blue-600',
  in_progress: 'bg-amber-500 hover:bg-amber-600',
  resolved: 'bg-emerald-500 hover:bg-emerald-600',
  wont_fix: 'bg-zinc-400 hover:bg-zinc-500',
  false_positive: 'bg-purple-500 hover:bg-purple-600',
};

function issuesWord(n: number): string {
  return pluralRu(n, 'замечание', 'замечания', 'замечаний');
}

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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');
  const [commentError, setCommentError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getIssueHistory(issueId);
      setHistory(Array.isArray(data) ? data : data?.history ?? []);
      setLoadError(null);
    } catch (err) {
      // Молчаливый провал показывал «Нет записей в истории» — то есть выдавал
      // недоступность данных за их отсутствие. Разные вещи, разные подписи.
      setLoadError(humanizeRequestError(err));
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
    setCommentError(null);
    try {
      await api.addIssueComment(issueId, trimmed);
      setCommentText('');
      await fetchHistory();
    } catch (err) {
      // Раньше отказ уходил в консоль: пользователь жал «Добавить», текст
      // оставался в поле, и было непонятно — отправлено или нет.
      setCommentError(humanizeRequestError(err));
    } finally {
      setSubmitting(false);
      inputRef.current?.focus();
    }
  };

  const commentFieldId = `issue-comment-${issueId}`;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 size={16} className="animate-spin text-zinc-400" />
        <span className="ml-2 text-xs text-zinc-400">Читаем историю замечания…</span>
      </div>
    );
  }

  return (
    <div>
      <p className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300 mb-3">История и комментарии</p>

      {loadError ? (
        <div className="mb-4 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 px-3 py-2">
          <p className="text-[11px] text-amber-800 dark:text-amber-300">
            История замечания не прочитана — записи могут быть, но сейчас их не видно. Повторите попытку.
          </p>
          <p className="text-[10px] text-amber-700/70 dark:text-amber-400/60 mt-0.5">({loadError})</p>
          <button
            onClick={fetchHistory}
            className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-amber-800 dark:text-amber-300 hover:underline"
          >
            <RotateCcw size={11} /> Попробовать снова
          </button>
        </div>
      ) : history.length > 0 ? (
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
                    <span className="text-zinc-400 dark:text-zinc-500">{formatEventTime(entry.at)}</span>
                  </div>
                  {entry.type === 'created' && (
                    <p className="text-zinc-500 dark:text-zinc-400 mt-0.5">Замечание создано</p>
                  )}
                  {isStatusChange && (
                    <p className="text-zinc-500 dark:text-zinc-400 mt-0.5">
                      {/* Статус приходит с сервера сырым ключом; фразу даёт словарь продукта. */}
                      Статус: <span className="font-medium text-zinc-700 dark:text-zinc-200">{issueStatusLabel(entry.from ?? '')}</span>
                      {' → '}
                      <span className="font-medium text-zinc-700 dark:text-zinc-200">{issueStatusLabel(entry.to ?? '')}</span>
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
        <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mb-4">
          С этим замечанием пока ничего не делали: статус не менялся, комментариев нет.
        </p>
      )}

      <div>
        <label htmlFor={commentFieldId} className="sr-only">Комментарий к замечанию</label>
        <div className="flex items-center gap-2">
          <input
            id={commentFieldId}
            ref={inputRef}
            type="text"
            placeholder="Что выяснили по этому замечанию"
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
        {commentError && (
          <p className="mt-1.5 text-[11px] text-red-600 dark:text-red-400">
            Комментарий не сохранён — текст остался в поле, повторите отправку.{' '}
            <span className="text-red-500/70 dark:text-red-400/60">({commentError})</span>
          </p>
        )}
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
  const [statusError, setStatusError] = useState<Record<string, string>>({});
  /** Открытая форма причины: сервер не примет отказ и «ложное» без слов человека. */
  const [reasonDraft, setReasonDraft] = useState<{ issueId: string; target: Status; text: string } | null>(null);

  const applyStatus = useCallback(async (issueId: string, target: Status, reason?: string) => {
    setStatusUpdating(issueId);
    setStatusError(prev => ({ ...prev, [issueId]: '' }));
    try {
      await api.updateIssueStatus(issueId, target, reason);
      setStatusOverrides(prev => ({ ...prev, [issueId]: target }));
      setReasonDraft(null);
    } catch (err) {
      const raw = humanizeRequestError(err);
      // 400 здесь означает одно: статус успел измениться в другом месте, и наш
      // переход больше не разрешён. Сырой ответ сервера («Переход "open" →
      // "resolved" недопустим») пользователю не показываем — он с ключами.
      const message = /код 400/.test(raw)
        ? `Статус не изменён: замечание уже перевели в другом месте. Обновите страницу и посмотрите, в каком оно статусе сейчас.`
        : `Статус не изменён. ${raw}`;
      setStatusError(prev => ({ ...prev, [issueId]: message }));
    } finally {
      setStatusUpdating(null);
    }
  }, []);

  const startTransition = useCallback((issueId: string, target: Status) => {
    if (issueTransitionNeedsReason(target)) {
      setStatusError(prev => ({ ...prev, [issueId]: '' }));
      setReasonDraft({ issueId, target, text: '' });
      return;
    }
    void applyStatus(issueId, target);
  }, [applyStatus]);

  // Use centralized filtered issues (respects dept, subordinate, search filters)
  const issues: DisplayIssue[] = useMemo(() => {
    const raw = fd.issues;
    return raw.map((iss: any) => ({
      id: iss.id,
      severity: iss.severity as Severity,
      title: iss.title,
      description: iss.description,
      dept: iss.departmentId || iss.sheet || '',
      row: iss.row,
      cell: iss.cell,
      signal: iss.signal,
      checkId: iss.checkId,
      kbHint: iss.kbHint,
      status: statusOverrides[iss.id] ?? ((iss.status as Status) || 'open'),
      // Своё время замечания, а не время обновления дашборда: подменять одно
      // другим значит выдавать «когда последний раз читали книги» за «когда
      // нашли это». Обе величины про прогон конвейера, но у замечания она своя.
      detectedAt: iss.detectedAt ?? dashboardData?.lastRefreshed ?? '',
      recommendation: iss.recommendation,
      comments: [],
    }));
  }, [fd.issues, dashboardData, statusOverrides]);

  // Оси шапки, за которыми нет данных замечания. Проверяется по самим данным,
  // а не по памяти: появится поле — подпись исчезнет вместе с ним.
  const deadAxes = useMemo(() => issueAxesWithoutData(fd.issues), [fd.issues]);

  // Local search (on top of global search from useFilteredData)
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return issues.filter(iss => {
      if (needle) {
        const haystack = `${iss.title} ${iss.description} ${deptLabel(iss.dept)}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      if (sevFilter.size > 0 && !sevFilter.has(iss.severity)) return false;
      if (statusFilter.size > 0 && !statusFilter.has(iss.status)) return false;
      return true;
    });
  }, [issues, search, sevFilter, statusFilter]);

  // Карточки диагноста (канон п.53): одна группа = один механизм проверки.
  // Простыня «строка N: предмет» удалена решением владельца (п.69д) — список
  // строк живёт внутри группы, заголовок группы называет механизм, не предмет.
  const mechanismGroups = useMemo(
    () => groupIssuesByMechanism(filtered, productLabel),
    [filtered],
  );

  // Категории по природе (канон п.88/26б): «Ошибка заполнения книги» /
  // «Дефект формул листа» / «Исполнение закупок». Карточка диагноста целиком
  // живёт в одной категории: у всех замечаний группы один механизм — одна
  // природа. Пустые категории не рисуются.
  const natureSections = useMemo(() => {
    const byNature = new Map<string, MechanismGroup[]>();
    for (const group of mechanismGroups) {
      const nature = natureOf(group.issues[0] ?? {});
      const bucket = byNature.get(nature.id) ?? [];
      bucket.push(group);
      byNature.set(nature.id, bucket);
    }
    return NATURE_ORDER
      .filter(id => (byNature.get(id) ?? []).length > 0)
      .map(id => ({
        nature: NATURE_CATEGORIES[id] as NatureCategory,
        groups: byNature.get(id) ?? [],
      }));
  }, [mechanismGroups]);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (key: string) => {
    setOpenGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Экспорт = РОВНО отфильтрованный список (глобальные фильтры ГРБС/подвед/вид
  // деятельности уже применены в fd.issues, локальные — в filtered). Раньше
  // серверная ссылка передавала только ПЕРВУЮ severity и игнорировала остальное —
  // выгрузка не соответствовала экрану (потерянная просьба, Phase 4.9).
  const downloadCSV = useCallback(() => {
    const esc = (v: unknown): string => {
      const s = v == null ? '' : String(v);
      return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const headers = ['Управление', 'Серьёзность', 'Заголовок', 'Описание', 'Рекомендация', 'Статус', 'Строка', 'Ячейка', 'Найдено при проверке'];
    const rows = filtered.map(i => [
      esc(deptLabel(i.dept)),
      esc(SEV_CONFIG[i.severity]?.label ?? i.severity),
      esc(i.title),
      esc(i.description),
      esc(i.recommendation ?? ''),
      esc(STATUS_CONFIG[i.status]?.label ?? issueStatusLabel(i.status)),
      esc(i.row ?? ''),
      esc(i.cell ?? ''),
      esc(formatEventTime(i.detectedAt)),
    ].join(';'));
    const csv = '﻿' + headers.join(';') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // Имя файла тоже читает человек — оно на русском, как и заголовки колонок.
    a.download = `замечания_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filtered]);

  const counts = useMemo(() => ({
    open: issues.filter(i => i.status === 'open').length,
    acknowledged: issues.filter(i => i.status === 'acknowledged').length,
    in_progress: issues.filter(i => i.status === 'in_progress').length,
    resolved: issues.filter(i => i.status === 'resolved').length,
    wont_fix: issues.filter(i => i.status === 'wont_fix').length,
    false_positive: issues.filter(i => i.status === 'false_positive').length,
  }), [issues]);

  const hasLocalFilter = search.trim() !== '' || sevFilter.size > 0 || statusFilter.size > 0;

  const resetLocalFilters = () => {
    setSearch('');
    setSevFilter(new Set());
    setStatusFilter(new Set());
  };

  const toggleSev = (s: Severity) => {
    const next = new Set(sevFilter);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    setSevFilter(next);
  };

  const toggleStatus = (s: Status) => {
    const next = new Set(statusFilter);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    setStatusFilter(next);
  };

  if (!dashboardData) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center max-w-md">
          <AlertTriangle size={40} className="mx-auto mb-3 text-zinc-300 dark:text-zinc-600" />
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Книги закупок ещё не прочитаны</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            Замечания появляются после проверки данных. Нажмите «Обновить» в шапке — система перечитает книги управлений и прогонит проверки.
          </p>
        </div>
      </div>
    );
  }

  if (issues.length === 0) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center max-w-md">
          <CheckCircle2 size={40} className="mx-auto mb-3 text-emerald-400 dark:text-emerald-500" />
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Замечаний нет</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            По текущему отбору шапки (управление, подведомственная организация, вид деятельности, поиск) проверки не нашли ни одного нарушения.
            Если ожидали увидеть замечания — снимите отбор в шапке.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="flex flex-wrap gap-3">
        {(Object.entries(counts) as [Status, number][]).map(([status, count]) => {
          const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.open;
          const Icon = cfg.icon;
          const active = statusFilter.has(status);
          return (
            <button
              key={status}
              onClick={() => toggleStatus(status)}
              aria-pressed={active}
              title={`Показать только замечания в статусе «${cfg.label}»`}
              className={clsx(
                'flex items-center gap-2 px-4 py-2 rounded-xl border transition text-sm font-medium',
                active ? `${cfg.bg} ${cfg.text} border-current` : 'bg-white dark:bg-zinc-800/60 border-zinc-200 dark:border-zinc-700/50 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700/30'
              )}
            >
              <Icon size={14} />
              {cfg.label}: {count}
            </button>
          );
        })}
      </div>

      {/* Какие оси шапки здесь работают, а какие нечем применить */}
      {deadAxes.length > 0 && (
        <div className="flex items-start gap-2 text-xs bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 px-5 py-3">
          <Info size={14} className="text-zinc-400 mt-px shrink-0" />
          <p className="text-zinc-500 dark:text-zinc-400">
            Здесь работают фильтры управления, подведомственной организации, вида деятельности и поиска.{' '}
            {deadAxes.map(a => a.label).join(' и ')}{' '}
            {deadAxes.length > 1 ? 'к замечаниям не применяются' : 'к замечаниям не применяется'}
            {': '}
            {deadAxes.map(a => a.reason).join('; ')}. Пока поля нет, фильтр не имитируется — список и счётчики от него не меняются.
          </p>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
            <label htmlFor="issues-search" className="sr-only">Поиск по замечаниям</label>
            <input
              id="issues-search"
              type="text"
              placeholder="Поиск по заголовку, описанию, управлению"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900/50 text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div className="flex items-center gap-1" role="group" aria-label="Отбор по серьёзности">
            <Filter size={13} className="text-zinc-400" aria-hidden="true" />
            {(['critical', 'significant', 'warning', 'info'] as Severity[]).map(s => {
              const cfg = SEV_CONFIG[s];
              const active = sevFilter.has(s);
              return (
                <button
                  key={s}
                  onClick={() => toggleSev(s)}
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
          {hasLocalFilter && (
            <button
              onClick={resetLocalFilters}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-700/30 transition"
            >
              <RotateCcw size={13} aria-hidden="true" />
              Снять отбор страницы
            </button>
          )}
          <button
            onClick={downloadCSV}
            disabled={filtered.length === 0}
            title="Выгружает ровно то, что сейчас отфильтровано на экране (все поля)"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-600 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download size={13} aria-hidden="true" />
            Выгрузить таблицей: {filtered.length} {issuesWord(filtered.length)}
          </button>
        </div>
      </div>

      {/* Issues list */}
      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 p-12 text-center">
          <Search className="mx-auto text-zinc-300 dark:text-zinc-600 mb-4" size={40} aria-hidden="true" />
          <h2 className="text-base font-semibold text-zinc-600 dark:text-zinc-300 mb-2">
            Под отбор страницы не подошло ни одно замечание
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-md mx-auto">
            Всего после отбора шапки — {issues.length} {issuesWord(issues.length)}. Скрыл их отбор на этой странице: поиск, серьёзность или статус.
          </p>
          <button
            onClick={resetLocalFilters}
            className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
          >
            <RotateCcw size={13} aria-hidden="true" /> Снять отбор страницы
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {natureSections.map(({ nature, groups }) => {
            const natureCount = groups.reduce((sum, g) => sum + g.count, 0);
            return (
              <section key={nature.id} aria-label={`${nature.label}: ${natureCount} ${issuesWord(natureCount)}`}>
                {/* Шапка категории по природе (канон п.88/26б): подпись,
                    отличие от соседних категорий и адресат действия. */}
                <header className="mb-2 px-1">
                  <h2 className="text-sm font-bold text-zinc-800 dark:text-white">
                    {nature.label}
                    <span className="ml-2 font-semibold tabular-nums text-zinc-500 dark:text-zinc-400">
                      {natureCount} {issuesWord(natureCount)}
                    </span>
                  </h2>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 leading-relaxed">
                    {nature.description} {nature.addressee}
                  </p>
                </header>
                <div className="space-y-3">
                  {groups.map(group => {
            const groupSev = SEV_CONFIG[group.severity as Severity] ?? SEV_CONFIG.info;
            const GroupIcon = groupSev.icon;
            const groupOpen = openGroups.has(group.key);
            const groupBodyId = `mechanism-group-${group.key.replace(/[^\w-]/g, '_')}`;
            const groupIssues = group.issues as DisplayIssue[];
            return (
              <section
                key={group.key}
                aria-label={`${group.label}: ${group.count} ${issuesWord(group.count)}`}
                className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 overflow-hidden"
              >
                {/* Заголовок карточки диагноста: механизм + счёт + действие (п.53) */}
                <button
                  type="button"
                  onClick={() => toggleGroup(group.key)}
                  aria-expanded={groupOpen}
                  aria-controls={groupBodyId}
                  className="w-full text-left flex items-start gap-3 p-4 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-700/30 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset"
                >
                  <span className={clsx('flex-shrink-0 mt-0.5 p-1.5 rounded-lg', groupSev.bg)}>
                    <GroupIcon size={16} className={groupSev.text} aria-hidden="true" />
                  </span>
                  <span className="flex-1 min-w-0 block">
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className={clsx('text-[10px] px-1.5 py-0.5 rounded-full font-medium', groupSev.bg, groupSev.text)}>{groupSev.label}</span>
                      <span className="text-sm font-semibold text-zinc-800 dark:text-white">{group.label}</span>
                      <span className="text-sm font-bold tabular-nums text-zinc-500 dark:text-zinc-400">
                        — {group.count} {issuesWord(group.count)}
                      </span>
                    </span>
                    {group.kbHint && (
                      <span className="block text-xs text-zinc-500 dark:text-zinc-400 mt-1 leading-relaxed">{group.kbHint}</span>
                    )}
                    {group.recommendation && (
                      <span className="block text-xs text-blue-600 dark:text-blue-400 mt-1 leading-relaxed">Что делать: {group.recommendation}</span>
                    )}
                  </span>
                  {groupOpen
                    ? <ChevronUp size={14} className="text-zinc-400 mt-1 flex-shrink-0" aria-hidden="true" />
                    : <ChevronDown size={14} className="text-zinc-400 mt-1 flex-shrink-0" aria-hidden="true" />}
                </button>

                {groupOpen && (
                  <div id={groupBodyId} className="space-y-2 px-3 pb-3 border-t border-zinc-100 dark:border-zinc-700/50 pt-3">
                    {groupIssues.map(iss => {
            const sev = SEV_CONFIG[iss.severity] ?? SEV_CONFIG.info;
            const stat = STATUS_CONFIG[iss.status] ?? STATUS_CONFIG.open;
            const SevIcon = sev.icon;
            const StatIcon = stat.icon;
            const expanded = expandedId === iss.id;
            const bodyId = `issue-body-${iss.id}`;
            const transitions = allowedIssueTransitions(iss.status);
            /** Закрытое замечание: единственный оставшийся ход — переоткрыть. */
            const isClosed = iss.status === 'resolved' || iss.status === 'wont_fix' || iss.status === 'false_positive';
            const draft = reasonDraft?.issueId === iss.id ? reasonDraft : null;
            const error = statusError[iss.id];

            return (
              <div key={iss.id} className={clsx('bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border overflow-hidden transition', expanded ? 'border-blue-200 dark:border-blue-500/30' : 'border-zinc-100 dark:border-zinc-700/50')}>
                {/*
                  Заголовок — настоящая кнопка: раскрытие карточки должно
                  работать с клавиатуры. Внутрь кнопки вложенных кнопок нет
                  (переход к данным управления переехал в раскрытую часть) —
                  иначе получилась бы кнопка в кнопке, недопустимая разметка.
                */}
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : iss.id)}
                  aria-expanded={expanded}
                  aria-controls={bodyId}
                  className="w-full text-left flex items-start gap-4 p-4 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-700/30 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset"
                >
                  <span className={clsx('flex-shrink-0 mt-0.5 p-1.5 rounded-lg', sev.bg)}>
                    <SevIcon size={16} className={sev.text} aria-hidden="true" />
                  </span>
                  <span className="flex-1 min-w-0 block">
                    <span className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={clsx('text-[10px] px-1.5 py-0.5 rounded-full font-medium', sev.bg, sev.text)}>{sev.label}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 font-medium">
                        {deptLabel(iss.dept)}
                      </span>
                    </span>
                    <span className="block text-sm font-medium text-zinc-800 dark:text-white truncate">{iss.title}</span>
                    <span className="block text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 line-clamp-1">{iss.description}</span>
                  </span>
                  <span className="flex items-center gap-3 flex-shrink-0">
                    <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', stat.bg, stat.text)}>
                      <StatIcon size={11} aria-hidden="true" /> {stat.label}
                    </span>
                    {expanded ? <ChevronUp size={14} className="text-zinc-400" aria-hidden="true" /> : <ChevronDown size={14} className="text-zinc-400" aria-hidden="true" />}
                  </span>
                </button>

                {expanded && (
                  <div id={bodyId} className="border-t border-zinc-100 dark:border-zinc-700/50 px-4 py-4 bg-zinc-50/50 dark:bg-zinc-900/30">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                      <div>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">{iss.description}</p>
                        {iss.recommendation && (
                          <p className="text-xs text-blue-600 dark:text-blue-400 mb-2">Рекомендация проверки: {iss.recommendation}</p>
                        )}
                        <div className="flex flex-wrap gap-3 text-[11px] text-zinc-500 dark:text-zinc-400">
                          {iss.cell && <span>Ячейка: <strong className="text-zinc-700 dark:text-zinc-200 font-mono">{deptLabel(iss.dept)}!{iss.cell}</strong></span>}
                          {iss.row && <span>Строка книги: <strong className="text-zinc-700 dark:text-zinc-200">{iss.row}</strong></span>}
                          {iss.detectedAt && (
                            <span title="Время прогона проверок, а не момент появления проблемы в книге: когда проблема возникла, система не знает.">
                              Найдено при проверке: <strong className="text-zinc-700 dark:text-zinc-200">{formatEventTime(iss.detectedAt)}</strong>
                            </span>
                          )}
                        </div>
                        {iss.dept && (
                          <button
                            onClick={() => navigateTo('data', { department: iss.dept })}
                            className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-blue-700 dark:text-blue-300 rounded-lg border border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition"
                          >
                            <ExternalLink size={11} aria-hidden="true" />
                            Открыть строки управления {deptLabel(iss.dept)}
                          </button>
                        )}
                      </div>
                      <div>
                        {/* Для закрытого замечания единственный переход — переоткрытие;
                            заголовок говорит об этом, чтобы кнопка «Открыто» не читалась
                            как непонятное действие. */}
                        <p className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300 mb-2">
                          {isClosed ? 'Замечание закрыто — можно вернуть в статус' : 'Перевести в статус'}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {statusUpdating === iss.id && (
                            <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                              <Loader2 size={14} className="animate-spin text-zinc-400" aria-hidden="true" /> Сохраняем статус…
                            </span>
                          )}
                          {/*
                            Кнопки строятся по таблице переходов сервера: раньше
                            «Исправлено» рисовалось и для открытого замечания,
                            хотя такой переход сервер отбивает — нажатие уходило
                            в никуда.
                          */}
                          {statusUpdating !== iss.id && transitions.map(target => (
                            <button
                              key={target}
                              onClick={() => startTransition(iss.id, target as Status)}
                              className={clsx('px-3 py-1 text-xs font-medium text-white rounded-lg transition', TRANSITION_STYLE[target as Status])}
                            >
                              {issueStatusLabel(target)}
                            </button>
                          ))}
                        </div>

                        {/* Почему «Исправлено» здесь нет: путь называем словами, а не прячем. */}
                        {statusUpdating !== iss.id && !isClosed && !transitions.includes('resolved') && (
                          <p className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">
                            {issueTransitionRefusal(iss.status, 'resolved')}
                          </p>
                        )}

                        {draft && (
                          <div className="mt-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/60 p-3">
                            <label htmlFor={`reason-${iss.id}`} className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-300 mb-1">
                              Причина перевода в «{issueStatusLabel(draft.target)}»
                            </label>
                            <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mb-2">
                              Останется в истории замечания — по ней потом объясняют решение.
                            </p>
                            <input
                              id={`reason-${iss.id}`}
                              type="text"
                              autoFocus
                              value={draft.text}
                              onChange={e => setReasonDraft({ ...draft, text: e.target.value })}
                              onKeyDown={e => {
                                if (e.key === 'Enter' && draft.text.trim()) void applyStatus(iss.id, draft.target, draft.text.trim());
                                if (e.key === 'Escape') setReasonDraft(null);
                              }}
                              placeholder="Например: закупка отменена, строка останется как есть"
                              className="w-full px-3 py-1.5 text-xs border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900/50 text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <div className="flex items-center gap-2 mt-2">
                              <button
                                onClick={() => void applyStatus(iss.id, draft.target, draft.text.trim())}
                                disabled={!draft.text.trim()}
                                className="px-3 py-1 text-xs font-medium bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                Сохранить
                              </button>
                              <button
                                onClick={() => setReasonDraft(null)}
                                className="px-3 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-300 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-700/30 transition"
                              >
                                Отмена
                              </button>
                            </div>
                          </div>
                        )}

                        {error && (
                          <p className="mt-2 text-[11px] text-red-600 dark:text-red-400">{error}</p>
                        )}
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
                )}
              </section>
            );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Status bar */}
      {filtered.length > 0 && (
        <div className="text-xs text-zinc-400 dark:text-zinc-500 text-center">
          Показано {filtered.length} из {issues.length} {issuesWord(issues.length)} — {mechanismGroups.length}{' '}
          {pluralRu(mechanismGroups.length, 'класс проверки', 'класса проверок', 'классов проверок')}
        </div>
      )}
    </div>
  );
}
