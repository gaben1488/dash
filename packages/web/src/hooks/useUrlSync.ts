import { useEffect } from 'react';
import { ACTIVITY_TYPES, dayNumberOf } from '@aemr/shared';
import { useStore, PAGE_FILTERS, getProductMonday, type AppState, type Page } from '../store';
import { productDayParts } from '../lib/period-coverage';
import type { PeriodScope, ProcurementFilter, ActivityFilter, BudgetType } from '../store';

const VALID_PERIODS: PeriodScope[] = ['year', 'q1', 'q2', 'q3', 'q4'];
/**
 * Словарь параметра `activity` — производная канонического списка видов
 * деятельности из @aemr/shared, а не собственный литерал рядом с ним.
 * DEADCODE_DISPOSITION_2026-06-05 §W-6: справочник видов лежал мёртвым,
 * пока ссылка разбиралась по трём строкам, переписанным здесь от руки —
 * новый вид в справочнике молча не попадал бы в разбор ссылки.
 * Экспортирован ради стража useUrlSync.test.ts.
 */
export const VALID_ACTIVITIES: ActivityFilter[] = ['all', ...ACTIVITY_TYPES];
const VALID_METHOD_SET = new Set(['competitive', 'single']);
const VALID_ACTIVITY_SET = new Set<string>(ACTIVITY_TYPES);
const VALID_BUDGET_SET = new Set<BudgetType>(['fb', 'kb', 'mb']);

const DEFAULT_YEAR = productDayParts().y;
const DEFAULT_PERIOD: PeriodScope = 'year';
const DEFAULT_METHOD: ProcurementFilter = 'all';
const DEFAULT_ACTIVITY: ActivityFilter = 'all';

// ── Параметр `months`: сериализация выбора месяцев вместе с годом ──
//
// Баг #15 реестра охоты 08.08: ссылка с `?months=` восстанавливала данные
// (activeMonths), но не барабан (monthsByYear) — TimeDrum показывал пустой
// выбор при отфильтрованном экране, и селекция многолетних периодов терялась.
// Формат: `2025:1,2;2026:7,8` (год:месяцы через запятую, годы через `;`).
// Легаси-формат `1,2,7` (без года) читается и приписывается выбранному году.

/** monthsByYear → значение параметра `months`; null = сериализовать нечего. */
export function serializeMonthsParam(
  monthsByYear: Record<number, Set<number>>,
  activeMonths: Set<number>,
  fallbackYear: number,
): string | null {
  const entries = Object.entries(monthsByYear)
    .map(([yr, months]) => [Number(yr), Array.from(months).sort((a, b) => a - b)] as const)
    .filter(([, months]) => months.length > 0)
    .sort(([a], [b]) => a - b);
  if (entries.length > 0) {
    return entries.map(([yr, months]) => `${yr}:${months.join(',')}`).join(';');
  }
  // Легаси-состояние: месяцы есть, а барабан (monthsByYear) их не знает —
  // пишем с годом, чтобы восстановление заполнило и барабан.
  if (activeMonths.size > 0) {
    const months = Array.from(activeMonths).sort((a, b) => a - b);
    return `${fallbackYear}:${months.join(',')}`;
  }
  return null;
}

export interface ParsedMonthsParam {
  monthsByYear: Record<number, Set<number>>;
  /** Месяцы года `year` — то, что должно попасть в activeMonths. */
  activeMonths: Set<number>;
  /** Год, чей выбор становится активным (совпадает с годом URL, если он в выборе). */
  year: number;
}

/** Разбор параметра `months` (оба формата); null = валидных месяцев нет. */
export function parseMonthsParam(value: string, urlYear: number): ParsedMonthsParam | null {
  const monthsByYear: Record<number, Set<number>> = {};
  if (value.includes(':')) {
    for (const part of value.split(';')) {
      const [yrStr, monthsStr] = part.split(':');
      const yr = /^\d{4}$/.test(yrStr) ? Number(yrStr) : NaN;
      if (yr < 2020 || yr > 2100 || !Number.isInteger(yr)) continue;
      const nums = (monthsStr ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 12);
      if (nums.length > 0) monthsByYear[yr] = new Set(nums);
    }
  } else {
    const nums = value.split(',').map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 12);
    if (nums.length > 0) monthsByYear[urlYear] = new Set(nums);
  }
  const years = Object.keys(monthsByYear).map(Number).sort((a, b) => a - b);
  if (years.length === 0) return null;
  const year = monthsByYear[urlYear] ? urlYear : years[0];
  return { monthsByYear, activeMonths: new Set(monthsByYear[year]), year };
}

