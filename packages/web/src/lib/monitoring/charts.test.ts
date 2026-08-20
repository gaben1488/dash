/**
 * Стражи рядов графиков вкладки «Мониторинг · Аналитика».
 *
 * Проверяются ОБЕЩАНИЯ рядов, а не оформление графиков:
 *   1) три коэффициента снижения не подменяют друг друга — у каждого свой
 *      знаменатель, и значения расходятся;
 *   2) пустота остаётся пустотой: null не превращается в ноль ни в долях, ни
 *      в снижении, ни в сроках;
 *   3) правило попадания на ступень воронки совпадает с правилом ядра —
 *      иначе деньги ступени описывали бы другие строки, чем её счёт;
 *   4) сверка показывает все шесть классов исхода, включая нулевые, и не
 *      выбирает правую сторону в расхождении.
 */
import { describe, expect, it } from 'vitest';
import type {
  DeptComparisonRow, DiscountBucket, DurationStats, MatchViewPayload,
  MatchedPair, NmckBucket, ReductionCoefficients, SeasonPoint,
  StageFunnelData, SupplierProfile,
} from './analytics-contract';
import type { RegistryProcedure } from './contract';
import {
  concentrationRows, deptBars, durationBoxes, funnelBars, funnelMoney,
  histogramBars, matchClasses, matchDisagreements, nmckBucketBars,
  reductionByMethod, reductionMethods, seasonBars, seasonLabel,
  seasonShortLabel, supplierTop,
} from './charts';

// ── Заготовки ────────────────────────────────────────────────────────

function proc(over: Partial<RegistryProcedure> = {}): RegistryProcedure {
  return {
    sheet: '1. УЭР',
    row: 10,
    dept: 'УЭР',
    ppNum: '1',
    customer: 'МКУ «Заказчик»',
    code: 'ЭА1-26',
    codeNote: null,
    method: 'ЭА',
    year: 2026,
    subject: 'Поставка бумаги',
    nmck: 1_000_000,
    applicationDate: '01.03.2026',
    publicationDate: '05.03.2026',
    deadlineDate: '14.03.2026',
    auctionDate: '18.03.2026',
    auctionPrice: 900_000,
    savingsTotal: 100_000,
    savingsMb: 100_000,
    savingsKb: null,
    savingsFb: null,
    savingsManual: false,
    selfCheck: 'верно',
    winner: 'ООО «Поставщик» ИНН 1234567890',
    winnerName: 'ООО «Поставщик»',
    winnerInn: '1234567890',
    outcome: null,
    stage: 'awarded',
    reductionRub: 100_000,
    reductionPct: 10,
    comment: null,
    customerNormalized: 'мку заказчик',
    savingsSplitSum: 100_000,
    controlAgrees: true,
    controlGapRub: 0,
    joint: false,
    innRepeated: false,
    durations: { toPublication: 4, toDeadline: 9, toAuction: 4, total: 17 },
    defects: [],
    ...over,
  };
}

const reduction: ReductionCoefficients = {
  portfolioPct: 9.74,
  portfolio: { count: 351, nmckRub: 1_200_000_000, priceRub: 1_083_120_000, savingsRub: 116_880_000 },
  rowMeanPct: 15.84,
  rowMedianPct: 0.5,
  rowCount: 351,
  reducedMeanPct: 29.1,
  reducedMedianPct: 26.34,
  reducedQ1Pct: 12,
  reducedQ3Pct: 41,
  reducedCount: 191,
  equalPriceCount: 160,
  equalPriceSharePct: 45.58,
};

// ── Воронка ──────────────────────────────────────────────────────────

describe('воронка стадий', () => {
  const funnel: StageFunnelData = {
    total: 100,
    steps: [
      { key: 'application', label: 'Заявка', count: 80, conversionPct: null, note: null },
      { key: 'published', label: 'Публикация', count: 40, conversionPct: 50, note: null },
      { key: 'auction', label: 'Торги', count: 50, conversionPct: 125, note: 'Ступень заполнена полнее предыдущей.' },
    ],
    reachedPriced: 40,
    reachedPricedPct: 40,
  };

  it('ширина полосы считается от наибольшей ступени, а не от первой', () => {
    const bars = funnelBars(funnel);
    expect(bars[0]!.widthPct).toBe(100);
    expect(bars[1]!.widthPct).toBe(50);
    // Ступень полнее предыдущей не выходит за сто процентов ширины.
    expect(bars[2]!.widthPct).toBeLessThanOrEqual(100);
  });

  it('оговорка ядра доезжает до экрана, а не сглаживается', () => {
    expect(funnelBars(funnel)[2]!.note).toContain('полнее предыдущей');
  });

  it('пустая воронка не делит на ноль', () => {
    const bars = funnelBars({ total: 0, steps: [{ key: 'a', label: 'A', count: 0, conversionPct: null, note: null }], reachedPriced: 0, reachedPricedPct: null });
    expect(bars[0]!.widthPct).toBe(0);
  });
});

