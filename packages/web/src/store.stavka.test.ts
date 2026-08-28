/**
 * Стражи режима счёта «ставка снижения» (канон п.144, интервью 22.08.2026).
 *
 * Класс, который сторожится: ставка — РЕЖИМ СЧЁТА, как тыс/млн, а не отбор
 * строк. Умолчание — норматив 8 % (им посчитаны формулы книг); живое положение
 * включается только рукой читателя; «Сбросить фильтры» возвращает умолчание и
 * считает изменённое положение в счётчик кнопки — молчание на умолчании.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildStavkaSumsLine, getActiveFilterCount, useStore } from './store';
import { ingestLiveEvent } from './hooks/useLiveEvents';
import { fetchMonitoringAnalytics } from './lib/monitoring/analytics-contract';

vi.mock('./lib/monitoring/analytics-contract', () => ({
  fetchMonitoringAnalytics: vi.fn(),
}));

const fetchMock = vi.mocked(fetchMonitoringAnalytics);

/** Ответ роута аналитики с заданным коэффициентом (null = замера нет). */
const payloadWith = (portfolioPct: number | null) => ({
  analytics: {
    reduction: {
      portfolioPct,
      reducedQ1Pct: 5.1,
      reducedQ3Pct: 12.4,
      portfolio: { count: 34 },
    },
  },
  source: { readAt: '2026-08-18T00:00:00.000Z' },
}) as any;

describe('ставка снижения — режим счёта в хранилище', () => {
  it('умолчание — норматив (norm), живой замер не выдуман (null)', () => {
    useStore.getState().resetAllFilters();
    expect(useStore.getState().stavkaMode).toBe('norm');
    expect(useStore.getState().liveStavka).toBeNull();
  });

  it('setStavkaMode переключает положение, resetAllFilters возвращает норматив', () => {
    useStore.getState().resetAllFilters();
    useStore.getState().setStavkaMode('live');
    expect(useStore.getState().stavkaMode).toBe('live');
    useStore.getState().resetAllFilters();
    expect(useStore.getState().stavkaMode).toBe('norm');
  });

  it('переключение ставки не трогает отбор строк (способ/вид/бюджет/период)', () => {
    useStore.getState().resetAllFilters();
    useStore.getState().setStavkaMode('live');
    const st = useStore.getState();
    expect(st.selectedMethods.size).toBe(0);
    expect(st.selectedActivities.size).toBe(0);
    expect(st.selectedBudgets.size).toBe(0);
    expect(st.periodMode).toBe('week');
    expect(st.activeMonths.size).toBe(0);
  });
});

describe('ставка в счётчике активных фильтров', () => {
  const baseInput = () => ({
    yearChanged: false,
    moneyUnitChanged: false,
    selectedMethods: new Set<string>(),
    selectedActivities: new Set<string>(),
    selectedBudgets: new Set<string>(),
    selectedDepartments: new Set<string>(),
    selectedSubordinates: new Set<string>(),
    activeMonths: new Set<number>(),
    monthsByYear: {},
    periodMode: 'week' as const,
    searchQuery: '',
  });

  it('умолчание (поле не передано либо false) не считается', () => {
    expect(getActiveFilterCount(baseInput())).toBe(0);
    expect(getActiveFilterCount({ ...baseInput(), stavkaChanged: false })).toBe(0);
  });

  it('живое положение считается одним изменением', () => {
    expect(getActiveFilterCount({ ...baseInput(), stavkaChanged: true })).toBe(1);
  });
});

