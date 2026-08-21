/**
 * analytics-perimeter.ts — паспорт периметра каждой карточки «Аналитики».
 *
 * Канон п.58 (дословно владелец): «я всегда должен точно понимать, что где
 * считается, по любой карточке на любой вкладке, за какой период». До этого
 * модуля вкладка отвечала на вопрос строкой-хардкодом: `perimeter="2026 · все
 * кварталы"`. У такой подписи три беды сразу — год вморожен в текст и 1 января
 * начнёт врать, органы не названы ни в одной карточке, хотя фильтр управлений
 * на них действует (п.58а), и момент чтения книг не назван нигде (п.64г).
 *
 * Своей фразы здесь нет: паспорт собирает общий дом `lib/perimeter`, а этот
 * модуль только ЗАЯВЛЯЕТ, чем число каждой карточки сужается на самом деле.
 * Заявление сверено с кодом расчёта, а не с намерением:
 *
 *   • `useFilteredData` сужает `fd.depts` управлениями и учреждениями, но по
 *     способу, бюджету и виду деятельности пересчитывает только ТОТАЛЫ
 *     (`useFilteredData.ts:141-158`). Любая карточка, читающая `d.quarters` или
 *     `d.byActivity` напрямую, этим трём осям не подчиняется — и говорит об
 *     этом вслух, а не молчит;
 *   • карточки годового разрешения (кварталы, скорость, прогноз, качество
 *     заполнения, аномалии) периоду шапки не подчиняются по построению;
 *   • роут централизации фильтров не принимает вовсе — у карточки неприменима
 *     каждая ось.
 *
 * Пустой список `notApplicable` здесь — утверждение, а не забывчивость.
 */
import { useMemo } from 'react';
import { useStore } from '../../store';
import { shouldShowYearMismatch } from '../year-mismatch';
import {
  perimeterFromFilters,
  type Perimeter,
  type PerimeterDeclaration,
  type PerimeterFilterAxis,
  type PerimeterFilterState,
} from '../perimeter';

/** Карточки вкладки — по одному имени на карточку карты продукта. */
export type AnalyticsCardId =
  | 'kpi'
  | 'quarterlyTrend'
  | 'execTrend'
  | 'planFact'
  | 'shares'
  | 'structure'
  | 'activity'
  | 'velocity'
  | 'orgsDistrict'
  | 'orgsWithSubs'
  | 'forecast'
  | 'economy'
  | 'summary'
  | 'fillQuality'
  | 'issues'
  | 'anomalies'
  | 'centralization';

/** Все шесть осей фильтра — для карточек, не подчиняющихся ничему. */
const EVERY_AXIS: readonly PerimeterFilterAxis[] = [
  'period', 'departments', 'subordinates', 'methods', 'budgets', 'activities',
];

/** Три оси, которые `useFilteredData` до `fd.depts` не доводит. */
const SLICE_AXES: readonly PerimeterFilterAxis[] = ['methods', 'budgets', 'activities'];

/**
 * Чем сужается число каждой карточки. Адрес расчёта — в комментарии: заявление,
 * не проверяемое по коду, через полгода расходится с ним молча.
 */
