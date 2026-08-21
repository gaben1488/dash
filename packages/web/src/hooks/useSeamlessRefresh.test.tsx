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
