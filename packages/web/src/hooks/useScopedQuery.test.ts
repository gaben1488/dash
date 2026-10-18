// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useScopedQuery } from './useScopedQuery';

afterEach(() => { cleanup(); vi.useRealTimers(); });
it('does not start a live fallback while the required dataset is absent', async () => {
  const load = vi.fn(async () => 'ready');
  const { rerender, result } = renderHook(({ key }) => useScopedQuery(key, load), { initialProps: { key: '' } });
  await act(async () => {});
  expect(load).not.toHaveBeenCalled();
  rerender({ key: 'accepted-snapshot' });
  await act(async () => {});
  expect(result.current.data).toBe('ready');
});
it('aborts an old scope and rejects its late result while keeping the newer result', async () => {
  const pending = new Map<string, { signal: AbortSignal; resolve: (value: string) => void }>();
  const { result, rerender, unmount } = renderHook(({ scope }) => useScopedQuery(scope, signal =>
    new Promise<string>(resolve => { pending.set(scope, { signal, resolve }); })), { initialProps: { scope: 'old' } });
  await act(async () => {});
  rerender({ scope: 'new' });
  await act(async () => {});
  expect(pending.get('old')!.signal.aborted).toBe(true);
  expect(result.current.data).toBeUndefined();
  await act(async () => pending.get('new')!.resolve('new-data'));
  await act(async () => pending.get('old')!.resolve('old-data'));
  expect(result.current.data).toBe('new-data');
  unmount();
  expect(pending.get('new')!.signal.aborted).toBe(true);
});

it('finishes a hanging read with an explicit error and permits a bounded retry', async () => {
  vi.useFakeTimers();
  const loader = vi.fn<(_: AbortSignal) => Promise<string>>().mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue('retried');
  const { result } = renderHook(() => useScopedQuery('same', loader));
  await act(async () => {});
  await act(async () => vi.advanceTimersByTime(35_000));
  expect(result.current.loading).toBe(false);
  expect(result.current.error).toContain('вовремя');
  await act(async () => result.current.retry());
  expect(result.current.data).toBe('retried');
  expect(loader).toHaveBeenCalledTimes(2);
});