export const ANALYTICS_CARD_DECLARATIONS: Readonly<Record<AnalyticsCardId, PerimeterDeclaration>> = {
  /** A2. Официальные показатели СВОД: `selectTopKpis` знает период и способ. */
  kpi: { notApplicable: ['subordinates', 'budgets', 'activities'] },
  /** A3. Все четыре квартала года разом — период карточку не сужает. */
  quarterlyTrend: { notApplicable: ['period', ...SLICE_AXES] },
  /** A4. Тренд по кварталам — то же годовое разрешение. */
  execTrend: { notApplicable: ['period', ...SLICE_AXES] },
  /** A5. План/факт за `periodKey` — период применяется, срез нет. */
  planFact: { notApplicable: SLICE_AXES },
  /** A6. Доли считаются из тех же квартальных сумм. */
  shares: { notApplicable: SLICE_AXES },
  /** A7. Структура расходов — факт за период. */
  structure: { notApplicable: SLICE_AXES },
  /**
   * A8. Разбивка по видам деятельности рисует ОБА ряда при выбранном виде:
   * карточка и есть разрез по этой оси, сужать её выбором значило бы стереть
   * половину сравнения. Ось названа неприменимой — п.58б закрыт словами.
   */
  activity: { notApplicable: SLICE_AXES },
  /** A9. Скорость — накопленный факт против ГОДОВОГО плана. */
  velocity: { notApplicable: ['period', ...SLICE_AXES] },
  /** A10, район: пятнадцать крупнейших организаций за весь год. */
  orgsDistrict: { notApplicable: ['period', 'subordinates', ...SLICE_AXES] },
  /** A10, режим подведомственных: организации выбранного управления за период. */
  orgsWithSubs: { notApplicable: SLICE_AXES },
  /** A11. Прогноз строится по годовому плану одного управления. */
  forecast: { notApplicable: ['period', 'subordinates', ...SLICE_AXES] },
  /**
   * A12. Роут `/api/rows/scatter` разбирает `type`, `activity` и `dept`;
   * `period`, `months` и `subordinate` он молча отбрасывает
   * (`server/routes/rows.ts:795-799`). Пока сервер не научен периметру
   * (работа 8.4 плана), карточка называет это вслух, а не носит бейдж периода
   * шапки — дословно запрещённый п.58б паттерн.
   */
  economy: { notApplicable: ['period', 'subordinates', 'budgets'] },
  /** A13. Сводка за `periodKey`. */
  summary: { notApplicable: SLICE_AXES },
  /** A14. Балл качества считается по книге целиком, без периода. */
  fillQuality: { notApplicable: ['period', 'subordinates', ...SLICE_AXES] },
  /** A15. `filterIssues` знает управления, учреждения и вид деятельности. */
  issues: { notApplicable: ['period', 'methods', 'budgets'] },
  /** A17. Проверки качества считаются по книге целиком. */
  anomalies: { notApplicable: ['period', 'subordinates', ...SLICE_AXES] },
  /** A16. Роут централизации фильтров не принимает вовсе. */
  centralization: { notApplicable: EVERY_AXIS },
};

/** Паспорта всех карточек из одного состояния — чистая функция, без React. */
export function buildAnalyticsPerimeters(
  state: PerimeterFilterState,
): Readonly<Record<AnalyticsCardId, Perimeter>> {
  const out = {} as Record<AnalyticsCardId, Perimeter>;
  for (const id of Object.keys(ANALYTICS_CARD_DECLARATIONS) as AnalyticsCardId[]) {
    out[id] = perimeterFromFilters(state, ANALYTICS_CARD_DECLARATIONS[id]);
  }
  return out;
}

/**
 * Паспорта всех карточек «Аналитики» из одного состояния шапки. Собираются
 * разом, чтобы год данных, недельный режим и момент чтения были у карточек
 * одни и те же: разъехавшиеся подписи соседних карточек одного экрана — та
 * самая болезнь, из-за которой п.58 и написан.
 */
export function useAnalyticsPerimeters(): Readonly<Record<AnalyticsCardId, Perimeter>> {
  const year = useStore((s) => s.year);
  const dataYear = useStore((s) => s.dataYear);
  const period = useStore((s) => s.period);
  const periodMode = useStore((s) => s.periodMode);
  const activeMonths = useStore((s) => s.activeMonths);
  const selectedDepartments = useStore((s) => s.selectedDepartments);
  const selectedSubordinates = useStore((s) => s.selectedSubordinates);
  const selectedMethods = useStore((s) => s.selectedMethods);
  const selectedBudgets = useStore((s) => s.selectedBudgets);
  const selectedActivities = useStore((s) => s.selectedActivities);
  const lastRefreshed = useStore((s) => s.lastRefreshed);
  const loading = useStore((s) => s.loading);

  return useMemo(() => buildAnalyticsPerimeters({
    year,
    dataYear,
    // Год данных побеждает выбор шапки: числа посчитаны по нему, и подпись
    // обязана назвать именно его (`lib/year-mismatch.ts` — одно правило на
    // весь продукт, второй его копии здесь заводить нельзя).
    yearMismatch: shouldShowYearMismatch(year, dataYear, loading),
    period,
    periodMode,
    activeMonths,
    selectedDepartments,
    selectedSubordinates,
    selectedMethods,
    selectedBudgets,
    selectedActivities,
    lastRefreshed,
  }), [
    year, dataYear, loading, period, periodMode, activeMonths, selectedDepartments,
    selectedSubordinates, selectedMethods, selectedBudgets, selectedActivities, lastRefreshed,
  ]);
}
