// @vitest-environment jsdom
/**
 * Стражи бесшовного обновления.
 *
 * Что здесь защищается:
 *   • числа подтягиваются САМИ, без нажатия и без перезагрузки;
 *   • тихая подмена НЕ трогает признак загрузки — иначе страницы уходят в
 *     заглушки, а вместе с ними пропадают прокрутка и раскрытые карточки;
 *   • фильтры и выбранный год подменой не затрагиваются;
 *   • устаревший ответ не затирает свежие числа;
 *   • пока человек вводит, выделяет или смотрит другое окно — экран под ним
 *     не дёргается: продукт ждёт и говорит, чего ждёт;
 *   • тишина в эфире не вызывает ни одного запроса.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

const getDashboard = vi.hoisted(() => vi.fn());
vi.mock('../api', () => ({
  api: { getDashboard: (...a: unknown[]) => getDashboard(...a) },
  humanizeRequestError: (e: unknown) => String(e),
}));

const liveState = vi.hoisted(() => ({ current: null as unknown }));
const acknowledge = vi.hoisted(() => vi.fn());
vi.mock('./useLiveEvents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useLiveEvents')>();
  return {
    ...actual,
    useLiveEvents: () => liveState.current,
    getLiveState: () => liveState.current,
    acknowledgeLiveEvents: () => acknowledge(),
  };
});

import { useStore } from '../store';
import {
  applySnapshotSilently,
  swapBlocker,
  useSeamlessRefresh,
  SETTLE_MS,
} from './useSeamlessRefresh';

/** Ответ дашборда в объёме, который читает подмена. */
function dashboard(id: string, year: number) {
  return {
    year,
    lastRefreshed: `2026-08-21T0${id.length}:00:00.000Z`,
    snapshot: { id, officialMetrics: {}, spreadsheetId: 'ss' },
  } as never;
}

function setNews(hasNews: boolean) {
  liveState.current = {
    connected: true,
    lastEventAt: hasNews ? '2026-08-21T05:00:00.000Z' : null,
    books: hasNews
      ? [{ book: 'УО', changedRows: 2, addedRows: 0, removedRows: 0, rowsTotal: 512, origin: 'webhook', at: '2026-08-21T05:00:00.000Z' }]
      : [],
    newIssues: 0,
    snapshotRebuilt: false,
    recentRows: [],
    hasNews,
    acknowledge,
  };
}

