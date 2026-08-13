// ── Человекочитаемая подпись периода ДАННЫХ (один дом для всех вкладок).
//
//    Правило Д4/Д9 реестра дефектов: подпись обязана называть период, за
//    который посчитаны числа, а не выбор в шапке. Недельный выбор расчёт не
//    сужает (resolvePeriodSelection принимает только квартал и месяцы) —
//    поэтому неделя здесь сознательно НЕ участвует; про неё потребитель
//    предупреждает отдельно (см. DrillPieChart).
//
//    Формулировки не сочиняются заново. Квартал приходит из `quarterLabel`
//    в `@aemr/shared` — там канон владельца от 29.07 («окончательно перейти
//    на 1 кв 2 кв 3 кв 4 кв везде по всей текстовке»), и здесь стояло
//    «3 квартал 2026» против «3 кв 2026» на «Своде»: один период, две
//    разные подписи на соседних экранах. Названия месяцев берутся из
//    `MONTHS` — того же дома, что и фильтр в шапке.

import { quarterLabel } from '@aemr/shared';
import { MONTHS, type PeriodScope } from '../store';

export const MONTH_ABBR = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'] as const;

/** Полные названия месяцев строчными: «январь», «сентябрь». */
const MONTH_FULL: Record<number, string> = Object.fromEntries(
  MONTHS.map(m => [m.id, m.full.toLowerCase()]),
);

/** Подпись «весь год», когда фильтр периода не сужает данные. */
const WHOLE_YEAR = 'весь год';

/** Номер квартала из ключа периода; null для года и неизвестных значений. */
function quarterOf(period: PeriodScope): number | null {
  if (period === 'year') return null;
  const q = Number(String(period).slice(1));
  return q >= 1 && q <= 4 ? q : null;
}

/**
 * Название периода без года: «весь год», «3 кв», «май», «3 мес.».
 * Отдельно от года — чтобы фраза собиралась по одному правилу во всех
 * случаях, а не по своему в каждой ветке.
 */
export function periodScopePhrase(period: PeriodScope, activeMonths: Set<number>): string {
  if (activeMonths.size === 1) {
    const m = [...activeMonths][0]!;
    return MONTH_FULL[m] ?? String(m);
  }
  const quarter = quarterOf(period);
  if (activeMonths.size > 0 && activeMonths.size < 12) {
    return quarter === null ? `${activeMonths.size} мес.` : quarterLabel(quarter);
  }
  return quarter === null ? WHOLE_YEAR : quarterLabel(quarter);
}

/**
 * Подпись периода данных: «весь год 2026», «3 кв 2026», «май 2026»,
 * «3 мес. 2026». Порядок слов один во всех ветках: сначала период, затем
 * год — фраза одинаково читается и в плашке, и внутри предложения
 * («числа за 3 кв 2026»).
 */
export function periodDataLabel(opts: {
  /** Год данных; 'all' — все годы сразу (фильтр года снят). */
  year: number | 'all';
  period: PeriodScope;
  activeMonths: Set<number>;
}): string {
  const scope = periodScopePhrase(opts.period, opts.activeMonths);

  if (opts.year === 'all') {
    // «весь год все годы» — бессмыслица; для снятого фильтра года своя фраза.
    return scope === WHOLE_YEAR ? 'все годы целиком' : `${scope}, все годы`;
  }

  return `${scope} ${opts.year}`;
}
