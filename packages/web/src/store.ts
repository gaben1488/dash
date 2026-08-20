import { create } from 'zustand';
import { ALL_DEPT_IDS, GRBS_ID_TO_DEPARTMENT_ID, SUBORDINATE_REGISTRY, type ActivityType, type DashboardData } from '@aemr/shared';
import { api, humanizeRequestError } from './api';
import { mergeSubordinates } from './lib/subordinates';
import { setOfficialProvenance } from './lib/provenance-registry';
import { toCanonicalDeptId } from './lib/dept-key';

/** СВОД — 6 страниц + legacy aliases */
export type Page =
  | 'dashboard'     // Пульт (сводная панель)
  | 'report'        // Отчёт (еженедельный отчёт по закупкам — проекция buildReport)
  | 'svod'          // СВОД ТД-ПМ (панель просмотра — точная копия листа)
  | 'data'          // Реестр (построчные данные)
  // Корзины Реестра (канон п.73в интервью 14.08.2026): собственные вкладки
  // навигации, каждая — Реестр с зафиксированным фильтром класса строк.
  | 'unfunded'      // Не обеспеченные финансированием (имя класса — канон п.23)
  | 'yearlong'      // Закупки, проводимые в течение года (канон п.71)
  | 'monitoring'    // Мониторинг — реестр процедур определения поставщика (канон п.69в/п.101а)
  | 'economy'       // Экономия
  | 'competition'   // Конкуренция (исходы 1–2: меньше ЕП, больше конкурентных)
  | 'discipline'    // Дисциплина (исход 3: список дел с эффектом, не рейтинг штрафов)
  | 'analytics'     // Аналитика
  | 'quality'       // Контроль (Trust+Recon+Issues+Journal)
  | 'recon'         // → Контроль (legacy alias)
  | 'trust'         // → Контроль (legacy alias)
  | 'issues'        // → Контроль (legacy alias)
  | 'recs'          // → Контроль (legacy alias)
  | 'journal'       // → Контроль/Журнал (legacy alias, now sub-tab)
  | 'settings';     // Система

/** Период фильтрации */
export type PeriodScope = 'year' | 'q1' | 'q2' | 'q3' | 'q4';

/** Единицы измерения денег */
export type MoneyUnit = 'тыс' | 'млн' | 'млрд';

/** Тип закупки (legacy single-select aliases kept for navigateTo compatibility) */
export type ProcurementFilter = 'all' | 'competitive' | 'single';

/**
 * Вид деятельности. Набор значений идёт от канонического ACTIVITY_TYPES
 * (@aemr/shared), а не переписан литералом (DEADCODE_DISPOSITION §W-6);
 * 'all' — только состояние фильтра «не сужать», видом деятельности не является.
 */
export type ActivityFilter = 'all' | ActivityType;

/** Тип бюджета */
export type BudgetType = 'fb' | 'kb' | 'mb';

/**
 * Period mode determines how period filtering works:
 * - 'week': Default. Периодного фильтра НЕТ — периметр данных = год.
 *   WeekRoller — только визуальная позиция (focusedWeekStart), не фильтр.
 *   Баг #5 реестра охоты 08.08: раньше сброс периода и прокрутка недель
 *   записывали месяцы недели в activeMonths — фильтр, невидимый для чипов
 *   (hasExplicitPeriodFilter) и URL, молча резал экран до месяца.
 *   Правило класса: в week-режиме activeMonths пуст, а всё, что в нём
 *   осталось от легаси-писателей, игнорируется на входе расчёта
 *   (useFilteredData). Resets to this on clearAllPeriods().
 * - 'explicit': User has manually selected months/quarters/year.
 *   WeekRoller is visual-only, doesn't drive data.
 */
export type PeriodMode = 'week' | 'explicit';

export function hasExplicitPeriodFilter(
  periodMode: PeriodMode,
  activeMonths: Set<number>,
  monthsByYear: Record<number, Set<number>>,
): boolean {
  if (periodMode !== 'explicit') return false;
  if (activeMonths.size > 0) return true;
  return Object.values(monthsByYear).some((months) => months.size > 0);
}

export interface ActiveFilterCountInput {
  yearChanged: boolean;
  moneyUnitChanged: boolean;
  selectedMethods: Set<string>;
  selectedActivities: Set<string>;
  selectedBudgets: Set<string>;
  selectedDepartments: Set<string>;
  selectedSubordinates: Set<string>;
  activeMonths: Set<number>;
  monthsByYear: Record<number, Set<number>>;
  periodMode: PeriodMode;
  searchQuery: string;
}

export function getActiveFilterCount(input: ActiveFilterCountInput): number {
  return (
    (input.yearChanged ? 1 : 0) +
    (input.moneyUnitChanged ? 1 : 0) +
    (input.selectedMethods.size > 0 ? 1 : 0) +
    (input.selectedActivities.size > 0 ? 1 : 0) +
    (input.selectedBudgets.size > 0 ? 1 : 0) +
    (input.selectedDepartments.size > 0 ? 1 : 0) +
    (input.selectedSubordinates.size > 0 ? 1 : 0) +
    (hasExplicitPeriodFilter(input.periodMode, input.activeMonths, input.monthsByYear) ? 1 : 0) +
    (input.searchQuery ? 1 : 0)
  );
}

// Здесь жила getMonthsForWeek (месяцы недели по понедельнику). Удалена 14.08
// вместе с багом #5 (реестр охоты 08.08): её единственным назначением было
// записывать месяцы недели в activeMonths — невидимый для чипов/URL фильтр
// периода. Week-режим — не фильтр (см. комментарий у PeriodMode ниже);
// не возвращать функцию без пересмотра канона периода.

