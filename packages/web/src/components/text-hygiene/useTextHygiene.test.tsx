// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { DashboardData } from '@aemr/shared';
import { useStore } from '../../store';
import { useTextHygiene } from './useTextHygiene';

const fetchJSON = vi.hoisted(() => vi.fn());
vi.mock('../../api', () => ({ fetchJSON, humanizeRequestError: (error: unknown) => String(error) }));

const dashboard = (id: string) => ({ snapshot: { id } }) as DashboardData;
const response = (asOf: string) => ({ asOf, byDept: [], language: [] });

beforeEach(() => {
  fetchJSON.mockReset();
  useStore.setState({ dashboardData: dashboard('before') });
});
afterEach(cleanup);

describe('перечитывание открытого раздела гигиены', () => {
  it('заменяет прежний ответ после принятия нового общего снимка без нового чтения Google', async () => {
    fetchJSON.mockResolvedValueOnce(response('before')).mockResolvedValueOnce(response('after'));
    const { result } = renderHook(() => useTextHygiene());
    await waitFor(() => expect(result.current.data?.asOf).toBe('before'));
    act(() => useStore.setState({ dashboardData: dashboard('after') }));
    await waitFor(() => expect(result.current.data?.asOf).toBe('after'));
    expect(fetchJSON.mock.calls.map((call) => call[0])).toEqual(['/text-hygiene', '/text-hygiene']);
  });

  it('после ручного чтения новый снимок не запускает ещё одно полное чтение источников', async () => {
    fetchJSON
      .mockResolvedValueOnce(response('before'))
      .mockResolvedValueOnce(response('manual'))
      .mockResolvedValueOnce(response('after'));
    const { result } = renderHook(() => useTextHygiene());
    await waitFor(() => expect(result.current.data?.asOf).toBe('before'));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.data?.asOf).toBe('manual'));
    act(() => useStore.setState({ dashboardData: dashboard('after') }));
    await waitFor(() => expect(result.current.data?.asOf).toBe('after'));
    expect(fetchJSON.mock.calls.map((call) => call[0])).toEqual([
      '/text-hygiene',
      '/text-hygiene?refresh=true',
      '/text-hygiene',
    ]);
  });
  it('поздний ответ прежнего снимка не заменяет уже принятый новый', async () => {
    let finishOld!: (value: ReturnType<typeof response>) => void;
    fetchJSON
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishOld = resolve;
        }),
      )
      .mockResolvedValueOnce(response('after'));
    const { result } = renderHook(() => useTextHygiene());
    act(() => useStore.setState({ dashboardData: dashboard('after') }));
    await waitFor(() => expect(result.current.data?.asOf).toBe('after'));
    await act(async () => finishOld(response('before')));
    expect(result.current.data?.asOf).toBe('after');
  });
});
