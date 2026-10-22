import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api, fetchJSON, fetchParsed, fetchBlob, ApiError, humanizeRequestError } from './api';
import { HealthResponseSchema } from '@aemr/shared';

function fakeResponse(body: unknown = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function dashboardBody() {
  const createdAt = '2026-10-20T00:00:00Z';
  const trust = { overall: null, grade: null, components: [], computedAt: createdAt, basedOnSnapshot: 'test' };
  return {
    snapshot: { id: 'test', spreadsheetId: 'test', createdAt, officialMetrics: {}, calculatedMetrics: {},
      deltas: [], issues: [{ id: 'one', severity: 'info', origin: 'bi_heuristic', category: 'fixture',
        title: 'Информация', description: 'Проверка', status: 'open', detectedAt: createdAt, detectedBy: 'test' }],
      trust, rowCount: 0, metadata: { sheetsRead: [], cellsRead: 0, readDurationMs: 0, pipelineDurationMs: 0 },
      datasetAnalyses: { retained: true } },
    trust, kpiCards: [], departmentSummaries: [], summaryByPeriod: {}, recentIssues: [],
    recentIssuesRef: 'snapshot.issues', signalCounts: {},
    issueSummary: { total: 1, bySeverity: { info: 1 }, byCategory: {}, byDepartment: {}, byOrigin: {}, signalCounts: {} },
    lastRefreshed: createdAt, year: 2026,
  };
}

it.each(['officialMetrics', 'calculatedMetrics', 'deltas', 'metadata', 'trust'])(
  'rejects a missing mandatory dashboard snapshot field: %s', async field => {
    const body = dashboardBody();
    Reflect.deleteProperty(body.snapshot, field);
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(body)));
    await expect(api.getDashboard()).rejects.toThrow(/формат|контракт|обновите/i);
  },
);

it('restores a compact dashboard alias without copying or losing issues', async () => {
  const body = dashboardBody();
  const issues = body.snapshot.issues;
  vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(body)));
  const data = await api.getDashboard(false, 2026);
  expect(data.recentIssues).toBe(data.snapshot.issues);
  expect(data.recentIssues).toEqual(issues);
  expect(data.snapshot).toHaveProperty('datasetAnalyses', { retained: true });
});

it('keeps a measured zero distinct from an unknown metric after contract validation', async () => {
  const body = dashboardBody();
  const metric = { origin: 'official', period: 'annual', unit: 'count',
    sourceSheet: 'СВОД ТД-ПМ', sourceCell: 'D4', formula: null, confidence: 1,
    readAt: body.lastRefreshed, warnings: [] };
  Object.assign(body.snapshot.officialMetrics, {
    zero: { ...metric, metricKey: 'zero', numericValue: 0, value: 0, displayValue: '0' },
    unknown: { ...metric, metricKey: 'unknown', numericValue: null, value: null,
      displayValue: '—', confidence: 0, warnings: ['Ячейка не прочитана'] },
  });
  vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(body)));
  const data = await api.getDashboard();
  expect(data.snapshot.officialMetrics.zero!.numericValue).toBe(0);
  expect(data.snapshot.officialMetrics.unknown!.numericValue).toBeNull();
  expect(data.snapshot.officialMetrics.unknown!.warnings).toEqual(['Ячейка не прочитана']);
});

it('rejects dropped calculated-period budget fields but accepts an explicit unknown', async () => {
  const body = dashboardBody();
  const required = [
    'kpCount', 'kpFactCount', 'kpPlan', 'kpFact', 'kpPercent',
    'epCount', 'epFactCount', 'epPlan', 'epFact', 'epPercent',
    'fbPlan', 'kbPlan', 'mbPlan', 'fbFact', 'kbFact', 'mbFact',
    'epFbPlan', 'epKbPlan', 'epMbPlan', 'epFbFact', 'epKbFact', 'epMbFact',
  ];
  const quarter = { ...Object.fromEntries(required.map(field => [field, null])), source: 'calculated' };
  Object.assign(body.summaryByPeriod, { q2: quarter });
  vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(body)));
  await expect(api.getDashboard()).resolves.toMatchObject({ summaryByPeriod: { q2: { epFbPlan: null } } });
  Reflect.deleteProperty(quarter, 'epFbPlan');
  await expect(api.getDashboard()).rejects.toThrow(/формат|контракт|обновите/i);
});

