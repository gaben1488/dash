/**
 * Паспорт числа вкладки «Мониторинг» — периметр из общесистемного дома
 * (`lib/perimeter.ts`), а не самодельная фраза «данные книги на …».
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ. Канон п.58 дословно: «я всегда должен точно
 * понимать, что где считается, по любой карточке на любой вкладке, за какой
 * период». До этого модуля вкладка носила самодельную подпись `readAtLabel`,
 * которая называла ОДНУ ось из пяти — момент чтения, — и молчала о четырёх
 * остальных. Молчание здесь опаснее обычного: у книги мониторинга ОТНОШЕНИЕ
 * К ШАПКЕ ОСОБОЕ, и почти ни один фильтр шапки к её числам не применяется.
 *
 * ЧТО КНИГА НЕ СЛУШАЕТ (проверено по коду вкладки, а не по памяти):
 *   • ГОД. Книга переходящая: на листах живут процедуры и 2025, и 2026 года,
 *     и читается она целиком (`Monitoring.tsx`, шапка вкладки). Поэтому ось
 *     года паспорта — «все годы», а не год из шапки.
 *   • ПЕРИОД (квартал, месяц, неделя). Из шапки не применяется вовсе; свой
 *     отбор по датам у вкладки есть, но он местный (`SliceState.period*`).
 *   • СПОСОБ, БЮДЖЕТ, ВИД ДЕЯТЕЛЬНОСТИ. В книге мониторинга способ живёт в
 *     префиксе кода процедуры, бюджета и вида деятельности у неё нет вовсе —
 *     ни одна из трёх осей шапки к её числам не применяется.
 *   • ПОДВЕДЫ. Заказчик в книге записан свободным текстом и со словарём
 *     подведов (колонка C книг ГРБС) строково не совпадает — сопоставление по
 *     похожести теряло бы строки, и продукт за него не берётся (решение
 *     владельца 20.08). Значит, фильтр подведомственных к числам не применим.
 *
 * ЧТО КНИГА СЛУШАЕТ: УПРАВЛЕНИЕ — и то не везде. Строки реестра и адресные
 * сигналы срезаются по листам выбранных управлений (`scopeProcedures`,
 * `scopeSignals`, канон п.127), а районные листы — свод, «25-26», справочник —
 * и вся аналитика считаются по ВСЕЙ книге. Отсюда две области паспорта:
 * `'registry'` (управление применяется) и `'district'` (не применяется).
 *
 * ПОЧЕМУ ЭТО ЛУЧШЕ ПРЕЖНИХ ЯНТАРНЫХ ОГОВОРОК. Оговорка «аналитика ниже —
 * районная» стояла ОДНОЙ фразой над девятью блоками: она обещала поведение
 * сразу всей секции (болезнь A1 карты «Аналитики»), и любой блок, который
 * повёл бы себя иначе, соврал бы молча. Паспорт объявляет расхождение у
 * КАЖДОГО числа и делает это одной и той же конструкцией на всех вкладках,
 * так что читатель узнаёт её, не перечитывая.
 */
import { useMemo } from 'react';
import { useStore } from '../../store';
import {
  buildPerimeter,
  type Perimeter,
  type PerimeterFilterAxis,
} from '../perimeter';

/**
 * Область числа вкладки.
 *
 * `registry` — число посчитано по строкам реестра, а они срезаны выбранным
 * управлением (портрет, итог листа, счётчики разрезов).
 * `district` — число посчитано по всей районной книге независимо от выбора
 * управления (аналитика, свод, «25-26», справочник, сверка).
 */
export type MonitoringScopeKind = 'registry' | 'district';

/**
 * Оси шапки, которых книга мониторинга не слушает НИКОГДА. Управление в этот
 * список не входит: его применимость зависит от области числа.
 */
const ALWAYS_NOT_APPLICABLE: readonly PerimeterFilterAxis[] = [
  'period', 'subordinates', 'methods', 'budgets', 'activities',
];

