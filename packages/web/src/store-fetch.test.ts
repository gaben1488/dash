/**
 * Стражи багов #6, #11, #12 (реестр охоты 08.08) — пути загрузки дашборда.
 *
 * #6: булев страж `if (loading) return` молча выбрасывал смену года во время
 *     загрузки. Канон: новый запрос ПОБЕЖДАЕТ — применяется только ответ
 *     последнего запроса, устаревший ответ (и устаревшая ошибка) игнорируются.
 * #11: dataYear пишется во ВСЕХ путях загрузки (fetchDashboard/refresh/quickRefresh).
 * #12: quickRefresh обновляет провенанс официальных метрик (setOfficialProvenance).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({
  api: {
    getDashboard: vi.fn(),
    refresh: vi.fn(),
  },
  humanizeRequestError: (err: unknown) => String(err),
}));
vi.mock('./lib/provenance-registry', () => ({
  setOfficialProvenance: vi.fn(),
}));

import { useStore } from './store';
import { api } from './api';
import { setOfficialProvenance } from './lib/provenance-registry';

const getDashboard = api.getDashboard as ReturnType<typeof vi.fn>;
const refreshApi = api.refresh as ReturnType<typeof vi.fn>;
const provenance = setOfficialProvenance as ReturnType<typeof vi.fn>;

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function makeData(year: number, id = `snap-${year}`) {
  return {
    snapshot: { id, officialMetrics: { 'k': { numericValue: 1 } }, spreadsheetId: 'sheet-1' },
    year,
    lastRefreshed: `${year}-01-01T00:00:00Z`,
    departmentSummaries: [],
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState({ dashboardData: null, loading: false, error: null, dataYear: 0 });
});

describe('fetchDashboard — гонка запросов (баг #6)', () => {
  it('смена года во время загрузки НЕ выбрасывается: побеждает последний запрос', async () => {
    const first = deferred<any>();
    const second = deferred<any>();
    getDashboard.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    useStore.setState({ year: 2025 });
    const p1 = useStore.getState().fetchDashboard();
    // Пользователь щёлкает другой год, пока первый запрос висит.
    useStore.setState({ year: 2026 });
    const p2 = useStore.getState().fetchDashboard();

    // Второй запрос ушёл на сервер (раньше здесь был `if (loading) return`).
    expect(getDashboard).toHaveBeenCalledTimes(2);

    second.resolve(makeData(2026));
    await p2;
    expect(useStore.getState().dataYear).toBe(2026);
    expect(useStore.getState().loading).toBe(false);

    // Устаревший ответ первого запроса приходит ПОЗЖЕ — и не затирает свежие данные.
    first.resolve(makeData(2025));
    await p1;
    expect(useStore.getState().dataYear).toBe(2026);
    expect((useStore.getState().dashboardData as any)?.year).toBe(2026);
  });

  it('устаревшая ОШИБКА не затирает свежие данные и не включает плашку', async () => {
    const first = deferred<any>();
    const second = deferred<any>();
    getDashboard.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const p1 = useStore.getState().fetchDashboard();
    const p2 = useStore.getState().fetchDashboard();

    second.resolve(makeData(2026));
    await p2;
    first.reject(new Error('сеть упала'));
    await p1;

    expect(useStore.getState().error).toBeNull();
    expect(useStore.getState().dataYear).toBe(2026);
  });
});

describe('refresh / quickRefresh — dataYear и провенанс (баги #11, #12)', () => {
  it('refresh пишет dataYear из ответа', async () => {
    refreshApi.mockResolvedValue({ sources: [] });
    getDashboard.mockResolvedValue(makeData(2025));
    await useStore.getState().refresh();
    expect(useStore.getState().dataYear).toBe(2025);
  });

  it('quickRefresh пишет dataYear из ответа', async () => {
    refreshApi.mockResolvedValue({ sources: [] });
    getDashboard.mockResolvedValue(makeData(2025));
    await useStore.getState().quickRefresh();
    expect(useStore.getState().dataYear).toBe(2025);
  });

  it('quickRefresh обновляет провенанс официальных метрик (баг #12)', async () => {
    refreshApi.mockResolvedValue({ sources: [] });
    const data = makeData(2026);
    getDashboard.mockResolvedValue(data);
    await useStore.getState().quickRefresh();
    expect(provenance).toHaveBeenCalledWith(data.snapshot.officialMetrics, 'sheet-1');
  });
});