// Each module owns its parameters; never discard monitoring/report state or anchors.
const OWNED = ['page', 'tab', 'year', 'period', 'mode', 'week', 'months', 'depts', 'subs',
  'method', 'activity', 'budget', 'q', 'unit', 'deptOnly', 'stavka', 'reportMode', 'reportQuarter', 'word', 'word_ctx'];
const QUALITY_TABS = ['trust', 'recon', 'issues', 'recs', 'journal', 'scorecard'];
const csv = (value: string | null) => new Set((value ?? '').split(',').filter(Boolean).map(part => {
  try { return decodeURIComponent(part); } catch { return part; }
}));
const civilDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function restore(params: URLSearchParams): Partial<AppState> {
  const initial = useStore.getInitialState();
  const yearParam = params.get('year');
  const numericYear = /^\d{4}$/.test(yearParam ?? '') ? Number(yearParam) : NaN;
  const year = yearParam === 'all' ? 'all' : numericYear >= 2020 && numericYear <= 2100 ? numericYear : initial.year;
  const pageParam = params.get('page') ?? 'dashboard';
  const page = Object.hasOwn(PAGE_FILTERS, pageParam) ? pageParam as Page : 'dashboard';
  const tab = params.get('tab');
  const periodParam = params.get('period');
  const period = VALID_PERIODS.includes(periodParam as PeriodScope) ? periodParam as PeriodScope : DEFAULT_PERIOD;
  const months = parseMonthsParam(params.get('months') ?? '', typeof year === 'number' ? year : DEFAULT_YEAR);
  const methods = new Set([...csv(params.get('method'))].filter(value => VALID_METHOD_SET.has(value)));
  const activities = new Set([...csv(params.get('activity'))].filter(value => VALID_ACTIVITY_SET.has(value)));
  const week = params.get('week');
  const validWeek = week && /^\d{4}-\d{2}-\d{2}$/.test(week) && dayNumberOf(week) !== null
    ? new Date(Number(week.slice(0, 4)), Number(week.slice(5, 7)) - 1, Number(week.slice(8, 10))) : getProductMonday();
  const focusedWeekStart = validWeek.getDay() === 1 ? validWeek : getProductMonday();
  return {
    urlNavigationVersion: useStore.getState().urlNavigationVersion + 1,
    reportMode: params.get('reportMode') === 'archive' ? 'archive' : 'live',
    reportQuarter: /^[1-4]$/.test(params.get('reportQuarter') ?? '') ? Number(params.get('reportQuarter')) as 1 | 2 | 3 | 4 : null,
    reportPinned: /^REL-[a-f0-9]{64}$/.test(params.get('word') ?? '') && params.get('word_ctx') && params.get('word_ctx')!.length <= 512
      ? { id: params.get('word')!, contextKey: params.get('word_ctx')! } : null,
    page: QUALITY_TABS.includes(page) ? 'quality' : page,
    qualityTab: QUALITY_TABS.includes(tab ?? '') ? tab as AppState['qualityTab']
      : QUALITY_TABS.includes(page) ? page as AppState['qualityTab'] : initial.qualityTab,
    year: months?.year ?? year, period,
    periodMode: params.get('mode') === 'week' ? 'week'
      : params.get('mode') === 'explicit' || periodParam || months ? 'explicit' : 'week',
    focusedWeekStart, activeMonths: months?.activeMonths ?? new Set(), monthsByYear: months?.monthsByYear ?? {},
    selectedDepartments: csv(params.get('depts')), selectedSubordinates: csv(params.get('subs')),
    deptOnlyMode: csv(params.get('deptOnly')), selectedMethods: methods,
    procurementFilter: methods.size === 1 ? [...methods][0] as ProcurementFilter : DEFAULT_METHOD,
    selectedActivities: activities, activityFilter: activities.size === 1 ? [...activities][0] as ActivityFilter : DEFAULT_ACTIVITY,
    selectedBudgets: new Set([...csv(params.get('budget'))].filter(value => VALID_BUDGET_SET.has(value as BudgetType))),
    searchQuery: params.get('q') ?? '', searchQueryDebounced: params.get('q') ?? '',
    moneyUnit: params.get('unit') === 'млн' ? 'млн' : initial.moneyUnit,
    stavkaMode: params.get('stavka') === 'live' ? 'live' : initial.stavkaMode,
    registrySignalSeed: [], trustComponentSeed: null, issuesSectionSeed: null,
  };
}

