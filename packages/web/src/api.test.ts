import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api, fetchJSON } from './api';

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