// ── Динамические годы: не хардкодим, определяем от текущей даты ──
const FIRST_DATA_YEAR = 2025; // первый год с данными
const currentYear = new Date().getFullYear();
/** Доступные годы: от первого года данных до текущего+1, плюс "all" */
export const AVAILABLE_YEARS: number[] = Array.from(
  { length: currentYear - FIRST_DATA_YEAR + 2 },
  (_, i) => FIRST_DATA_YEAR + i,
);

/** Тип года: любой год из доступных ИЛИ 'all' для выбора всех */
export type YearFilter = number | 'all';

/** Месяцы (1-12) */
export const MONTHS = [
  { id: 1, short: 'Янв', full: 'Январь' },
  { id: 2, short: 'Фев', full: 'Февраль' },
  { id: 3, short: 'Мар', full: 'Март' },
  { id: 4, short: 'Апр', full: 'Апрель' },
  { id: 5, short: 'Май', full: 'Май' },
  { id: 6, short: 'Июн', full: 'Июнь' },
  { id: 7, short: 'Июл', full: 'Июль' },
  { id: 8, short: 'Авг', full: 'Август' },
  { id: 9, short: 'Сен', full: 'Сентябрь' },
  { id: 10, short: 'Окт', full: 'Октябрь' },
  { id: 11, short: 'Ноя', full: 'Ноябрь' },
  { id: 12, short: 'Дек', full: 'Декабрь' },
] as const;

/**
 * Fallback subordinates (используется до загрузки реальных данных из API).
 * ПРОИЗВОДНЫЕ от канонического SUBORDINATE_REGISTRY (single source of truth)
 * через мост GrbsId → DepartmentId (биекция УАГиЗО↔УАГЗО и т.д.).
 * Раньше — рукописная карта с плейсхолдерами («Школы») и непроверенными именами;
 * теперь — канон. Пустой массив = у управления нет подведов (управление = сама орг).
 * Полнота канона дозаполняется в subordinate-registry.ts; /api остаётся primary.
 */
export const SUBORDINATES_FALLBACK: Record<string, string[]> = (() => {
  const map: Record<string, string[]> = Object.fromEntries(ALL_DEPT_IDS.map((id) => [id, [] as string[]]));
  for (const sub of SUBORDINATE_REGISTRY) {
    if (sub.isOrgItself) continue; // строка самого управления — не подвед
    const deptId = GRBS_ID_TO_DEPARTMENT_ID[sub.grbsId]; // канон GrbsId → форма данных/фильтра
    // П.51 (14.08.2026): ключ пункта — canonicalName (ДОСЛОВНОЕ значение
    // колонки C книги), а не displayName. /api/rows/subordinates возвращает
    // живые значения C; displayName («КДМШ» против «МБУ ДО "КДМШ"» из книги)
    // не совпадал с ними строково, объединение fallback ∪ api плодило ДУБЛИ
    // одной организации и завышало счётчик подведов Пульта (класс «23 вместо
    // 22 у УКСиМП»). Ещё дефект того же ключа: фильтр строк сравнивает выбор
    // с живой колонкой C — displayName-чип отфильтровывал в ноль строк.
    (map[deptId] ??= []).push(sub.canonicalName);
  }
  return map;
})();

/** Месяцы, входящие в каждый квартал */
export const QUARTER_MONTHS: Record<string, number[]> = {
  q1: [1, 2, 3],
  q2: [4, 5, 6],
  q3: [7, 8, 9],
  q4: [10, 11, 12],
};

function omitYearSelection(
  monthsByYear: Record<number, Set<number>>,
  year: number,
): Record<number, Set<number>> {
  return Object.fromEntries(
    Object.entries(monthsByYear).filter(([key]) => Number(key) !== year),
  ) as Record<number, Set<number>>;
}

/** Get Monday of the week containing the given date */
export function getMondayOfWeek(d: Date): Date {
  const result = new Date(d);
  const day = result.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  result.setDate(result.getDate() + diff);
  result.setHours(0, 0, 0, 0);
  return result;
}

export interface AppState {
  // Навигация
  page: Page;
  setPage: (page: Page) => void;
  /*
   * Полей `sidebarCollapsed` / `toggleSidebar` здесь больше нет: боковая
   * панель удалена вместе с компонентом Sidebar.tsx, а поля продолжали
   * висеть в состоянии и попадать в каждый снимок хранилища
   * (DEADCODE_DISPOSITION_2026-06-05, раздел «мёртвые поля хранилища»;
   * инвентарь долга 18.08.2026, раздел «а»). Проверено по всем пакетам:
   * ни одного обращения к ним не осталось. Страж — сборка типов: попытка
   * прочитать поле из состояния теперь не проходит `pnpm typecheck`.
   */

