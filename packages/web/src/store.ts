import { create } from 'zustand';
import { ALL_DEPT_IDS } from '@aemr/shared';
import { api } from './api';

/** СВОД — 6 страниц + legacy aliases */
export type Page =
  | 'dashboard'     // Пульт (сводная панель)
  | 'data'          // Реестр (построчные данные)
  | 'economy'       // Экономия
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

/** Вид деятельности (legacy single-select aliases kept for navigateTo compatibility) */
export type ActivityFilter = 'all' | 'program' | 'current_program' | 'current_non_program';

/** Тип бюджета */
export type BudgetType = 'fb' | 'kb' | 'mb';

/**
 * Period mode determines how period filtering works:
 * - 'week': Default. activeMonths auto-derived from focusedWeekStart.
 *   WeekRoller scrolling changes data. Resets to this on clearAllPeriods().
 * - 'explicit': User has manually selected months/quarters/year.
 *   WeekRoller is visual-only, doesn't drive data.
 */
export type PeriodMode = 'week' | 'explicit';

/** Get month(s) from a week's Monday date.
 *  If week spans two months, returns both. */
export function getMonthsForWeek(monday: Date): Set<number> {
  const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
  const m1 = monday.getMonth() + 1;
  const m2 = sunday.getMonth() + 1;
  return m1 === m2 ? new Set([m1]) : new Set([m1, m2]);
}

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

/** Fallback subordinates (used until API loads real data).
 *  Empty array = dept has no subordinates (the dept IS the org).
 *  УИО/УФБП/УАГЗО: "x" in source sheet name column = row belongs to dept itself. */
const SUBORDINATES_FALLBACK: Record<string, string[]> = {
  'УЭР':    ['МКУ "ЦЭР"'],
  'УИО':    [],
  'УАГЗО':  [],
  'УФБП':   [],
  'УД':     ['МКУ "ХОЗУ"', 'МКУ "АХО"'],
  'УДТХ':   ['МКУ "УДТХ"', 'МБУ "БДХ"'],
  'УКСиМП': ['МКУ "ДКСМП"', 'МБУ "СК"', 'МБУ "ДК"'],
  'УО':     ['МКУ "ЦБ УО"', 'Школы', 'Детские сады'],
};

/** Месяцы, входящие в каждый квартал */
export const QUARTER_MONTHS: Record<string, number[]> = {
  q1: [1, 2, 3],
  q2: [4, 5, 6],
  q3: [7, 8, 9],
  q4: [10, 11, 12],
};

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
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;

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
  /** Поиск по тексту (debounced на UI) */
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  /** Активная вкладка Quality страницы */
  qualityTab: 'trust' | 'recon' | 'issues' | 'recs' | 'journal';
  setQualityTab: (tab: 'trust' | 'recon' | 'issues' | 'recs' | 'journal') => void;
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
    qualityTab: 'trust' | 'recon' | 'issues' | 'recs' | 'journal';
  }>) => void;
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
  dashboardData: any | null;
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

  // Утилиты
  formatMoney: (value: number) => string;
}

