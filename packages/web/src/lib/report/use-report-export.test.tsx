// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useReportExport, type ExportContext } from './use-report-export';

const receipt = {
  release_id: `REL-${'a'.repeat(64)}`, snapshot_id: 'SNP-test', report_date: '30.09.2026',
  report_year: 2026, quarter: 3, cutoff_at: '2026-09-29T16:00:00Z', published_at: '2026-09-29T16:05:00Z',
  model_sha256: 'a'.repeat(64), rules_version: 'test', renderer_version: 'test', status: 'VERIFIED',
};
const context: ExportContext = { date: '2026-09-30', year: 2026, quarter: 3, mode: 'live' };
const request = vi.fn();
let poll: () => void;
const realSetInterval = globalThis.setInterval;
beforeEach(() => {
  vi.spyOn(globalThis, 'setInterval').mockImplementation((callback, delay, ...args) => {
    if (delay !== 60_000) return realSetInterval(callback, delay, ...args);
    poll = callback as () => void;
    return 0 as unknown as ReturnType<typeof setInterval>;
  });
  vi.stubGlobal('fetch', request);
  request.mockReset();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const response = (selected: unknown) => ({ ok: true, json: async () => ({ latest: receipt, selected, attempt: null }) });

it('pins the pair when a background publication arrives after the first download', async () => {
  let selected = receipt;
  const downloads: string[] = [];
  request.mockImplementation(async (url: string) => {
    if (url.endsWith('.docx')) { downloads.push(url); return { ok: true, blob: async () => new Blob(['docx']) }; }
    return response(selected);
  });
  const { result } = renderHook(() => useReportExport(context));
  await waitFor(() => expect(result.current.release?.release_id).toBe(receipt.release_id));
  await act(() => result.current.download('main'));
  selected = { ...receipt, release_id: `REL-${'b'.repeat(64)}`, model_sha256: 'b'.repeat(64) };
  await act(async () => { poll(); await new Promise(resolve => setTimeout(resolve, 0)); });
  await act(() => result.current.download('extra'));
  expect(downloads).toEqual([`/api/report-releases/${receipt.release_id}/main.docx`, `/api/report-releases/${receipt.release_id}/supplement.docx`]);
});

it('cancels an in-flight document when the reader changes the period', async () => {
  let deliver!: (value: Blob) => void;
  request.mockImplementation(async (url: string) => url.endsWith('.docx')
    ? { ok: true, blob: () => new Promise<Blob>(resolve => { deliver = resolve; }) } : response(receipt));
  const { result, rerender } = renderHook(({ value }) => useReportExport(value), { initialProps: { value: context } });
  await waitFor(() => expect(result.current.release).not.toBeNull());
  let downloading!: Promise<void>;
  act(() => { downloading = result.current.download('main'); });
  await waitFor(() => expect(deliver).toBeTypeOf('function'));
  rerender({ value: { ...context, year: 2027 } });
  await act(async () => { deliver(new Blob(['docx'])); await downloading; });
  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  expect(result.current.release).toBeNull();
});

it('ignores an obsolete status response even if the transport does not honor cancellation', async () => {
  let deliver!: (value: ReturnType<typeof response>) => void;
  request.mockImplementationOnce(() => new Promise(resolve => { deliver = resolve; }));
  request.mockResolvedValue(response(null));
  const { result, rerender } = renderHook(({ value }) => useReportExport(value), { initialProps: { value: context } });
  rerender({ value: { ...context, year: 2027 } });
  await act(async () => { deliver(response(receipt)); });
  await waitFor(() => expect(result.current.status).toContain('ещё не выпущен'));
  expect(result.current.release).toBeNull();
});

it.each([
  { ...receipt, report_date: '24.09.2026' }, { ...receipt, quarter: 4 }, { ...receipt, report_year: 2027 },
])('does not expose a document from a mismatched context', async selected => {
  request.mockResolvedValue(response(selected));
  const { result } = renderHook(() => useReportExport(context));
  await waitFor(() => expect(result.current.status).toContain('ещё не выпущен'));
  await act(() => result.current.download('main'));
  expect(result.current.release).toBeNull();
  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
});

it('distinguishes unavailable service from missing historical data', async () => {
  request.mockRejectedValue(new Error('offline'));
  const { result } = renderHook(() => useReportExport(context));
  await waitFor(() => expect(result.current.status).toContain('Не удалось проверить'));
  expect(result.current.status).not.toContain('ещё не выпущен');
  expect(result.current.release).toBeNull();
});

it('does not overlap polling while a previous response is pending', async () => {
  let deliver!: (value: ReturnType<typeof response>) => void;
  request.mockImplementation(() => new Promise(resolve => { deliver = resolve; }));
  const { result } = renderHook(() => useReportExport(context));
  act(() => { poll(); });
  expect(request).toHaveBeenCalledOnce();
  await act(async () => { deliver(response(receipt)); });
  expect(result.current.release?.release_id).toBe(receipt.release_id);
});

it('does not advertise preparation for a different year or quarter', async () => {
  request.mockResolvedValue({ ok: true, json: async () => ({ selected: null, latest: receipt,
    attempt: { status: 'RUNNING', started_at: '2026-09-29T16:00:00Z' } }) });
  const { result } = renderHook(() => useReportExport({ ...context, year: 2027 }));
  await waitFor(() => expect(result.current.status).toContain('ещё не выпущен'));
  expect(result.current.status).not.toContain('Готовится');
});

it('does not present newer assurance as belonging to an already downloaded Word pair', async () => {
  const assurance = {
    contract: 'actionable-assurance-v1', fully_automated: true, user_action_count: 0,
    engine_action_count: 0, active_recommendations: 0, link_status_counts: {}, action_status_counts: {},
    actions: [], meaning: 'Verification is scoped.',
  };
  let selected = { ...receipt, automation_assurance: assurance };
  request.mockImplementation(async (url: string) => url.endsWith('.docx')
    ? { ok: true, blob: async () => new Blob(['docx']) } : response(selected));
  const { result } = renderHook(() => useReportExport(context));
  await waitFor(() => expect(result.current.assurance?.user_action_count).toBe(0));
  await act(() => result.current.download('main'));
  selected = { ...selected, release_id: `REL-${'b'.repeat(64)}`,
    automation_assurance: { ...assurance, user_action_count: 1, fully_automated: false } };
  await act(async () => { poll(); await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(result.current.assurance?.user_action_count).toBe(0);
  expect(result.current.release?.release_id).toBe(receipt.release_id);
});

it('materializes a missing archived pair through the native action with exact date/year/quarter', async () => {
  request.mockImplementation(async (url: string) => {
    if (url === '/api/report-releases/prepare') return response(receipt);
    return response(null);
  });
  const { result } = renderHook(() => useReportExport({ ...context, mode: 'archive' }));
  await waitFor(() => expect(result.current.release?.release_id).toBe(receipt.release_id));
  const prepare = request.mock.calls.find(([url]) => url === '/api/report-releases/prepare');
  expect(prepare?.[1].method).toBe('POST');
  expect(JSON.parse(prepare?.[1].body)).toEqual({ date: context.date, year: 2026, quarter: 3 });
});

it('ignores an archive builder response for a previously selected week', async () => {
  let finish!: (value: ReturnType<typeof response>) => void;
  request.mockImplementation((url: string) => url === '/api/report-releases/prepare'
    ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(response(null)));
  const { result, rerender } = renderHook(({ value }: { value: ExportContext }) => useReportExport(value),
    { initialProps: { value: { ...context, mode: 'archive' } } });
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  rerender({ value: { ...context, date: '2026-10-01', mode: 'live', quarter: 4 } });
  await act(async () => { finish(response(receipt)); });
  expect(result.current.release).toBeNull();
  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
});

it('names the missing archived inputs and does not spin up another build on every poll', async () => {
  const missing = { ok: true, json: async () => ({ selected: null, attempt: null, archive: {
    status: 'NOT_ISSUED', code: 'ARCHIVE_INPUT_INCOMPLETE', message: 'Нужен исходный архив недели.',
    coverage: { departments: 8, rows: 40, missing_sections: ['Архив реестра процедур'] },
  } }) };
  request.mockResolvedValue(missing);
  const { result } = renderHook(() => useReportExport({ ...context, mode: 'archive' }));
  await waitFor(() => expect(result.current.status).toContain('Архив реестра процедур'));
  await act(async () => { poll(); await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(request.mock.calls.filter(([url]) => url === '/api/report-releases/prepare')).toHaveLength(1);
  expect(result.current.status).not.toContain('Готовится');
  expect(result.current.release).toBeNull();
});


it('offers one-click fresh release only in live mode and keeps Word available while starting it', async () => {
  request.mockImplementation(async (url: string) => {
    if (url === '/api/report-releases/refresh') {
      return { ok: true, json: async () => ({ status: 'STARTED',
        message: 'Проверка актуальных данных запущена.' }) };
    }
    return response(receipt);
  });
  const { result } = renderHook(() => useReportExport(context));
  await waitFor(() => expect(result.current.release?.release_id).toBe(receipt.release_id));
  expect(result.current.canRefresh).toBe(true);
  await act(() => result.current.refresh());
  expect(result.current.refreshNotice).toContain('Проверка актуальных данных');
  expect(result.current.release?.release_id).toBe(receipt.release_id);
  expect(request.mock.calls.filter(([url]) => url === '/api/report-releases/refresh')).toHaveLength(1);
});

it('cannot overwrite historical inputs through the live refresh action', async () => {
  request.mockResolvedValue(response(receipt));
  const { result } = renderHook(() => useReportExport({ ...context, mode: 'archive' }));
  await waitFor(() => expect(result.current.release?.release_id).toBe(receipt.release_id));
  expect(result.current.canRefresh).toBe(false);
  await act(() => result.current.refresh());
  expect(request.mock.calls.filter(([url]) => url === '/api/report-releases/refresh')).toHaveLength(0);
});