  // Глобальные фильтры
  year: YearFilter;
  setYear: (year: YearFilter) => void;
  period: PeriodScope;
  setPeriod: (period: PeriodScope) => void;
  /** Period mode: 'week' = auto-derive from WeekRoller, 'explicit' = manual selection */
  periodMode: PeriodMode;
  /** Активные месяцы (toggle on/off) */
  activeMonths: Set<number>;
  toggleMonth: (month: number) => void;
  moneyUnit: MoneyUnit;
  setMoneyUnit: (unit: MoneyUnit) => void;
  /** Multi-select: выбранные способы закупки (empty = all) */
  selectedMethods: Set<string>;
  toggleMethod: (method: string) => void;
  clearMethods: () => void;
  /** Multi-select: выбранные виды деятельности (empty = all) */
  selectedActivities: Set<string>;
  toggleActivity: (activity: string) => void;
  clearActivities: () => void;
  /** Multi-select: выбранные типы бюджета (empty = all) */
  selectedBudgets: Set<string>;
  toggleBudget: (budget: BudgetType) => void;
  clearBudgets: () => void;
  /** Legacy single-select getters (computed from Sets for backward compat) */
  procurementFilter: ProcurementFilter;
  setProcurementFilter: (filter: ProcurementFilter) => void;
  activityFilter: ActivityFilter;
  setActivityFilter: (filter: ActivityFilter) => void;
  /** Поиск по тексту — то, что прямо сейчас набрано в поле (мгновенно) */
  searchQuery: string;
  /**
   * Поиск, «догоняющий» ввод: по нему считаются таблицы и сводки.
   * Отдельное поле нужно потому, что поле ввода обязано отзываться на каждую
   * букву, а полный пересчёт дэша (управления, подведы, KPI, графики) стоит
   * десятки миллисекунд и на каждой букве превращает набор в рывки.
   */
  searchQueryDebounced: string;
  setSearchQuery: (q: string) => void;
  /** Активная вкладка Quality страницы */
  qualityTab: 'trust' | 'recon' | 'issues' | 'recs' | 'journal' | 'scorecard';
  setQualityTab: (tab: 'trust' | 'recon' | 'issues' | 'recs' | 'journal' | 'scorecard') => void;
  /** Сброс всех фильтров */
  resetAllFilters: () => void;
  /** Навигация с предзаполненными фильтрами */
  navigateTo: (page: Page, filters?: Partial<{
    period: PeriodScope;
    department: string;
    procurement: ProcurementFilter;
    activity: ActivityFilter;
    subordinate: string;
    year: YearFilter;
    search: string;
    months: number[];
    category: string;
    qualityTab: 'trust' | 'recon' | 'issues' | 'recs' | 'journal' | 'scorecard';
    /** Ключи признаков строк для фильтра Реестра (готовый фильтр «Дисциплины»). */
    signals: string[];
  }>) => void;
  /**
   * Затравка фильтра признаков для Реестра: navigateTo('data', { signals })
   * кладёт ключи сюда, Реестр читает их ОДИН раз при открытии и очищает.
   * Отдельное поле, а не постоянный фильтр: признаки — локальный фильтр
   * страницы Реестра, глобальной оси признаков в шапке нет.
   */
  registrySignalSeed: string[];
  clearRegistrySignalSeed: () => void;
  /** Выбранные отделы (пустой Set = все) */
  selectedDepartments: Set<string>;
  toggleDepartment: (deptId: string) => void;
  selectAllDepartments: () => void;
  /** Выбранные подведомственные учреждения (пустой Set = все) */
  selectedSubordinates: Set<string>;
  toggleSubordinate: (sub: string) => void;
  clearSubordinates: () => void;
  /** Dept-only mode: depts where ONLY dept-level data shows (no subs) */
  deptOnlyMode: Set<string>;
  setDeptOnly: (deptId: string) => void;
  clearDeptOnly: (deptId: string) => void;
  /** Выбрать/снять все месяцы квартала */
  setQuarterMonths: (quarter: string) => void;
  /** Сбросить все месяцы */
  clearMonths: () => void;

  /** Per-year month selections (multi-year support) */
  monthsByYear: Record<number, Set<number>>;
  /** Toggle a month for a specific year — syncs year + activeMonths */
  toggleMonthInYear: (yr: number, month: number) => void;
  /** Toggle all months in a quarter for a specific year */
  toggleQuarterInYear: (yr: number, qKey: string) => void;
  /** Toggle all 12 months for a year (click on year label) */
  toggleYearFull: (yr: number) => void;
  /** Clear all per-year months */
  clearAllPeriods: () => void;

  /** Focused week start (Monday) for WeekRoller navigation */
  focusedWeekStart: Date;
  /** Shift focused week by ±N weeks */
  shiftFocusedWeek: (delta: number) => void;

  // Подведомственные учреждения (из API)
  subordinatesMap: Record<string, string[]>;
  subordinatesLoading: boolean;
  fetchSubordinates: () => Promise<void>;

  // Данные дашборда
  dashboardData: DashboardData | null;
  /** Год, за который загружены данные (из ответа API) */
  dataYear: number;
  loading: boolean;
  error: string | null;
  lastRefreshed: string | null;
  /** true если данные пришли из demo-снимка сервера (Google Sheets недоступен) */
  isDemo: boolean;

  // Действия
  fetchDashboard: (force?: boolean) => Promise<void>;
  /** Полное обновление: СВОД + 8 dept sheets + ШДЮ + pipeline */
  refresh: () => Promise<void>;
  /** Быстрая проверка: только СВОД (без перезагрузки dept sheets) */
  quickRefresh: () => Promise<void>;
  refreshResult: { sources: any[]; loading: boolean } | null;

  /**
   * Честные счётчики корзин Реестра (канон п.73в) для кнопок навигации:
   * считает сервер по тем же предикатам, что страницы-фильтры. null = ещё
   * не загружено или сервер не ответил — кнопка показывается БЕЗ числа
   * (отсутствие счёта не выдаётся за ноль строк).
   */
  bucketCounts: { unfunded: number; yearlong: number } | null;
  fetchBucketCounts: () => Promise<void>;