describe('деньги ступеней воронки', () => {
  const rows: RegistryProcedure[] = [
    proc({ row: 1 }),
    // Дата публикации есть, даты заявки нет — путь пройден не по порядку.
    proc({ row: 2, applicationDate: null, auctionPrice: 0, stage: 'no_result', savingsSplitSum: null, controlAgrees: null }),
    // Сумма не читается числом: строка на ступени есть, деньги её неполные.
    proc({ row: 3, nmck: null, auctionPrice: 500_000 }),
  ];

  it('ступень засчитывается по заполненности колонки, а не по стадии строки', () => {
    const money = funnelMoney(rows);
    const byKey = new Map(money.map((m) => [m.key, m]));
    expect(byKey.get('application')!.count).toBe(2);
    expect(byKey.get('published')!.count).toBe(3);
    // Цена ровно ноль на ступень «есть цена победителя» не пускает.
    expect(byKey.get('priced')!.count).toBe(2);
  });

  it('строка без читаемой начальной цены считается отдельно, а не нулём', () => {
    const published = funnelMoney(rows).find((m) => m.key === 'published')!;
    expect(published.nmckMissing).toBe(1);
    expect(published.nmckRub).toBe(2_000_000);
  });

  it('до цены победителя деньги победителя не показываются вовсе', () => {
    const money = funnelMoney(rows);
    expect(money.find((m) => m.key === 'published')!.priceRub).toBeNull();
    expect(money.find((m) => m.key === 'priced')!.priceRub).not.toBeNull();
  });
});

// ── Три коэффициента ─────────────────────────────────────────────────

describe('три коэффициента снижения', () => {
  it('возвращаются все три и не подменяют друг друга', () => {
    const methods = reductionMethods(reduction);
    expect(methods).toHaveLength(3);
    const values = methods.map((m) => m.valuePct);
    expect(new Set(values).size).toBe(3);
    expect(methods.map((m) => m.id)).toEqual(['portfolio', 'row', 'reduced']);
  });

  it('у каждого коэффициента назван свой знаменатель', () => {
    const methods = reductionMethods(reduction);
    expect(methods[0]!.basis).toContain('351');
    expect(methods[0]!.basis).toContain('состоявшейся процедуре');
    expect(methods[2]!.basis).toContain('191');
    expect(methods[0]!.basis).not.toBe(methods[2]!.basis);
  });

  it('у портфельного медианы нет по природе — она не подставляется чужой', () => {
    expect(reductionMethods(reduction)[0]!.medianPct).toBeNull();
  });

  it('пустой расчёт оставляет плитки на месте с прочерками, а не прячет их', () => {
    const empty: ReductionCoefficients = {
      ...reduction,
      portfolioPct: null, rowMeanPct: null, rowMedianPct: null,
      reducedMeanPct: null, reducedMedianPct: null,
    };
    const methods = reductionMethods(empty);
    expect(methods).toHaveLength(3);
    expect(methods.every((m) => m.valuePct === null)).toBe(true);
  });
});

describe('гистограмма снижения', () => {
  const buckets: DiscountBucket[] = [
    { key: 'zero', label: 'ровно 0 %', fromPct: 0, toPct: 0, count: 160, nmckRub: 500_000_000, priceRub: 500_000_000 },
    { key: '25-50', label: 'от 25 до 50 %', fromPct: 25, toPct: 50, count: 40, nmckRub: 100_000_000, priceRub: 65_000_000 },
  ];

  it('доля считается от числа состоявшихся, а экономия — разностью сумм', () => {
    const bars = histogramBars(buckets);
    expect(bars[0]!.sharePct).toBeCloseTo(80, 5);
    expect(bars[1]!.savingsRub).toBe(35_000_000);
  });

  it('корзина «ровно ноль» показывает нулевую экономию, а не пустоту', () => {
    expect(histogramBars(buckets)[0]!.savingsRub).toBe(0);
  });

  it('пустой набор корзин не даёт долю нулём — доли просто нет', () => {
    const bars = histogramBars([{ ...buckets[0]!, count: 0 }, { ...buckets[1]!, count: 0 }]);
    expect(bars[0]!.sharePct).toBeNull();
  });
});

