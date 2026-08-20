/**
 * analytics.ts — собственная аналитика реестра процедур: то, чего книга
 * «Ежедневный мониторинг» не считает и посчитать не может (спека §3).
 *
 * Здесь нет ни одного числа из книги «как есть»: воронка, распределение
 * снижения, портрет поставщиков, сроки этапов, сезонность и сравнение
 * управлений выводятся из разобранных строк. Модуль — чистые функции над
 * MonitoringProcedure[]; никаких обращений к сети и никакого состояния.
 *
 * ГЛАВНОЕ ПРАВИЛО МОДУЛЯ — ТРИ КОЭФФИЦИЕНТА СНИЖЕНИЯ, А НЕ ОДИН. Вопрос
 * «сколько мы обычно экономим на торгах» имеет три разных честных ответа,
 * и они расходятся втрое:
 *   — портфельный (Σ НМЦК − Σ цена) ÷ Σ НМЦК отвечает «на сколько подешевел
 *     весь портфель денег» — 9,74 % на дампе 18.08;
 *   — среднее построчных процентов отвечает «как ведёт себя типичная
 *     процедура, включая те, где снижения не было» — 15,84 % при медиане
 *     0,50 %;
 *   — среднее там, где снижение вообще было, отвечает «насколько падает
 *     цена, когда торги реально идут» — 29,10 %.
 * Разрыв объясняется одним фактом: у 160 из 351 состоявшейся процедуры цена
 * в точности равна НМЦК. Подменять один коэффициент другим — врать, поэтому
 * функция возвращает все три сразу и с числом строк-оснований у каждого.
 *
 * Тон подписей — объяснение механизма, не упрёк (п.104). «Снижение свыше
 * 50 %» здесь не нарушение, а повод посмотреть.
 */

import { isoMonth, isoQuarter, round3 } from './cells.js';
import type { MonitoringProcedure } from './procedures.js';
import { supplierKey } from './winner.js';

// ── Статистика: медиана и квартили ───────────────────────────────────

