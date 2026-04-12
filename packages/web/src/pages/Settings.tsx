import { useState, useEffect, useCallback, useRef } from 'react';
import { Settings, Database, Map, Key, RefreshCw, CheckCircle2, AlertTriangle, Clock, ExternalLink, Save, Eye, EyeOff, HelpCircle, Wifi, WifiOff, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../api';
import { useStore } from '../store';
import { SVOD_SPREADSHEET_ID } from '@aemr/shared';

type SourceStatus = 'ok' | 'warning' | 'error' | 'unknown';

interface SheetSource {
  id: string;
  name: string;
  spreadsheetId: string;
  status: SourceStatus;
  statusLabel?: string | null;
  lastRead: string;
  rows: number;
  cells: number;
}

interface MappingEntry {
  metricKey: string;
  label: string;
  cellRef: string;
  currentValue: string | number | null;
  group: string;
  isOverridden: boolean;
  validationStatus?: 'ok' | 'empty' | 'error' | 'unknown';
}

type FeedbackState = 'idle' | 'loading' | 'success' | 'error';

interface Feedback {
  state: FeedbackState;
  message?: string;
}

const STATUS_CONFIG: Record<SourceStatus, { label: string; bg: string; text: string; icon: typeof CheckCircle2 }> = {
  ok: { label: 'Активна', bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-400', icon: CheckCircle2 },
  warning: { label: 'Предупреждение', bg: 'bg-amber-50 dark:bg-amber-950/30', text: 'text-amber-700 dark:text-amber-400', icon: Clock },
  error: { label: 'Ошибка', bg: 'bg-red-50 dark:bg-red-950/30', text: 'text-red-700 dark:text-red-400', icon: AlertTriangle },
  unknown: { label: 'Неизвестно', bg: 'bg-zinc-50 dark:bg-zinc-950/30', text: 'text-zinc-500 dark:text-zinc-400', icon: HelpCircle },
};

/** Format relative time ago in Russian */
function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'никогда';
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 0) return 'только что';
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'только что';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} мин. назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч. назад`;
  const days = Math.floor(hours / 24);
  return `${days} дн. назад`;
}

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<'sources' | 'mapping' | 'connection'>('sources');
  const [editingMetric, setEditingMetric] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [connForm, setConnForm] = useState({
    spreadsheetId: SVOD_SPREADSHEET_ID,
    serviceAccountEmail: '',
    privateKey: '',
    port: '3000',
    host: '0.0.0.0',
  });
  const [connStatus, setConnStatus] = useState<'idle' | 'testing' | 'success' | 'error' | 'copied'>('idle');
  const [connError, setConnError] = useState('');
  const [serverStatus, setServerStatus] = useState<{
    online: boolean;
    configured: boolean;
    email?: string;
    lastSync?: string | null;
  } | null>(null);

  // Real data from API
  const [sources, setSources] = useState<SheetSource[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [mapping, setMapping] = useState<MappingEntry[]>([]);
  const [mappingLoading, setMappingLoading] = useState(false);

  // Test results per source
  const [testResults, setTestResults] = useState<Record<string, { loading: boolean; result?: any }>>({});
  const [validationResults, setValidationResults] = useState<Record<string, { loading: boolean; result?: any }>>({});
  const [editingSource, setEditingSource] = useState<string | null>(null);
  const [editSourceValue, setEditSourceValue] = useState('');
  const [mappingSearch, setMappingSearch] = useState('');
  const [validating, setValidating] = useState(false);

  // Refresh button feedback
  const [refreshFeedback, setRefreshFeedback] = useState<Feedback>({ state: 'idle' });
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Connection test feedback (Google Sheets)
  const [sheetsTestFeedback, setSheetsTestFeedback] = useState<Feedback>({ state: 'idle' });

  // Save source feedback per source
  const [saveSourceFeedback, setSaveSourceFeedback] = useState<Record<string, Feedback>>({});

  // Save env feedback
  const [saveEnvFeedback, setSaveEnvFeedback] = useState<Feedback>({ state: 'idle' });

  // Global issue/data counts from last validation
  const [globalValidation, setGlobalValidation] = useState<{
    totalIssues: number;
    totalData: number;
    lastChecked: string | null;
  }>({ totalIssues: 0, totalData: 0, lastChecked: null });

  // Re-fetch sources after refresh completes
  const refreshResult = useStore(s => s.refreshResult);
  const lastRefreshed = useStore(s => s.lastRefreshed);

  // Parse sources from API response
  const parseSources = useCallback((data: any): SheetSource[] => {
    return (data.sources ?? []).map((s: any) => ({
      id: s.name,
      name: s.name,
      spreadsheetId: s.spreadsheetId ?? '—',
      status: s.status as SourceStatus,
      statusLabel: s.statusLabel ?? null,
      lastRead: s.lastSuccess ? new Date(s.lastSuccess).toLocaleString('ru-RU') : '—',
      rows: s.rowCount ?? 0,
      cells: (s.rowCount ?? 0) * 33,
    }));
  }, []);

  // Fetch sources from API
  const fetchSourcesData = useCallback(() => {
    setSourcesLoading(true);
    api.getSources().then((data: any) => {
      setSources(parseSources(data));
    }).catch(() => {}).finally(() => setSourcesLoading(false));
  }, [parseSources]);

  useEffect(() => {
    if (activeTab === 'sources' && sources.length === 0) {
      fetchSourcesData();
    }
  }, [activeTab, sources.length, fetchSourcesData]);

  // Initialize global validation from dashboard data on mount
  const dashboardData = useStore(s => s.dashboardData);
  useEffect(() => {
    if (dashboardData && globalValidation.lastChecked === null) {
      const issues = dashboardData.recentIssues ?? dashboardData.snapshot?.issues ?? [];
      const totalData = sources.reduce((s: number, src: SheetSource) => s + src.rows, 0);
      setGlobalValidation({
        totalIssues: issues.length,
        totalData: totalData || (dashboardData.snapshot?.metadata?.cellsRead ?? 0),
        lastChecked: dashboardData.lastRefreshed ?? null,
      });
    }
  }, [dashboardData, sources]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh sources when store refresh completes
  useEffect(() => {
    if (refreshResult && !refreshResult.loading && activeTab === 'sources') {
      fetchSourcesData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshResult?.loading]);

  // Auto-refresh server status every 30s when on connection tab
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/settings/status');
        if (res.ok) {
          const data = await res.json();
          setServerStatus({
            online: true,
            configured: data.configured,
            email: data.serviceAccountEmail,
            lastSync: lastRefreshed,
          });
          if (data.serviceAccountEmail) setConnForm(f => ({ ...f, serviceAccountEmail: data.serviceAccountEmail }));
          if (data.spreadsheetId) setConnForm(f => ({ ...f, spreadsheetId: data.spreadsheetId }));
          if (data.hasPrivateKey) setConnForm(f => {
            // Only set placeholder if user hasn't typed a real key
            if (!f.privateKey || f.privateKey.startsWith('•')) {
              return { ...f, privateKey: '••••••• (загружен из .env)' };
            }
            return f;
          });
        } else {
          setServerStatus({ online: true, configured: false });
        }
      } catch {
        setServerStatus({ online: false, configured: false });
      }
    };

    fetchStatus();

    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [lastRefreshed]);

  // Handle full refresh
  const handleRefreshAll = async () => {
    if (refreshFeedback.state === 'loading') return;
    setRefreshFeedback({ state: 'loading', message: 'Обновление данных...' });

    // Clear old timer
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }

    try {
      const result = await api.refresh();
      const sourcesData = await api.getSources();
      const newSources = parseSources(sourcesData);
      setSources(newSources);

      // Aggregate validation signal
      let totalIssues = 0;
      const totalData = newSources.reduce((sum: number, s: SheetSource) => sum + s.rows, 0);
      if (result.issues?.length) {
        totalIssues = result.issues.length;
      }
      setGlobalValidation({
        totalIssues,
        totalData,
        lastChecked: new Date().toISOString(),
      });

      const sourceCount = newSources.length;
      const okCount = newSources.filter((s: SheetSource) => s.status === 'ok').length;
      setRefreshFeedback({
        state: 'success',
        message: `Обновлено: ${okCount}/${sourceCount} источников. Строк: ${totalData}${totalIssues > 0 ? `. Проблем: ${totalIssues}` : ''}`,
      });

      // Auto-clear success after 8s
      refreshTimerRef.current = setTimeout(() => {
        setRefreshFeedback({ state: 'idle' });
      }, 8000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setRefreshFeedback({ state: 'error', message: `Ошибка обновления: ${msg}` });
      refreshTimerRef.current = setTimeout(() => {
        setRefreshFeedback({ state: 'idle' });
      }, 10000);
    }
  };

  // Handle test individual source
  const handleTestSource = async (name: string) => {
    setTestResults(prev => ({ ...prev, [name]: { loading: true } }));
    try {
      const result = await api.testSource(name);
      setTestResults(prev => ({ ...prev, [name]: { loading: false, result } }));
    } catch (err) {
      setTestResults(prev => ({ ...prev, [name]: { loading: false, result: { success: false, error: String(err) } } }));
    }
  };

  // Handle validate source
  const handleValidateSource = async (name: string) => {
    setValidationResults(prev => ({ ...prev, [name]: { loading: true } }));
    try {
      const result = await api.validateSource(name);
      setValidationResults(prev => ({ ...prev, [name]: { loading: false, result } }));

      // Update global validation counts
      const summary = result.summary;
      if (summary) {
        setGlobalValidation(prev => ({
          ...prev,
          totalIssues: prev.totalIssues + (summary.total ?? 0),
          lastChecked: new Date().toISOString(),
        }));
      }
    } catch (err) {
      setValidationResults(prev => ({ ...prev, [name]: { loading: false, result: { error: String(err) } } }));
    }
  };

  // Test Google Sheets connectivity
  const handleTestSheetsConnection = async () => {
    setSheetsTestFeedback({ state: 'loading', message: 'Проверка подключения к Google Sheets...' });
    try {
      // First check backend health
      const healthRes = await api.health();
      if (healthRes.status !== 'ok') {
        setSheetsTestFeedback({ state: 'error', message: 'Бэкенд не отвечает' });
        return;
      }

      // Then test actual sheets connectivity via СВОД source
      const testRes = await api.testSource('СВОД ТД-ПМ');
      if (testRes.success) {
        setSheetsTestFeedback({
          state: 'success',
          message: `Google Sheets доступен. Таблица: ${testRes.title ?? 'OK'}, листов: ${testRes.sheetCount ?? '?'}`,
        });
      } else {
        setSheetsTestFeedback({
          state: 'error',
          message: testRes.error ?? 'Не удалось подключиться к Google Sheets',
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSheetsTestFeedback({
        state: 'error',
        message: msg.includes('API error') ? 'Бэкенд не запущен или API недоступен' : msg,
      });
    }

    // Auto-clear after 10s
    setTimeout(() => setSheetsTestFeedback({ state: 'idle' }), 10000);
  };

  // Save source spreadsheet ID
  const handleSaveSource = async (srcId: string, srcName: string, newSpreadsheetId: string) => {
    if (!newSpreadsheetId.trim()) return;
    setSaveSourceFeedback(prev => ({ ...prev, [srcId]: { state: 'loading' } }));
    try {
      await api.updateSource(srcName, newSpreadsheetId.trim());
      setSources(prev => prev.map(s => s.id === srcId ? { ...s, spreadsheetId: newSpreadsheetId.trim() } : s));
      setEditingSource(null);
      setSaveSourceFeedback(prev => ({ ...prev, [srcId]: { state: 'success', message: 'Сохранено' } }));
      setTimeout(() => setSaveSourceFeedback(prev => ({ ...prev, [srcId]: { state: 'idle' } })), 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSaveSourceFeedback(prev => ({ ...prev, [srcId]: { state: 'error', message: msg } }));
      setTestResults(prev => ({ ...prev, [srcName]: { loading: false, result: { success: false, error: msg } } }));
      setTimeout(() => setSaveSourceFeedback(prev => ({ ...prev, [srcId]: { state: 'idle' } })), 5000);
    }
  };

  // Fetch mapping from API
  useEffect(() => {
    if (activeTab === 'mapping' && mapping.length === 0) {
      setMappingLoading(true);
      api.getMapping().then((data: any) => {
        const entries: MappingEntry[] = [];
        for (const group of (data.groups ?? [])) {
          for (const m of (group.metrics ?? [])) {
            entries.push({
              metricKey: m.metricKey,
              label: m.label,
              cellRef: m.cellRef ?? `${m.sourceSheet}!${m.sourceCell}`,
              currentValue: m.currentValue ?? null,
              group: group.name ?? 'Общие',
              isOverridden: m.isOverridden ?? false,
              validationStatus: 'unknown',
            });
          }
        }
        setMapping(entries);
      }).catch(() => {}).finally(() => setMappingLoading(false));
    }
  }, [activeTab, mapping.length]);

  const buildEnvContent = () => `# Google Sheets API