export interface MonitoringPerimeterInput {
  /** Момент чтения книги сервером; `null` — сервер его не назвал. */
  readonly readAt: string | null;
  /** Область числа: срезано ли оно выбранным в шапке управлением. */
  readonly scope: MonitoringScopeKind;
  /** Точка отсчёта относительной фразы момента — тесты задают явно. */
  readonly now?: number;
}

/**
 * Состояние шапки, из которого собирается паспорт. Названо ровно так, как
 * лежит в store, — вкладка ничего не перекладывает руками.
 */
export interface MonitoringPerimeterFilters {
  readonly selectedDepartments: Iterable<string>;
  readonly selectedSubordinates: Iterable<string>;
  readonly selectedMethods: Iterable<string>;
  readonly selectedBudgets: Iterable<string>;
  readonly selectedActivities: Iterable<string>;
  readonly period: Parameters<typeof buildPerimeter>[0]['period'];
  readonly activeMonths: Iterable<number>;
}

/**
 * Паспорт числа вкладки. Собирается тем же `buildPerimeter`, что и паспорта
 * Пульта: второй способ собрать периметр означал бы, что он однажды разойдётся
 * с первым (канон п.112 «брать готовое»).
 *
 * Ось года здесь всегда `'all'` — «все годы». Это не потеря точности, а факт о
 * книге: она переходящая и читается целиком, и назвать здесь год из шапки
 * значило бы подписать числа периметром, которому они не подчиняются
 * (правило «б» дома периметра — ровно тот дефект, ради которого он появился).
 */
export function monitoringPerimeter(
  filters: MonitoringPerimeterFilters,
  input: MonitoringPerimeterInput,
): Perimeter {
  const notApplicable: PerimeterFilterAxis[] = [...ALWAYS_NOT_APPLICABLE];
  if (input.scope === 'district') notApplicable.push('departments');

  return buildPerimeter({
    year: 'all',
    period: filters.period,
    activeMonths: filters.activeMonths,
    departments: filters.selectedDepartments,
    subordinates: filters.selectedSubordinates,
    methods: filters.selectedMethods,
    budgets: filters.selectedBudgets,
    activities: filters.selectedActivities,
    readAt: input.readAt,
    notApplicable,
    ...(input.now !== undefined ? { now: input.now } : {}),
  });
}

/**
 * Паспорт прямо из шапки. Возвращает ОБА периметра сразу: у вкладки числа двух
 * областей стоят на одном экране, и собирать их двумя вызовами хука значило бы
 * дважды подписаться на одно и то же состояние.
 */
export function useMonitoringPerimeters(readAt: string | null): {
  readonly registry: Perimeter;
  readonly district: Perimeter;
} {
  const selectedDepartments = useStore((s) => s.selectedDepartments);
  const selectedSubordinates = useStore((s) => s.selectedSubordinates);
  const selectedMethods = useStore((s) => s.selectedMethods);
  const selectedBudgets = useStore((s) => s.selectedBudgets);
  const selectedActivities = useStore((s) => s.selectedActivities);
  const period = useStore((s) => s.period);
  const periodMode = useStore((s) => s.periodMode);
  const activeMonths = useStore((s) => s.activeMonths);

  return useMemo(() => {
    // Недельный режим месяцы в `activeMonths` не пишет; правило то же, что в
    // `perimeterFromFilters`, — период неделей не сужается.
    const months = periodMode === 'week' ? new Set<number>() : activeMonths;
    const filters: MonitoringPerimeterFilters = {
      selectedDepartments,
      selectedSubordinates,
      selectedMethods,
      selectedBudgets,
      selectedActivities,
      period,
      activeMonths: months,
    };
    return {
      registry: monitoringPerimeter(filters, { readAt, scope: 'registry' }),
      district: monitoringPerimeter(filters, { readAt, scope: 'district' }),
    };
  }, [
    selectedDepartments, selectedSubordinates, selectedMethods, selectedBudgets,
    selectedActivities, period, periodMode, activeMonths, readAt,
  ]);
}