/** Квантиль по возрастанию отсортированного ряда (линейная интерполяция). */
export function quantile(sortedAsc: readonly number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const pos = (sortedAsc.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
}

/** Медиана ряда (порядок входа не важен — копия сортируется). */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return quantile([...values].sort((a, b) => a - b), 0.5);
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Доля в процентах; знаменатель ноль → null, а не ноль (п.36). */
function sharePct(part: number, whole: number): number | null {
  return whole === 0 ? null : (part / whole) * 100;
}

// ── §3.1. Воронка стадий с конверсией ────────────────────────────────

/** Пять ступеней пути процедуры — ось воронки (спека §3.1). */
export type FunnelStepKey = 'application' | 'published' | 'auction' | 'priced' | 'split';

export interface FunnelStep {
  readonly key: FunnelStepKey;
  readonly label: string;
  readonly count: number;
  /** Конверсия из предыдущей ступени, %; у первой — null. */
  readonly conversionPct: number | null;
  /** Оговорка, когда ступень заполнена полнее предыдущей; иначе null. */
  readonly note: string | null;
}

export interface StageFunnel {
  readonly total: number;
  readonly steps: readonly FunnelStep[];
  /** Дошли до цены победителя, шт. и % — то, что читают вслух. */
  readonly reachedPriced: number;
  readonly reachedPricedPct: number | null;
}

const FUNNEL_LABELS: Record<FunnelStepKey, string> = {
  application: 'Заявка поступила в уполномоченный орган',
  published: 'Процедура опубликована',
  auction: 'Торги состоялись',
  priced: 'Есть цена победителя',
  split: 'Экономия расписана по бюджетам',
};

/**
 * Воронка считается по ЗАПОЛНЕННОСТИ КОЛОНОК книги, а не по стадии строки:
 * стадия отвечает «где процедура сейчас», воронка — «сколько дошло до этой
 * ступени». Ступени могут заполняться не по порядку (дата торгов есть, даты
 * публикации нет — двенадцать таких строк), и продукт это называет вслух
 * оговоркой, а не сглаживает подгонкой чисел.
 */
export function stageFunnel(procedures: readonly MonitoringProcedure[]): StageFunnel {
  const counts: Record<FunnelStepKey, number> = {
    application: 0, published: 0, auction: 0, priced: 0, split: 0,
  };
  for (const p of procedures) {
    if (p.applicationDate?.iso != null) counts.application += 1;
    if (p.publicationDate?.iso != null) counts.published += 1;
    if (p.auctionDate?.iso != null) counts.auction += 1;
    if (p.auctionPrice !== null && p.auctionPrice > 0) counts.priced += 1;
    if (p.savingsSplitSum !== null && p.controlAgrees === true) counts.split += 1;
  }

  const order: FunnelStepKey[] = ['application', 'published', 'auction', 'priced', 'split'];
  const steps: FunnelStep[] = [];
  let prev: number | null = null;
  for (const key of order) {
    const count = counts[key];
    steps.push({
      key,
      label: FUNNEL_LABELS[key],
      count,
      conversionPct: prev === null ? null : sharePct(count, prev),
      note: prev !== null && count > prev
        ? 'Ступень заполнена полнее предыдущей: часть строк проходит путь не по порядку — в книге пропущен предыдущий этап.'
        : null,
    });
    prev = count;
  }

  return {
    total: procedures.length,
    steps,
    reachedPriced: counts.priced,
    reachedPricedPct: sharePct(counts.priced, procedures.length),
  };
}

// ── §3.2. Три коэффициента снижения ──────────────────────────────────

export interface ReductionCoefficients {
  /** Портфельный: (Σ НМЦК − Σ цена) ÷ Σ НМЦК по состоявшимся, %. */
  readonly portfolioPct: number | null;
  /** Основание портфельного коэффициента — чтобы его нельзя было спутать. */
  readonly portfolio: {
    readonly count: number;
    readonly nmckRub: number;
    readonly priceRub: number;
    readonly savingsRub: number;
  };
  /** Среднее построчных процентов по ВСЕМ состоявшимся, %. */
  readonly rowMeanPct: number | null;
  readonly rowMedianPct: number | null;
  readonly rowCount: number;
  /** Среднее по тем, где снижение вообще было, %. */
  readonly reducedMeanPct: number | null;
  readonly reducedMedianPct: number | null;
  readonly reducedQ1Pct: number | null;
  readonly reducedQ3Pct: number | null;
  readonly reducedCount: number;
  /** Цена в точности равна НМЦК — торги без единого шага снижения. */
  readonly equalPriceCount: number;
  readonly equalPriceSharePct: number | null;
}

/**
 * Три коэффициента сразу. Знаменатели у них РАЗНЫЕ, и это не оплошность:
 * портфельный делит деньги на деньги, построчный — проценты на число строк,
 * третий — на число строк, где снижение было. Тест волны проверяет именно
 * то, что они не подменяют друг друга.
 */
export function reductionCoefficients(
  procedures: readonly MonitoringProcedure[],
): ReductionCoefficients {
  let nmckRub = 0;
  let priceRub = 0;
  let count = 0;
  let equalPriceCount = 0;
  const rowPcts: number[] = [];
  const reducedPcts: number[] = [];

  for (const p of procedures) {
    if (p.stage !== 'awarded' || p.auctionPrice === null || p.nmck === null || p.nmck <= 0) continue;
    count += 1;
    nmckRub += p.nmck;
    priceRub += p.auctionPrice;
    const pct = ((p.nmck - p.auctionPrice) / p.nmck) * 100;
    rowPcts.push(pct);
    if (Math.abs(p.nmck - p.auctionPrice) < 0.005) equalPriceCount += 1;
    else if (pct > 0) reducedPcts.push(pct);
  }

  const reducedSorted = [...reducedPcts].sort((a, b) => a - b);

  return {
    portfolioPct: nmckRub === 0 ? null : ((nmckRub - priceRub) / nmckRub) * 100,
    portfolio: {
      count,
      nmckRub: round3(nmckRub),
      priceRub: round3(priceRub),
      savingsRub: round3(nmckRub - priceRub),
    },
    rowMeanPct: mean(rowPcts),
    rowMedianPct: median(rowPcts),
    rowCount: rowPcts.length,
    reducedMeanPct: mean(reducedPcts),
    reducedMedianPct: quantile(reducedSorted, 0.5),
    reducedQ1Pct: quantile(reducedSorted, 0.25),
    reducedQ3Pct: quantile(reducedSorted, 0.75),
    reducedCount: reducedPcts.length,
    equalPriceCount,
    equalPriceSharePct: sharePct(equalPriceCount, count),
  };
}

// ── §3.2. Гистограмма снижения: семь корзин ──────────────────────────

export type DiscountBucketKey = 'zero' | '0-1' | '1-5' | '5-10' | '10-25' | '25-50' | '50+';

export interface DiscountBucket {
  readonly key: DiscountBucketKey;
  readonly label: string;
  /** Границы в процентах: [от; до). У «ровно 0» обе границы — ноль. */
  readonly fromPct: number;
  readonly toPct: number | null;
  readonly count: number;
  readonly nmckRub: number;
  readonly priceRub: number;
}

const DISCOUNT_BUCKET_DEFS: ReadonlyArray<{
  key: DiscountBucketKey; label: string; fromPct: number; toPct: number | null;
}> = [
  { key: 'zero', label: 'ровно 0 %', fromPct: 0, toPct: 0 },
  { key: '0-1', label: 'от 0 до 1 %', fromPct: 0, toPct: 1 },
  { key: '1-5', label: 'от 1 до 5 %', fromPct: 1, toPct: 5 },
  { key: '5-10', label: 'от 5 до 10 %', fromPct: 5, toPct: 10 },
  { key: '10-25', label: 'от 10 до 25 %', fromPct: 10, toPct: 25 },
  { key: '25-50', label: 'от 25 до 50 %', fromPct: 25, toPct: 50 },
  { key: '50+', label: 'свыше 50 %', fromPct: 50, toPct: null },
];

/** Корзина процента снижения; null — процедура не состоялась либо нет НМЦК. */
export function discountBucketOf(procedure: MonitoringProcedure): DiscountBucketKey | null {
  if (procedure.stage !== 'awarded' || procedure.reductionPct === null) return null;
  const pct = procedure.reductionPct;
  if (pct <= 0) return 'zero';
  if (pct < 1) return '0-1';
  if (pct < 5) return '1-5';
  if (pct < 10) return '5-10';
  if (pct < 25) return '10-25';
  if (pct <= 50) return '25-50';
  return '50+';
}

/**
 * Гистограмма распределения снижения. Форма двугорбая — огромный столб на
 * нуле и второй горб в зоне 25–50 %; это два разных мира (процедуры с одним
 * участником и процедуры с реальной конкуренцией), и склеивать их одним
 * средним нельзя.
 */
export function discountHistogram(
  procedures: readonly MonitoringProcedure[],
): DiscountBucket[] {
  const acc = new Map<DiscountBucketKey, { count: number; nmck: number; price: number }>();
  for (const def of DISCOUNT_BUCKET_DEFS) acc.set(def.key, { count: 0, nmck: 0, price: 0 });

  for (const p of procedures) {
    const key = discountBucketOf(p);
    if (key === null) continue;
    const bucket = acc.get(key);
    if (bucket === undefined) continue;
    bucket.count += 1;
    bucket.nmck += p.nmck ?? 0;
    bucket.price += p.auctionPrice ?? 0;
  }

  return DISCOUNT_BUCKET_DEFS.map((def) => {
    const bucket = acc.get(def.key) ?? { count: 0, nmck: 0, price: 0 };
    return {
      ...def,
      count: bucket.count,
      nmckRub: round3(bucket.nmck),
      priceRub: round3(bucket.price),
    };
  });
}

// ── §3.3. Портрет поставщиков и концентрация ─────────────────────────

export interface SupplierRow {
  /** Ключ группировки: ИНН, если он есть, иначе нормализованное имя. */
  readonly key: string;
  readonly inn: string | null;
  /** Написание из книги — первое встреченное для этого ключа. */
  readonly name: string;
  readonly wins: number;
  /** Сумма цен контрактов этого поставщика, руб. */
  readonly moneyRub: number;
  /** Управления, на листах которых он выигрывал. */
  readonly depts: readonly string[];
  /** Заказчики этого поставщика, по убыванию числа побед. */
  readonly customers: readonly string[];
}

export interface SupplierConcentration {
  /** Доля побед (штук) у топ-5 и топ-10 по числу побед, %. */
  readonly top5WinsPct: number | null;
  readonly top10WinsPct: number | null;
  /** Доля денег у топ-5 и топ-10 по деньгам, %. */
  readonly top5MoneyPct: number | null;
  readonly top10MoneyPct: number | null;
}

export interface SupplierProfile {
  /** Все поставщики, по убыванию числа побед. */
  readonly suppliers: readonly SupplierRow[];
  readonly uniqueCount: number;
  readonly totalWins: number;
  readonly totalMoneyRub: number;
  /** Выиграли ровно один раз — мера немонопольности рынка. */
  readonly singleWinCount: number;
  readonly singleWinSharePct: number | null;
  readonly concentration: SupplierConcentration;
  /** Победы без ИНН: группировка по имени, что менее надёжно, — сказать вслух. */
  readonly winsWithoutInn: number;
}

export function supplierProfile(
  procedures: readonly MonitoringProcedure[],
): SupplierProfile {
  const acc = new Map<string, {
    inn: string | null; name: string; wins: number; money: number;
    depts: Set<string>; customers: Map<string, number>;
  }>();
  let totalWins = 0;
  let totalMoney = 0;
  let winsWithoutInn = 0;

  for (const p of procedures) {
    if (p.stage !== 'awarded') continue;
    const key = supplierKey(p.winner);
    if (key === null) continue;
    totalWins += 1;
    totalMoney += p.auctionPrice ?? 0;
    if (p.winner.inn === null) winsWithoutInn += 1;

    let bucket = acc.get(key);
    if (bucket === undefined) {
      bucket = {
        inn: p.winner.inn,
        name: p.winner.name ?? p.winner.raw,
        wins: 0,
        money: 0,
        depts: new Set<string>(),
        customers: new Map<string, number>(),
      };
      acc.set(key, bucket);
    }
    bucket.wins += 1;
    bucket.money += p.auctionPrice ?? 0;
    bucket.depts.add(p.dept);
    if (p.customer !== '') {
      bucket.customers.set(p.customer, (bucket.customers.get(p.customer) ?? 0) + 1);
    }
  }

  const suppliers: SupplierRow[] = [...acc.entries()]
    .map(([key, b]) => ({
      key,
      inn: b.inn,
      name: b.name,
      wins: b.wins,
      moneyRub: round3(b.money),
      depts: [...b.depts].sort(),
      customers: [...b.customers.entries()]
        .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0], 'ru'))
        .map(([customer]) => customer),
    }))
    .sort((a, b) => b.wins - a.wins || b.moneyRub - a.moneyRub || a.name.localeCompare(b.name, 'ru'));

  const byMoney = [...suppliers].sort((a, b) => b.moneyRub - a.moneyRub);
  const sumWins = (list: readonly SupplierRow[], n: number): number =>
    list.slice(0, n).reduce((s, r) => s + r.wins, 0);
  const sumMoney = (list: readonly SupplierRow[], n: number): number =>
    list.slice(0, n).reduce((s, r) => s + r.moneyRub, 0);

  const singleWinCount = suppliers.filter((s) => s.wins === 1).length;

  return {
    suppliers,
    uniqueCount: suppliers.length,
    totalWins,
    totalMoneyRub: round3(totalMoney),
    singleWinCount,
    singleWinSharePct: sharePct(singleWinCount, suppliers.length),
    concentration: {
      top5WinsPct: sharePct(sumWins(suppliers, 5), totalWins),
      top10WinsPct: sharePct(sumWins(suppliers, 10), totalWins),
      top5MoneyPct: sharePct(sumMoney(byMoney, 5), totalMoney),
      top10MoneyPct: sharePct(sumMoney(byMoney, 10), totalMoney),
    },
    winsWithoutInn,
  };
}

