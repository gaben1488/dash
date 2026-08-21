/**
 * Паспорт периметра карточек «Отчёта» — за что посчитано число этой секции.
 *
 * Канон п.58 дословно: «я всегда должен точно понимать, что где считается, по
 * любой карточке на любой вкладке, за какой период». До 21.08 секции «Отчёта»
 * несли только бейдж происхождения («расчёт» / «СВОД»); период, органы и
 * момент чтения читатель достраивал сам из шапки страницы — а шапка «Отчёта»
 * как раз и врёт больше всех: выбор управлений, способа, бюджета и поиска этот
 * документ не сужает вовсе.
 *
 * Поэтому паспорт строится ИЗ ДАННЫХ ответа (`report.period`), а неприменимые
 * оси объявляются через `notApplicable` — тот самый механизм правила (ж)
 * общего дома `lib/perimeter.ts`. Своего шаблона подписи здесь нет: фразу
 * собирает `perimeterLabel`, единственный на всю систему.
 */
import { isoOfDayNumber } from '@aemr/shared';

import { buildPerimeter, type Perimeter, type PerimeterFilterAxis } from '../perimeter';
import type { FilterContext } from '../filter-context';

/**
 * Оси шапки, которых «Отчёт» не применяет НИКОГДА (решение владельца 03.08:
 * отчёт — полный документ по всем восьми ГРБС, как бумага). Список назван
 * один раз и здесь: второй такой перечень в тексте плашек разошёлся бы с
 * этим молча.
 */
const REPORT_IGNORES: readonly PerimeterFilterAxis[] = [
  'departments', 'subordinates', 'methods', 'budgets', 'activities',
];

export interface ReportPerimeterInput {
  /**
   * Ровно то, что паспорту нужно от ответа: год, квартал и момент. Узкая
   * форма вместо целого `ReportResponse` — чтобы функция была проверяема на
   * фикстуре и не тянула за собой весь ответ роута ради двух полей.
   */
  report: {
    period: {
      year: number;
      quarter: 1 | 2 | 3 | 4;
      /** Номер суток архивного среза; нет — прямой эфир. */
      asOfDay?: number | undefined;
      /** true — числа на текущий момент; поля нет — считаем эфиром. */
      live?: boolean | undefined;
    };
  };
  ctx: FilterContext;
  /**
   * Блок считается по ВСЕМУ году, а не по отчётному кварталу: основания ЕП и
   * причины отклонений (`reasonsOf` ядра), закупки без финансирования (строки
   * без года плана). Для них ось периода тоже неприменима.
   */
  wholeYear?: boolean;
}

/**
 * Периметр секции отчёта. Год, квартал и момент — из ответа сервера; оси,
 * которых документ не знает, объявлены неприменимыми и получат от `perimeter`
 * готовые пометки вида «фильтр способа закупки к этому числу не применяется».
 */
export function reportPerimeter({ report, ctx, wholeYear = false }: ReportPerimeterInput): Perimeter {
  const notApplicable = wholeYear ? [...REPORT_IGNORES, 'period' as const] : REPORT_IGNORES;
  // Момент чтения: в эфире числа на сейчас, в архиве — снимок четверга среза.
  // Дату берём из ответа, а не из new Date(): у продукта свой календарь (+12).
  const live = report.period.live ?? true;
  const asOfDay = report.period.asOfDay;
  const asOf = live || asOfDay === undefined ? null : isoOfDayNumber(asOfDay);
  return buildPerimeter({
    year: report.period.year,
    period: wholeYear ? 'year' : (`q${report.period.quarter}` as const),
    departments: ctx.grbs,
    subordinates: ctx.subordinates,
    methods: ctx.methods,
    budgets: ctx.budgets,
    activities: ctx.activities,
    asOf,
    notApplicable,
  });
}