  // Утилиты
  formatMoney: (value: number) => string;
}

/**
 * Задержка «догоняющего» поиска. 220 мс — ниже порога, на котором пауза читается
 * как подвисание, и выше типичного интервала между нажатиями при беглом наборе:
 * слово из восьми букв даёт один пересчёт вместо восьми.
 */
export const SEARCH_DEBOUNCE_MS = 220;

let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

/** Снять отложенный пересчёт — иначе он «догонит» уже сброшенный фильтр. */
function cancelSearchDebounce(): void {
  if (searchDebounceTimer !== null) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }
}

/** Флаг: используются ли демо-данные сервера (не mock фронтенда) */
function isDemoData(data: DashboardData): boolean {
  return data.snapshot.id.startsWith('demo-');
}

/**
 * Счётчик запросов загрузки дашборда — общий для fetchDashboard/refresh/
 * quickRefresh (все трое пишут dashboardData).
 *
 * Баг #6 реестра охоты 08.08: булев страж `if (loading) return` молча
 * выбрасывал смену года во время загрузки — пользователь щёлкал год, ответ не
 * приходил никогда. Правило класса: новый запрос ПОБЕЖДАЕТ, а не выбрасывается —
 * каждый запрос получает номер, применяется только ответ последнего; устаревший
 * ответ (в т.ч. устаревшая ошибка) не трогает состояние.
 */
let dashboardRequestSeq = 0;