/** Повторяющаяся пара «поставщик — заказчик»: факт о рынке, не обвинение. */
export interface SupplierCustomerPair {
  readonly supplierKey: string;
  readonly supplierName: string;
  readonly inn: string | null;
  readonly customer: string;
  readonly wins: number;
  readonly moneyRub: number;
  /** Предметы закупок этой пары — читатель видит механизм, а не гадает. */
  readonly subjects: readonly string[];
}

/**
 * Пары, встретившиеся не реже minWins раз. Одиннадцать побед Кузьминой А. А.
 * у УИО — это приобретение квартир для детей-сирот: продавец-физическое лицо,
 * единственный на конкретную квартиру. Поэтому рядом с парой всегда стоят
 * предметы: механизм объясняет сам себя (п.104).
 */
export function supplierCustomerPairs(
  procedures: readonly MonitoringProcedure[],
  minWins = 3,
): SupplierCustomerPair[] {
  const acc = new Map<string, {
    supplierKey: string; supplierName: string; inn: string | null; customer: string;
    wins: number; money: number; subjects: string[];
  }>();

  for (const p of procedures) {
    if (p.stage !== 'awarded' || p.customer === '') continue;
    const key = supplierKey(p.winner);
    if (key === null) continue;
    const pairKey = `${key}|${p.customerNormalized}`;
    let bucket = acc.get(pairKey);
    if (bucket === undefined) {
      bucket = {
        supplierKey: key,
        supplierName: p.winner.name ?? p.winner.raw,
        inn: p.winner.inn,
        customer: p.customer,
        wins: 0,
        money: 0,
        subjects: [],
      };
      acc.set(pairKey, bucket);
    }
    bucket.wins += 1;
    bucket.money += p.auctionPrice ?? 0;
    if (p.subject !== '' && bucket.subjects.length < 5 && !bucket.subjects.includes(p.subject)) {
      bucket.subjects.push(p.subject);
    }
  }

  return [...acc.values()]
    .filter((b) => b.wins >= minWins)
    .map((b) => ({
      supplierKey: b.supplierKey,
      supplierName: b.supplierName,
      inn: b.inn,
      customer: b.customer,
      wins: b.wins,
      moneyRub: round3(b.money),
      subjects: b.subjects,
    }))
    .sort((a, b) => b.wins - a.wins || b.moneyRub - a.moneyRub);
}

