import { useState, useMemo } from 'react';
import { useStore } from '../store';
import type { MoneyUnit, BudgetType } from '../store';
import { Search, X, ChevronDown, Calendar, Filter, RotateCcw } from 'lucide-react';
import clsx from 'clsx';

import { YearScroller } from './filters/YearScroller';
import { MonthStrip } from './filters/MonthStrip';
import { DeptTreePicker } from './filters/DeptTreePicker';

// ── Types ──────────────────────────────────────────────────────────
export type FilterGroup =
  | 'period'
  | 'currency'
  | 'procurement'
  | 'activity'
  | 'budget'
  | 'department'
  | 'subordinate'
  | 'search';

interface FilterBarProps {
  /** Which filter groups to show on this page */
  groups?: FilterGroup[];
  /** Compact mode for narrow layouts */
  compact?: boolean;
  /** Enabled filters (alternative prop name for compatibility) */
  enabledFilters?: string[];
}

// ── Pill group — shared base for radio and checkbox pills ─────────
function PillGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; color?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center bg-zinc-100/80 dark:bg-zinc-800/60 rounded-lg p-0.5 gap-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={clsx(
            'px-2.5 py-1 rounded-md text-[11px] font-medium transition-all duration-150 select-none whitespace-nowrap',
            value === opt.value
              ? opt.color || 'bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-sm shadow-blue-600/20'
              : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-white/60 dark:hover:bg-zinc-700/60',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ── Multi-select checkbox group (empty selection = "Все") ────────
function CheckboxGroup<T extends string>({
  options,
  selected,
  onToggle,
  onClear,
  label,
}: {
  options: { value: T; label: string; color?: string }[];
  selected: Set<string>;
  onToggle: (v: T) => void;
  onClear: () => void;
  label: string;
}) {
  const isIdentity = selected.size === 0;
  return (
    <div className="flex items-center bg-zinc-100/80 dark:bg-zinc-800/60 rounded-lg p-0.5 gap-0.5">
      <button
        onClick={onClear}
        className={clsx(
          'px-2.5 py-1 rounded-md text-[11px] font-medium transition-all duration-150 select-none whitespace-nowrap',
          isIdentity
            ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-sm shadow-blue-600/20'
            : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-white/60 dark:hover:bg-zinc-700/60',
        )}
      >
        {label}
      </button>
      {options.map((opt) => {
        const isActive = !isIdentity && selected.has(opt.value);
        return (
          <button
            key={opt.value}
            onClick={() => onToggle(opt.value)}
            className={clsx(
              'px-2.5 py-1 rounded-md text-[11px] font-medium transition-all duration-150 select-none whitespace-nowrap',
              isActive
                ? opt.color ?? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-sm shadow-blue-600/20'
                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-white/60 dark:hover:bg-zinc-700/60',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Section divider ──────────────────────────────────────────────
function Divider() {
  return <div className="w-px h-5 bg-gradient-to-b from-transparent via-zinc-300 dark:via-zinc-600 to-transparent mx-0.5 flex-shrink-0" />;
}

// ── Main FilterBar ───────────────────────────────────────────────
export function FilterBar({ groups, compact, enabledFilters }: FilterBarProps) {
  const visible = useMemo(() => {
    if (enabledFilters && enabledFilters.length > 0) return enabledFilters;
    if (groups) return groups;
    return ['period', 'currency', 'procurement', 'activity', 'department', 'subordinate'];
  }, [groups, enabledFilters]);

  const has = (key: string) => visible.includes(key);

  const {
    activeMonths,
    moneyUnit, setMoneyUnit,
    selectedMethods, toggleMethod, clearMethods,
    selectedActivities, toggleActivity, clearActivities,
    selectedBudgets, toggleBudget, clearBudgets,
    selectedDepartments,
    selectedSubordinates,
    searchQuery, setSearchQuery,
    resetAllFilters,
    year,
  } = useStore();

  const [monthsOpen, setMonthsOpen] = useState(false);

  // Count active filters
  const activeCount =
    (year !== new Date().getFullYear() ? 1 : 0) +
    (moneyUnit !== 'тыс' ? 1 : 0) +
    (selectedMethods.size > 0 ? 1 : 0) +
    (selectedActivities.size > 0 ? 1 : 0) +
    (selectedBudgets.size > 0 ? 1 : 0) +
    (selectedDepartments.size > 0 ? 1 : 0) +
    (selectedSubordinates.size > 0 ? 1 : 0) +
    (activeMonths.size > 0 ? 1 : 0) +
    (searchQuery ? 1 : 0);

  const procOptions: { value: string; label: string }[] = [
    { value: 'competitive', label: 'КП' },
    { value: 'single', label: 'ЕП' },
  ];

  const activityOptions: { value: string; label: string }[] = [
    { value: 'program', label: 'ПМ' },
    { value: 'current_program', label: 'ТД-ПМ' },
    { value: 'current_non_program', label: 'ТД' },
  ];

  const budgetOptions: { value: BudgetType; label: string; color?: string }[] = [
    { value: 'fb', label: 'ФБ', color: 'bg-blue-600 text-white shadow-sm shadow-blue-600/25' },
    { value: 'kb', label: 'КБ', color: 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/25' },
    { value: 'mb', label: 'МБ', color: 'bg-amber-500 text-white shadow-sm shadow-amber-500/25' },
  ];

  const moneyOptions: { value: MoneyUnit; label: string }[] = [
    { value: 'тыс', label: 'тыс' },
    { value: 'млн', label: 'млн' },
  ];

  // Show sections based on enabled list
  const showYear = has('period');
  const showMonths = has('period');
  const showDept = has('department') || has('subordinate');
  const showProcurement = has('procurement');
  const showActivity = has('activity');
  const showBudget = has('budget');
  const showMoney = has('currency');
  const showSearch = has('search');

  return (
    <div
      className={clsx(
        'flex items-center gap-1.5 flex-wrap',
        compact ? 'px-2 py-1.5' : 'px-1 py-1',
      )}
    >
      {/* 1. Year picker */}
      {showYear && (
        <>
          <YearScroller />
          <Divider />
        </>
      )}

      {/* 2. MonthStrip (expandable) */}
      {showMonths && (
        <>
          <div className="relative">
            <button
              onClick={() => setMonthsOpen(!monthsOpen)}
              className={clsx(
                'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all duration-200 border select-none',
                activeMonths.size > 0
                  ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-700 text-blue-700 dark:text-blue-300 shadow-sm shadow-blue-500/10'
                  : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600 hover:shadow-sm',
              )}
            >
              <Calendar size={11} className={activeMonths.size > 0 ? 'text-blue-500' : 'text-zinc-400'} />
              {activeMonths.size > 0 ? `${activeMonths.size} мес.` : 'Месяцы'}
              <ChevronDown size={11} className={clsx('transition-transform duration-200', monthsOpen && 'rotate-180')} />
            </button>
            {monthsOpen && (
              <div className="absolute top-full left-0 mt-1.5 z-50 bg-white/95 dark:bg-zinc-800/95 backdrop-blur-xl border border-zinc-200/80 dark:border-zinc-700/80 rounded-xl shadow-xl p-2.5 min-w-[280px] animate-in fade-in-0 slide-in-from-top-2 duration-150">
                <MonthStrip />
              </div>
            )}
          </div>
          <Divider />
        </>
      )}

      {/* 3. Department tree picker */}
      {showDept && (
        <>
          <DeptTreePicker />
          <Divider />
        </>
      )}

      {/* 4. Procurement multi-select */}
      {showProcurement && (
        <>
          <CheckboxGroup options={procOptions} selected={selectedMethods} onToggle={toggleMethod} onClear={clearMethods} label="Все" />
          <Divider />
        </>
      )}

      {/* 5. Activity multi-select */}
      {showActivity && (
        <>
          <CheckboxGroup options={activityOptions} selected={selectedActivities} onToggle={toggleActivity} onClear={clearActivities} label="Все" />
          <Divider />
        </>
      )}

      {/* 6. Budget multi-select — with semantic colors */}
      {showBudget && (
        <>
          <CheckboxGroup options={budgetOptions} selected={selectedBudgets} onToggle={toggleBudget} onClear={clearBudgets} label="Все" />
          <Divider />
        </>
      )}

      {/* 7. Money unit pills */}
      {showMoney && (
        <PillGroup options={moneyOptions} value={moneyUnit} onChange={setMoneyUnit} />
      )}

      {/* 8. Search input */}
      {showSearch && (
        <div className="relative flex-1 min-w-[140px] max-w-xs">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            placeholder="Поиск..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={clsx(
              'w-full pl-7 pr-7 py-1.5 rounded-lg text-xs border transition-all duration-200',
              searchQuery
                ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-700 text-blue-700 dark:text-blue-300 shadow-sm shadow-blue-500/10'
                : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 focus:border-blue-400 dark:focus:border-blue-600 focus:shadow-sm focus:shadow-blue-500/10',
            )}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 transition"
            >
              <X size={12} />
            </button>
          )}
        </div>
      )}

      {/* 9. Reset button with badge */}
      {activeCount > 0 && (
        <button
          onClick={resetAllFilters}
          className={clsx(
            'flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-200',
            'text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30',
            'active:scale-95',
          )}
          title="Сбросить все фильтры"
        >
          <RotateCcw size={12} />
          <span className="hidden sm:inline">Сброс</span>
          <span className="w-4.5 h-4.5 flex items-center justify-center rounded-full bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 text-[9px] font-bold ml-0.5">
            {activeCount}
          </span>
        </button>
      )}
    </div>
  );
}
