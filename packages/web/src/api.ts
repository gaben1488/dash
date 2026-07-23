import type { DashboardData } from '@aemr/shared';
import type { Report } from '@aemr/core';
import {
  HealthResponseSchema,
  IssuesListResponseSchema,
  IssueHistoryResponseSchema,
  JournalListResponseSchema,
  JournalStatsResponseSchema,
  SourcesResponseSchema,
  SnapshotHistoryResponseSchema,
  MetricsResponseSchema,
  TrustScoreSchema,
} from '@aemr/shared';

const API_BASE = '/api';

/**
 * Структурный контракт zod-схемы (zod не в deps web; схемы приходят из @aemr/shared).
 * Тип результата выводится из success-ветки safeParse — эквивалент z.infer.
 */
interface ParseSchema<T> {
  safeParse(data: unknown):
    | { success: true; data: T }
    | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } };
}

export async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  // Only set Content-Type for requests with a body, and only if the caller hasn't set one
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  // Attach Bearer token if configured (for auth middleware), unless the caller already set one
  const apiKey = typeof localStorage !== 'undefined' ? localStorage.getItem('aemr_api_key') : null;
  if (apiKey && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${apiKey}`);
  }
  const res = await fetch(`${API_BASE}${url}`, {
    ...init,
    headers,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

/**
 * fetchJSON + runtime-валидация ответа по zod-схеме.
 * При несоответствии контракту бросает Error с url и кратким списком расхождений
 * (страницы ловят её так же, как сетевые ошибки fetchJSON).
 */
export async function fetchParsed<T>(url: string, schema: ParseSchema<T>, init?: RequestInit): Promise<T> {
  const json = await fetchJSON<unknown>(url, init);
  const result = schema.safeParse(json);
  if (!result.success) {
    const brief = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`API contract violation at ${url}: ${brief}`);
  }
  // Возвращаем исходный json, а не result.data: strip-режим zod вырезал бы
  // незадекларированные поля, на которые ещё опираются страницы.
  return json as T;
}

export const api = {
  // Dashboard
  getDashboard: (refresh = false, year?: number | 'all') => {
    const params = new URLSearchParams();
    if (refresh) params.set('refresh', 'true');
    if (year !== undefined) params.set('year', String(year));
    const qs = params.toString();
    return fetchJSON<DashboardData>(`/dashboard${qs ? `?${qs}` : ''}`);
  },

  refresh: (quick = false) =>
    fetchJSON<any>(`/refresh${quick ? '?quick=true' : ''}`, { method: 'POST' }),

  // Metrics
  getMetrics: () =>
    fetchParsed('/metrics', MetricsResponseSchema),

  getMetric: (key: string) =>
    fetchJSON<any>(`/metrics/${encodeURIComponent(key)}`),

  // Issues
  getIssues: (filters?: Record<string, string>) => {
    const params = new URLSearchParams(filters);
    return fetchParsed(`/issues?${params}`, IssuesListResponseSchema);
  },

  updateIssueStatus: (id: string, status: string, reason?: string) =>
    fetchJSON<any>(`/issues/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status, reason }),
    }),

  addIssueComment: (id: string, comment: string) =>
    fetchJSON<any>(`/issues/${id}/comment`, {
      method: 'PUT',
      body: JSON.stringify({ comment }),
    }),

  // Валидация контрактом + широкий тип: страница держит свой локальный HistoryEntry
  // (passthrough-схема не сужается до него — сузим при типизации DTO).
  getIssueHistory: (id: string): Promise<any> =>
    fetchParsed(`/issues/${id}/history`, IssueHistoryResponseSchema),

  // Trust
  getTrust: () =>
    fetchParsed('/trust', TrustScoreSchema),

  getTrustDetail: (deptId: string) =>
    fetchJSON<any>(`/trust/${encodeURIComponent(deptId)}`),

  // Rows
  getRows: (deptId: string, params?: Record<string, string>) => {
    const search = new URLSearchParams(params);
    return fetchJSON<any>(`/rows/${encodeURIComponent(deptId)}?${search}`);
  },

  updateField: (deptId: string, rowIndex: number, field: string, value: string) =>
    fetchJSON<any>(`/rows/${encodeURIComponent(deptId)}/${rowIndex}/field`, {
      method: 'PUT',
      body: JSON.stringify({ field, value }),
    }),

  /** Batch-save edited rows (multiple field updates with audit logging) */
  saveRows: (rows: Array<{ deptId: string; rowIndex: number; changes: Record<string, unknown> }>) =>
    fetchJSON<any>('/data/rows', {
      method: 'POST',
      body: JSON.stringify({ rows }),
    }),

  // Reconciliation — сложные DTO без готовых схем; мигрируют при типизации DTO
  getReconciliation: (year?: number | 'all') => {
    const qs = year !== undefined ? `?year=${year}` : '';
    return fetchJSON<any>(`/reconciliation${qs}`);
  },

  getReconciliationMonthly: (dept?: string, year?: number | 'all') => {
    const params = new URLSearchParams();
    if (dept) params.set('dept', dept);
    if (year !== undefined) params.set('year', String(year));
    const qs = params.toString();
    return fetchJSON<any>(`/reconciliation/monthly${qs ? `?${qs}` : ''}`);
  },

  /** Единая сетка СВОД (ГРБС × активность × метод × период) + сверка против листа СВОД ТД-ПМ. */
  getSvodUnified: (year?: number | 'all') => {
    const qs = year !== undefined ? `?year=${year}` : '';
    return fetchJSON<any>(`/svod/unified${qs}`);
  },

  // Journal
  getJournal: (filters?: Record<string, string>) => {
    const params = new URLSearchParams(filters);
    return fetchParsed(`/journal?${params}`, JournalListResponseSchema);
  },

  getJournalStats: () =>
    fetchParsed('/journal/stats', JournalStatsResponseSchema),

  // Sources
  getSources: () =>
    fetchParsed('/sources', SourcesResponseSchema),

  testSource: (name: string) =>
    fetchJSON<any>(`/sources/${encodeURIComponent(name)}/test`, { method: 'POST' }),

  updateSource: (name: string, spreadsheetId: string) =>
    fetchJSON<any>(`/sources/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify({ spreadsheetId }),
    }),

  validateSource: (name: string) =>
    fetchJSON<any>(`/sources/${encodeURIComponent(name)}/validate`, { method: 'POST' }),

  /** Валидация всех источников разом (СВОД + 8 ГРБС + «СВОД с месяцами»). */
  validateAllSources: () =>
    fetchJSON<any>('/sources/validate-all', { method: 'POST' }),

  // Settings / подключение Google (через fetchJSON — с Bearer; голый fetch давал 401 в проде)
  settingsStatus: () => fetchJSON<any>('/settings/status'),
  saveEnv: (form: Record<string, string>) =>
    fetchJSON<any>('/settings/env', { method: 'POST', body: JSON.stringify(form) }),

  getSubordinates: () =>
    fetchJSON<Record<string, string[]>>('/rows/subordinates'),

  // Mapping
  getMapping: () =>
    fetchJSON<any>('/mapping'),

  updateMapping: (metricId: string, cellRef: string) =>
    fetchJSON<any>(`/mapping/${encodeURIComponent(metricId)}`, {
      method: 'PUT',
      body: JSON.stringify({ cellRef }),
    }),

  resetMapping: () =>
    fetchJSON<any>('/mapping/reset', { method: 'POST' }),

  validateMapping: () =>
    fetchJSON<any>('/mapping/validate', { method: 'POST' }),

  // Subjects (normalization analysis)
  getSubjects: () =>
    fetchJSON<any>('/rows/subjects'),

  // Scatter data for Economy page
  getScatterData: (params?: Record<string, string>) => {
    const search = params ? new URLSearchParams(params).toString() : '';
    return fetchJSON<any>(`/rows/scatter${search ? `?${search}` : ''}`);
  },

  // Отчёт — проекция buildReport (@aemr/core); квартал опционален (дефолт выбирает сервер)
  getReport: (year: number, quarter?: 1 | 2 | 3 | 4) => {
    const params = new URLSearchParams({ year: String(year) });
    if (quarter) params.set('quarter', String(quarter));
    return fetchJSON<Report>(`/report?${params.toString()}`);
  },

  // Report map
  getReportMap: () =>
    fetchJSON<any>('/report-map'),

  // History (audit log)
  getHistory: (limit = 50) =>
    fetchParsed(`/history?limit=${limit}`, SnapshotHistoryResponseSchema),

  // Export
  exportAudit: () =>
    `${API_BASE}/export/audit`,
  exportIssuesUrl: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return `${API_BASE}/export/issues${qs}`;
  },
  exportReconciliationUrl: (year?: number | 'all') => {
    const qs = year !== undefined ? `?year=${year}` : '';
    return `${API_BASE}/export/reconciliation${qs}`;
  },

  // Analytics
  getAnalyticsProfiles: () =>
    fetchJSON<any>('/analytics/profiles'),

  getAnalyticsCompliance: () =>
    fetchJSON<any>('/analytics/compliance'),

  getAnalyticsEPReasons: () =>
    fetchJSON<any>('/analytics/ep-reasons'),

  getAnalyticsAnomalies: () =>
    fetchJSON<any>('/analytics/anomalies'),

  getAnalyticsForecast: (deptId: string) =>
    fetchJSON<any>(`/analytics/forecast/${encodeURIComponent(deptId)}`),

  getAnalyticsSubjects: () =>
    fetchJSON<any>('/analytics/subjects'),

  getAnalyticsCentralization: () =>
    fetchJSON<any>('/analytics/centralization'),

  getCellRefs: (params?: Record<string, string>) => {
    const search = params ? '?' + new URLSearchParams(params).toString() : '';
    return fetchJSON<any>(`/cell-refs${search}`);
  },

  // Health
  health: () =>
    fetchParsed('/health', HealthResponseSchema),
};