// ── §3.4. Сроки этапов и их разброс ──────────────────────────────────

export type DurationStageKey = 'toPublication' | 'toDeadline' | 'toAuction' | 'total';

export interface DurationOutlier {
  readonly sheet: string;
  readonly row: number;
  readonly code: string | null;
  readonly days: number;
  readonly reason: 'negative' | 'long';
}

export interface DurationStats {
  readonly key: DurationStageKey;
  readonly label: string;
  readonly count: number;
  readonly medianDays: number | null;
  readonly meanDays: number | null;
  readonly minDays: number | null;
  readonly maxDays: number | null;
  readonly q1Days: number | null;
  readonly q3Days: number | null;
  /** Отрицательная длительность: торги раньше публикации — ошибка набора даты. */
  readonly negativeCount: number;
  readonly outliers: readonly DurationOutlier[];
}

const DURATION_LABELS: Record<DurationStageKey, string> = {
  toPublication: 'Заявка → публикация',
  toDeadline: 'Публикация → окончание подачи',
  toAuction: 'Окончание подачи → торги',
  total: 'Заявка → торги (весь путь)',
};

/**
 * Сроки этапов в календарных днях. Медианы устойчивы (4 / 9 / 4 дня, весь
 * путь 17), средние испорчены выбросами — и это не «плохие данные», а прямой
 * сигнал: двенадцать процедур имеют отрицательную длительность этапа. Каждая
 * такая строка едет в список выбросов с адресом.
 */
