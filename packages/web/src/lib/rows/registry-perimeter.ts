/**
 * registry-perimeter.ts — паспорт периметра Реестра и его корзин.
 *
 * Канон п.58 (дословно владелец): «я всегда должен точно понимать, что где
 * считается, по любой карточке на любой вкладке, за какой период». Реестр
 * держал только половину ответа — бейдж периода из шапки: год, состав
 * управлений, срез по способу и бюджету и момент чтения книг на трёх вкладках
 * не назывались нигде.
 *
 * Свою фразу здесь не собирают: паспорт строит общий дом (`lib/perimeter`), а
 * этот модуль только заявляет, чем числа Реестра сужаются на самом деле. Ось
 * фильтра, к числу не применимую, объявляют вслух — у Реестра таких нет, и
 * пустой список `notApplicable` здесь утверждение, а не забывчивость:
 *
 *   • год       — уезжает в запрос (`params.year`);
 *   • период    — квартал и месяцы отбираются на экране по дате строки;
 *   • органы    — грузятся только выбранные управления, подведы уходят
 *                 отдельным параметром запроса;
 *   • срез      — способ и вид деятельности уезжают в запрос, источники
 *                 финансирования отбираются на экране;
 *   • момент    — из последнего чтения книг, а незнание момента остаётся
 *                 незнанием (см. `reading-moment`).
 *
 * Недельный выбор шапки Реестром не применяется — и не подменяется здесь
 * тишиной: правило «в недельном режиме месяцы период не сужают» держит
 * `perimeterFromFilters` за все вкладки сразу, поэтому ось периода честно
 * читается «весь год», а оговорку о неделе рядом печатает `PeriodBadge`.
 */
import { useMemo } from 'react';
import { useStore } from '../../store';
import { perimeterFromFilters, type Perimeter } from '../perimeter';

/** Паспорт периметра для чисел Реестра — из состояния шапки и момента чтения книг. */
export function useRegistryPerimeter(): Perimeter {
  const year = useStore((s) => s.year);
  const period = useStore((s) => s.period);
  const periodMode = useStore((s) => s.periodMode);
  const activeMonths = useStore((s) => s.activeMonths);
  const selectedDepartments = useStore((s) => s.selectedDepartments);
  const selectedSubordinates = useStore((s) => s.selectedSubordinates);
  const selectedMethods = useStore((s) => s.selectedMethods);
  const selectedBudgets = useStore((s) => s.selectedBudgets);
  const selectedActivities = useStore((s) => s.selectedActivities);
  const lastRefreshed = useStore((s) => s.lastRefreshed);

  return useMemo(
    () => perimeterFromFilters({
      year,
      period,
      periodMode,
      activeMonths,
      selectedDepartments,
      selectedSubordinates,
      selectedMethods,
      selectedBudgets,
      selectedActivities,
      lastRefreshed,
    }),
    [
      year, period, periodMode, activeMonths, selectedDepartments, selectedSubordinates,
      selectedMethods, selectedBudgets, selectedActivities, lastRefreshed,
    ],
  );
}
