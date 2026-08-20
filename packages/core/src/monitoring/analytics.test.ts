/**
 * analytics.test.ts — аналитика вкладки мониторинга (спека §3).
 *
 * Главный тест волны — тот, что проверяет ТРИ КОЭФФИЦИЕНТА СНИЖЕНИЯ: они
 * считаются по трём разным знаменателям и не подменяют друг друга. Именно
 * подмена одного другим и породила бы ответ «мы экономим 30 %» там, где
 * портфель подешевел на 10.
 *
 * Фикстура собрана по живым формам книги: процедура со снижением, процедура
 * без снижения (цена в точности равна НМЦК — таких в книге 160 из 351),
 * процедура без результата (цена ноль) и объявленная без итога.
 */
import { describe, expect, it } from 'vitest';
import {
  deptComparison,
  detectAnomalies,
  discountHistogram,
  median,
  monitoringAnalytics,
  nmckBuckets,
  quantile,
  reductionCoefficients,
  seasonality,
  stageDurations,
  stageFunnel,
  supplierCustomerPairs,
  supplierProfile,
  unsuccessfulProcedures,
} from './analytics.js';
import { parseMonitoringProcedures } from './procedures.js';

/** Строка листа управления: 16 колонок раскладки книги. */
function row(over: {
  customer?: string; subject?: string; nmck?: unknown;
  application?: string; publication?: string; deadline?: string; auction?: string;
  price?: unknown; savings?: unknown; mb?: unknown; check?: string; winner?: string;
}): unknown[] {
  const r: unknown[] = new Array(16).fill('');
  r[0] = 1;
  r[1] = over.customer ?? 'МКУ ЦЭР';
  r[2] = over.subject ?? '';
  r[3] = over.nmck ?? '';
  r[4] = over.application ?? '';
  r[5] = over.publication ?? '';
  r[6] = over.deadline ?? '';
  r[7] = over.auction ?? '';
  r[8] = over.price ?? '';
  r[9] = over.savings ?? '';
  r[10] = over.check ?? '';
  r[11] = over.mb ?? '';
  r[14] = over.winner ?? '';
  return r;
}

const HEADERS: unknown[][] = [new Array(16).fill('ш'), new Array(16).fill('ш')];

/**
 * Четыре процедуры УЭР и две УО:
 *  — ЭА1-26: 1 000 000 → 500 000, снижение 50 %;
 *  — ЭА2-26: 1 000 000 → 1 000 000, снижения нет (цена = НМЦК);
 *  — ЭА3-26: 200 000 → 0, торги без результата;
 *  — ЭА4-26: 300 000, объявлена, итога нет;
 *  — ЭА5-26 (УО): 4 000 000 → 3 800 000, снижение 5 %;
 *  — ЭА6-26 (УО): 100 000 → 100 000, снижения нет.
 */
const SHEETS: Record<string, unknown[][]> = {
  '1. УЭР': [
    ...HEADERS,
    row({
      subject: 'ЭА1-26 Ремонт кровли', nmck: 1_000_000,
      application: '01.03.2026', publication: '05.03.2026',
      deadline: '14.03.2026', auction: '18.03.2026',
      price: 500_000, savings: 500_000, mb: 500_000, check: 'верно',
      winner: 'ООО «БИТ»\nИНН 4101100000',
    }),
    row({
      subject: 'ЭА2-26 Поставка бумаги', nmck: 1_000_000,
      application: '02.03.2026', publication: '06.03.2026',
      deadline: '15.03.2026', auction: '19.03.2026',
      price: 1_000_000, savings: 0, check: 'верно',
      winner: 'ООО «БИТ»\nИНН 4101100000',
    }),
    row({
      subject: 'ЭА3-26 Услуги охраны', nmck: 200_000,
      application: '03.03.2026', publication: '07.03.2026',
      deadline: '16.03.2026', auction: '20.03.2026',
      price: 0, winner: 'Не состоялся (0 заявок)',
    }),
    row({ subject: 'ЭА4-26 Проектирование', nmck: 300_000, application: '04.04.2026', publication: '10.04.2026' }),
  ],
  '8. УО': [
    ...HEADERS,
    row({
      customer: 'МБОУ ЕСШ №1', subject: 'ЭА5-26 Капитальный ремонт', nmck: 4_000_000,
      application: '01.04.2026', publication: '06.04.2026',
      deadline: '16.04.2026', auction: '20.04.2026',
      price: 3_800_000, savings: 200_000, mb: 200_000, check: 'верно',
      winner: 'ООО «АВАНТОРГ»\nИНН 4101200000',
    }),
    row({
      customer: 'МБОУ ЕСШ №1', subject: 'ЭА6-26 Учебники', nmck: 100_000,
      application: '02.04.2026', publication: '07.04.2026',
      deadline: '17.04.2026', auction: '21.04.2026',
      price: 100_000, savings: 0, check: 'верно',
      winner: 'ООО «БИТ»\nИНН 4101100000',
    }),
  ],
};