export function stageDurations(
  procedures: readonly MonitoringProcedure[],
  outlierLimit = 20,
): DurationStats[] {
  const keys: DurationStageKey[] = ['toPublication', 'toDeadline', 'toAuction', 'total'];

  return keys.map((key) => {
    const values: number[] = [];
    const rows: Array<{ sheet: string; row: number; code: string | null; days: number }> = [];
    for (const p of procedures) {
      const days = p.durations[key];
      if (days === null) continue;
      values.push(days);
      rows.push({ sheet: p.sheet, row: p.row, code: p.code, days });
    }
    const sorted = [...values].sort((a, b) => a - b);
    const q1 = quantile(sorted, 0.25);
    const q3 = quantile(sorted, 0.75);
    const longThreshold = q1 !== null && q3 !== null ? q3 + 1.5 * (q3 - q1) : null;

    const outliers: DurationOutlier[] = rows
      .filter((r) => r.days < 0 || (longThreshold !== null && r.days > longThreshold))
      .map((r) => ({ ...r, reason: r.days < 0 ? ('negative' as const) : ('long' as const) }))
      .sort((a, b) => a.days - b.days)
      .slice(0, outlierLimit);

    return {
      key,
      label: DURATION_LABELS[key],
      count: values.length,
      medianDays: quantile(sorted, 0.5),
      meanDays: mean(values),
      minDays: sorted.length > 0 ? sorted[0] : null,
      maxDays: sorted.length > 0 ? sorted[sorted.length - 1] : null,
      q1Days: q1,
      q3Days: q3,
      negativeCount: values.filter((v) => v < 0).length,
      outliers,
    };
  });
}

// ── §3.5. Сезонность ─────────────────────────────────────────────────

/** По какой дате строится сезонность: обе содержательны, подмена меняет картину. */
export type SeasonBasis = 'publication' | 'auction';

export interface SeasonPoint {
  /** «2026-03» для месяца, «2026-I» для квартала. */
  readonly period: string;
  readonly count: number;
  readonly nmckRub: number;
  readonly priceRub: number;
}

export interface Seasonality {
  readonly basis: SeasonBasis;
  readonly months: readonly SeasonPoint[];
  readonly quarters: readonly SeasonPoint[];
  /** Строк без выбранной даты — счёт объявляется неполным честно. */
  readonly undated: number;
}

export function seasonality(
  procedures: readonly MonitoringProcedure[],
  basis: SeasonBasis = 'publication',
): Seasonality {
  const months = new Map<string, { count: number; nmck: number; price: number }>();
  const quarters = new Map<string, { count: number; nmck: number; price: number }>();
  let undated = 0;

  for (const p of procedures) {
    const iso = basis === 'publication' ? p.publicationDate?.iso ?? null : p.auctionDate?.iso ?? null;
    if (iso === null) {
      undated += 1;
      continue;
    }
    for (const [map, period] of [
      [months, isoMonth(iso)],
      [quarters, isoQuarter(iso)],
    ] as const) {
      if (period === null) continue;
      const bucket = map.get(period);
      if (bucket === undefined) {
        map.set(period, { count: 1, nmck: p.nmck ?? 0, price: p.auctionPrice ?? 0 });
      } else {
        bucket.count += 1;
        bucket.nmck += p.nmck ?? 0;
        bucket.price += p.auctionPrice ?? 0;
      }
    }
  }

  const toPoints = (map: Map<string, { count: number; nmck: number; price: number }>): SeasonPoint[] =>
    [...map.entries()]
      .map(([period, b]) => ({
        period,
        count: b.count,
        nmckRub: round3(b.nmck),
        priceRub: round3(b.price),
      }))
      .sort((a, b) => a.period.localeCompare(b.period));

  return { basis, months: toPoints(months), quarters: toPoints(quarters), undated };
}

// ── §2.6. Корзины НМЦК ───────────────────────────────────────────────

export type NmckBucketKey = 'до100к' | '100к-600к' | '600к-3м' | '3м-20м' | 'свыше20м';

export interface NmckBucket {
  readonly key: NmckBucketKey;
  readonly label: string;
  readonly count: number;
  readonly nmckRub: number;
  /** Портфельное снижение внутри корзины, % — мелкие и крупные ведут себя по-разному. */
  readonly reductionPct: number | null;
}

const NMCK_BUCKET_DEFS: ReadonlyArray<{ key: NmckBucketKey; label: string; max: number | null }> = [
  { key: 'до100к', label: 'до 100 тыс. руб.', max: 100_000 },
  { key: '100к-600к', label: 'от 100 до 600 тыс. руб.', max: 600_000 },
  { key: '600к-3м', label: 'от 0,6 до 3 млн руб.', max: 3_000_000 },
  { key: '3м-20м', label: 'от 3 до 20 млн руб.', max: 20_000_000 },
  { key: 'свыше20м', label: 'свыше 20 млн руб.', max: null },
];

/** Корзина НМЦК строки; null — суммы нет. */
export function nmckBucketOf(nmck: number | null): NmckBucketKey | null {
  if (nmck === null) return null;
  for (const def of NMCK_BUCKET_DEFS) {
    if (def.max === null || nmck < def.max) return def.key;
  }
  return 'свыше20м';
}

