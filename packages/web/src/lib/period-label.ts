// ── Человекочитаемая подпись периода ДАННЫХ (один дом для всех вкладок).
//    Правило Д4/Д9 реестра дефектов: подпись обязана называть период,
//    за который посчитаны числа, а не выбор в шапке. Недельный выбор
//    расчёт не сужает (resolvePeriodSelection принимает только квартал и
//    месяцы) — поэтому неделя здесь сознательно НЕ участвует; про неё
//    потребитель предупреждает отдельно (см. DrillPieChart).

import type { PeriodScope } from '../store';

export const MONTH_ABBR = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'] as const;

const QUARTER_LABEL: Record<string, string> = {
  q1: '1 квартал',
  q2: '2 квартал',
  q3: '3 квартал',
  q4: '4 квартал',
};

/** Подпись периода данных: «2026 • весь год», «3 квартал 2026», «май 2026», «3 мес. 2026». */
export function periodDataLabel(opts: {
  /** Год данных; 'all' — все годы сразу (фильтр года снят). */
  year: number | 'all';
  period: PeriodScope;
  activeMonths: Set<number>;
}): string {
  const { period, activeMonths } = opts;
  const year = opts.year === 'all' ? 'все годы' : opts.year;
  if (activeMonths.size === 1) {
    const m = [...activeMonths][0];
    return `${MONTH_ABBR[m - 1] ?? m} ${year}`;
  }
  if (activeMonths.size > 0 && activeMonths.size < 12) {
    if (period !== 'year' && QUARTER_LABEL[period]) return `${QUARTER_LABEL[period]} ${year}`;
    return `${activeMonths.size} мес. ${year}`;
  }
  if (period !== 'year' && QUARTER_LABEL[period]) return `${QUARTER_LABEL[period]} ${year}`;
  return `${year} • весь год`;
}