describe('разрез снижения по способу закупки', () => {
  it('электронный аукцион и единственный поставщик считаются порознь', () => {
    const rows = reductionByMethod([
      proc({ method: 'ЭА', nmck: 1_000_000, auctionPrice: 800_000 }),
      proc({ method: 'ЭЕП', nmck: 1_000_000, auctionPrice: 1_000_000 }),
      proc({ method: 'ЭЕП', nmck: 2_000_000, auctionPrice: 2_000_000 }),
    ]);
    const byMethod = new Map(rows.map((r) => [r.method, r]));
    expect(byMethod.get('ЭА')!.portfolioPct).toBeCloseTo(20, 5);
    expect(byMethod.get('ЭЕП')!.portfolioPct).toBe(0);
    expect(byMethod.get('ЭЕП')!.equalPriceCount).toBe(2);
  });

  it('несостоявшиеся процедуры в разрез не входят', () => {
    const rows = reductionByMethod([proc({ stage: 'no_result', auctionPrice: 0 })]);
    expect(rows).toHaveLength(0);
  });

  it('строка без разобранного способа не теряется, а получает честное имя', () => {
    const rows = reductionByMethod([proc({ method: null })]);
    expect(rows[0]!.method).toBe('способ не определён');
  });
});

describe('корзины размера закупки', () => {
  it('доля корзины считается от числа процедур всех корзин', () => {
    const buckets: NmckBucket[] = [
      { key: 'до100к', label: 'до 100 тыс.', count: 30, nmckRub: 2_000_000, reductionPct: 12 },
      { key: 'свыше20м', label: 'свыше 20 млн', count: 10, nmckRub: 900_000_000, reductionPct: null },
    ];
    const bars = nmckBucketBars(buckets);
    expect(bars[0]!.sharePct).toBeCloseTo(75, 5);
    expect(bars[1]!.reductionPct).toBeNull();
  });
});

// ── Сезонность ───────────────────────────────────────────────────────

describe('сезонность', () => {
  const points: SeasonPoint[] = [
    { period: '2026-05', count: 8, nmckRub: 20_000_000, priceRub: 18_000_000 },
    { period: '2026-03', count: 12, nmckRub: 10_000_000, priceRub: 10_000_000 },
  ];

  it('месяц называется словом с годом', () => {
    expect(seasonLabel('2026-03')).toBe('март 2026');
    expect(seasonShortLabel('2026-03')).toBe('мар 26');
  });

  it('незнакомый ключ периода показывается как есть, а не прячется', () => {
    expect(seasonLabel('что-то')).toBe('что-то');
  });

  it('месяцы упорядочены по времени и не достраиваются до календаря', () => {
    const bars = seasonBars(points);
    expect(bars.map((b) => b.period)).toEqual(['2026-03', '2026-05']);
    expect(bars).toHaveLength(2);
  });

  it('месяц без снижения даёт ровно ноль, месяц без денег — пустоту', () => {
    const bars = seasonBars([
      ...points,
      { period: '2026-06', count: 1, nmckRub: 0, priceRub: 0 },
    ]);
    expect(bars.find((b) => b.period === '2026-03')!.reductionPct).toBe(0);
    expect(bars.find((b) => b.period === '2026-06')!.reductionPct).toBeNull();
  });
});

// ── Сроки ────────────────────────────────────────────────────────────