export function nmckBuckets(procedures: readonly MonitoringProcedure[]): NmckBucket[] {
  const acc = new Map<NmckBucketKey, { count: number; nmck: number; awardedNmck: number; price: number }>();
  for (const def of NMCK_BUCKET_DEFS) {
    acc.set(def.key, { count: 0, nmck: 0, awardedNmck: 0, price: 0 });
  }
  for (const p of procedures) {
    const key = nmckBucketOf(p.nmck);
    if (key === null) continue;
    const bucket = acc.get(key);
    if (bucket === undefined) continue;
    bucket.count += 1;
    bucket.nmck += p.nmck ?? 0;
    if (p.stage === 'awarded' && p.auctionPrice !== null && p.nmck !== null) {
      bucket.awardedNmck += p.nmck;
      bucket.price += p.auctionPrice;
    }
  }
  return NMCK_BUCKET_DEFS.map((def) => {
    const b = acc.get(def.key) ?? { count: 0, nmck: 0, awardedNmck: 0, price: 0 };
    return {
      key: def.key,
      label: def.label,
      count: b.count,
      nmckRub: round3(b.nmck),
      reductionPct: b.awardedNmck === 0 ? null : ((b.awardedNmck - b.price) / b.awardedNmck) * 100,
    };
  });
}

// ── §3.7. Сравнение управлений ───────────────────────────────────────

export interface DeptComparisonRow {
  readonly dept: string;
  readonly sheet: string;
  readonly count: number;
  readonly nmckRub: number;
  readonly priceRub: number;
  readonly savingsBookRub: number;
  /** Портфельное снижение управления, %. */
  readonly reductionPct: number | null;
  /** Доля процедур с реальным снижением среди состоявшихся, %. */
  readonly withReductionSharePct: number | null;
  /** Доля процедур без результата (цена ровно ноль), %. */
  readonly noResultSharePct: number | null;
  /** Медианный срок «заявка → торги», дней. */
  readonly medianTotalDays: number | null;
  /** Доля строк, где контроль книги показывает «ошибка», %. */
  readonly controlErrorSharePct: number | null;
  /** Доля строк с экономией, не расписанной по бюджетам, %. */
  readonly splitMissingSharePct: number | null;
}

/**
 * Сравнение по НОРМИРОВАННЫМ величинам: иначе УО со 108 процедурами всегда
 * «лучший», а УФБП с четырьмя — всегда «худший». Крайности объясняются
 * предметом закупок (УИО с 1,15 % ведёт приобретение квартир, где снижения
 * нет по природе предмета), а не выставляются оценкой.
 */
export function deptComparison(
  procedures: readonly MonitoringProcedure[],
): DeptComparisonRow[] {
  const acc = new Map<string, {
    sheet: string; count: number; nmck: number; price: number; savings: number;
    awardedNmck: number; awardedPrice: number; awarded: number; reduced: number;
    noResult: number; controlErrors: number; splitMissing: number; totals: number[];
  }>();

  for (const p of procedures) {
    let b = acc.get(p.dept);
    if (b === undefined) {
      b = {
        sheet: p.sheet, count: 0, nmck: 0, price: 0, savings: 0,
        awardedNmck: 0, awardedPrice: 0, awarded: 0, reduced: 0,
        noResult: 0, controlErrors: 0, splitMissing: 0, totals: [],
      };
      acc.set(p.dept, b);
    }
    b.count += 1;
    b.nmck += p.nmck ?? 0;
    b.price += p.auctionPrice ?? 0;
    b.savings += p.savingsTotal ?? 0;
    if (p.stage === 'no_result') b.noResult += 1;
    if (p.controlAgrees === false) b.controlErrors += 1;
    if (p.savingsTotal !== null && p.savingsTotal !== 0 && p.savingsSplitSum === null) b.splitMissing += 1;
    if (p.stage === 'awarded' && p.auctionPrice !== null && p.nmck !== null && p.nmck > 0) {
      b.awarded += 1;
      b.awardedNmck += p.nmck;
      b.awardedPrice += p.auctionPrice;
      if (p.nmck - p.auctionPrice > 0.005) b.reduced += 1;
    }
    if (p.durations.total !== null) b.totals.push(p.durations.total);
  }

  return [...acc.entries()]
    .map(([dept, b]) => ({
      dept,
      sheet: b.sheet,
      count: b.count,
      nmckRub: round3(b.nmck),
      priceRub: round3(b.price),
      savingsBookRub: round3(b.savings),
      reductionPct: b.awardedNmck === 0 ? null : ((b.awardedNmck - b.awardedPrice) / b.awardedNmck) * 100,
      withReductionSharePct: sharePct(b.reduced, b.awarded),
      noResultSharePct: sharePct(b.noResult, b.count),
      medianTotalDays: median(b.totals),
      controlErrorSharePct: sharePct(b.controlErrors, b.count),
      splitMissingSharePct: sharePct(b.splitMissing, b.count),
    }))
    .sort((a, b) => b.count - a.count || a.dept.localeCompare(b.dept, 'ru'));
}

// ── §3.6, §3.8. Несостоявшиеся и аномалии ────────────────────────────

export interface UnsuccessfulProcedures {
  readonly count: number;
  readonly sharePct: number | null;
  /** Деньги, которые за ними стоят (НМЦК), руб. */
  readonly nmckRub: number;
  readonly byDept: ReadonlyArray<{ dept: string; count: number; nmckRub: number }>;
  /** Тексты исходов из ячейки победителя и их частота. */
  readonly outcomes: ReadonlyArray<{ text: string; count: number }>;
}