/** Флаг: используются ли демо-данные сервера (не mock фронтенда) */
function isDemoData(data: any): boolean {
  return data?.snapshot?.id?.startsWith('demo-') || data?.snapshotId?.startsWith('demo-');
}

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
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  // Фильтры — default year: current year if in AVAILABLE_YEARS, else last available
  year: (AVAILABLE_YEARS.includes(new Date().getFullYear())
    ? new Date().getFullYear()
    : AVAILABLE_YEARS[AVAILABLE_YEARS.length - 1]) as YearFilter,
  setYear: (year) => set({ year }),
  period: 'year',
  setPeriod: (period) => set({ period, periodMode: 'explicit' as PeriodMode }),
  periodMode: 'week' as PeriodMode,
  activeMonths: getMonthsForWeek(getMondayOfWeek(new Date())),
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
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  qualityTab: 'trust',
  setQualityTab: (qualityTab) => set({ qualityTab }),
  resetAllFilters: () => {
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
      activeMonths: getMonthsForWeek(monday),
      focusedWeekStart: monday,
      monthsByYear: {},
      searchQuery: '',
    });
  },
  navigateTo: (page, filters) => {
    const updates: Partial<Pick<AppState,
      'page' | 'period' | 'procurementFilter' | 'activityFilter' |
      'selectedDepartments' | 'selectedSubordinates' | 'year' |
      'searchQuery' | 'activeMonths' | 'qualityTab'
    >> = { page };
    if (filters?.period) updates.period = filters.period;
    if (filters?.procurement) updates.procurementFilter = filters.procurement;
    if (filters?.activity) updates.activityFilter = filters.activity;
    if (filters?.department) {
      updates.selectedDepartments = new Set([filters.department]);
    }
    if (filters?.subordinate) {
      updates.selectedSubordinates = new Set([filters.subordinate]);
    }
    if (filters?.year !== undefined) {
      updates.year = filters.year;
    }
    if (filters?.search !== undefined) {
      updates.searchQuery = filters.search;
    }
    if (filters?.months) {
      updates.activeMonths = new Set(filters.months);
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
  toggleDepartment: (deptId) => {
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
    // If clearing all months → back to week mode; otherwise explicit
    if (next.size === 0) {
      const monday = getMondayOfWeek(new Date());
      set({ activeMonths: getMonthsForWeek(monday), periodMode: 'week' as PeriodMode, focusedWeekStart: monday });
    } else {
      set({ activeMonths: next, periodMode: 'explicit' as PeriodMode });
    }
  },
  clearMonths: () => {
    const yr = get().year;
    const mby = { ...get().monthsByYear };
    if (typeof yr === 'number') delete mby[yr];
    // Clearing months → back to week mode
    const monday = getMondayOfWeek(new Date());
    set({
      activeMonths: getMonthsForWeek(monday),
      monthsByYear: mby,
      periodMode: 'week' as PeriodMode,
      focusedWeekStart: monday,
    });
  },

  // Multi-year month selections
  monthsByYear: {} as Record<number, Set<number>>,

  toggleMonthInYear: (yr, month) => {
    const mby = { ...get().monthsByYear };
    const current = new Set(mby[yr] ?? []);
    if (current.has(month)) current.delete(month); else current.add(month);
    if (current.size === 0) delete mby[yr]; else mby[yr] = current;

    // Sync: set year to this year if it has selections, update activeMonths
    const targetYear = yr;
    const activeForTarget = mby[targetYear] ?? new Set<number>();

    // If all months cleared → back to week mode
    if (activeForTarget.size === 0 && Object.keys(mby).length === 0) {
      const monday = getMondayOfWeek(new Date());
      set({ monthsByYear: mby, year: targetYear, activeMonths: getMonthsForWeek(monday), periodMode: 'week' as PeriodMode, focusedWeekStart: monday });
    } else {
      set({ monthsByYear: mby, year: targetYear, activeMonths: new Set(activeForTarget), periodMode: 'explicit' as PeriodMode });
    }
  },

  toggleQuarterInYear: (yr, qKey) => {
    const months = QUARTER_MONTHS[qKey];
    if (!months) return;
    const mby = { ...get().monthsByYear };
    const current = new Set(mby[yr] ?? []);
    const allSelected = months.every(m => current.has(m));
    if (allSelected) {
      months.forEach(m => current.delete(m));
    } else {
      months.forEach(m => current.add(m));
    }
    if (current.size === 0) delete mby[yr]; else mby[yr] = current;

    const activeForYear = mby[yr] ?? new Set<number>();
    // If all months cleared → back to week mode
    if (activeForYear.size === 0 && Object.keys(mby).length === 0) {
      const monday = getMondayOfWeek(new Date());
      set({ monthsByYear: mby, year: yr, activeMonths: getMonthsForWeek(monday), periodMode: 'week' as PeriodMode, focusedWeekStart: monday });
    } else {
      set({ monthsByYear: mby, year: yr, activeMonths: new Set(activeForYear), periodMode: 'explicit' as PeriodMode });
    }
  },

  toggleYearFull: (yr) => {
    const mby = { ...get().monthsByYear };
    const current = mby[yr];
    const allSelected = current && current.size === 12;
    if (allSelected) {
      delete mby[yr];
    } else {
      mby[yr] = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    }
    const activeForYear = mby[yr] ?? new Set<number>();
    set({ monthsByYear: mby, year: yr, activeMonths: new Set(activeForYear) });
  },

  clearAllPeriods: () => {
    const monday = getMondayOfWeek(new Date());
    set({
      monthsByYear: {},
      activeMonths: getMonthsForWeek(monday),
      focusedWeekStart: monday,
      periodMode: 'week' as PeriodMode,
      period: 'year' as PeriodScope,
    });
  },

  // Week roller
  focusedWeekStart: getMondayOfWeek(new Date()),
  shiftFocusedWeek: (delta) => {
    const current = get().focusedWeekStart;
    const newDate = new Date(current.getTime() + delta * 7 * 24 * 60 * 60 * 1000);
    const minYear = AVAILABLE_YEARS[0];
    const maxYear = AVAILABLE_YEARS[AVAILABLE_YEARS.length - 1];
    if (newDate.getFullYear() < minYear || newDate.getFullYear() > maxYear) return;
    const updates: Record<string, unknown> = { focusedWeekStart: newDate };
    const newYear = newDate.getFullYear();
    if (AVAILABLE_YEARS.includes(newYear)) {
      updates.year = newYear;
    }
    // In week mode: auto-derive activeMonths from the new week
    if (get().periodMode === 'week') {
      updates.activeMonths = getMonthsForWeek(newDate);
    }
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
        // Merge: keep fallback depts that API didn't return, overlay API data on top
        const merged = { ...SUBORDINATES_FALLBACK, ...data };
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
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const year = get().year;
      const data = await api.getDashboard(force, year);
      set({
        dashboardData: data,
        dataYear: data.year ?? new Date().getFullYear(),
        lastRefreshed: data.lastRefreshed,
        loading: false,
        isDemo: isDemoData(data),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({
        loading: false,
        error: `Не удалось загрузить данные: ${msg}`,
      });
    }
  },

  refreshResult: null,
  refresh: async () => {
    set({ loading: true, error: null, refreshResult: { sources: [], loading: true } });
    try {
      const year = get().year;
      const result = await api.refresh();
      const data = await api.getDashboard(false, year);
      set({
        dashboardData: data,
        lastRefreshed: data.lastRefreshed,
        loading: false,
        isDemo: isDemoData(data),
        refreshResult: { sources: result.sources ?? [], loading: false },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({
        loading: false,
        error: `Не удалось обновить: ${msg}`,
        refreshResult: { sources: [], loading: false },
      });
    }
  },

  quickRefresh: async () => {
    set({ loading: true, error: null });
    try {
      const year = get().year;
      await api.refresh(true);
      const data = await api.getDashboard(true, year);
      set({
        dashboardData: data,
        lastRefreshed: data.lastRefreshed,
        loading: false,
        isDemo: isDemoData(data),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({
        loading: false,
        error: `Не удалось обновить: ${msg}`,
      });
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