beforeEach(() => {
  getDashboard.mockReset();
  acknowledge.mockClear();
  useStore.setState({ loading: false, year: 2026, dashboardData: null });
  document.body.innerHTML = '';
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('когда подменять числа нельзя', () => {
  it('поле ввода в фокусе — помеха названа, а не проигнорирована', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    expect(swapBlocker(document, window, false)).toBe('ввод');
  });

  it('открытое окно — тоже помеха: там своя работа', () => {
    const modal = document.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    document.body.appendChild(modal);
    expect(swapBlocker(document, window, false)).toBe('диалог');
  });

  it('идёт обычная загрузка — тихая подмена в неё не лезет', () => {
    expect(swapBlocker(document, window, true)).toBe('идёт-загрузка');
  });

  it('ничего не мешает — помехи нет', () => {
    expect(swapBlocker(document, window, false)).toBeNull();
  });
});

describe('подмена снимка', () => {
  it('не трогает признак загрузки: заглушки не появляются, место не теряется', () => {
    useStore.setState({ loading: false, year: 2026 });
    const applied = applySnapshotSilently(dashboard('snap-1', 2026), 2026);

    expect(applied).toBe(true);
    expect(useStore.getState().loading).toBe(false);
    expect(useStore.getState().dashboardData).not.toBeNull();
  });

  it('не трогает выбранные фильтры и год', () => {
    const methods = new Set(['ЭА']);
    useStore.setState({ loading: false, year: 2026, selectedMethods: methods, searchQuery: 'кровля' });
    applySnapshotSilently(dashboard('snap-2', 2026), 2026);

    expect(useStore.getState().selectedMethods).toBe(methods);
    expect(useStore.getState().searchQuery).toBe('кровля');
    expect(useStore.getState().year).toBe(2026);
  });

  it('устаревший ответ выбрасывается: пока он ехал, человек сменил год', () => {
    useStore.setState({ loading: false, year: 2025, dashboardData: null });
    const applied = applySnapshotSilently(dashboard('snap-3', 2026), 2026);

    expect(applied).toBe(false);
    expect(useStore.getState().dashboardData).toBeNull();
  });

  it('идёт обычная загрузка — подмена уступает ей дорогу', () => {
    useStore.setState({ loading: true, year: 2026, dashboardData: null });
    expect(applySnapshotSilently(dashboard('snap-4', 2026), 2026)).toBe(false);
  });
});

describe('хук бесшовного обновления', () => {
  it('stops retrying a failed event after three retries without starting periodic refresh', async () => {
    getDashboard.mockRejectedValue(new Error('temporary outage'));
    setNews(true);
    vi.useFakeTimers();
    const view = renderHook(() => useSeamlessRefresh(true));
    await act(async () => { await vi.advanceTimersByTimeAsync(SETTLE_MS + 1); });
    for (const delay of [1_001, 3_001, 10_001, 120_000]) {
      await act(async () => { await vi.advanceTimersByTimeAsync(delay); });
    }
    expect(getDashboard).toHaveBeenCalledTimes(4);
    expect(view.result.current.failed).toBe(true);
  });
  it('событие пришло — числа подтягиваются сами, без нажатия', async () => {
    getDashboard.mockResolvedValue(dashboard('snap-live', 2026));
    setNews(true);
    vi.useFakeTimers();

    renderHook(() => useSeamlessRefresh(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SETTLE_MS + 50);
    });
    vi.useRealTimers();

    await waitFor(() => expect(getDashboard).toHaveBeenCalledTimes(1));
    // Сервер уже перечитал источники по уведомлению — второй раз не просим.
    expect(getDashboard).toHaveBeenCalledWith(false, 2026);
    expect(useStore.getState().loading).toBe(false);
    expect(useStore.getState().dashboardData).not.toBeNull();
    expect(acknowledge).toHaveBeenCalled();
  });

  it('в эфире тишина — ни одного запроса', async () => {
    setNews(false);
    vi.useFakeTimers();

    renderHook(() => useSeamlessRefresh(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SETTLE_MS * 3);
    });
    vi.useRealTimers();

    expect(getDashboard).not.toHaveBeenCalled();
  });

  it('человек вводит — экран под ним не дёргается, продукт ждёт и объясняет', async () => {
    getDashboard.mockResolvedValue(dashboard('snap-wait', 2026));
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    setNews(true);
    vi.useFakeTimers();

    const { result } = renderHook(() => useSeamlessRefresh(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SETTLE_MS + 50);
    });
    vi.useRealTimers();

    expect(getDashboard).not.toHaveBeenCalled();
    expect(result.current.waitingBecause).toBe('ввод');
  });

  it('обновление не удалось — числа на экране прежние, и об этом сказано', async () => {
    getDashboard.mockRejectedValue(new Error('нет связи'));
    setNews(true);
    vi.useFakeTimers();

    const { result } = renderHook(() => useSeamlessRefresh(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SETTLE_MS + 50);
    });
    vi.useRealTimers();

    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(useStore.getState().dashboardData).toBeNull();
    expect(useStore.getState().loading).toBe(false);
  });
});


it('тихое принятие снимка обновляет общий счёт навигации и состояния без отдельного контура', () => {
  const fetchBucketCounts = vi.fn(async () => undefined);
  const original = useStore.getState().fetchBucketCounts;
  useStore.setState({ loading: false, year: 2026, fetchBucketCounts });
  try {
    expect(applySnapshotSilently(dashboard('webhook-read', 2026), 2026)).toBe(true);
    expect(fetchBucketCounts).toHaveBeenCalledTimes(1);
    expect(useStore.getState().loading).toBe(false);
  } finally { useStore.setState({ fetchBucketCounts: original }); }
});