/** Процедуры с ценой ровно ноль — торги без результата (5,6 % реестра). */
export function unsuccessfulProcedures(
  procedures: readonly MonitoringProcedure[],
): UnsuccessfulProcedures {
  const byDept = new Map<string, { count: number; nmck: number }>();
  const outcomes = new Map<string, number>();
  let count = 0;
  let nmck = 0;

  for (const p of procedures) {
    if (p.stage !== 'no_result') continue;
    count += 1;
    nmck += p.nmck ?? 0;
    const b = byDept.get(p.dept);
    if (b === undefined) byDept.set(p.dept, { count: 1, nmck: p.nmck ?? 0 });
    else {
      b.count += 1;
      b.nmck += p.nmck ?? 0;
    }
    const text = p.winner.outcomeText ?? p.winner.raw;
    if (text !== '') outcomes.set(text, (outcomes.get(text) ?? 0) + 1);
  }

  return {
    count,
    sharePct: sharePct(count, procedures.length),
    nmckRub: round3(nmck),
    byDept: [...byDept.entries()]
      .map(([dept, b]) => ({ dept, count: b.count, nmckRub: round3(b.nmck) }))
      .sort((a, b) => b.count - a.count),
    outcomes: [...outcomes.entries()]
      .map(([text, c]) => ({ text, count: c }))
      .sort((a, b) => b.count - a.count),
  };
}

export type AnomalyKind =
  /** Снижение свыше 50 %: либо НМЦК завышена, либо демпинг — всегда повод посмотреть. */
  | 'deep-reduction'
  /** Цена ровно ноль при заполненных датах торгов. */
  | 'zero-price'
  /** Одинаковые суммы НМЦК до копейки в трёх и более строках. */
  | 'equal-nmck'
  /** Один код процедуры дважды — не считая штатной формы совместной закупки. */
  | 'duplicate-code'
  /** Экономия внесена вручную: формула на строке разорвана. */
  | 'manual-savings'
  /** ВСЕГО ≠ МБ+КБ+ФБ — экономия не расписана по бюджетам. */
  | 'control-gap';

export interface AnomalyRef {
  readonly sheet: string;
  readonly row: number;
  readonly code: string | null;
  /** Что именно увидено на этой строке, одной фразой. */
  readonly note: string;
}

export interface AnomalyGroup {
  readonly kind: AnomalyKind;
  readonly title: string;
  /** Механизм: почему так вышло (карточка диагноста, п.53). */
  readonly mechanism: string;
  /** Действие: что сделать читателю. */
  readonly action: string;
  readonly count: number;
  readonly refs: readonly AnomalyRef[];
}