function workspaceUrl(state: AppState): URL {
  const url = new URL(window.location.href);
  const params = url.searchParams;
  for (const key of OWNED) params.delete(key);
  params.set('page', state.page);
  params.set('year', String(state.year)); // Explicit even for the current year: links survive New Year.
  params.set('mode', state.periodMode);
  params.set('period', state.period);
  params.set('week', civilDay(state.focusedWeekStart));
  params.set('tab', state.qualityTab);
  params.set('reportMode', state.reportMode);
  if (state.reportQuarter) params.set('reportQuarter', String(state.reportQuarter));
  if (state.reportPinned) {
    params.set('word', state.reportPinned.id); params.set('word_ctx', state.reportPinned.contextKey);
  }
  if (state.periodMode === 'explicit') {
    const months = serializeMonthsParam(state.monthsByYear, state.activeMonths,
      typeof state.year === 'number' ? state.year : DEFAULT_YEAR);
    if (months) params.set('months', months);
  }
  for (const [key, values] of [['depts', state.selectedDepartments], ['subs', state.selectedSubordinates],
    ['deptOnly', state.deptOnlyMode], ['method', state.selectedMethods], ['activity', state.selectedActivities],
    ['budget', state.selectedBudgets]] as const) {
    if (values.size) params.set(key, [...values].sort().map(encodeURIComponent).join(','));
  }
  if (!state.selectedMethods.size && state.procurementFilter !== DEFAULT_METHOD) params.set('method', state.procurementFilter);
  if (!state.selectedActivities.size && state.activityFilter !== DEFAULT_ACTIVITY) params.set('activity', state.activityFilter);
  if (state.searchQuery) params.set('q', state.searchQuery);
  if (state.moneyUnit !== 'тыс') params.set('unit', state.moneyUnit);
  if (state.stavkaMode !== 'norm') params.set('stavka', state.stavkaMode);
  return url;
}

/** Restore a complete workspace on mount/popstate; navigation gets a real browser entry. */
export function useUrlSync() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let restoring = false;
    const write = (push: boolean) => {
      clearTimeout(timer);
      const url = workspaceUrl(useStore.getState());
      if (url.href !== window.location.href) {
        window.history[push ? 'pushState' : 'replaceState'](window.history.state, '', url);
      }
    };
    const read = () => {
      clearTimeout(timer);
      restoring = true;
      const next = restore(new URLSearchParams(window.location.search));
      // Cancel the store's pending search debounce before atomically restoring all fields.
      useStore.getState().setSearchQuery(next.searchQuery ?? '');
      useStore.setState(next);
      restoring = false;
    };
    read();
    write(false);
    const unsubscribe = useStore.subscribe((state, previous) => {
      if (restoring || workspaceUrl(state).href === window.location.href) return;
      clearTimeout(timer);
      if (state.page !== previous.page || state.qualityTab !== previous.qualityTab) write(true);
      else timer = setTimeout(() => write(true), 300);
    });
    const flush = () => write(false);
    window.addEventListener('popstate', read);
    window.addEventListener('pagehide', flush);
    return () => {
      clearTimeout(timer); unsubscribe();
      window.removeEventListener('popstate', read); window.removeEventListener('pagehide', flush);
      write(false);
    };
  }, []);
}