describe('C05.02: unified Svod HTTP transport required fields', () => {
  const zeroCell = {
    planCount: 0, factCount: 0,
    planFB: 0, planKB: 0, planMB: 0,
    factFB: 0, factKB: 0, factMB: 0,
    economyFB: 0, economyKB: 0, economyMB: 0,
  };

  function responseWithCell() {
    return {
      year: 2026, grid: {
        cells: { 'uo|all|kp|year': { ...zeroCell } },
        grbsIds: ['uo'], scopes: ['all', 'td', 'pm'],
      },
      reconciliation: [],
      reconciliationState: 'materialized' as const,
      snapshotId: 'fixture-svod',
      createdAt: '2026-10-22T00:00:00Z',
      sourceRevision: null,
    };
  }

  it('preserves a complete measured-zero cell and a genuinely empty grid', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(responseWithCell())));
    const full = await api.getSvodUnified(2026);
    expect(full.grid.cells['uo|all|kp|year'].planCount).toBe(0);
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse({
      year: 2026, grid: { cells: {}, grbsIds: [], scopes: [] }, reconciliation: [],
      reconciliationState: 'materialized', snapshotId: 'empty-svod',
      createdAt: '2026-10-22T00:00:00Z', sourceRevision: null,
    })));
    await expect(api.getSvodUnified()).resolves.toMatchObject({ grid: { cells: {} } });
  });

  it.each(['planCount', 'factCount', 'planFB', 'planKB', 'planMB',
    'factFB', 'factKB', 'factMB', 'economyFB', 'economyKB', 'economyMB'])(
    'rejects a dropped mandatory Svod cell field: %s', async field => {
      const body = responseWithCell();
      Reflect.deleteProperty(body.grid.cells['uo|all|kp|year'], field);
      vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(body)));
      await expect(api.getSvodUnified()).rejects.toThrow(/формат|контракт|обновите/i);
    },
  );

  it('requires provenance and differentiates missing comparison from an empty comparison', async () => {
    const body = responseWithCell();
    Reflect.deleteProperty(body, 'snapshotId');
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(body)));
    await expect(api.getSvodUnified()).rejects.toThrow(/формат|контракт|обновите/i);

    const unavailable = responseWithCell();
    unavailable.reconciliationState = 'not_materialized';
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(unavailable)));
    await expect(api.getSvodUnified()).resolves.toMatchObject({
      reconciliationState: 'not_materialized', reconciliation: [],
    });
  });

  it('rejects a broken grid axis or missing reconciliation collection', async () => {
    const body = responseWithCell();
    Reflect.deleteProperty(body.grid, 'grbsIds');
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(body)));
    await expect(api.getSvodUnified()).rejects.toThrow(/формат|контракт|обновите/i);

    const body2 = responseWithCell();
    Reflect.deleteProperty(body2, 'reconciliation');
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(body2)));
    await expect(api.getSvodUnified()).rejects.toThrow(/формат|контракт|обновите/i);
  });
});