/** Шесть машинных проверок §3.8, каждая с адресом строки. */
export function detectAnomalies(
  procedures: readonly MonitoringProcedure[],
  refLimit = 60,
): AnomalyGroup[] {
  const deep: AnomalyRef[] = [];
  const zero: AnomalyRef[] = [];
  const manual: AnomalyRef[] = [];
  const control: AnomalyRef[] = [];
  const byNmck = new Map<number, MonitoringProcedure[]>();
  const byCode = new Map<string, MonitoringProcedure[]>();

  for (const p of procedures) {
    if (p.reductionPct !== null && p.reductionPct > 50) {
      deep.push({
        sheet: p.sheet, row: p.row, code: p.code,
        note: `Снижение ${p.reductionPct.toFixed(1)} % от начальной цены.`,
      });
    }
    if (p.stage === 'no_result') {
      zero.push({
        sheet: p.sheet, row: p.row, code: p.code,
        note: p.auctionDate?.iso != null
          ? 'Цена аукциона ровно ноль при заполненной дате торгов.'
          : 'Цена аукциона ровно ноль.',
      });
    }
    for (const defect of p.defects) {
      if (defect.kind === 'manual-savings') {
        manual.push({ sheet: p.sheet, row: p.row, code: p.code, note: defect.note });
      }
    }
    if (p.controlAgrees === false) {
      control.push({
        sheet: p.sheet, row: p.row, code: p.code,
        note: `ВСЕГО и МБ+КБ+ФБ расходятся на ${(p.controlGapRub ?? 0).toFixed(2)} руб.`,
      });
    }
    if (p.nmck !== null && p.nmck > 0) {
      const bucket = byNmck.get(p.nmck);
      if (bucket === undefined) byNmck.set(p.nmck, [p]);
      else bucket.push(p);
    }
    if (p.code !== null) {
      const bucket = byCode.get(p.code);
      if (bucket === undefined) byCode.set(p.code, [p]);
      else bucket.push(p);
    }
  }

  const equal: AnomalyRef[] = [];
  for (const [value, rows] of byNmck) {
    if (rows.length < 3) continue;
    for (const p of rows) {
      equal.push({
        sheet: p.sheet, row: p.row, code: p.code,
        note: `Начальная цена ${value.toFixed(2)} руб. встречается в ${rows.length} строках книги.`,
      });
    }
  }

  const dupes: AnomalyRef[] = [];
  for (const [code, rows] of byCode) {
    if (rows.length < 2) continue;
    const sheets = new Set(rows.map((r) => r.sheet));
    const sameSheet = sheets.size < rows.length;
    // Совместная закупка (ЭАС) на разных листах — штатная форма: каждое
    // управление ведёт свою долю. Аномалия — только дубль внутри листа
    // либо повтор кода у несовместной процедуры.
    const jointAcrossSheets = !sameSheet && rows.every((r) => r.joint);
    if (jointAcrossSheets) continue;
    for (const p of rows) {
      dupes.push({
        sheet: p.sheet, row: p.row, code,
        note: sameSheet
          ? `Код ${code} встречается на этом листе больше одного раза.`
          : `Код ${code} встречается на ${sheets.size} листах, и процедура не помечена как совместная.`,
      });
    }
  }

  const groups: AnomalyGroup[] = [
    {
      kind: 'deep-reduction',
      title: 'Снижение свыше 50 %',
      mechanism: 'Цена на торгах упала больше чем вдвое: либо начальная цена посчитана с запасом, либо участник пошёл в глубокий демпинг.',
      action: 'Посмотреть предмет и число участников — это не нарушение само по себе, но всегда повод взглянуть.',
      count: deep.length,
      refs: deep.slice(0, refLimit),
    },
    {
      kind: 'zero-price',
      title: 'Торги без результата',
      mechanism: 'Цена аукциона равна нулю: заявок не подано либо процедура не состоялась по другой причине. Ноль здесь — содержание, а не пустота.',
      action: 'Проверить по переходящему реестру, объявлена ли процедура заново.',
      count: zero.length,
      refs: zero.slice(0, refLimit),
    },
    {
      kind: 'equal-nmck',
      title: 'Одинаковые начальные цены',
      mechanism: 'Одна и та же сумма до копейки встречается в трёх и более процедурах: чаще всего это типовые закупки по одному расчёту, реже — копия строки.',
      action: 'Сверить предметы: совпадение суммы при разных предметах требует взгляда.',
      count: equal.length,
      refs: equal.slice(0, refLimit),
    },
    {
      kind: 'duplicate-code',
      title: 'Код процедуры повторяется',
      mechanism: 'Один код стоит у нескольких строк. У совместной закупки это норма — каждое управление ведёт свою долю, — но повтор внутри одного листа означает копию строки либо ошибку в наборе кода.',
      action: 'Сверить строки между собой: если это две разные закупки, один из кодов набран неверно.',
      count: dupes.length,
      refs: dupes.slice(0, refLimit),
    },
    {
      kind: 'manual-savings',
      title: 'Экономия внесена вручную',
      mechanism: 'Формула книги считает ОКРУГЛ(НМЦК − цена; 3) даже при незаполненной цене, поэтому число забивают руками. Связь с исходными ячейками при этом рвётся.',
      action: 'Читать такую строку как «внесено вручную»: при изменении начальной цены экономия не пересчитается.',
      count: manual.length,
      refs: manual.slice(0, refLimit),
    },
    {
      kind: 'control-gap',
      title: 'Экономия не расписана по бюджетам',
      mechanism: 'Контроль книги сравнивает ВСЕГО с суммой МБ+КБ+ФБ; расхождение означает, что сэкономленные деньги не разнесены по источникам.',
      action: 'Заполнить разбивку: эти данные знает исполнитель, машинно они не восстанавливаются.',
      count: control.length,
      refs: control.slice(0, refLimit),
    },
  ];

  return groups.filter((g) => g.count > 0);
}

// ── Сборка всей аналитики ────────────────────────────────────────────

export interface MonitoringAnalytics {
  readonly funnel: StageFunnel;
  readonly reduction: ReductionCoefficients;
  readonly histogram: readonly DiscountBucket[];
  readonly suppliers: SupplierProfile;
  readonly pairs: readonly SupplierCustomerPair[];
  readonly durations: readonly DurationStats[];
  readonly seasonality: Seasonality;
  readonly nmckBuckets: readonly NmckBucket[];
  readonly depts: readonly DeptComparisonRow[];
  readonly unsuccessful: UnsuccessfulProcedures;
  readonly anomalies: readonly AnomalyGroup[];
}

export interface MonitoringAnalyticsOptions {
  readonly seasonBasis?: SeasonBasis;
  readonly pairMinWins?: number;
}

/** Вся аналитика вкладки одним вызовом — то, что уезжает в роут. */
export function monitoringAnalytics(
  procedures: readonly MonitoringProcedure[],
  options: MonitoringAnalyticsOptions = {},
): MonitoringAnalytics {
  return {
    funnel: stageFunnel(procedures),
    reduction: reductionCoefficients(procedures),
    histogram: discountHistogram(procedures),
    suppliers: supplierProfile(procedures),
    pairs: supplierCustomerPairs(procedures, options.pairMinWins ?? 3),
    durations: stageDurations(procedures),
    seasonality: seasonality(procedures, options.seasonBasis ?? 'publication'),
    nmckBuckets: nmckBuckets(procedures),
    depts: deptComparison(procedures),
    unsuccessful: unsuccessfulProcedures(procedures),
    anomalies: detectAnomalies(procedures),
  };
}