describe('сроки этапов', () => {
  const stats: DurationStats[] = [
    {
      key: 'toPublication', label: 'Заявка → публикация', count: 10,
      medianDays: 4, meanDays: 6, minDays: -12, maxDays: 40, q1Days: 2, q3Days: 9,
      negativeCount: 2,
      outliers: [{ sheet: '1. УЭР', row: 12, code: 'ЭА5-26', days: -12, reason: 'negative' }],
    },
    {
      key: 'total', label: 'Заявка → торги', count: 3,
      medianDays: null, meanDays: null, minDays: null, maxDays: null,
      q1Days: null, q3Days: null, negativeCount: 0, outliers: [],
    },
  ];

  it('шкала общая на все этапы и включает ноль ради отрицательных сроков', () => {
    const { scale } = durationBoxes(stats);
    expect(scale).not.toBeNull();
    expect(scale!.minDays).toBe(-12);
    expect(scale!.maxDays).toBe(40);
  });

  it('этап без четвертей остаётся в списке без ящика, а не выпадает', () => {
    const { boxes } = durationBoxes(stats);
    expect(boxes).toHaveLength(2);
    expect(boxes[1]!.box).toBeNull();
  });

  it('выбросы с адресами доезжают до экрана', () => {
    expect(durationBoxes(stats).boxes[0]!.outliers[0]!.sheet).toBe('1. УЭР');
  });

  it('без единой пары дат шкалы нет вовсе', () => {
    const { scale } = durationBoxes([stats[1]!]);
    expect(scale).toBeNull();
  });
});

// ── Управления ───────────────────────────────────────────────────────

describe('сравнение управлений', () => {
  const depts: DeptComparisonRow[] = [
    {
      dept: 'УО', sheet: '8. УО', count: 108, nmckRub: 500_000_000, priceRub: 450_000_000,
      savingsBookRub: 50_000_000, reductionPct: 10, withReductionSharePct: 60,
      noResultSharePct: 5, medianTotalDays: 17, controlErrorSharePct: 1, splitMissingSharePct: 2,
    },
    {
      dept: 'УФБП', sheet: '7. УФБП', count: 4, nmckRub: 4_000_000, priceRub: 4_000_000,
      savingsBookRub: 0, reductionPct: null, withReductionSharePct: null,
      noResultSharePct: 0, medianTotalDays: null, controlErrorSharePct: 0, splitMissingSharePct: 0,
    },
    {
      dept: 'УИО', sheet: '3. УИО', count: 40, nmckRub: 200_000_000, priceRub: 198_000_000,
      savingsBookRub: 2_000_000, reductionPct: 1.15, withReductionSharePct: 10,
      noResultSharePct: 2, medianTotalDays: 21, controlErrorSharePct: 0, splitMissingSharePct: 0,
    },
  ];

  it('ряд сортируется по величине, а управление без величины уходит вниз, но остаётся', () => {
    const bars = deptBars(depts, 'reductionPct');
    expect(bars.map((b) => b.dept)).toEqual(['УО', 'УИО', 'УФБП']);
    expect(bars[2]!.value).toBeNull();
  });

  it('смена величины меняет порядок, а не набор управлений', () => {
    const byDays = deptBars(depts, 'medianTotalDays');
    expect(byDays).toHaveLength(3);
    expect(byDays[0]!.dept).toBe('УИО');
  });
});

// ── Поставщики ───────────────────────────────────────────────────────

describe('поставщики и концентрация', () => {
  const profile: SupplierProfile = {
    suppliers: [
      { key: '1', inn: '1', name: 'Крупный', wins: 2, moneyRub: 900, depts: ['УО'], customers: ['А'] },
      { key: '2', inn: '2', name: 'Частый', wins: 9, moneyRub: 100, depts: ['УЭР'], customers: ['Б'] },
    ],
    uniqueCount: 2,
    totalWins: 11,
    totalMoneyRub: 1000,
    singleWinCount: 0,
    singleWinSharePct: 0,
    concentration: { top5WinsPct: 100, top10WinsPct: 100, top5MoneyPct: 100, top10MoneyPct: 100 },
    winsWithoutInn: 0,
  };

  it('топ по деньгам и топ по победам — разные списки', () => {
    expect(supplierTop(profile, 'money')[0]!.name).toBe('Крупный');
    expect(supplierTop(profile, 'wins')[0]!.name).toBe('Частый');
  });

  it('доля считается от итога выбранной величины, а не от чужой', () => {
    expect(supplierTop(profile, 'money')[0]!.sharePct).toBeCloseTo(90, 5);
    expect(supplierTop(profile, 'wins')[0]!.sharePct).toBeCloseTo(81.8, 1);
  });

  it('концентрация показывает долю побед и долю денег рядом', () => {
    const rows = concentrationRows(profile);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.winsPct).not.toBeUndefined();
    expect(rows[0]!.moneyPct).not.toBeUndefined();
  });

  it('пустой итог не превращает долю в ноль', () => {
    const empty = { ...profile, totalMoneyRub: 0 };
    expect(supplierTop(empty, 'money')[0]!.sharePct).toBeNull();
  });
});

