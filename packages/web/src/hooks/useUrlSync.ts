import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import type { PeriodScope, ProcurementFilter, ActivityFilter, BudgetType } from '../store';

const VALID_PERIODS: PeriodScope[] = ['year', 'q1', 'q2', 'q3', 'q4'];
const VALID_METHODS: ProcurementFilter[] = ['all', 'competitive', 'single'];
const VALID_ACTIVITIES: ActivityFilter[] = ['all', 'program', 'current_program', 'current_non_program'];
const VALID_METHOD_SET = new Set(['competitive', 'single']);
const VALID_ACTIVITY_SET = new Set(['program', 'current_program', 'current_non_program']);
const VALID_BUDGET_SET = new Set<BudgetType>(['fb', 'kb', 'mb']);

const DEFAULT_YEAR = new Date().getFullYear();
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
      const yr = parseInt(yrStr, 10);
      if (Number.isNaN(yr)) continue;
      const nums = (monthsStr ?? '').split(',').map(Number).filter((n) => n >= 1 && n <= 12);
      if (nums.length > 0) monthsByYear[yr] = new Set(nums);
    }
  } else {
    const nums = value.split(',').map(Number).filter((n) => n >= 1 && n <= 12);
    if (nums.length > 0) monthsByYear[urlYear] = new Set(nums);
  }
  const years = Object.keys(monthsByYear).map(Number).sort((a, b) => a - b);
  if (years.length === 0) return null;
  const year = monthsByYear[urlYear] ? urlYear : years[0];
  return { monthsByYear, activeMonths: new Set(monthsByYear[year]), year };
}

/** Parse URL search params and apply to store on mount; sync store changes back to URL (debounced). */
export function useUrlSync() {
  const initialized = useRef(false);

  // On mount: parse URL → store
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const params = new URLSearchParams(window.location.search);
    const updates: Record<string, unknown> = {};

    // year
    const yearParam = params.get('year');
    if (yearParam != null) {
      if (yearParam === 'all') {
        updates.year = 'all';
      } else {
        const n = parseInt(yearParam, 10);
        if (!Number.isNaN(n)) updates.year = n;
      }
    }

    // period
    const periodParam = params.get('period');
    if (periodParam != null && VALID_PERIODS.includes(periodParam as PeriodScope)) {
      updates.period = periodParam;
      updates.periodMode = 'explicit'; // URL has explicit period → explicit mode
    }

    // months — восстанавливаются И данные (activeMonths), И барабан
    // (monthsByYear), и год выбора (баг #15).
    const monthsParam = params.get('months');
    if (monthsParam) {
      const urlYear = typeof updates.year === 'number' ? updates.year : DEFAULT_YEAR;
      const parsed = parseMonthsParam(monthsParam, urlYear);
      if (parsed) {
        updates.activeMonths = parsed.activeMonths;
        updates.monthsByYear = parsed.monthsByYear;
        updates.year = parsed.year;
        updates.periodMode = 'explicit'; // URL has explicit months → explicit mode
      }
    }

    // depts
    const deptsParam = params.get('depts');
    if (deptsParam) {
      updates.selectedDepartments = new Set(deptsParam.split(',').map(decodeURIComponent));
    }

    // subs
    const subsParam = params.get('subs');
    if (subsParam) {
      updates.selectedSubordinates = new Set(subsParam.split(',').map(decodeURIComponent));
    }

    // method (supports both legacy single-value and new multi-select comma-separated)
    const methodParam = params.get('method');
    if (methodParam != null) {
      const parts = methodParam.split(',').filter(m => VALID_METHOD_SET.has(m));
      if (parts.length > 0) {
        updates.selectedMethods = new Set(parts);
        // Sync legacy
        updates.procurementFilter = parts.length === 1 ? parts[0] : 'all';
      } else if (VALID_METHODS.includes(methodParam as ProcurementFilter)) {
        updates.procurementFilter = methodParam;
        updates.selectedMethods = methodParam === 'all' ? new Set<string>()
          : new Set([methodParam === 'single' ? 'single' : 'competitive']);
      }
    }

    // activity (supports both legacy single-value and new multi-select)
    const activityParam = params.get('activity');
    if (activityParam != null) {
      const parts = activityParam.split(',').filter(a => VALID_ACTIVITY_SET.has(a));
      if (parts.length > 0) {
        updates.selectedActivities = new Set(parts);
        updates.activityFilter = parts.length === 1 ? parts[0] : 'all';
      } else if (VALID_ACTIVITIES.includes(activityParam as ActivityFilter)) {
        updates.activityFilter = activityParam;
        updates.selectedActivities = activityParam === 'all' ? new Set<string>()
          : new Set([activityParam]);
      }
    }

    // budget (new multi-select)
    const budgetParam = params.get('budget');
    if (budgetParam) {
      const parts = budgetParam.split(',').filter(b => VALID_BUDGET_SET.has(b as BudgetType));
      if (parts.length > 0) {
        updates.selectedBudgets = new Set(parts);
      }
    }

    if (Object.keys(updates).length > 0) {
      useStore.setState(updates as Partial<ReturnType<typeof useStore.getState>>);
    }
  }, []);

  // On store change: debounced URL update
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const unsub = useStore.subscribe((state) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const params = new URLSearchParams();

        // year — skip if current year (default)
        if (state.year !== DEFAULT_YEAR) {
          params.set('year', String(state.year));
        }

        // period
        if (state.period !== DEFAULT_PERIOD) {
          params.set('period', state.period);
        }

        // months — only serialize when in explicit mode (week-режим — не фильтр,
        // баг #5). Сериализуется monthsByYear целиком, с годами (баг #15).
        if (state.periodMode === 'explicit') {
          const fallbackYear = typeof state.year === 'number' ? state.year : DEFAULT_YEAR;
          const serialized = serializeMonthsParam(state.monthsByYear, state.activeMonths, fallbackYear);
          if (serialized) params.set('months', serialized);
        }

        // depts
        if (state.selectedDepartments.size > 0) {
          params.set('depts', Array.from(state.selectedDepartments).map(encodeURIComponent).join(','));
        }

        // subs
        if (state.selectedSubordinates.size > 0) {
          params.set('subs', Array.from(state.selectedSubordinates).map(encodeURIComponent).join(','));
        }

        // method (use multi-select Set if available, else legacy)
        if (state.selectedMethods.size > 0) {
          params.set('method', Array.from(state.selectedMethods).sort().join(','));
        } else if (state.procurementFilter !== DEFAULT_METHOD) {
          params.set('method', state.procurementFilter);
        }

        // activity (use multi-select Set if available, else legacy)
        if (state.selectedActivities.size > 0) {
          params.set('activity', Array.from(state.selectedActivities).sort().join(','));
        } else if (state.activityFilter !== DEFAULT_ACTIVITY) {
          params.set('activity', state.activityFilter);
        }

        // budget
        if (state.selectedBudgets.size > 0) {
          params.set('budget', Array.from(state.selectedBudgets).sort().join(','));
        }

        const qs = params.toString();
        const newUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
        window.history.replaceState(null, '', newUrl);
      }, 300);
    });

    return () => {
      clearTimeout(timer);
      unsub();
    };
  }, []);
}
