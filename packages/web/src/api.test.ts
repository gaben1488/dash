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

it('restores a compact dashboard alias without copying or losing issues', async () => {
  const issues = [{ id: 'one' }];
  vi.stubGlobal('fetch', vi.fn(async () => fakeResponse({ snapshot: { issues }, recentIssues: [], recentIssuesRef: 'snapshot.issues' })));
  const data = await api.getDashboard(false, 2026);
  expect(data.recentIssues).toBe(data.snapshot.issues);
  expect(data.recentIssues).toEqual(issues);
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