const { procedures } = parseMonitoringProcedures(SHEETS);

describe('квантили и медиана', () => {
  it('медиана чётного ряда — среднее середины, нечётного — середина', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([1, 2, 3])).toBe(2);
    expect(median([])).toBeNull();
  });

  it('квартили считаются линейной интерполяцией', () => {
    const sorted = [0, 10, 20, 30, 40];
    expect(quantile(sorted, 0.25)).toBe(10);
    expect(quantile(sorted, 0.75)).toBe(30);
  });
});

describe('воронка стадий', () => {
  it('ступени считаются по заполненности колонок, конверсия — между соседями', () => {
    const funnel = stageFunnel(procedures);
    expect(funnel.total).toBe(6);
    const byKey = Object.fromEntries(funnel.steps.map((s) => [s.key, s.count]));
    expect(byKey).toMatchObject({ application: 6, published: 6, auction: 5, priced: 4 });
    // Из шести заявок до цены победителя дошли четыре — две трети.
    expect(funnel.reachedPricedPct).toBeCloseTo(66.6667, 3);
    const priced = funnel.steps.find((s) => s.key === 'priced');
    // Конверсия считается от предыдущей ступени: четыре из пяти состоявшихся.
    expect(priced?.conversionPct).toBeCloseTo(80, 6);
    expect(funnel.steps[0].conversionPct).toBeNull();
  });

  it('ступень полнее предыдущей получает оговорку, а не подгонку числа', () => {
    const { procedures: odd } = parseMonitoringProcedures({
      '1. УЭР': [
        ...HEADERS,
        // Торги есть, публикации нет — путь пройден не по порядку.
        row({ subject: 'ЭА70-26 Услуги', nmck: 50_000, auction: '10.03.2026', price: 40_000 }),
      ],
    });
    const funnel = stageFunnel(odd);
    const auctionStep = funnel.steps.find((s) => s.key === 'auction');
    expect(auctionStep?.note).toContain('не по порядку');
  });
});

describe('три коэффициента снижения — знаменатели разные', () => {
  const coefficients = reductionCoefficients(procedures);

  it('портфельный делит деньги на деньги', () => {
    // Состоявшиеся: 1 000 000 + 1 000 000 + 4 000 000 + 100 000 = 6 100 000;
    // цены: 500 000 + 1 000 000 + 3 800 000 + 100 000 = 5 400 000.
    expect(coefficients.portfolio).toMatchObject({
      count: 4, nmckRub: 6_100_000, priceRub: 5_400_000, savingsRub: 700_000,
    });
    expect(coefficients.portfolioPct).toBeCloseTo(11.4754, 3);
  });

  it('построчный делит проценты на число состоявшихся, включая нулевые', () => {
    // Построчно: 50 %, 0 %, 5 %, 0 % → среднее 13,75 %, медиана 2,5 %.
    expect(coefficients.rowCount).toBe(4);
    expect(coefficients.rowMeanPct).toBeCloseTo(13.75, 6);
    expect(coefficients.rowMedianPct).toBeCloseTo(2.5, 6);
  });

  it('третий считает только те, где снижение вообще было', () => {
    // Снижение было у двух: 50 % и 5 % → среднее 27,5 %, медиана 27,5 %.
    expect(coefficients.reducedCount).toBe(2);
    expect(coefficients.reducedMeanPct).toBeCloseTo(27.5, 6);
    expect(coefficients.reducedMedianPct).toBeCloseTo(27.5, 6);
  });

  it('три ответа не совпадают между собой — подменять их друг другом нельзя', () => {
    expect(coefficients.portfolioPct).not.toBeCloseTo(coefficients.rowMeanPct ?? 0, 3);
    expect(coefficients.rowMeanPct).not.toBeCloseTo(coefficients.reducedMeanPct ?? 0, 3);
  });

  it('цена в точности равна начальной — отдельный счёт, а не «снижение 0 %»', () => {
    expect(coefficients.equalPriceCount).toBe(2);
    expect(coefficients.equalPriceSharePct).toBeCloseTo(50, 6);
  });
});