it('поздний тихий ответ не заменяет уже принятый обычный снимок того же года', async () => {
  let resolve!: (data: ReturnType<typeof dashboard>) => void;
  getDashboard.mockReturnValueOnce(new Promise(r => { resolve = r; })).mockResolvedValueOnce(dashboard('regular-new', 2026));
  setNews(true); vi.useFakeTimers();
  renderHook(() => useSeamlessRefresh(true));
  await act(async () => { await vi.advanceTimersByTimeAsync(SETTLE_MS + 1); });
  await act(async () => { await useStore.getState().fetchDashboard(); });
  await act(async () => { resolve(dashboard('silent-old', 2026)); });
  expect(useStore.getState().dashboardData?.snapshot.id).toBe('regular-new');
  expect(acknowledge).not.toHaveBeenCalled();
});

it('новое событие во время чтения не гасится подтверждением прежнего события', async () => {
  let resolve!: (data: ReturnType<typeof dashboard>) => void;
  getDashboard.mockReturnValueOnce(new Promise(r => { resolve = r; }));
  setNews(true); vi.useFakeTimers();
  const { result, rerender } = renderHook(() => useSeamlessRefresh(true));
  await act(async () => { await vi.advanceTimersByTimeAsync(SETTLE_MS + 1); });
  act(() => {
    liveState.current = { ...(liveState.current as Record<string, unknown>), lastEventAt: '2026-08-21T05:01:00.000Z' };
    rerender();
  });
  await act(async () => { resolve(dashboard('silent-read', 2026)); });
  expect(acknowledge).not.toHaveBeenCalled();
  expect(result.current.waitingBecause).not.toBeNull();
});

it('не гасит разные события с одинаковым временем, пришедшие во время чтения', async () => {
  let resolve!: (data: ReturnType<typeof dashboard>) => void;
  getDashboard.mockReturnValueOnce(new Promise(r => { resolve = r; }));
  setNews(true); vi.useFakeTimers();
  const { rerender } = renderHook(() => useSeamlessRefresh(true));
  await act(async () => { await vi.advanceTimersByTimeAsync(SETTLE_MS + 1); });
  act(() => { liveState.current = { ...(liveState.current as Record<string, unknown>), newIssues: 1 }; rerender(); });
  await act(async () => { resolve(dashboard('same-event-time', 2026)); });
  expect(acknowledge).not.toHaveBeenCalled();
});


it.each(['refreshing', 'stale'] as const)('does not acknowledge a source update while the returned read model is %s', async (state) => {
  const data = { year: 2026, lastRefreshed: '2026-10-16T01:00:00Z', snapshot: {
    id: 'previous-materialized', officialMetrics: {}, spreadsheetId: 'ss', metadata: { readModel: { state } },
  } };
  getDashboard.mockResolvedValue(data);
  setNews(true); vi.useFakeTimers();
  renderHook(() => useSeamlessRefresh(true));
  await act(async () => { await vi.advanceTimersByTimeAsync(SETTLE_MS + 1); });
  expect(acknowledge).not.toHaveBeenCalled();
  expect(useStore.getState().dashboardData?.snapshot.id).toBe('previous-materialized');
  await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
  expect(getDashboard).toHaveBeenCalledTimes(1);
});


it('catches up once when materialization finishes before an older refreshing HTTP response arrives', async () => {
  let resolve!: (value: unknown) => void;
  getDashboard.mockReturnValueOnce(new Promise(yes => { resolve = yes; })).mockResolvedValue(dashboard('completed', 2026));
  setNews(true); vi.useFakeTimers();
  const view = renderHook(() => useSeamlessRefresh(true));
  await act(async () => { await vi.advanceTimersByTimeAsync(SETTLE_MS + 1); });
  act(() => { liveState.current = { ...(liveState.current as Record<string, unknown>), lastEventAt: '2026-08-21T05:00:01.000Z' }; view.rerender(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(SETTLE_MS + 1); });
  await act(async () => { resolve({ year: 2026, snapshot: { id: 'previous', metadata: { readModel: { state: 'refreshing' } } } }); });
  expect(acknowledge).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(2_001); });
  expect(getDashboard).toHaveBeenCalledTimes(2);
  expect(useStore.getState().dashboardData?.snapshot.id).toBe('completed');
  expect(acknowledge).toHaveBeenCalledOnce();
});
