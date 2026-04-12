const API_BASE = '/api';

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};
  // Only set Content-Type for requests with a body
  if (init?.body) {
    headers['Content-Type'] = 'application/json';
  }
  // Attach Bearer token if configured (for auth middleware)
  const apiKey = typeof localStorage !== 'undefined' ? localStorage.getItem('aemr_api_key') : null;
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  const res = await fetch(`${API_BASE}${url}`, {
    headers,
    ...init,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  // Dashboard
  getDashboard: (refresh = false, year?: number | 'all') => {
    const params = new URLSearchParams();
    if (refresh) params.set('refresh', 'true');
    if (year !== undefined) params.set('year', String(year));
    const qs = params.toString();
    return fetchJSON<any>(`/dashboard${qs ? `?${qs}` : ''}`);
  },

  refresh: (quick = false) =>
    fetchJSON<any>(`/refresh${quick ? '?quick=true' : ''}`, { method: 'POST' }),

  // Metrics
  getMetrics: () =>
    fetchJSON<any>('/metrics'),

  getMetric: (key: string) =>
    fetchJSON<any>(`/metrics/${encodeURIComponent(key)}`),

  // Issues
  getIssues: (filters?: Record<string, string>) => {
    const params = new URLSearchParams(filters);
    return fetchJSON<any>(`/issues?${params}`);
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

  getIssueHistory: (id: string) =>
    fetchJSON<any>(`/issues/${id}/history`),

  // Trust
  getTrust: () =>
    fetchJSON<any>('/trust'),

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

  // Reconciliation
  getReconciliation: () =>
    fetchJSON<any>('/reconciliation'),

  getReconciliationMonthly: (dept?: string) =>
    fetchJSON<any>(`/reconciliation/monthly${dept ? `?dept=${dept}` : ''}`),

  // Journal
  getJournal: (filters?: Record<string, string>) => {
    const params = new URLSearchParams(filters);
    return fetchJSON<any>(`/journal?${params}`);
  },

  getJournalStats: () =>
    fetchJSON<any>('/journal/stats'),

  // Sources
  getSources: () =>
    fetchJSON<any>('/sources'),

  testSource: (name: string) =>
    fetchJSON<any>(`/sources/${encodeURIComponent(name)}/test`, { method: 'POST' }),

  updateSource: (name: string, spreadsheetId: string) =>
    fetchJSON<any>(`/sources/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify({ spreadsheetId }),
    }),

  validateSource: (name: string) =>
    fetchJSON<any>(`/sources/${encodeURIComponent(name)}/validate`, { method: 'POST' }),

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

  // Report map
  getReportMap: () =>
    fetchJSON<any>('/report-map'),

  // History (audit log)
  getHistory: (limit = 50) =>
    fetchJSON<any>(`/history?limit=${limit}`),

  // Export
  exportAudit: () =>
    `${API_BASE}/export/audit`,
  exportIssuesUrl: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return `${API_BASE}/export/issues${qs}`;
  },
  exportReconciliationUrl: () =>
    `${API_BASE}/export/reconciliation`,

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
    fetchJSON<any>('/health'),
};
