/**
 * Шесть чисел портрета реестра и три коэффициента снижения.
 *
 * ПОЧЕМУ СЧИТАЕТСЯ ЗДЕСЬ, А НЕ БЕРЁТСЯ ГОТОВЫМ. Портрет обязан описывать
 * ровно те строки, которые читатель сейчас видит: выбрал управление —
 * портрет про это управление, снял разрезы — про весь реестр. Готовый
 * серверный агрегат всегда про весь реестр и при действующем разрезе
 * рассказывал бы про другие строки, чем таблица под ним.
 *
 * ТРИ КОЭФФИЦИЕНТА, А НЕ ОДИН. На вопрос «сколько мы обычно экономим на
 * торгах» есть три разных правильных ответа, и они отвечают на разные
 * вопросы (спека §3.2):
 *   • портфельный — на сколько подешевел весь портфель денег;
 *   • среднее построчных — как ведёт себя типичная процедура, включая те,
 *     где снижения не было вовсе;
 *   • среднее там, где снижение было, — насколько падает цена, когда торги
 *     реально идут.
 * Разрыв между ними велик (по книге 9,7 % против 29,1 %) ровно потому, что у
 * почти половины состоявшихся процедур цена в точности равна начальной. Ни
 * один из трёх не имеет права молча выступать от имени остальных, поэтому
 * функция возвращает все три и знаменатель каждого.
 */
import type { RegistryProcedure } from './contract';

export interface DiscountCoefficient {
  /** Значение, %; null — считать не из чего. */
  value: number | null;
  /** Медиана того же ряда, %; null — ряд пуст либо коэффициент портфельный. */
  median: number | null;
  /** Сколько процедур в знаменателе — без этого числа процент нечитаем. */
  base: number;
}

export interface RegistryPortrait {
  /** Всего строк в показанном срезе. */
  total: number;
  /** Сумма НМЦК, руб. */
  nmckTotal: number;
  /** Строк, где НМЦК не читается числом, — знаменатель честности суммы. */
  nmckMissing: number;
  /** Состоявшиеся торги: цена больше нуля. */
  awardedCount: number;
  /** Сумма цен победителей по состоявшимся, руб. */
  priceTotal: number;
  /** Экономия на торгах: НМЦК − цена по состоявшимся, руб. */
  savingsTotal: number | null;
  /** Процедуры с ценой ровно ноль — торги без результата. */
  noResultCount: number;
  /** Их НМЦК, руб.: деньги, которые за несостоявшимися стоят. */
  noResultNmck: number;
  /** Цена в точности равна НМЦК — ни шага снижения. */
  noReductionCount: number;
  portfolio: DiscountCoefficient;
  perRow: DiscountCoefficient;
  whenReduced: DiscountCoefficient;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

export function portraitFrom(rows: readonly RegistryProcedure[]): RegistryPortrait {
  let nmckTotal = 0;
  let nmckMissing = 0;
  let awardedCount = 0;
  let awardedNmck = 0;
  let priceTotal = 0;
  let pairedPrice = 0;
  let noResultCount = 0;
  let noResultNmck = 0;
  let noReductionCount = 0;
  const perRowPct: number[] = [];
  const reducedPct: number[] = [];

  for (const p of rows) {
    if (p.nmck === null) nmckMissing += 1;
    else if (p.stage !== 'reissued') nmckTotal += p.nmck;

    if (p.stage === 'no_result') {
      noResultCount += 1;
      if (p.nmck !== null) noResultNmck += p.nmck;
      continue;
    }

    if (p.stage !== 'awarded' || p.factsEligible === false || p.auctionPrice === null || p.auctionPrice <= 0) continue;
    awardedCount += 1;
    priceTotal += p.auctionPrice;
    if (p.nmck === null || p.nmck <= 0) continue;

    pairedPrice += p.auctionPrice;
    awardedNmck += p.nmck;
    const pct = ((p.nmck - p.auctionPrice) / p.nmck) * 100;
    perRowPct.push(pct);
    if (p.nmck === p.auctionPrice) noReductionCount += 1;
    else if (pct > 0) reducedPct.push(pct);
  }

  const savingsTotal = perRowPct.length > 0 ? awardedNmck - pairedPrice : awardedCount > 0 ? null : 0;

  return {
    total: rows.length,
    nmckTotal,
    nmckMissing,
    awardedCount,
    priceTotal,
    savingsTotal,
    noResultCount,
    noResultNmck,
    noReductionCount,
    portfolio: {
      // Отношение сумм: знаменатель — НМЦК состоявшихся, а не всего реестра,
      // иначе несостоявшиеся торги разбавляли бы процент чужими деньгами.
      value: awardedNmck > 0 && savingsTotal !== null ? (savingsTotal / awardedNmck) * 100 : null,
      median: null,
      base: perRowPct.length,
    },
    perRow: {
      value: mean(perRowPct),
      median: median(perRowPct),
      base: perRowPct.length,
    },
    whenReduced: {
      value: mean(reducedPct),
      median: median(reducedPct),
      base: reducedPct.length,
    },
  };
}
