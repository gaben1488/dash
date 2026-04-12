import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import type { PeriodScope, ProcurementFilter, ActivityFilter, YearFilter, BudgetType } from '../store';

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
    }

    // months
    const monthsParam = params.get('months');
    if (monthsParam) {
      const nums = monthsParam.split(',').map(Number).filter((n) => n >= 1 && n <= 12);
      if (nums.length > 0) updates.activeMonths = new Set(nums);
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

        // months
        if (state.activeMonths.size > 0) {
          params.set('months', Array.from(state.activeMonths).sort((a, b) => a - b).join(','));
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
