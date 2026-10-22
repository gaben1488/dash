// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { fetchJSON } from '../../api';
import { useIntegrity } from './useExtraSignals';

vi.mock('../../api', () => ({
  fetchJSON: vi.fn(),
  humanizeRequestError: (error: unknown) => String(error),
}));

afterEach(() => {
  cleanup();
  vi.mocked(fetchJSON).mockReset();
});

it('initial Control visit reads actual Google sources; SSE is debounced and cache-only', async () => {
  vi.mocked(fetchJSON).mockResolvedValue({} as never);
  const { result } = renderHook(() => useIntegrity());
  await waitFor(() => expect(fetchJSON).toHaveBeenCalledTimes(1));
  // No webhook was delivered; the first visit still starts an independent source read.
  expect(fetchJSON).toHaveBeenLastCalledWith('/integrity?refresh=true');

  act(() => {
    window.dispatchEvent(new Event('department-books-updated'));
    window.dispatchEvent(new Event('department-books-updated'));
  });
  await waitFor(() => expect(fetchJSON).toHaveBeenCalledTimes(2), { timeout: 2500 });
  expect(fetchJSON).toHaveBeenLastCalledWith('/integrity');

  act(() => result.current.reload());
  await waitFor(() => expect(fetchJSON).toHaveBeenCalledTimes(3));
  expect(fetchJSON).toHaveBeenLastCalledWith('/integrity?refresh=true');

  act(() => window.dispatchEvent(new Event('department-books-updated')));
  await waitFor(() => expect(fetchJSON).toHaveBeenCalledTimes(4), { timeout: 2500 });
  expect(fetchJSON).toHaveBeenLastCalledWith('/integrity');
});
