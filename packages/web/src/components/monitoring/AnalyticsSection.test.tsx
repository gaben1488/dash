// @vitest-environment jsdom
/**
 * Стражи секции «Аналитика мониторинга».
 *
 * Проверяются обещания секции, а не её оформление:
 *   1) семь блоков собираются из ответа сервера, и три коэффициента снижения
 *      показаны РЯДОМ, разными числами — ни один не выступает от имени
 *      остальных;
 *   2) у каждого блока стоят плашка периода и методика словами;
 *   3) три пустоты различимы: «аналитика не посчитана» (отказ), «в срезе нет
 *      строк для блока» (пустой знаменатель) и «сверка не поднята»;
 *   4) без строк реестра деньги воронки и разрез по способу честно молчат, а
 *      не показывают нули.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

// jsdom не знает ResizeObserver, на котором стоит адаптивный контейнер
// recharts. Заглушка ничего не измеряет: графики проверяются текстовым дублём.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

const fetchJSON = vi.fn();
vi.mock('../../api', () => ({
  fetchJSON: (url: string) => fetchJSON(url),
  humanizeRequestError: (e: unknown) => String((e as Error)?.message ?? e),
}));

const { MonitoringAnalyticsSection } = await import('./AnalyticsSection');

const analyticsResponse = {
  source: {
    bookName: 'Ежедневный мониторинг',
    readAt: '2026-08-18T07:00:00Z',
    moneyUnit: 'руб',
    sheetsRead: ['1. УЭР'],
    sheetsFailed: {},
  },
  analytics: {
    funnel: {
      total: 100,
      steps: [
        { key: 'application', label: 'Заявка поступила в уполномоченный орган', count: 80, conversionPct: null, note: null },
        { key: 'priced', label: 'Есть цена победителя', count: 40, conversionPct: 50, note: null },
      ],
      reachedPriced: 40,
      reachedPricedPct: 40,
    },
    reduction: {
      portfolioPct: 9.74,
      portfolio: { count: 351, nmckRub: 1_200_000_000, priceRub: 1_083_000_000, savingsRub: 117_000_000 },
      rowMeanPct: 15.84, rowMedianPct: 0.5, rowCount: 351,
      reducedMeanPct: 29.1, reducedMedianPct: 26.34, reducedQ1Pct: 12, reducedQ3Pct: 41, reducedCount: 191,
      equalPriceCount: 160, equalPriceSharePct: 45.6,
    },
    histogram: [
      { key: 'zero', label: 'ровно 0 %', fromPct: 0, toPct: 0, count: 160, nmckRub: 100, priceRub: 100 },
      { key: '25-50', label: 'от 25 до 50 %', fromPct: 25, toPct: 50, count: 40, nmckRub: 200, priceRub: 120 },
    ],
    suppliers: {
      suppliers: [
        { key: '1', inn: '1234567890', name: 'ООО «Крупный»', wins: 3, moneyRub: 900, depts: ['УО'], customers: ['МКУ «Заказчик»'] },
      ],
      uniqueCount: 191, totalWins: 351, totalMoneyRub: 1000,
      singleWinCount: 128, singleWinSharePct: 67,
      concentration: { top5WinsPct: 13.5, top10WinsPct: 22.2, top5MoneyPct: 29.1, top10MoneyPct: 49 },
      winsWithoutInn: 12,
    },
    pairs: [
      { supplierKey: '1', supplierName: 'Кузьмина А. А.', inn: null, customer: 'УИО', wins: 11, moneyRub: 40_000_000, subjects: ['Приобретение квартиры'] },
    ],
    durations: [
      {
        key: 'total', label: 'Заявка → торги (весь путь)', count: 300,
        medianDays: 17, meanDays: 21, minDays: -12, maxDays: 90, q1Days: 12, q3Days: 25,
        negativeCount: 12,
        outliers: [{ sheet: '5. УДТХиРКИ', row: 34, code: 'ЭА52-26', days: -12, reason: 'negative' }],
      },
    ],
    seasonality: {
      basis: 'publication',
      months: [{ period: '2026-03', count: 12, nmckRub: 10_000_000, priceRub: 9_000_000 }],
      quarters: [],
      undated: 7,
    },
    nmckBuckets: [{ key: 'до100к', label: 'до 100 тыс. руб.', count: 30, nmckRub: 2_000_000, reductionPct: 12 }],
    depts: [{
      dept: 'УО', sheet: '8. УО', count: 108, nmckRub: 500_000_000, priceRub: 450_000_000,
      savingsBookRub: 50_000_000, reductionPct: 10, withReductionSharePct: 60,
      noResultSharePct: 5, medianTotalDays: 17, controlErrorSharePct: 1, splitMissingSharePct: 2,
    }],
    unsuccessful: {
      count: 21, sharePct: 5.6, nmckRub: 30_000_000,
      byDept: [{ dept: 'УО', count: 10, nmckRub: 20_000_000 }],
      outcomes: [{ text: 'Не состоялся (0 заявок)', count: 15 }],
    },
    anomalies: [{
      kind: 'deep-reduction',
      title: 'Снижение свыше 50 %',
      mechanism: 'Цена на торгах упала больше чем вдвое: либо начальная цена посчитана с запасом, либо участник пошёл в глубокий демпинг.',
      action: 'Посмотреть предмет и число участников.',
      count: 2,
      refs: [{ sheet: '8. УО', row: 100, code: 'ЭА1-26', note: 'Снижение 62,0 % от начальной цены.' }],
    }],
  },
  notes: ['Деньги книги мониторинга — в рублях.'],
};

const matchResponse = {
  source: { readAt: '2026-08-18T07:00:00Z' },
  books: { read: ['УО'], rowsWithCode: 300 },
  summary: {
    bookRowsWithCode: 300, proceduresWithCode: 380, matched: 1, bookOnly: 1, monitoringOnly: 0,
    ambiguousAcrossBooks: 1, ambiguousSameBook: 0, listCells: 0, coveragePct: 87.4,
    nmckAgree: 1, nmckDisagree: 0, nmckNoComparison: 0,
    factAgree: 0, factDisagree: 1, factNoComparison: 0,
  },
  matched: [{
    code: 'ЭА1-26',
    bookRow: { rowKey: 'УО:214', book: 'УО' },
    primary: { procKey: '8. УО:100', sheet: '8. УО' },
    nmck: { bookRub: 1_000_000, monitoringRub: 1_000_000, deltaRub: 0, relDiff: 0, agrees: true },
    fact: { bookRub: 900_000, monitoringRub: 800_000, deltaRub: 100_000, relDiff: 0.111, agrees: false },
  }],
  bookOnly: [{ code: 'ЭА9-26', bookRow: { rowKey: 'УО:301' } }],
  monitoringOnly: [],
  ambiguous: [],
  listCells: [],
  internal: { codesOnSheets: 380, codesInJournal: 53, codesInBoth: 50, rows: [], counts: {} },
  notes: [],
};

function route(url: string): unknown {
  if (url.startsWith('/monitoring/analytics')) return analyticsResponse;
  if (url === '/monitoring/match') return matchResponse;
  throw new Error(`неожиданный запрос: ${url}`);
}

beforeEach(() => {
  fetchJSON.mockImplementation((url: string) => Promise.resolve(route(url)));
});

afterEach(() => {
  cleanup();
  fetchJSON.mockReset();
});

describe('секция аналитики мониторинга', () => {
  it('собирает семь блоков и показывает три коэффициента снижения рядом', async () => {
    render(<MonitoringAnalyticsSection />);

    await screen.findByText(/Аналитика мониторинга/);

    // Три коэффициента — три плитки с разными числами и своими знаменателями.
    expect(await screen.findByText('Портфельный')).toBeTruthy();
    expect(screen.getByText('Средний построчный')).toBeTruthy();
    expect(screen.getByText('Средний там, где снижение было')).toBeTruthy();
    expect(screen.getByText('9,7 %')).toBeTruthy();
    expect(screen.getByText('15,8 %')).toBeTruthy();
    expect(screen.getByText('29,1 %')).toBeTruthy();
    // Знаменатели названы у каждого коэффициента: у портфельного и построчного
    // он один и тот же, у третьего — свой, и это видно глазами.
    expect(screen.getAllByText(/по 351 состоявшейся процедуре/)).toHaveLength(2);
    expect(screen.getByText(/по 191 процедуре со снижением/)).toBeTruthy();

    // Остальные шесть блоков на месте — по их ярлыкам.
    for (const kicker of [
      'Воронка стадий', 'Снижение на торгах', 'Поставщики-победители',
      'Повторяемость связок', 'Сроки этапов', 'Сезонность',
      'Сравнение управлений', 'Несостоявшиеся и аномалии',
      'Сверка с книгами управлений',
    ]) {
      expect(screen.getAllByText(kicker).length).toBeGreaterThan(0);
    }
  });

  it('у каждого блока стоят методика словами и плашка периода данных', async () => {
    render(<MonitoringAnalyticsSection />);
    const methods = await screen.findAllByText(/Как посчитано:/);
    expect(methods.length).toBeGreaterThanOrEqual(9);
    const badges = screen.getAllByText(/данные книги на/);
    expect(badges.length).toBeGreaterThanOrEqual(9);
  });

  it('строки без даты и находки с адресами объявляются вслух', async () => {
    render(<MonitoringAnalyticsSection />);
    expect(await screen.findByText(/7 процедур без выбранной даты/)).toBeTruthy();
    expect(screen.getByText(/у 12 строк длительность этапа отрицательна/)).toBeTruthy();
    expect(screen.getByText('Снижение свыше 50 %')).toBeTruthy();
  });

  it('расхождение сумм показывает обе стороны и не выбирает правую', async () => {
    render(<MonitoringAnalyticsSection />);
    expect(await screen.findByText(/книга УО:214 · мониторинг 8. УО:100/)).toBeTruthy();
    expect(screen.getByText(/Какая из двух записей верна, продукт не решает/)).toBeTruthy();
  });

  it('без строк реестра деньги воронки и разрез по способу честно молчат', async () => {
    render(<MonitoringAnalyticsSection />);
    expect((await screen.findAllByText(/суммы этой ступени показываются вместе с реестром/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/Разрез по способу считается из строк реестра/)).toBeTruthy();
  });

  it('отказ аналитики — отдельная пустота с причиной и действием', async () => {
    fetchJSON.mockImplementation((url: string) => (
      url.startsWith('/monitoring/analytics')
        ? Promise.reject(new Error('сервер данных ответил отказом'))
        : Promise.resolve(matchResponse)
    ));
    render(<MonitoringAnalyticsSection />);

    expect(await screen.findByText('Аналитика по книге не посчитана')).toBeTruthy();
    expect(screen.getByText(/сервер данных ответил отказом/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Посчитать ещё раз/ })).toBeTruthy();
  });

  it('отказ сверки не роняет аналитику и объявляется своими словами', async () => {
    fetchJSON.mockImplementation((url: string) => (
      url === '/monitoring/match'
        ? Promise.reject(new Error('книги управлений не прочитаны'))
        : Promise.resolve(analyticsResponse)
    ));
    render(<MonitoringAnalyticsSection />);

    expect(await screen.findByText('Сверка сейчас не получена')).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/книги управлений не прочитаны/)).toBeTruthy());
    // Остальные блоки при этом на месте.
    expect(screen.getByText('Портфельный')).toBeTruthy();
  });

  it('пустой ответ аналитики даёт пустоты блоков, а не нули', async () => {
    fetchJSON.mockImplementation((url: string) => Promise.resolve(
      url.startsWith('/monitoring/analytics')
        ? { source: analyticsResponse.source, analytics: {}, notes: [] }
        : matchResponse,
    ));
    render(<MonitoringAnalyticsSection />);

    expect(await screen.findByText(/Ступеней воронки сервер не прислал/)).toBeTruthy();
    expect(screen.getByText(/Состоявшихся процедур с обеими суммами в этом срезе нет/)).toBeTruthy();
    expect(screen.getByText(/Ни у одной процедуры нет выбранной даты/)).toBeTruthy();
  });
});
