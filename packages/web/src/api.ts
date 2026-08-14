import type { DashboardData } from '@aemr/shared';
import type { MetricDelta, Report, RowTimeline, UpcomingRiskRow } from '@aemr/core';
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
 * Ответ GET /api/report: проекция Report плюс серверная обвязка страницы —
 * methodology («как посчитано» — текст для подвала) и svodOnlineUrl («где
 * сверить» — официальная книга СВОД в Google Sheets; id книги на сервере не
 * настроен → поля в ответе нет). Обвязка живёт рядом с core-типом, а не
 * внутри него: это свойства ответа сервера, не расчётной проекции.
 */
export type ReportResponse = Omit<Report, 'period'> & {
  /**
   * Период ответа: сервер всегда называет день (эфир — сегодня, архив — дата
   * среза) и режим. live=true — числа на текущий момент, гейт факта не
   * применялся; live=false — архивный снимок недели.
   */
  period: Report['period'] & { asOfDay: number; live: boolean };
  methodology?: string;
  svodOnlineUrl?: string;
};

/**
 * Ответ GET /api/timeline/:deptId/:sheetRow — таймлайн строки (@aemr/core
 * RowTimeline) плюс серверная сводка покрытия источников: сколько источников
 * реально несут историю этой строки (журнал может быть недоступен — это
 * не то же самое, что «правок не было»).
 */
export type RowTimelineResponse = RowTimeline & {
  coverage: {
    /** false — таблица журнала правок недоступна (не «правок не было»). */
    journalAvailable: boolean;
    journalEntries: number;
    snapshotObservations: number;
    weekSliceDates: string[];
  };
};

/** Ответ GET /api/timeline/upcoming — «близкие к плановой дате» (канон п.75б). */
export interface UpcomingResponse {
  /** День расчёта (ISO) по календарю продукта. */
  asOf: string;
  /** Окно вперёд, дней. */
  days: number;
  total: number;
  rows: UpcomingRiskRow[];
  /** false — вкладка «Ежедневный мониторинг» ещё не подключена, стадий нет. */
  monitoringLinked: boolean;
}

/**
 * Структурный контракт zod-схемы (zod не в deps web; схемы приходят из @aemr/shared).
 * Тип результата выводится из success-ветки safeParse — эквивалент z.infer.
 */
interface ParseSchema<T> {
  safeParse(data: unknown):
    | { success: true; data: T }
    | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } };
}

/**
 * Русская фраза по коду ответа: пользователь читает, что случилось и что
 * делать, а не «API error 500». Единственный дом этих формулировок.
 */
function httpErrorPhrase(status: number): string {
  if (status === 401 || status === 403) return 'Нет доступа к данным: ключ доступа не принят сервером';
  if (status === 404) return 'Данные не найдены на сервере';
  if (status === 429) return 'Слишком много запросов подряд — повторите через минуту';
  if (status === 502 || status === 503 || status === 504) return 'Сервер данных недоступен — идёт перезапуск или обновление';
  if (status >= 500) return 'Ошибка на стороне сервера данных';
  return 'Запрос отклонён сервером';
}

/**
 * Отказ, на который сервер всё-таки ОТВЕТИЛ (пришёл код состояния).
 *
 * Отдельный класс нужен не для красоты типов: страницам приходится отличать
 * «сервер жив, но отказал» от «сервера нет вовсе» — например, вкладка
 * «Подключение» на этом различии рисует «Сервер работает, доступ настроен не
 * полностью» против «Сервер не запущен». Раньше это различие ловили строкой
 * `String(e).includes('API error')`; текст ошибки стал русским, проверка
 * замолчала — и живой ненастроенный сервер отображался как выключенный.
 * Признак состояния должен быть полем, а не подстрокой сообщения.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    // Текст ошибки видит пользователь в красной плашке шапки — он русский
    // и объясняет ситуацию, а не пересказывает протокол. Код и тело
    // остаются в скобках: без них не отличить «нет прав» от «сервер лёг».
    super(`${httpErrorPhrase(status)} (код ${status}${body ? `: ${body.slice(0, 120)}` : ''})`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Ответ сервера не совпал с объявленным контрактом (zod-схема из @aemr/shared).
 * Читателю это ничего не говорит, поэтому наружу идёт русская фраза с
 * действием, а перечень расхождений — технической припиской в скобках.
 */
export class ApiContractError extends Error {
  readonly url: string;
  readonly issues: string;

  constructor(url: string, issues: string) {
    super(`Сервер вернул данные в непонятном виде — обновите страницу, и если повторится, сообщите разработчику (${url}: ${issues})`);
    this.name = 'ApiContractError';
    this.url = url;
    this.issues = issues;
  }
}

/**
 * Человеческий текст любой ошибки запроса для плашки в шапке. Ловит и
 * браузерные сетевые отказы («Failed to fetch» при офлайне или упавшем
 * сервере) — их текст задаёт движок, и по-русски он не бывает.
 */