describe('скачивание опубликованного документа', () => {
  it('сохраняет авторизацию и возвращает байты, не пытаясь разобрать DOCX как JSON', async () => {
    vi.stubGlobal('localStorage', { getItem: () => 'test-token' });
    const blob = new Blob(['document bytes']);
    const request = vi.fn(async (_url: string, _init: RequestInit) => ({ ok: true, blob: async () => blob }));
    vi.stubGlobal('fetch', request);
    expect(await fetchBlob('/report-releases/release/main.docx')).toBe(blob);
    expect(request.mock.calls[0][0]).toBe('/api/report-releases/release/main.docx');
    expect(new Headers(request.mock.calls[0][1].headers).get('Authorization')).toBe('Bearer test-token');
  });

  it('не скачивает тело ошибки как документ', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, text: async () => 'unavailable' })));
    await expect(fetchBlob('/report-releases/release/main.docx')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('fetchJSON header merging (B-13)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (key === 'aemr_api_key' ? 'secret-token' : null),
    });
  });

  it('merges init.headers with the constructed Authorization/Content-Type instead of replacing them', async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      calls.push(init);
      return fakeResponse();
    }));

    await fetchJSON('/some-endpoint', {
      method: 'POST',
      body: JSON.stringify({ a: 1 }),
      headers: { 'X-Custom': 'abc' },
    });

    const sent = new Headers(calls[0].headers);
    expect(sent.get('Authorization')).toBe('Bearer secret-token'); // currently dropped: init.headers wholly replaces the built headers object
    expect(sent.get('Content-Type')).toBe('application/json');     // currently dropped for the same reason
    expect(sent.get('X-Custom')).toBe('abc');                       // caller's own header must still survive
  });
});


describe('production edge basic-auth compatibility', () => {
  it('does not overwrite the browser Basic authorization with a stale stored API bearer', async () => {
    vi.stubEnv('PROD', true);
    vi.stubGlobal('localStorage', { getItem: () => 'old-browser-token' });
    const call = vi.fn(async (_url: string, _init: RequestInit) => fakeResponse());
    vi.stubGlobal('fetch', call);
    try {
      await fetchJSON('/report-releases?date=2026-10-11&year=2026&quarter=4');
      const headers = new Headers(call.mock.calls[0]?.[1]?.headers);
      expect(headers.has('Authorization')).toBe(false);
      expect(call.mock.calls[0]?.[1]?.credentials).toBe('same-origin');
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });
});

describe('reconciliation endpoints thread the year filter (B-11)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null });
  });

  it('getReconciliation sends ?year= when a year is selected', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { calls.push(url); return fakeResponse({ reconciliation: {} }); }));
    await api.getReconciliation(2025);
    expect(calls[0]).toContain('year=2025');
  });

  it('exportReconciliationUrl includes ?year= when a year is selected', () => {
    expect(api.exportReconciliationUrl(2025)).toContain('year=2025');
  });

  it('getReconciliationMonthly includes ?year= alongside dept', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { calls.push(url); return fakeResponse({}); }));
    await api.getReconciliationMonthly('УЖКХ', 2025);
    expect(calls[0]).toContain('year=2025');
    expect(calls[0]).toContain('dept=');
  });
});

describe('fetchParsed (контракт-валидация ответов по zod-схемам)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null });
  });

  it('валидный json проходит схему и возвращается как есть (лишние поля не срезаются)', async () => {
    const body = { status: 'ok', timestamp: '2026-07-17T00:00:00Z', service: 'aemr-server', extra: 42 };
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(body)));
    const result = await fetchParsed('/health', HealthResponseSchema);
    expect(result.status).toBe('ok');
    // Совместимость: страницы могут опираться на незадекларированные поля
    expect((result as Record<string, unknown>).extra).toBe(42);
  });

  it('невалидный json бросает ошибку с url и кратким описанием несоответствия', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse({ status: 123 })));
    await expect(fetchParsed('/health', HealthResponseSchema)).rejects.toThrow(/\/health/);
    await expect(fetchParsed('/health', HealthResponseSchema)).rejects.toThrow(/status/);
  });

  it('api.health() валидирует ответ через схему; текст ошибки — русский, техника в скобках', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse({ nope: true })));
    // Читателю — фраза с действием, не «contract violation»
    await expect(api.health()).rejects.toThrow(/обновите страницу/i);
    await expect(api.health()).rejects.toThrow(/\/health/);
  });
});