describe('гистограмма снижения', () => {
  it('семь корзин, процедуры без результата и без итога в них не попадают', () => {
    const buckets = discountHistogram(procedures);
    expect(buckets).toHaveLength(7);
    const counts = Object.fromEntries(buckets.map((b) => [b.key, b.count]));
    expect(counts).toMatchObject({ zero: 2, '5-10': 1, '25-50': 1 });
    expect(buckets.reduce((s, b) => s + b.count, 0)).toBe(4);
  });
});

describe('поставщики и концентрация', () => {
  const profile = supplierProfile(procedures);

  it('группировка идёт по ИНН, а не по написанию наименования', () => {
    expect(profile.uniqueCount).toBe(2);
    expect(profile.suppliers[0]).toMatchObject({ inn: '4101100000', wins: 3 });
    expect(profile.totalWins).toBe(4);
  });

  it('деньги и победы считаются раздельно — доли расходятся', () => {
    // «БИТ»: три победы на 1 600 000; «АВАНТОРГ»: одна победа на 3 800 000.
    const bit = profile.suppliers.find((s) => s.inn === '4101100000');
    expect(bit?.moneyRub).toBe(1_600_000);
    expect(profile.concentration.top5WinsPct).toBeCloseTo(100, 6);
    expect(profile.totalMoneyRub).toBe(5_400_000);
  });

  it('пары «поставщик — заказчик» приходят с предметами закупок', () => {
    const pairs = supplierCustomerPairs(procedures, 2);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ inn: '4101100000', customer: 'МКУ ЦЭР', wins: 2 });
    expect(pairs[0].subjects).toContain('Ремонт кровли');
  });
});

describe('сроки этапов', () => {
  it('медианы и квартили считаются по каждому этапу отдельно', () => {
    const stats = stageDurations(procedures);
    const total = stats.find((s) => s.key === 'total');
    expect(total?.count).toBe(5);
    // Весь путь: 17, 17, 17, 19, 19 дней — медиана 17, среднее сдвинуто вверх.
    expect(total?.medianDays).toBe(17);
    expect(total?.meanDays).toBeCloseTo(17.8, 6);
    const toDeadline = stats.find((s) => s.key === 'toDeadline');
    expect(toDeadline?.medianDays).toBe(9);
  });

  it('отрицательная длительность попадает в выбросы с адресом строки', () => {
    const { procedures: broken } = parseMonitoringProcedures({
      '6. УД': [
        ...HEADERS,
        row({
          subject: 'ЭА80-26 Услуги', nmck: 10_000,
          publication: '20.03.2026', deadline: '10.03.2026',
        }),
      ],
    });
    const stats = stageDurations(broken);
    const toDeadline = stats.find((s) => s.key === 'toDeadline');
    expect(toDeadline?.negativeCount).toBe(1);
    expect(toDeadline?.outliers[0]).toMatchObject({ sheet: '6. УД', row: 3, reason: 'negative' });
  });
});

describe('сезонность', () => {
  it('по дате публикации строятся месяцы и кварталы, недатированные считаются', () => {
    const season = seasonality(procedures, 'publication');
    expect(season.months.map((m) => m.period)).toEqual(['2026-03', '2026-04']);
    expect(season.months[0].count).toBe(3);
    expect(season.quarters.map((q) => q.period)).toEqual(['2026-I', '2026-II']);
    expect(season.undated).toBe(0);
  });

  it('смена основания на дату торгов меняет картину, а не подпись', () => {
    const byAuction = seasonality(procedures, 'auction');
    expect(byAuction.basis).toBe('auction');
    // У объявленной без итога даты торгов нет — она выпадает честно.
    expect(byAuction.undated).toBe(1);
  });
});