export const useStore = create<AppState>((set, get) => ({
  // Навигация
  page: 'dashboard',
  setPage: (page) => {
    if (page === 'journal') {
      set({ page: 'quality', qualityTab: 'journal' });
    } else {
      set({ page });
    }
  },

  // Фильтры — default year: current year if in AVAILABLE_YEARS, else last available
  year: (AVAILABLE_YEARS.includes(new Date().getFullYear())
    ? new Date().getFullYear()
    : AVAILABLE_YEARS[AVAILABLE_YEARS.length - 1]) as YearFilter,
  setYear: (year) => {
    // Mirror toggleMonthInYear/toggleQuarterInYear/toggleYearFull: when the user is in
    // explicit period-selection mode, switching the year (TimeDrum wheel scroll) must
    // re-sync activeMonths to the *new* year's own selection instead of leaving it stuck
    // on whatever months were active for the previously selected year.
    const { periodMode, monthsByYear } = get();
    if (periodMode === 'explicit' && typeof year === 'number') {
      set({ year, activeMonths: new Set(monthsByYear[year] ?? []) });
    } else {
      set({ year });
    }
  },
  period: 'year',
  setPeriod: (period) => set({ period, periodMode: 'explicit' as PeriodMode }),
  periodMode: 'week' as PeriodMode,
  // Дефолт — год (комментарий выше, store.ts:302). activeMonths ПУСТ при старте:
  // непустой activeMonths перекрывает period в resolvePeriodSelection (period-resolution.ts:55-57),
  // так что заполнение текущей неделей здесь молча узило дефолт до квартала (баг Б1,
  // docs/superpowers/specs/filter-system-target-2026-07-16.md §1,§2). focusedWeekStart
  // (ниже) остаётся текущей неделей — это только позиция WeekRoller, не фильтр.
  activeMonths: new Set<number>(),
  toggleMonth: (month) => {
    const current = new Set(get().activeMonths);
    if (current.has(month)) {
      current.delete(month);
    } else {
      current.add(month);
    }
    // Manual month toggle → switch to explicit mode
    set({ activeMonths: current, periodMode: 'explicit' as PeriodMode });
  },
  moneyUnit: 'тыс',
  setMoneyUnit: (moneyUnit) => set({ moneyUnit }),
  // Multi-select filters (empty Set = identity = "Все")
  // When all options are selected individually → collapse to empty Set (= identity)
  selectedMethods: new Set<string>(),
  toggleMethod: (method) => {
    const current = new Set(get().selectedMethods);
    if (current.has(method)) current.delete(method); else current.add(method);
    // All selected = identity (2 options: competitive, single)
    if (current.size >= 2) { current.clear(); }
    const pf = current.size === 0 ? 'all'
      : current.has('competitive') ? 'competitive' : 'single';
    set({ selectedMethods: current, procurementFilter: pf as ProcurementFilter });
  },
  clearMethods: () => set({ selectedMethods: new Set<string>(), procurementFilter: 'all' as ProcurementFilter }),
  selectedActivities: new Set<string>(),
  toggleActivity: (activity) => {
    const current = new Set(get().selectedActivities);
    if (current.has(activity)) current.delete(activity); else current.add(activity);
    // All selected = identity (3 options)
    if (current.size >= 3) { current.clear(); }
    const af = current.size === 1 ? [...current][0] as ActivityFilter : 'all';
    set({ selectedActivities: current, activityFilter: af });
  },
  clearActivities: () => set({ selectedActivities: new Set<string>(), activityFilter: 'all' as ActivityFilter }),
  selectedBudgets: new Set<string>(),
  toggleBudget: (budget) => {
    const current = new Set(get().selectedBudgets);
    if (current.has(budget)) current.delete(budget); else current.add(budget);
    // All selected = identity (3 options: fb, kb, mb)
    if (current.size >= 3) { current.clear(); }
    set({ selectedBudgets: current });
  },
  clearBudgets: () => set({ selectedBudgets: new Set<string>() }),
  // Legacy single-select (kept for backward compat with navigateTo/useFilteredData)
  procurementFilter: 'all',
  setProcurementFilter: (procurementFilter) => {
    // Sync to multi-select Set
    const methods = procurementFilter === 'all' ? new Set<string>()
      : procurementFilter === 'competitive' ? new Set(['competitive'])
      : new Set(['single']);
    set({ procurementFilter, selectedMethods: methods });
  },
  activityFilter: 'all',
  setActivityFilter: (activityFilter) => {
    // Sync to multi-select Set
    const activities = activityFilter === 'all' ? new Set<string>()
      : new Set([activityFilter]);
    set({ activityFilter, selectedActivities: activities });
  },
  searchQuery: '',
  searchQueryDebounced: '',
  setSearchQuery: (searchQuery) => {
    // Поле ввода обновляется сразу — курсор и буквы не должны ждать расчёта.
    set({ searchQuery });
    cancelSearchDebounce();
    if (searchQuery === '') {
      // Снятие поиска не откладываем: крестик и Escape обязаны немедленно
      // вернуть экран к полным данным, иначе кажется, что кнопка не сработала.
      set({ searchQueryDebounced: '' });
      return;
    }
    searchDebounceTimer = setTimeout(() => {
      searchDebounceTimer = null;
      set({ searchQueryDebounced: get().searchQuery });
    }, SEARCH_DEBOUNCE_MS);
  },
  qualityTab: 'recon',
  setQualityTab: (qualityTab) => set({ qualityTab }),
  registrySignalSeed: [],
  clearRegistrySignalSeed: () => set({ registrySignalSeed: [] }),
  resetAllFilters: () => {
    // Сброс должен быть мгновенным и окончательным: отложенный пересчёт,
    // поставленный последней набранной буквой, вернул бы поиск после сброса.
    cancelSearchDebounce();
    const monday = getMondayOfWeek(new Date());
    const currentYear = new Date().getFullYear();
    const defaultYear: YearFilter = AVAILABLE_YEARS.includes(currentYear)
      ? currentYear
      : AVAILABLE_YEARS[AVAILABLE_YEARS.length - 1];
    set({
      year: defaultYear,
      period: 'year',
      periodMode: 'week' as PeriodMode,
      moneyUnit: 'тыс',
      procurementFilter: 'all',
      activityFilter: 'all',
      selectedMethods: new Set<string>(),
      selectedActivities: new Set<string>(),
      selectedBudgets: new Set<string>(),
      selectedDepartments: new Set<string>(),
      selectedSubordinates: new Set<string>(),
      deptOnlyMode: new Set<string>(),
      activeMonths: new Set<number>(), // см. комментарий у дефолт-инициализации выше
      focusedWeekStart: monday,
      monthsByYear: {},
      searchQuery: '',
      searchQueryDebounced: '',
    });
  },
  navigateTo: (page, filters) => {
    const updates: Partial<Pick<AppState,
      'page' | 'period' | 'procurementFilter' | 'activityFilter' |
      'selectedMethods' | 'selectedActivities' |
      'selectedDepartments' | 'selectedSubordinates' | 'year' |
      'searchQuery' | 'searchQueryDebounced' | 'activeMonths' | 'qualityTab' |
      'periodMode' | 'monthsByYear' | 'registrySignalSeed'
    >> = { page };
    if (filters?.signals) {
      updates.registrySignalSeed = filters.signals;
    }
    // Период — АТОМАРНО (фильтр-спека 16.07, Б1-Б3): период/месяцы/режим меняются
    // вместе, иначе week-mode молча съедает переданный период, а старые месяцы
    // перебивают новый квартал.
    const rawTargetYear = filters?.year ?? get().year;
    const targetYear = typeof rawTargetYear === 'number' ? rawTargetYear : new Date().getFullYear();
    if (filters?.months) {
      updates.activeMonths = new Set(filters.months);
      updates.monthsByYear = { ...get().monthsByYear, [targetYear]: new Set(filters.months) };
      updates.period = 'year';
      updates.periodMode = 'explicit' as PeriodMode;
    } else if (filters?.period && filters.period !== 'year') {
      const months = QUARTER_MONTHS[filters.period] ?? [];
      updates.period = filters.period;
      updates.activeMonths = new Set(months);
      updates.monthsByYear = { ...get().monthsByYear, [targetYear]: new Set(months) };
      updates.periodMode = 'explicit' as PeriodMode;
    } else if (filters?.period === 'year') {
      updates.period = 'year';
      updates.activeMonths = new Set<number>();
      updates.monthsByYear = omitYearSelection(get().monthsByYear, targetYear);
      updates.periodMode = 'explicit' as PeriodMode;
    }
    if (filters?.procurement) {
      updates.procurementFilter = filters.procurement;
      updates.selectedMethods = filters.procurement === 'all'
        ? new Set<string>()
        : filters.procurement === 'competitive'
          ? new Set(['competitive'])
          : new Set(['single']);
    }
    if (filters?.activity) {
      updates.activityFilter = filters.activity;
      updates.selectedActivities = filters.activity === 'all'
        ? new Set<string>()
        : new Set([filters.activity]);
    }
    if (filters?.department) {
      // Канон ключа ГРБС — кириллица (Б5: латиница со страниц ломала issues/deltas-фильтры)
      updates.selectedDepartments = new Set([toCanonicalDeptId(filters.department)]);
    }
    if (filters?.subordinate) {
      updates.selectedSubordinates = new Set([filters.subordinate]);
    }
    if (filters?.year !== undefined) {
      updates.year = filters.year;
    }
    if (filters?.search !== undefined) {
      // Переход по ссылке/клику — не набор с клавиатуры: запрос применяется
      // целиком и сразу, откладывать нечего.
      cancelSearchDebounce();
      updates.searchQuery = filters.search;
      updates.searchQueryDebounced = filters.search;
    }
    // Quality tab: explicit qualityTab > legacy page IDs > category implies issues
    if (filters?.qualityTab) {
      updates.qualityTab = filters.qualityTab;
    } else if (page === 'recon') {
      updates.qualityTab = 'recon';
    } else if (page === 'issues') {
      updates.qualityTab = 'issues';
    } else if (page === 'recs') {
      updates.qualityTab = 'recs';
    } else if (page === 'trust') {
      updates.qualityTab = 'trust';
    } else if (page === 'journal') {
      updates.qualityTab = 'journal';
      updates.page = 'quality';
    } else if (page === 'quality' && (filters?.category || filters?.search)) {
      updates.qualityTab = 'issues';
    }
    set(updates);
  },
  selectedDepartments: new Set<string>(),
  toggleDepartment: (rawDeptId) => {
    // Канон ключа — кириллица (Б5): все писатели проходят одну точку.
    const deptId = toCanonicalDeptId(rawDeptId);
    const current = new Set(get().selectedDepartments);
    const deptOnly = new Set(get().deptOnlyMode);
    // Always clear dept-only when toggling via dept header (dept header = dept+subs)
    deptOnly.delete(deptId);
    if (current.has(deptId)) {
      current.delete(deptId);
      // Auto-clear subordinates of removed department
      const deptSubs = get().subordinatesMap[deptId] ?? [];
      if (deptSubs.length > 0) {
        const currentSubs = new Set(get().selectedSubordinates);
        let changed = false;
        for (const sub of deptSubs) {
          if (currentSubs.has(sub)) { currentSubs.delete(sub); changed = true; }
        }
        if (changed) set({ selectedDepartments: current, selectedSubordinates: currentSubs, deptOnlyMode: deptOnly });
        else set({ selectedDepartments: current, deptOnlyMode: deptOnly });
        return;
      }
    } else {
      current.add(deptId);
    }
    set({ selectedDepartments: current, deptOnlyMode: deptOnly });
  },
  selectAllDepartments: () => {
    const current = get().selectedDepartments;
    if (current.size > 0) {
      // Some selected → clear all (show all)
      set({ selectedDepartments: new Set<string>(), selectedSubordinates: new Set<string>(), deptOnlyMode: new Set<string>() });
    } else {
      // None selected → select all explicitly
      const allDepts = new Set<string>(ALL_DEPT_IDS);
      set({ selectedDepartments: allDepts, deptOnlyMode: new Set<string>() });
    }
  },
  selectedSubordinates: new Set<string>(),
  toggleSubordinate: (sub) => {
    const current = new Set(get().selectedSubordinates);
    if (current.has(sub)) {
      current.delete(sub);
    } else {
      current.add(sub);
    }
    set({ selectedSubordinates: current });
  },
  clearSubordinates: () => set({ selectedSubordinates: new Set<string>() }),
  deptOnlyMode: new Set<string>(),
  setDeptOnly: (deptId) => {
    const current = new Set(get().deptOnlyMode);
    current.add(deptId);
    // Ensure dept is selected
    const depts = new Set(get().selectedDepartments);
    depts.add(deptId);
    // Clear any sub selections for this dept
    const subs = new Set(get().selectedSubordinates);
    const deptSubs = get().subordinatesMap[deptId] ?? [];
    for (const s of deptSubs) subs.delete(s);
    set({ deptOnlyMode: current, selectedDepartments: depts, selectedSubordinates: subs });
  },
  clearDeptOnly: (deptId) => {
    const current = new Set(get().deptOnlyMode);
    current.delete(deptId);
    set({ deptOnlyMode: current });
  },
  setQuarterMonths: (quarter) => {
    const months = QUARTER_MONTHS[quarter];
    if (!months) return;
    const current = get().activeMonths;
    const allSelected = months.every(m => current.has(m));
    const next = new Set(current);
    if (allSelected) {
      months.forEach(m => next.delete(m));
    } else {
      months.forEach(m => next.add(m));
    }
    // If clearing all months → back to week mode; otherwise explicit.
    // Баг #5 (реестр охоты 08.08): «сброшенный» период обязан быть пустым
    // множеством, как в resetAllFilters, — запись месяцев текущей недели
    // ставила невидимый для чипов/URL фильтр месяца.
    if (next.size === 0) {
      const monday = getMondayOfWeek(new Date());
      set({ activeMonths: new Set<number>(), periodMode: 'week' as PeriodMode, focusedWeekStart: monday });
    } else {
      set({ activeMonths: next, periodMode: 'explicit' as PeriodMode });
    }
  },
  clearMonths: () => {
    const yr = get().year;
    const mby = typeof yr === 'number'
      ? omitYearSelection(get().monthsByYear, yr)
      : { ...get().monthsByYear };
    // Clearing months → back to week mode. Пустой Set, не месяцы недели (баг #5).
    const monday = getMondayOfWeek(new Date());
    set({
      activeMonths: new Set<number>(),
      monthsByYear: mby,
      periodMode: 'week' as PeriodMode,
      focusedWeekStart: monday,
    });
  },

  // Multi-year month selections
  monthsByYear: {} as Record<number, Set<number>>,

  toggleMonthInYear: (yr, month) => {
    let mby = { ...get().monthsByYear };
    const current = new Set(mby[yr] ?? []);
    if (current.has(month)) current.delete(month); else current.add(month);
    if (current.size === 0) mby = omitYearSelection(mby, yr);
    else mby[yr] = current;

    // Sync: set year to this year if it has selections, update activeMonths
    const targetYear = yr;
    const activeForTarget = mby[targetYear] ?? new Set<number>();

    // If all months cleared → back to week mode. Пустой Set, не месяцы недели (баг #5).
    if (activeForTarget.size === 0 && Object.keys(mby).length === 0) {
      const monday = getMondayOfWeek(new Date());
      set({ monthsByYear: mby, year: targetYear, activeMonths: new Set<number>(), periodMode: 'week' as PeriodMode, focusedWeekStart: monday });
    } else {
      set({ monthsByYear: mby, year: targetYear, activeMonths: new Set(activeForTarget), periodMode: 'explicit' as PeriodMode });
    }
  },

  toggleQuarterInYear: (yr, qKey) => {
    const months = QUARTER_MONTHS[qKey];
    if (!months) return;
    let mby = { ...get().monthsByYear };
    const current = new Set(mby[yr] ?? []);
    const allSelected = months.every(m => current.has(m));
    if (allSelected) {
      months.forEach(m => current.delete(m));
    } else {
      months.forEach(m => current.add(m));
    }
    if (current.size === 0) mby = omitYearSelection(mby, yr);
    else mby[yr] = current;

    const activeForYear = mby[yr] ?? new Set<number>();
    // If all months cleared → back to week mode. Пустой Set, не месяцы недели (баг #5).
    if (activeForYear.size === 0 && Object.keys(mby).length === 0) {
      const monday = getMondayOfWeek(new Date());
      set({ monthsByYear: mby, year: yr, activeMonths: new Set<number>(), periodMode: 'week' as PeriodMode, focusedWeekStart: monday });
    } else {
      set({ monthsByYear: mby, year: yr, activeMonths: new Set(activeForYear), periodMode: 'explicit' as PeriodMode });
    }
  },

  toggleYearFull: (yr) => {
    let mby = { ...get().monthsByYear };
    const current = mby[yr];
    const allSelected = current && current.size === 12;
    if (allSelected) {
      mby = omitYearSelection(mby, yr);
    } else {
      mby[yr] = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    }
    const activeForYear = mby[yr] ?? new Set<number>();
    // Пустой Set, не месяцы недели (баг #5).
    if (activeForYear.size === 0 && Object.keys(mby).length === 0) {
      const monday = getMondayOfWeek(new Date());
      set({ monthsByYear: mby, year: yr, activeMonths: new Set<number>(), periodMode: 'week' as PeriodMode, focusedWeekStart: monday });
    } else {
      set({ monthsByYear: mby, year: yr, activeMonths: new Set(activeForYear), periodMode: 'explicit' as PeriodMode });
    }
  },

  clearAllPeriods: () => {
    // Баг #5 (реестр охоты 08.08): «Сбросить период» ставил фильтр текущего
    // месяца (месяцы недели) и делал его невидимым для чипов/URL. Сброс — это
    // пустое множество, как в resetAllFilters: периметр возвращается к году.
    const monday = getMondayOfWeek(new Date());
    set({
      monthsByYear: {},
      activeMonths: new Set<number>(),
      focusedWeekStart: monday,
      periodMode: 'week' as PeriodMode,
      period: 'year' as PeriodScope,
    });
  },

  // Week roller
  focusedWeekStart: getMondayOfWeek(new Date()),
  shiftFocusedWeek: (delta) => {
    const current = get().focusedWeekStart;
    // Шаг — календарными сутками (setDate), не миллисекундами: DST-переход
    // при мс-арифметике сдвигал бы понедельник 00:xx в воскресенье 23:xx.
    const newDate = new Date(current);
    newDate.setDate(newDate.getDate() + delta * 7);
    const minYear = AVAILABLE_YEARS[0];
    const maxYear = AVAILABLE_YEARS[AVAILABLE_YEARS.length - 1];
    if (newDate.getFullYear() < minYear || newDate.getFullYear() > maxYear) return;
    const updates: Record<string, unknown> = { focusedWeekStart: newDate };
    const newYear = newDate.getFullYear();
    // Баг #13 (реестр охоты 08.08): в режиме явного выбора (explicit) колесо
    // недель меняло year и тем перезагружало данные, ломая выставленный период.
    // Год следует за неделей ТОЛЬКО в week-режиме; в explicit колесо — чистая
    // визуальная прокрутка.
    if (get().periodMode === 'week' && AVAILABLE_YEARS.includes(newYear)) {
      updates.year = newYear;
    }
    // Баг #5: месяцы недели в activeMonths НЕ записываются — week-режим не
    // фильтр (см. комментарий у PeriodMode). Раньше здесь появлялся невидимый
    // для чипов/URL фильтр месяца.
    set(updates as any);
  },

  // Подведы
  subordinatesMap: { ...SUBORDINATES_FALLBACK },
  subordinatesLoading: false,
  fetchSubordinates: async () => {
    if (get().subordinatesLoading) return;
    set({ subordinatesLoading: true });
    try {
      const data = await api.getSubordinates();
      if (data && Object.keys(data).length > 0) {
        // Объединение канона с живыми именами, НЕ замена: частично
        // прочитанная книга не должна вытеснять организации из фильтра
        // (баг «пропала часть организаций», см. lib/subordinates.ts).
        const merged = mergeSubordinates(SUBORDINATES_FALLBACK, data);
        set({ subordinatesMap: merged, subordinatesLoading: false });
      } else {
        set({ subordinatesLoading: false });
      }
    } catch {
      set({ subordinatesLoading: false });
    }
  },

  // Данные
  dashboardData: null,
  dataYear: new Date().getFullYear(),
  loading: false,
  error: null,
  lastRefreshed: null,
  isDemo: false,

  fetchDashboard: async (force = false) => {
    // Баг #6: НЕ выходим при get().loading — смена года во время загрузки
    // обязана дойти до сервера. Гонку решает номер запроса (см. dashboardRequestSeq).
    const seq = ++dashboardRequestSeq;
    set({ loading: true, error: null });
    try {
      const year = get().year;
      const data = await api.getDashboard(force, year);
      if (seq !== dashboardRequestSeq) return; // ответ устарел — победил более поздний запрос
      // Живой провенанс официальных метрик — попапам БЗ (Д11): лист, ячейка,
      // формула, время чтения каждой официальной строки СВОДа.
      setOfficialProvenance(
        (data as any).snapshot?.officialMetrics,
        (data as any).snapshot?.spreadsheetId,
      );
      set({
        dashboardData: data,
        dataYear: data.year ?? new Date().getFullYear(),
        lastRefreshed: data.lastRefreshed,
        loading: false,
        isDemo: isDemoData(data),
      });
    } catch (err) {
      if (seq !== dashboardRequestSeq) return; // устаревшая ошибка не затирает свежие данные
      // humanizeRequestError уже отдаёт законченную русскую фразу с действием.
      // Приставка через точку, а не через двоеточие: иначе в плашке шапки
      // выходило два двоеточия подряд («Не удалось…: Нет связи…: проверьте…»).
      const msg = humanizeRequestError(err);
      set({
        loading: false,
        error: `Данные не загружены. ${msg}`,
      });
    }
  },

  refreshResult: null,
  refresh: async () => {
    const seq = ++dashboardRequestSeq; // участвует в той же гонке, что fetchDashboard (баг #6)
    set({ loading: true, error: null, refreshResult: { sources: [], loading: true } });
    try {
      const year = get().year;
      const result = await api.refresh();
      const data = await api.getDashboard(false, year);
      if (seq !== dashboardRequestSeq) return;
      setOfficialProvenance(
        (data as any).snapshot?.officialMetrics,
        (data as any).snapshot?.spreadsheetId,
      );
      set({
        dashboardData: data,
        // Баг #11: dataYear пишется во ВСЕХ путях загрузки — иначе после
        // обновления баннер «данные за другой год» сравнивал год фильтра
        // с годом давно прошедшей загрузки.
        dataYear: data.year ?? new Date().getFullYear(),
        lastRefreshed: data.lastRefreshed,
        loading: false,
        isDemo: isDemoData(data),
        refreshResult: { sources: result.sources ?? [], loading: false },
      });
    } catch (err) {
      if (seq !== dashboardRequestSeq) return;
      const msg = humanizeRequestError(err);
      set({
        loading: false,
        error: `Обновление не выполнено, на экране прежние числа. ${msg}`,
        refreshResult: { sources: [], loading: false },
      });
    }
  },

  quickRefresh: async () => {
    const seq = ++dashboardRequestSeq; // участвует в той же гонке, что fetchDashboard (баг #6)
    set({ loading: true, error: null });
    try {
      const year = get().year;
      await api.refresh(true);
      const data = await api.getDashboard(true, year);
      if (seq !== dashboardRequestSeq) return;
      // Баг #12: без обновления провенанса «Первичка сейчас» в попапах БЗ
      // устаревала после автообновления — числа новые, доказательства старые.
      setOfficialProvenance(
        (data as any).snapshot?.officialMetrics,
        (data as any).snapshot?.spreadsheetId,
      );
      set({
        dashboardData: data,
        dataYear: data.year ?? new Date().getFullYear(), // баг #11 — см. refresh
        lastRefreshed: data.lastRefreshed,
        loading: false,
        isDemo: isDemoData(data),
      });
    } catch (err) {
      if (seq !== dashboardRequestSeq) return;
      const msg = humanizeRequestError(err);
      set({
        loading: false,
        error: `Обновление не выполнено, на экране прежние числа. ${msg}`,
      });
    }
  },

  bucketCounts: null,
  fetchBucketCounts: async () => {
    try {
      const b = await api.getRegistryBuckets();
      set({ bucketCounts: { unfunded: b.unfunded.rows, yearlong: b.yearlong.rows } });
    } catch {
      // Сервер не ответил — счётчик остаётся null: кнопка навигации живёт
      // без числа, отсутствие счёта не выдаётся за ноль строк.
    }
  },

  formatMoney: (value: number) => {
    const unit = get().moneyUnit;
    let displayValue = value;
    let suffix = 'тыс. ₽';

    if (unit === 'млн') {
      displayValue = value / 1000;
      suffix = 'млн ₽';
    } else if (unit === 'млрд') {
      displayValue = value / 1000000;
      suffix = 'млрд ₽';
    }

    const formatted = new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: unit === 'тыс' ? 0 : 1,
      maximumFractionDigits: unit === 'млрд' ? 2 : 1,
    }).format(displayValue);

    return `${formatted} ${suffix}`;
  },
}));