export function humanizeRequestError(err: unknown): string {
  // Сообщения ApiError/ApiContractError уже собраны по-русски — не трогаем.
  if (err instanceof ApiError || err instanceof ApiContractError) return err.message;
  const raw = err instanceof Error ? err.message : String(err);
  if (/failed to fetch|networkerror|load failed|ERR_NETWORK|ERR_CONNECTION/i.test(raw)) {
    return 'Нет связи с сервером данных: проверьте подключение или дождитесь перезапуска сервера';
  }
  if (/aborted|timeout/i.test(raw)) return 'Сервер не ответил вовремя — повторите запрос';
  // Сюда попадает текст движка — он английский. Оборачиваем русской рамкой,
  // чтобы читатель хотя бы понимал, что случилось, а подробность оставляем
  // разработчику мелким шрифтом в скобках (правило зоны: без сырых строк).
  return `Непредвиденная ошибка при обращении к серверу (${raw})`;
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
    throw new ApiError(res.status, body);
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
      .map((i) => `${i.path.join('.') || 'корень ответа'}: ${i.message}`)
      .join('; ');
    throw new ApiContractError(url, brief);
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

  // Отчёт — проекция buildReport (@aemr/core); квартал и дата среза опциональны.
  // Без asOf — прямой эфир (числа на сейчас); asOf открывает снимок той недели.

  /** Правки книг ГРБС с даты среза — журналы _ChangeLog (провенанс коллеги). */
  getChanges: (since?: string) => {
    const qs = since ? `?since=${since}` : '';
    return fetchJSON<{
      since: string;
      total: number;
      records: Array<{
        dept: string; sheet: string; cell: string; attribute: string;
        oldValue: string; newValue: string; atMs: number; author: string;
      }>;
    }>(`/changes${qs}`);
  },

  getReport: (year: number, quarter?: 1 | 2 | 3 | 4, asOf?: string) => {
    const params = new URLSearchParams({ year: String(year) });
    if (quarter) params.set('quarter', String(quarter));
    if (asOf) params.set('asOf', asOf);
    return fetchJSON<ReportResponse>(`/report?${params.toString()}`);
  },

  // Таймлайн строки книги ГРБС (роуты routes/timeline.ts, канон п.75)

  /** История одной строки: журнал правок + снимки + срезы недель. */
  getRowTimeline: (deptId: string, sheetRow: number) =>
    fetchJSON<RowTimelineResponse>(`/timeline/${encodeURIComponent(deptId)}/${sheetRow}`),

  /** «Близкие к плановой дате»: просроченные + плановая дата в ближайшие N дней. */
  getTimelineUpcoming: (days?: number) =>
    fetchJSON<UpcomingResponse>(`/timeline/upcoming${days ? `?days=${days}` : ''}`),

  // Разметка видов строк стадии «в течение года» (routes/annotations.ts, канон п.83)

  /** Все пользовательские оверрайды видов (слияние со стартовой — на клиенте). */
  getYearlongAnnotations: () =>
    fetchJSON<{
      overrides: Array<{ dept: string; ppNum: string; kind: string; provisional: boolean; updatedAt: string }>;
      total: number;
    }>('/annotations/yearlong'),

  /** Разметить вид строки (kind=null — снять оверрайд, вернуть стартовую разметку). */
  putYearlongAnnotation: (dept: string, ppNum: string, kind: string | null, provisional?: boolean) =>
    fetchJSON<{ success: boolean }>(
      `/annotations/yearlong/${encodeURIComponent(dept)}/${encodeURIComponent(ppNum)}`,
      { method: 'PUT', body: JSON.stringify({ kind, ...(provisional !== undefined ? { provisional } : {}) }) },
    ),

  // Аннотации «комментарий против структуры» (routes/comment-annotations.ts,
  // пп. 72а/74б/78): правила ядра detectCommentInconsistencies по строкам книг.

  /** Все аннотации несогласованности комментариев по текущему чтению книг. */
  getCommentAnnotations: () =>
    fetchJSON<{
      asOf: string;
      source: 'live' | 'snapshot';
      rowsScanned: number;
      total: number;
      byKind: Record<string, number>;
      annotations: Array<{
        dept: string; sheetRow: number; rowKey: string; column: string; cell: string;
        kind: string; excerpt: string; mechanism: string; action: string;
      }>;
    }>('/annotations/comments'),

  /** Честные счётчики корзин Реестра (п.73в): не обеспеченные финансированием + в течение года. */
  getRegistryBuckets: () =>
    fetchJSON<{
      asOf: string;
      source: 'live' | 'snapshot';
      unfunded: { rows: number; planSum: number };
      yearlong: { rows: number; planSum: number };
    }>('/registry/buckets'),

  // Report map
  getReportMap: () =>
    fetchJSON<any>('/report-map'),

  // getHistory (/api/history) удалён: 0 потребителей, байт-в-байт дубль
  // getHistorySnapshots (ponytail-ревью R1 #5); судьба дубль-роута — задача сервера.

  // Таймлайн снимков и дрейф метрик между двумя снимками — блок
  // «Что изменилось за неделю» страницы «Отчёт» (роуты routes/history.ts)
  getHistorySnapshots: () =>
    fetchParsed('/history/snapshots', SnapshotHistoryResponseSchema),

  getHistoryDiff: (from: string, to: string) => {
    const params = new URLSearchParams({ from, to });
    return fetchJSON<MetricDelta[]>(`/history/diff?${params.toString()}`);
  },

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
