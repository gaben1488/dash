import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api, fetchJSON, fetchParsed, ApiError, humanizeRequestError } from './api';
import { HealthResponseSchema } from '@aemr/shared';

function fakeResponse(body: unknown = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

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