describe('живой замер — три исхода и события эфира (пп.5–6 канона пульс-2)', () => {
  beforeEach(() => {
    useStore.setState({ liveStavka: null, liveStavkaAbsent: false });
    fetchMock.mockReset();
  });

  it('успех: замер сохранён, отсутствие не выдумано', async () => {
    fetchMock.mockResolvedValue(payloadWith(9.79));
    await useStore.getState().fetchLiveStavka();
    const st = useStore.getState();
    expect(st.liveStavka?.pct).toBe(9.79);
    expect(st.liveStavka?.count).toBe(34);
    expect(st.liveStavkaAbsent).toBe(false);
  });

  it('полученный замер без события эфира не перезапрашивается', async () => {
    fetchMock.mockResolvedValue(payloadWith(9.79));
    await useStore.getState().fetchLiveStavka();
    await useStore.getState().fetchLiveStavka();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('«замера нет» (portfolioPct null) — отдельный исход, не «ещё не получен», и тоже без повторных запросов', async () => {
    fetchMock.mockResolvedValue(payloadWith(null));
    await useStore.getState().fetchLiveStavka();
    const st = useStore.getState();
    // Отсутствие замера — знание, а не ожидание: оно хранится своим полем…
    expect(st.liveStavka).toBeNull();
    expect(st.liveStavkaAbsent).toBe(true);
    // …и не перезапрашивается, пока эфир не скажет, что книга изменилась.
    await useStore.getState().fetchLiveStavka();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('invalidateLiveStavka сбрасывает оба исхода — следующий вызов перезапрашивает', async () => {
    fetchMock.mockResolvedValue(payloadWith(null));
    await useStore.getState().fetchLiveStavka();
    expect(useStore.getState().liveStavkaAbsent).toBe(true);
    useStore.getState().invalidateLiveStavka();
    expect(useStore.getState().liveStavkaAbsent).toBe(false);
    fetchMock.mockResolvedValue(payloadWith(8.5));
    await useStore.getState().fetchLiveStavka();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(useStore.getState().liveStavka?.pct).toBe(8.5);
  });

  it('событие monitoring-updated из эфира сбрасывает замер (инвалидация по событию, не по таймеру)', () => {
    useStore.setState({
      liveStavka: { pct: 9.79, q1: null, q3: null, count: 34, readAt: null },
      liveStavkaAbsent: false,
    });
    ingestLiveEvent({ kind: 'monitoring-updated', sheets: ['Лист1'], version: 2 });
    expect(useStore.getState().liveStavka).toBeNull();
    expect(useStore.getState().liveStavkaAbsent).toBe(false);
  });

  it('чужое событие эфира замер не трогает', () => {
    useStore.setState({
      liveStavka: { pct: 9.79, q1: null, q3: null, count: 34, readAt: null },
    });
    ingestLiveEvent({ kind: 'snapshot-rebuilt', at: '2026-08-29T00:00:00.000Z' });
    expect(useStore.getState().liveStavka?.pct).toBe(9.79);
  });
});

describe('паспорт разницы ставок (buildStavkaSumsLine — общий для барабана и жетона)', () => {
  const fm = (v: number) => `${v} тыс. ₽`;

  it('план не загружен — сумм нет, обещаний тоже', () => {
    expect(buildStavkaSumsLine(0, 9.79, fm)).toContain('План года ещё не загружен');
  });

  it('замера нет — только норматив, без выдуманной живой суммы', () => {
    const line = buildStavkaSumsLine(1000, null, fm);
    expect(line).toContain('по нормативу 8 % — 80 тыс. ₽');
    expect(line).toContain('живого коэффициента нет');
  });

  it('живая ставка выше норматива — разница в рублях со словом «больше»', () => {
    const line = buildStavkaSumsLine(1000, 10, fm);
    expect(line).toContain('по нормативу 8 % — 80 тыс. ₽');
    expect(line).toContain('по живой ставке 10,00 % — 100 тыс. ₽');
    expect(line).toContain('на 20 тыс. ₽ больше норматива');
  });

  it('ниже норматива — «меньше»', () => {
    expect(buildStavkaSumsLine(1000, 7, fm)).toContain('на 10 тыс. ₽ меньше норматива');
  });

  it('|разница| меньше копейки — «совпадает с нормативом», а не «на 0 ₽ больше»', () => {
    const line = buildStavkaSumsLine(1000, 8, fm);
    expect(line).toContain('совпадает с нормативом');
    expect(line).not.toContain('больше норматива');
  });
});