describe('корзины НМЦК и сравнение управлений', () => {
  it('пять корзин суммы с портфельным снижением внутри каждой', () => {
    const buckets = nmckBuckets(procedures);
    expect(buckets.map((b) => b.key)).toEqual(['до100к', '100к-600к', '600к-3м', '3м-20м', 'свыше20м']);
    const large = buckets.find((b) => b.key === '3м-20м');
    expect(large?.count).toBe(1);
    expect(large?.reductionPct).toBeCloseTo(5, 6);
  });

  it('управления сравниваются нормированными долями, а не абсолютом', () => {
    const rows = deptComparison(procedures);
    const uer = rows.find((r) => r.dept === 'УЭР');
    expect(uer?.count).toBe(4);
    // Из двух состоявшихся УЭР снижение было у одной.
    expect(uer?.withReductionSharePct).toBeCloseTo(50, 6);
    expect(uer?.noResultSharePct).toBeCloseTo(25, 6);
    const uo = rows.find((r) => r.dept === 'УО');
    expect(uo?.noResultSharePct).toBe(0);
  });
});

describe('несостоявшиеся и аномалии', () => {
  it('за несостоявшимися названы деньги и текст исхода из книги', () => {
    const unsuccessful = unsuccessfulProcedures(procedures);
    expect(unsuccessful.count).toBe(1);
    expect(unsuccessful.nmckRub).toBe(200_000);
    expect(unsuccessful.outcomes[0].text).toContain('Не состоялся');
  });

  it('глубокое снижение и нулевая цена приходят карточками с адресами', () => {
    const groups = detectAnomalies(procedures);
    const kinds = groups.map((g) => g.kind);
    expect(kinds).toContain('zero-price');
    const deep = groups.find((g) => g.kind === 'deep-reduction');
    // Ровно 50 % в «свыше 50» не попадает — граница включена в корзину 25–50.
    expect(deep).toBeUndefined();
    const zero = groups.find((g) => g.kind === 'zero-price');
    expect(zero?.refs[0]).toMatchObject({ sheet: '1. УЭР', row: 5 });
    expect(zero?.mechanism).toContain('Ноль здесь — содержание');
  });

  it('совместная закупка на разных листах дублем не считается', () => {
    const { procedures: joint } = parseMonitoringProcedures({
      '1. УЭР': [...HEADERS, row({ subject: 'ЭАС258-26 Продукты', nmck: 719_574.67 })],
      '8. УО': [...HEADERS, row({ subject: 'ЭАС258-26 Продукты', nmck: 1_100_000 })],
    });
    const groups = detectAnomalies(joint);
    expect(groups.find((g) => g.kind === 'duplicate-code')).toBeUndefined();
  });

  it('повтор кода внутри одного листа — аномалия с адресами обеих строк', () => {
    const { procedures: dup } = parseMonitoringProcedures({
      '8. УО': [
        ...HEADERS,
        row({ subject: 'ЭА280-26 Капремонт школы', nmck: 20_254_367.2 }),
        row({ subject: 'ЭА280-26 Баннеры', nmck: 807_513 }),
      ],
    });
    const group = detectAnomalies(dup).find((g) => g.kind === 'duplicate-code');
    expect(group?.count).toBe(2);
    expect(group?.refs.map((r) => r.row)).toEqual([3, 4]);
  });
});

describe('сборка аналитики', () => {
  it('одним вызовом собираются все разделы вкладки', () => {
    const analytics = monitoringAnalytics(procedures);
    expect(Object.keys(analytics)).toEqual([
      'funnel', 'reduction', 'histogram', 'suppliers', 'pairs',
      'durations', 'seasonality', 'nmckBuckets', 'depts', 'unsuccessful', 'anomalies',
    ]);
    expect(analytics.funnel.total).toBe(6);
    expect(analytics.durations).toHaveLength(4);
  });
});