describe('ApiError: состояние ответа — поле, а не подстрока сообщения', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null });
  });

  it('не-ok ответ даёт ApiError с кодом состояния и русской фразой', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 403,
      text: async () => 'forbidden',
      json: async () => ({}),
    } as unknown as Response)));

    // Различие «сервер жив, но отказал» / «сервера нет» страницы читают полем
    // status, а не поиском подстроки в тексте (тот меняется вместе с текстовкой).
    const err = await fetchJSON('/settings/status').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
    expect((err as ApiError).message).toMatch(/Нет доступа/);
  });

  it('сетевой отказ движка переводится в русскую фразу с действием', () => {
    expect(humanizeRequestError(new TypeError('Failed to fetch'))).toMatch(/Нет связи с сервером/);
  });

  it('distinguishes a first snapshot being prepared from an unavailable server', () => {
    const preparing = new ApiError(503, JSON.stringify({ code: 'SNAPSHOT_NOT_READY' }));
    expect(preparing.code).toBe('SNAPSHOT_NOT_READY');
    expect(humanizeRequestError(preparing)).toContain('Срез данных ещё готовится');
    expect(humanizeRequestError(preparing)).not.toContain('недоступен');
    const unavailable = new ApiError(503, '<html>Unavailable</html>');
    expect(unavailable.code).toBeNull();
    expect(humanizeRequestError(unavailable)).toContain('недоступен');
  });
});

describe('issue decision confirmed persistence', () => {
  beforeEach(() => vi.stubGlobal('localStorage', { getItem: () => null }));
  it.each([
    { success: false, issueId: 'case-1', toStatus: 'false_positive' },
    { success: true, issueId: 'other', toStatus: 'false_positive' },
    { success: true, issueId: 'case-1', toStatus: 'open' },
  ])('rejects misleading mutation acknowledgement %j', async body => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(body)));
    await expect(api.updateIssueStatus('case-1', 'false_positive', 'Evidence')).rejects.toThrow();
  });
  it('rejects when authoritative readback fails after acknowledged save', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(fakeResponse({ success: true, issueId: 'case-1', toStatus: 'false_positive' }))
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'unavailable' }));
    await expect(api.updateIssueStatus('case-1', 'false_positive', 'Evidence')).rejects.toThrow();
  });
  it.each([{ id: 'case-1', status: 'open' }, { id: 'other', status: 'false_positive' }])('rejects mismatched readback %j', async issue => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(fakeResponse({ success: true, issueId: 'case-1', toStatus: 'false_positive' }))
      .mockResolvedValueOnce(fakeResponse({ issue, history: [] })));
    await expect(api.updateIssueStatus('case-1', 'false_positive', 'Evidence')).rejects.toThrow();
  });
  it('confirms persisted false-positive status from GET, preserving reason request', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(fakeResponse({ success: true, issueId: 'case-1', toStatus: 'false_positive' }))
      .mockResolvedValueOnce(fakeResponse({ issue: { id: 'case-1', status: 'false_positive' }, history: [{ reason: 'Evidence' }] }));
    vi.stubGlobal('fetch', request);
    await api.updateIssueStatus('case-1', 'false_positive', 'Evidence');
    expect(request.mock.calls.map(c => c[0])).toEqual(['/api/issues/case-1/status', '/api/issues/case-1']);
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ status: 'false_positive', reason: 'Evidence' });
  });
});

describe('API base prefix for journal and source consumers',()=>{
 it.each([['/api/change-story?limit=1','/api/change-story?limit=1'],['/change-story?limit=1','/api/change-story?limit=1'],['/api/sources','/api/sources'],['/apiary','/api/apiary']])('requests %s at exactly one API prefix',async(input,expected)=>{
  vi.stubGlobal('localStorage',{getItem:()=>null});
  const request=vi.fn(async(_url:string)=>fakeResponse({}));vi.stubGlobal('fetch',request);
  await fetchJSON(input);expect(request.mock.calls[0]?.[0]).toBe(expected);
 });
});