GOOGLE_SHEETS_SPREADSHEET_ID=${connForm.spreadsheetId}
GOOGLE_SERVICE_ACCOUNT_EMAIL=${connForm.serviceAccountEmail}
GOOGLE_PRIVATE_KEY="${connForm.privateKey}"

# Сервер
PORT=${connForm.port}
HOST=${connForm.host}
LOG_LEVEL=info

# База данных (SQLite для разработки)
SQLITE_PATH=./data/aemr.db
# DB_PROVIDER=postgresql
# DATABASE_URL=postgresql://user:pass@localhost:5432/aemr`;

  const startEdit = (metricKey: string, currentRef: string) => {
    setEditingMetric(metricKey);
    setEditValue(currentRef);
  };

  const cancelEdit = () => {
    setEditingMetric(null);
    setEditValue('');
  };

  // Save .env handler
  const handleSaveEnv = async () => {
    setSaveEnvFeedback({ state: 'loading', message: 'Сохранение...' });
    const envContent = buildEnvContent();
    try {
      const res = await fetch('/api/settings/env', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(connForm),
      });
      if (res.ok) {
        setSaveEnvFeedback({ state: 'success', message: 'Файл .env перезаписан на сервере. Перезапустите бэкенд для применения.' });
        setServerStatus(s => s ? { ...s, configured: true, email: connForm.serviceAccountEmail } : s);
        setConnStatus('success');
        setConnError('Файл .env перезаписан на сервере. Перезапустите бэкенд для применения.');
        setTimeout(() => setSaveEnvFeedback({ state: 'idle' }), 8000);
        return;
      }
      throw new Error('Server returned non-OK');
    } catch {
      // Fallback: download as file + copy to clipboard
      try {
        await navigator.clipboard.writeText(envContent);
      } catch { /* clipboard may fail */ }
      const blob = new Blob([envContent], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '.env';
      a.click();
      URL.revokeObjectURL(url);
      setSaveEnvFeedback({ state: 'success', message: 'Файл .env скачан. Скопируйте его в корень проекта.' });
      setConnStatus('copied');
      setConnError('');
      setTimeout(() => setSaveEnvFeedback({ state: 'idle' }), 8000);
    }
  };

  // Compute aggregated validation signal
  const aggregatedIssues = Object.values(validationResults).reduce((sum, vr) => {
    if (vr.result?.summary?.total) return sum + vr.result.summary.total;
    return sum;
  }, 0);
  const aggregatedData = sources.reduce((sum, s) => sum + s.rows, 0);

  return (
    <div className="space-y-6">
      {/* Verification signal bar */}
      {(globalValidation.lastChecked || aggregatedData > 0) && (
        <div className={clsx(
          'flex items-center justify-between px-5 py-3 rounded-xl border text-sm',
          (globalValidation.totalIssues > 0 || aggregatedIssues > 0)
            ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300'
            : 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
        )}>
          <div className="flex items-center gap-4">
            {(globalValidation.totalIssues > 0 || aggregatedIssues > 0) ? (
              <AlertTriangle size={16} />
            ) : (
              <CheckCircle2 size={16} />
            )}
            <span className="font-medium">
              Найдено проблем: {globalValidation.totalIssues + aggregatedIssues}
            </span>
            <span className="text-xs opacity-75">|</span>
            <span>
              Данные: {aggregatedData > 0 ? `${aggregatedData} строк` : 'не загружены'}
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs opacity-75">
            {lastRefreshed && (
              <span>Последняя синхронизация: {timeAgo(lastRefreshed)}</span>
            )}
            {globalValidation.lastChecked && (
              <span>Проверено: {timeAgo(globalValidation.lastChecked)}</span>
            )}
          </div>
        </div>
      )}

      {/* Tab header */}
      <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50">
        <div className="flex items-center border-b border-zinc-100 dark:border-zinc-700/50">
          <button
            onClick={() => setActiveTab('sources')}
            className={clsx(
              'flex items-center gap-2 px-6 py-3.5 text-sm font-medium border-b-2 transition',
              activeTab === 'sources'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
            )}
          >
            <Database size={15} />
            Источники данных
          </button>
          <button
            onClick={() => setActiveTab('mapping')}
            className={clsx(
              'flex items-center gap-2 px-6 py-3.5 text-sm font-medium border-b-2 transition',
              activeTab === 'mapping'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
            )}
          >
            <Map size={15} />
            Маппинг ячеек
          </button>
          <button
            onClick={() => setActiveTab('connection')}
            className={clsx(
              'flex items-center gap-2 px-6 py-3.5 text-sm font-medium border-b-2 transition',
              activeTab === 'connection'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
            )}
          >
            <Key size={15} />
            Подключение
          </button>
          <div className="flex-1" />
          {activeTab === 'sources' && (
            <div className="flex items-center gap-2 mr-4">
              {/* Refresh feedback inline */}
              {refreshFeedback.state === 'success' && (
                <span className="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 size={12} /> {refreshFeedback.message}
                </span>
              )}
              {refreshFeedback.state === 'error' && (
                <span className="text-[11px] text-red-600 dark:text-red-400 flex items-center gap-1 max-w-xs truncate" title={refreshFeedback.message}>
                  <AlertTriangle size={12} /> {refreshFeedback.message}
                </span>
              )}
              <button
                onClick={handleRefreshAll}
                disabled={refreshFeedback.state === 'loading'}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition',
                  refreshFeedback.state === 'loading'
                    ? 'text-blue-400 bg-blue-100 dark:bg-blue-900/40 cursor-wait'
                    : 'text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800'
                )}
              >
                {refreshFeedback.state === 'loading' ? (
                  <><Loader2 size={12} className="animate-spin" /> Обновление...</>
                ) : (
                  <><RefreshCw size={12} /> Обновить данные</>
                )}
              </button>
            </div>
          )}
          {activeTab === 'mapping' && (
            <button
              onClick={async () => {
                await api.resetMapping();
                setMapping([]);
              }}
              className="mr-4 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-700 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-600 active:bg-zinc-300 dark:active:bg-zinc-500 transition"
            >
              Сбросить к дефолту
            </button>
          )}
        </div>

        {/* Sources tab */}
        {activeTab === 'sources' && (
          <div className="p-5">
            {sourcesLoading && sources.length === 0 && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="animate-spin text-blue-500" size={24} />
                <span className="ml-2 text-sm text-zinc-500">Загрузка источников...</span>
              </div>
            )}

            {/* Summary row */}
            {sources.length > 0 && (
              <div className="flex items-center gap-4 mb-4 text-xs text-zinc-500 dark:text-zinc-400">
                <span>Источников: <strong className="text-zinc-700 dark:text-zinc-200">{sources.length}</strong></span>
                <span>Активных: <strong className="text-emerald-600 dark:text-emerald-400">{sources.filter(s => s.status === 'ok').length}</strong></span>
                {sources.some(s => s.status === 'error') && (
                  <span>С ошибками: <strong className="text-red-600 dark:text-red-400">{sources.filter(s => s.status === 'error').length}</strong></span>
                )}
                <span>Всего строк: <strong className="text-zinc-700 dark:text-zinc-200">{aggregatedData.toLocaleString('ru-RU')}</strong></span>
                {lastRefreshed && (
                  <span className="ml-auto">Синхронизация: {timeAgo(lastRefreshed)}</span>
                )}
                {sourcesLoading && <Loader2 size={12} className="animate-spin text-blue-500 ml-1" />}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {sources.map(src => {
                const cfg = STATUS_CONFIG[src.status as SourceStatus] ?? STATUS_CONFIG.warning;
                const StatusIcon = cfg.icon;
                const srcSaveFb = saveSourceFeedback[src.id];
                return (
                  <div key={src.id} className={clsx(
                    'rounded-xl border p-4 transition-all duration-200 hover:shadow-md',
                    src.status === 'error' ? 'border-red-200 dark:border-red-500/30 bg-red-50/30 dark:bg-red-500/5' :
                    src.status === 'warning' ? 'border-amber-200 dark:border-amber-500/30 bg-amber-50/20 dark:bg-amber-500/5' :
                    'border-zinc-200 dark:border-zinc-700/50 hover:border-zinc-300 dark:hover:border-zinc-600'
                  )}>
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{src.name}</h4>
                      <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium', cfg.bg, cfg.text)}>
                        <StatusIcon size={10} /> {src.statusLabel ?? cfg.label}
                      </span>
                    </div>
                    <div className="space-y-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                      <div>
                        <div className="flex justify-between items-center">
                          <span>Spreadsheet ID</span>
                          <button
                            onClick={() => {
                              if (editingSource === src.id) {
                                setEditingSource(null);
                              } else {
                                setEditingSource(src.id);
                                setEditSourceValue(src.spreadsheetId === '—' ? '' : src.spreadsheetId);
                              }
                            }}
                            className="text-[9px] text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                          >
                            {editingSource === src.id ? 'Отмена' : 'Изменить'}
                          </button>
                        </div>
                        {editingSource === src.id ? (
                          <div className="mt-1 flex gap-1">
                            <input
                              type="text"
                              value={editSourceValue}
                              onChange={e => setEditSourceValue(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') handleSaveSource(src.id, src.name, editSourceValue);
                                if (e.key === 'Escape') setEditingSource(null);
                              }}
                              className="flex-1 px-1.5 py-1 text-[10px] font-mono bg-white dark:bg-zinc-900/50 border border-blue-300 dark:border-blue-600 rounded text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                              placeholder="1abc...xyz"
                              autoFocus
                            />
                            <button
                              onClick={() => handleSaveSource(src.id, src.name, editSourceValue)}
                              disabled={srcSaveFb?.state === 'loading'}
                              className="px-2 py-1 text-[10px] font-medium text-white bg-blue-600 rounded hover:bg-blue-700 active:bg-blue-800 transition disabled:opacity-50"
                            >
                              {srcSaveFb?.state === 'loading' ? <Loader2 size={10} className="animate-spin" /> : <Save size={10} />}
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <span className="font-mono text-zinc-600 dark:text-zinc-300 truncate block max-w-full" title={src.spreadsheetId}>
                              {src.spreadsheetId && src.spreadsheetId !== '—' ? `${src.spreadsheetId.slice(0, 12)} ...` : '—'}
                            </span>
                            {srcSaveFb?.state === 'success' && (
                              <CheckCircle2 size={10} className="text-emerald-500 flex-shrink-0" />
                            )}
                          </div>
                        )}
                        {srcSaveFb?.state === 'error' && (
                          <div className="mt-1 text-[9px] text-red-600 dark:text-red-400 truncate" title={srcSaveFb.message}>
                            {srcSaveFb.message}
                          </div>
                        )}
                      </div>
                      <div className="flex justify-between">
                        <span>Последнее чтение</span>
                        <span className="text-zinc-600 dark:text-zinc-300">{src.lastRead}</span>
                      </div>
                      {src.rows > 0 && (
                        <div className="flex justify-between">
                          <span>Строк</span>
                          <span className="font-medium text-zinc-700 dark:text-zinc-200">{src.rows}</span>
                        </div>
                      )}
                    </div>
                    {/* Test result */}
                    {testResults[src.name]?.result && (
                      <div className={clsx('mt-2 px-2.5 py-1.5 rounded-lg text-[10px] transition-all',
                        testResults[src.name].result.success
                          ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400'
                          : 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400'
                      )}>
                        {testResults[src.name].result.success
                          ? `${testResults[src.name].result.title} — ${testResults[src.name].result.sheetCount} листов`
                          : `Ошибка: ${testResults[src.name].result.error}`}
                      </div>
                    )}
                    {/* Validation result */}
                    {validationResults[src.name]?.result && !validationResults[src.name]?.result.error && (
                      <div className={clsx('mt-2 px-2.5 py-2 rounded-lg text-[10px] space-y-1 transition-all',
                        (validationResults[src.name].result.summary?.total ?? 0) === 0
                          ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400'
                          : 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400'
                      )}>
                        {(validationResults[src.name].result.summary?.total ?? 0) === 0 ? (
                          <div className="flex items-center gap-1"><CheckCircle2 size={10} /> Проблем не обнаружено</div>
                        ) : (
                          <>
                            <div className="font-medium">Найдено проблем: {validationResults[src.name].result.summary.total}</div>
                            <div className="flex gap-3">
                              {validationResults[src.name].result.summary.dataErrors > 0 && (
                                <span>Данные: {validationResults[src.name].result.summary.dataErrors}</span>
                              )}
                              {validationResults[src.name].result.summary.formulaIssues > 0 && (
                                <span>Формулы: {validationResults[src.name].result.summary.formulaIssues}</span>
                              )}
                              {validationResults[src.name].result.summary.emptyRequired > 0 && (
                                <span>Пустые: {validationResults[src.name].result.summary.emptyRequired}</span>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                    {validationResults[src.name]?.result?.error && (
                      <div className="mt-2 px-2.5 py-1.5 rounded-lg text-[10px] bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400">
                        Ошибка валидации: {validationResults[src.name].result.error}
                      </div>
                    )}
                    <div className="flex gap-2 mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-700/50">
                      <button
                        onClick={() => handleTestSource(src.name)}
                        disabled={testResults[src.name]?.loading}
                        className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 active:bg-blue-200 dark:active:bg-blue-900/50 transition disabled:opacity-50 disabled:cursor-wait"
                      >
                        {testResults[src.name]?.loading
                          ? <><Loader2 size={10} className="animate-spin" /> Проверка...</>
                          : <><Wifi size={10} /> Проверить</>}
                      </button>
                      <button
                        onClick={() => handleValidateSource(src.name)}
                        disabled={validationResults[src.name]?.loading}
                        className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/30 active:bg-emerald-200 dark:active:bg-emerald-900/50 transition disabled:opacity-50 disabled:cursor-wait"
                      >
                        {validationResults[src.name]?.loading
                          ? <><Loader2 size={10} className="animate-spin" /> Валидация...</>
                          : <><CheckCircle2 size={10} /> Валидация</>}
                      </button>
                      {src.spreadsheetId && src.spreadsheetId !== '—' && (
                        <a
                          href={`https://docs.google.com/spreadsheets/d/${src.spreadsheetId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] font-medium text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-700/50 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-600/50 active:bg-zinc-200 dark:active:bg-zinc-600 transition"
                        >
                          <ExternalLink size={10} /> Открыть
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Mapping tab */}
        {activeTab === 'mapping' && (
          <div>
            {/* Toolbar */}
            <div className="flex items-center gap-3 px-5 py-3 border-b border-zinc-100 dark:border-zinc-700/50">
              <input
                type="text"
                placeholder="Поиск метрики..."
                value={mappingSearch}
                onChange={e => setMappingSearch(e.target.value)}
                className="px-3 py-1.5 text-xs border border-zinc-200 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-900/50 text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
              />
              <button
                onClick={async () => {
                  setValidating(true);
                  try {
                    const res = await api.validateMapping();
                    setMapping(prev => prev.map(m => {
                      const r = (res.results ?? []).find((r: any) => r.metricId === m.metricKey);
                      return r ? { ...m, currentValue: r.value, validationStatus: r.status } : m;
                    }));
                  } catch { /* ok */ }
                  setValidating(false);
                }}
                disabled={validating}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-700 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950/30 active:bg-blue-100 dark:active:bg-blue-900/40 transition disabled:opacity-50 disabled:cursor-wait"
              >
                {validating ? <Loader2 className="animate-spin" size={13} /> : <CheckCircle2 size={13} />}
                Проверить все
              </button>
              <button
                onClick={async () => {
                  await api.resetMapping();
                  setMapping([]);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-700 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-950/30 active:bg-amber-100 dark:active:bg-amber-900/40 transition"
              >
                <RefreshCw size={13} />
                Сбросить все
              </button>
              <div className="ml-auto text-xs text-zinc-400">
                {mapping.length} метрик
                {mapping.filter(m => m.isOverridden).length > 0 && (
                  <span className="ml-2 text-amber-500">{mapping.filter(m => m.isOverridden).length} изменены</span>
                )}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-zinc-50 dark:bg-zinc-900/50 text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                    <th className="px-5 py-3 text-left">Метрика</th>
                    <th className="px-4 py-3 text-left">Ключ</th>
                    <th className="px-4 py-3 text-left">Ячейка СВОД</th>
                    <th className="px-4 py-3 text-right">Текущее значение</th>
                    <th className="px-4 py-3 text-center w-12">Статус</th>
                    <th className="px-4 py-3 text-center w-20">Действие</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
                  {mappingLoading && (
                    <tr><td colSpan={6} className="text-center py-8">
                      <Loader2 className="animate-spin text-blue-500 inline" size={20} />
                      <span className="ml-2 text-sm text-zinc-500">Загрузка маппинга...</span>
                    </td></tr>
                  )}
                  {(() => {
                    const search = mappingSearch.toLowerCase();
                    const filtered = mapping.filter(m =>
                      !search || m.label.toLowerCase().includes(search) || m.metricKey.toLowerCase().includes(search)
                    );
                    const groups = [...new Set(filtered.map(m => m.group))];
                    const rows: React.ReactNode[] = [];

                    for (const group of groups) {
                      const items = filtered.filter(m => m.group === group);
                      rows.push(
                        <tr key={`group-${group}`}>
                          <td colSpan={6} className="px-5 py-2 bg-zinc-100/80 dark:bg-zinc-800/80 text-xs font-semibold text-zinc-600 dark:text-zinc-300 uppercase tracking-wider">
                            {group} <span className="text-zinc-400 font-normal">({items.length})</span>
                          </td>
                        </tr>
                      );
                      for (const m of items) {
                        const valStatusColor = m.validationStatus === 'ok' ? 'text-emerald-500'
                          : m.validationStatus === 'empty' ? 'text-amber-500'
                          : m.validationStatus === 'error' ? 'text-red-500'
                          : 'text-zinc-300 dark:text-zinc-600';

                        rows.push(
                          <tr key={m.metricKey} className="hover:bg-zinc-50 dark:hover:bg-zinc-700/30 transition">
                            <td className="px-5 py-3 text-zinc-700 dark:text-zinc-200 font-medium">
                              {m.label}
                              {m.isOverridden && <span className="ml-2 inline-block w-2 h-2 rounded-full bg-amber-400" title="Изменён" />}
                            </td>
                            <td className="px-4 py-3 text-zinc-400 dark:text-zinc-500 font-mono text-xs">{m.metricKey}</td>
                            <td className="px-4 py-3">
                              {editingMetric === m.metricKey ? (
                                <div className="flex items-center gap-2">
                                  <input
                                    type="text"
                                    value={editValue}
                                    onChange={e => setEditValue(e.target.value)}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') {
                                        api.updateMapping(m.metricKey, editValue).then(() => {
                                          setMapping(prev => prev.map(item => item.metricKey === m.metricKey ? { ...item, cellRef: editValue, isOverridden: true } : item));
                                          cancelEdit();
                                        });
                                      }
                                      if (e.key === 'Escape') cancelEdit();
                                    }}
                                    className="px-2 py-1 text-xs border border-blue-300 dark:border-blue-600 rounded bg-white dark:bg-zinc-900/50 text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono w-48"
                                    autoFocus
                                  />
                                  <button onClick={cancelEdit} className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">&#10005;</button>
                                  <button
                                    onClick={async () => {
                                      await api.updateMapping(m.metricKey, editValue);
                                      setMapping(prev => prev.map(item => item.metricKey === m.metricKey ? { ...item, cellRef: editValue, isOverridden: true } : item));
                                      cancelEdit();
                                    }}
                                    className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium transition-colors"
                                  >&#10003;</button>
                                </div>
                              ) : (
                                <span className="font-mono text-xs text-blue-600 dark:text-blue-400 cursor-pointer hover:underline" onClick={() => startEdit(m.metricKey, m.cellRef)}>
                                  {m.cellRef}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                              {m.currentValue !== null
                                ? typeof m.currentValue === 'number'
                                  ? m.currentValue.toLocaleString('ru-RU')
                                  : String(m.currentValue)
                                : <span className="text-zinc-300 dark:text-zinc-600">—</span>}
                            </td>
                            <td className={clsx('px-4 py-3 text-center', valStatusColor)}>
                              {m.validationStatus === 'ok' ? <CheckCircle2 size={14} className="inline" /> : m.validationStatus === 'empty' ? '○' : m.validationStatus === 'error' ? <AlertTriangle size={14} className="inline" /> : '·'}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <button
                                onClick={() => startEdit(m.metricKey, m.cellRef)}
                                className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline transition-colors"
                              >
                                Изменить
                              </button>
                            </td>
                          </tr>
                        );
                      }
                    }
                    return rows;
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Connection tab */}
        {activeTab === 'connection' && (
          <div className="p-5 space-y-6">
            {/* Server status banner */}
            {serverStatus && (
              <div className={clsx(
                'flex items-center gap-3 p-4 rounded-xl border transition-all',
                serverStatus.online && serverStatus.configured
                  ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800'
                  : serverStatus.online
                    ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800'
                    : 'bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700'
              )}>
                {serverStatus.online ? (
                  <Wifi size={18} className={serverStatus.configured ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'} />
                ) : (
                  <WifiOff size={18} className="text-zinc-400 dark:text-zinc-500" />
                )}
                <div className="flex-1">
                  <p className={clsx('text-sm font-medium', serverStatus.online && serverStatus.configured ? 'text-emerald-800 dark:text-emerald-300' : serverStatus.online ? 'text-amber-800 dark:text-amber-300' : 'text-zinc-600 dark:text-zinc-300')}>
                    {serverStatus.online && serverStatus.configured
                      ? 'Бэкенд работает, credentials настроены'
                      : serverStatus.online
                        ? 'Бэкенд работает, но credentials не полные'
                        : 'Бэкенд не запущен'}
                  </p>
                  {serverStatus.email && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">{serverStatus.email}</p>
                  )}
                  {!serverStatus.online && (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">Запустите: <code className="bg-zinc-200 dark:bg-zinc-700 px-1 rounded text-zinc-800 dark:text-zinc-200">pnpm --filter @aemr/server dev</code></p>
                  )}
                </div>
                <div className="text-right text-[10px] text-zinc-400 dark:text-zinc-500 space-y-0.5">
                  {lastRefreshed && (
                    <div>Последняя синхронизация: {timeAgo(lastRefreshed)}</div>
                  )}
                  <div>Статус обновляется автоматически</div>
                </div>
              </div>
            )}

            {/* Google Sheets connectivity test */}
            {sheetsTestFeedback.state !== 'idle' && (
              <div className={clsx(
                'flex items-center gap-2 p-3 rounded-lg border transition-all',
                sheetsTestFeedback.state === 'loading' ? 'bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700' :
                sheetsTestFeedback.state === 'success' ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800' :
                'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800'
              )}>
                {sheetsTestFeedback.state === 'loading' ? (
                  <Loader2 size={16} className="text-blue-500 animate-spin" />
                ) : sheetsTestFeedback.state === 'success' ? (
                  <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <AlertTriangle size={16} className="text-red-600 dark:text-red-400" />
                )}
                <span className={clsx('text-xs font-medium',
                  sheetsTestFeedback.state === 'loading' ? 'text-zinc-600 dark:text-zinc-300' :
                  sheetsTestFeedback.state === 'success' ? 'text-emerald-700 dark:text-emerald-300' :
                  'text-red-700 dark:text-red-300'
                )}>
                  {sheetsTestFeedback.message}
                </span>
              </div>
            )}

            {/* Step-by-step instructions */}
            <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-blue-800 dark:text-blue-300 flex items-center gap-2 mb-3">
                <HelpCircle size={16} />
                Как получить Google credentials (пошагово)
              </h3>
              <ol className="space-y-2.5 text-xs text-blue-700 dark:text-blue-400">
                <li className="flex gap-2">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 flex items-center justify-center text-[10px] font-bold">1</span>
                  <span>Перейдите в <strong>Google Cloud Console</strong> &rarr; console.cloud.google.com</span>
                </li>
                <li className="flex gap-2">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 flex items-center justify-center text-[10px] font-bold">2</span>
                  <span>Создайте проект (или выберите существующий). Название: например <code className="bg-blue-100 dark:bg-blue-900/50 px-1 rounded">aemr-analytics</code></span>
                </li>
                <li className="flex gap-2">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 flex items-center justify-center text-[10px] font-bold">3</span>
                  <span>Включите <strong>Google Sheets API</strong>: APIs & Services &rarr; Library &rarr; найдите «Google Sheets API» &rarr; Enable</span>
                </li>
                <li className="flex gap-2">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 flex items-center justify-center text-[10px] font-bold">4</span>
                  <span>Создайте <strong>Service Account</strong>: IAM & Admin &rarr; Service Accounts &rarr; Create Service Account. Имя: <code className="bg-blue-100 dark:bg-blue-900/50 px-1 rounded">aemr-reader</code></span>
                </li>
                <li className="flex gap-2">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 flex items-center justify-center text-[10px] font-bold">5</span>
                  <span>Создайте <strong>ключ</strong>: нажмите на аккаунт &rarr; Keys &rarr; Add Key &rarr; Create new key &rarr; JSON. Скачается файл.</span>
                </li>
                <li className="flex gap-2">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 flex items-center justify-center text-[10px] font-bold">6</span>
                  <span>Из JSON файла скопируйте <code className="bg-blue-100 dark:bg-blue-900/50 px-1 rounded">client_email</code> (это Email) и <code className="bg-blue-100 dark:bg-blue-900/50 px-1 rounded">private_key</code> (это Приватный ключ)</span>
                </li>
                <li className="flex gap-2">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 flex items-center justify-center text-[10px] font-bold">7</span>
                  <span><strong>Расшарьте каждую таблицу</strong> в Google Sheets на email сервисного аккаунта (права: Viewer / Читатель)</span>
                </li>
                <li className="flex gap-2">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 flex items-center justify-center text-[10px] font-bold">8</span>
                  <span>Заполните форму ниже и нажмите <strong>Сохранить .env</strong>. Файл будет создан в корне проекта.</span>
                </li>
              </ol>
            </div>

            {/* Connection form */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Параметры подключения</h3>

              <div>
                <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">Spreadsheet ID (СВОД ТД-ПМ)</label>
                <input
                  type="text"
                  value={connForm.spreadsheetId}
                  onChange={e => setConnForm(f => ({ ...f, spreadsheetId: e.target.value }))}
                  placeholder={SVOD_SPREADSHEET_ID}
                  className="w-full px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-700 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                />
                <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1">Из URL таблицы: docs.google.com/spreadsheets/d/<strong>ВОТ_ЭТОТ_ID</strong>/edit</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">Service Account Email</label>
                <input
                  type="email"
                  value={connForm.serviceAccountEmail}
                  onChange={e => setConnForm(f => ({ ...f, serviceAccountEmail: e.target.value }))}
                  placeholder="aemr-reader@your-project.iam.gserviceaccount.com"
                  className="w-full px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-700 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                />
                <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1">Из JSON ключа: поле <code>client_email</code></p>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">Private Key (приватный ключ)</label>
                <div className="relative">
                  <textarea
                    value={connForm.privateKey}
                    onChange={e => setConnForm(f => ({ ...f, privateKey: e.target.value }))}
                    placeholder={"-----BEGIN PRIVATE KEY-----\nMIIEv...\n-----END PRIVATE KEY-----"}
                    rows={4}
                    className={clsx(
                      'w-full px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-700 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none transition',
                      !showKey && connForm.privateKey && 'text-transparent selection:text-transparent'
                    )}
                    style={!showKey && connForm.privateKey ? { caretColor: 'transparent' } : undefined}
                  />
                  {!showKey && connForm.privateKey && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <span className="text-sm text-zinc-400">*** Ключ скрыт ***</span>
                    </div>
                  )}
                  <button
                    onClick={() => setShowKey(!showKey)}
                    className="absolute top-2 right-2 p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition"
                    title={showKey ? 'Скрыть ключ' : 'Показать ключ'}
                  >
                    {showKey ? <EyeOff size={14} className="text-zinc-400" /> : <Eye size={14} className="text-zinc-400" />}
                  </button>
                </div>
                <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1">Из JSON ключа: поле <code>private_key</code>. Вставьте полностью включая BEGIN/END.</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">Порт сервера</label>
                  <input
                    type="text"
                    value={connForm.port}
                    onChange={e => setConnForm(f => ({ ...f, port: e.target.value }))}
                    className="w-full px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-700 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">Host</label>
                  <input
                    type="text"
                    value={connForm.host}
                    onChange={e => setConnForm(f => ({ ...f, host: e.target.value }))}
                    className="w-full px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-700 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                  />
                </div>
              </div>

              {/* Status feedback for save */}
              {connStatus === 'testing' && (
                <div className="flex items-center gap-2 p-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                  <Loader2 size={16} className="text-blue-500 animate-spin" />
                  <span className="text-xs text-zinc-600 dark:text-zinc-300 font-medium">Сохранение...</span>
                </div>
              )}
              {connStatus === 'success' && (
                <div className="flex items-center gap-2 p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg">
                  <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400" />
                  <span className="text-xs text-emerald-700 dark:text-emerald-300 font-medium">{connError || 'Подключение успешно!'}</span>
                </div>
              )}
              {connStatus === 'copied' && (
                <div className="flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg">
                  <CheckCircle2 size={16} className="text-blue-600 dark:text-blue-400" />
                  <span className="text-xs text-blue-700 dark:text-blue-300 font-medium">Файл .env скачан! Скопируйте его в корень проекта: <code className="bg-blue-100 dark:bg-blue-900/50 px-1 rounded font-mono">C:/Users/filat/dash/.env</code></span>
                </div>
              )}
              {connStatus === 'error' && (
                <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg">
                  <AlertTriangle size={16} className="text-red-600 dark:text-red-400" />
                  <span className="text-xs text-red-700 dark:text-red-300">{connError || 'Ошибка подключения'}</span>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleSaveEnv}
                  disabled={!connForm.serviceAccountEmail || !connForm.privateKey || saveEnvFeedback.state === 'loading'}
                  className={clsx(
                    'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition',
                    saveEnvFeedback.state === 'loading'
                      ? 'text-blue-400 bg-blue-200 dark:bg-blue-900/40 cursor-wait'
                      : 'text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed'
                  )}
                >
                  {saveEnvFeedback.state === 'loading' ? (
                    <><Loader2 size={14} className="animate-spin" /> Сохранение...</>
                  ) : (
                    <><Save size={14} /> Сохранить .env</>
                  )}
                </button>
                <button
                  onClick={handleTestSheetsConnection}
                  disabled={sheetsTestFeedback.state === 'loading'}
                  className={clsx(
                    'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition',
                    sheetsTestFeedback.state === 'loading'
                      ? 'text-zinc-400 bg-zinc-200 dark:bg-zinc-700 cursor-wait'
                      : 'text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 active:bg-zinc-300 dark:active:bg-zinc-500'
                  )}
                >
                  {sheetsTestFeedback.state === 'loading' ? (
                    <><Loader2 size={14} className="animate-spin" /> Проверка...</>
                  ) : (
                    <><Wifi size={14} /> Проверить подключение</>
                  )}
                </button>
              </div>
            </div>

            {/* .env preview */}
            <div>
              <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-2">Превью файла .env</h3>
              <pre className="bg-zinc-900 text-green-400 text-xs p-4 rounded-xl overflow-x-auto font-mono leading-relaxed">
{`# Google Sheets API
GOOGLE_SHEETS_SPREADSHEET_ID=${connForm.spreadsheetId}
GOOGLE_SERVICE_ACCOUNT_EMAIL=${connForm.serviceAccountEmail || '<ваш-email@project.iam.gserviceaccount.com>'}
GOOGLE_PRIVATE_KEY="${connForm.privateKey ? '-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----' : '<вставьте-private_key-из-JSON>'}"

# Сервер
PORT=${connForm.port}
HOST=${connForm.host}
LOG_LEVEL=info

# База данных (SQLite для разработки)
SQLITE_PATH=./data/aemr.db
# DB_PROVIDER=postgresql          # для продакшена
# DATABASE_URL=postgresql://...   # для продакшена`}
              </pre>
              <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-2">
                Этот файл должен быть в корне проекта: <code className="bg-zinc-100 dark:bg-zinc-700 px-1 rounded">C:/Users/filat/dash/.env</code>
              </p>
            </div>

            {/* Quick start */}
            <div className="bg-zinc-50 dark:bg-zinc-900/30 border border-zinc-200 dark:border-zinc-700/50 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-3">Быстрый запуск (после настройки .env)</h3>
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-zinc-300 dark:bg-zinc-600 text-zinc-800 dark:text-zinc-200 flex items-center justify-center text-xs font-bold">1</span>
                  <div>
                    <code className="text-xs text-zinc-800 dark:text-zinc-200 bg-zinc-200 dark:bg-zinc-700 px-2 py-1 rounded font-mono inline-block">pnpm --filter @aemr/shared build && pnpm --filter @aemr/core build</code>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">Сборка shared и core (нужно один раз)</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-zinc-300 dark:bg-zinc-600 text-zinc-800 dark:text-zinc-200 flex items-center justify-center text-xs font-bold">2</span>
                  <div>
                    <code className="text-xs text-zinc-800 dark:text-zinc-200 bg-zinc-200 dark:bg-zinc-700 px-2 py-1 rounded font-mono inline-block">pnpm --filter @aemr/server dev</code>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">Запустить бэкенд (терминал 1) &rarr; http://localhost:{connForm.port}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-zinc-300 dark:bg-zinc-600 text-zinc-800 dark:text-zinc-200 flex items-center justify-center text-xs font-bold">3</span>
                  <div>
                    <code className="text-xs text-zinc-800 dark:text-zinc-200 bg-zinc-200 dark:bg-zinc-700 px-2 py-1 rounded font-mono inline-block">pnpm --filter @aemr/web dev</code>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">Запустить фронтенд (терминал 2) &rarr; http://localhost:5173</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