// ── Сверка ───────────────────────────────────────────────────────────

const matched: MatchedPair[] = [
  {
    code: 'ЭА1-26', book: 'УО', bookRowKey: 'УО:214', sheet: '8. УО', procKey: '8. УО:100',
    nmck: { bookRub: 1_000_000, monitoringRub: 1_000_000, deltaRub: 0, relDiff: 0, agrees: true },
    fact: { bookRub: 900_000, monitoringRub: 800_000, deltaRub: 100_000, relDiff: 0.111, agrees: false },
  },
  {
    code: 'ЭА2-26', book: 'УЭР', bookRowKey: 'УЭР:15', sheet: '1. УЭР', procKey: '1. УЭР:20',
    nmck: { bookRub: 5_000_000, monitoringRub: 4_000_000, deltaRub: 1_000_000, relDiff: 0.2, agrees: false },
    fact: { bookRub: null, monitoringRub: 3_000_000, deltaRub: null, relDiff: null, agrees: null },
  },
];

const matchPayload: MatchViewPayload = {
  source: { bookName: 'Ежедневный мониторинг', readAt: '2026-08-18T10:00:00Z', moneyUnit: 'руб', sheetsRead: [], sheetsFailed: {} },
  books: { read: ['УО', 'УЭР'], rowsWithCode: 300 },
  summary: {
    bookRowsWithCode: 300, proceduresWithCode: 380, matched: 2, bookOnly: 1, monitoringOnly: 0,
    ambiguousAcrossBooks: 1, ambiguousSameBook: 0, listCells: 0, coveragePct: 87.4,
    nmckAgree: 1, nmckDisagree: 1, nmckNoComparison: 0,
    factAgree: 0, factDisagree: 1, factNoComparison: 1,
  },
  matched,
  bookOnly: [{ code: 'ЭА9-26', addresses: ['УО:301'] }],
  monitoringOnly: [],
  ambiguous: [{ code: 'ЭАС258-26', bookAddresses: ['УО:5', 'УЭР:7'], procedureAddresses: [], sameBook: false }],
  listCells: [],
  internal: { codesOnSheets: 380, codesInJournal: 53, codesInBoth: 50, rows: [], counts: {} },
  notes: [],
};

describe('классы исхода сверки', () => {
  it('показываются все шесть классов, включая нулевые', () => {
    const classes = matchClasses(matchPayload);
    expect(classes).toHaveLength(6);
    expect(classes.find((c) => c.kind === 'monitoring-only')!.count).toBe(0);
  });

  it('у каждого класса есть механизм и действие, а не только счёт', () => {
    for (const c of matchClasses(matchPayload)) {
      expect(c.mechanism.length).toBeGreaterThan(20);
      expect(c.action.length).toBeGreaterThan(10);
    }
  });

  it('совместная закупка и повтор внутри одной книги разведены по классам', () => {
    const classes = matchClasses(matchPayload);
    expect(classes.find((c) => c.kind === 'ambiguous-across')!.count).toBe(1);
    expect(classes.find((c) => c.kind === 'ambiguous-same')!.count).toBe(0);
  });

  it('примеры несут адрес книги и адрес мониторинга сразу', () => {
    const matchedClass = matchClasses(matchPayload).find((c) => c.kind === 'matched')!;
    expect(matchedClass.examples[0]!.addresses.join(' ')).toContain('УО:214');
    expect(matchedClass.examples[0]!.addresses.join(' ')).toContain('8. УО:100');
  });
});

describe('расхождения сумм', () => {
  it('берутся только явные расхождения, «сравнивать нечего» не считается расхождением', () => {
    const rows = matchDisagreements(matched);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.bookRub !== null && r.monitoringRub !== null)).toBe(true);
  });

  it('сортируются по размеру разрыва, наибольший сверху', () => {
    const rows = matchDisagreements(matched);
    expect(rows[0]!.deltaRub).toBe(1_000_000);
  });

  it('каждое расхождение несёт адреса обеих сторон и обе суммы', () => {
    const row = matchDisagreements(matched)[0]!;
    expect(row.bookAddress).toBe('УЭР:15');
    expect(row.monitoringAddress).toBe('1. УЭР:20');
    expect(row.bookRub).not.toBe(row.monitoringRub);
  });
});
