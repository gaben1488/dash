import { useStore, MONTHS } from '../store';
import { X, Filter } from 'lucide-react';

/**
 * Premium breadcrumb showing active filters as removable pills.
 * Renders only when at least one filter is active.
 */
export function FilterBreadcrumb() {
  const {
    selectedDepartments, selectedSubordinates, activeMonths,
    selectedMethods, selectedActivities, selectedBudgets,
    selectAllDepartments, clearSubordinates, toggleMonth,
    clearMethods, clearActivities, clearBudgets,
    resetAllFilters,
  } = useStore();

  const hasDept = selectedDepartments.size > 0;
  const hasSub = selectedSubordinates.size > 0;
  const hasMonth = activeMonths.size > 0;
  const hasMethod = selectedMethods.size > 0;
  const hasActivity = selectedActivities.size > 0;
  const hasBudget = selectedBudgets.size > 0;

  if (!hasDept && !hasSub && !hasMonth && !hasMethod && !hasActivity && !hasBudget) return null;

  const monthNames = hasMonth
    ? [...activeMonths].sort((a, b) => a - b).map(m => MONTHS.find(mo => mo.id === m)?.short ?? String(m)).join(', ')
    : null;

  const Chip = ({
    label,
    onRemove,
    color = 'blue',
  }: {
    label: string;
    onRemove: () => void;
    color?: 'blue' | 'indigo' | 'emerald' | 'amber' | 'purple';
  }) => {
    const colorClasses = {
      blue: 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-500/20',
      indigo: 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-500/20',
      emerald: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/20',
      amber: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-500/20',
      purple: 'bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-500/20',
    };

    return (
      <button
        onClick={onRemove}
        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all duration-150 ${colorClasses[color]} active:scale-95`}
      >
        <span className="truncate max-w-[200px]">{label}</span>
        <X size={10} className="opacity-50 hover:opacity-100 shrink-0" />
      </button>
    );
  };

  return (
    <div className="flex items-center flex-wrap gap-1.5 text-xs bg-zinc-50/80 dark:bg-zinc-800/30 backdrop-blur-sm rounded-2xl px-4 py-2.5 border border-zinc-200/40 dark:border-zinc-700/40">
      <Filter size={12} className="text-zinc-400 shrink-0" />
      <span className="text-zinc-400 dark:text-zinc-500 font-medium text-[11px] shrink-0">Активные фильтры:</span>

      {hasDept && (
        <Chip
          label={[...selectedDepartments].join(', ')}
          onRemove={() => selectAllDepartments()}
          color="blue"
        />
      )}
      {hasSub && (
        <Chip
          label={selectedSubordinates.size <= 2
            ? [...selectedSubordinates].join(', ')
            : `${selectedSubordinates.size} подведов`
          }
          onRemove={() => clearSubordinates()}
          color="indigo"
        />
      )}
      {hasMonth && (
        <Chip
          label={monthNames!}
          onRemove={() => [...activeMonths].forEach(m => toggleMonth(m))}
          color="emerald"
        />
      )}
      {hasMethod && (
        <Chip
          label={[...selectedMethods].map(m => m === 'competitive' ? 'КП' : 'ЕП').join(', ')}
          onRemove={clearMethods}
          color="amber"
        />
      )}
      {hasActivity && (
        <Chip
          label={[...selectedActivities].map(a =>
            a === 'program' ? 'ПМ' : a === 'current_program' ? 'ТД-ПМ' : 'ТД'
          ).join(', ')}
          onRemove={clearActivities}
          color="purple"
        />
      )}
      {hasBudget && (
        <Chip
          label={[...selectedBudgets].map(b => b.toUpperCase()).join(', ')}
          onRemove={clearBudgets}
          color="blue"
        />
      )}

      <button
        onClick={resetAllFilters}
        className="ml-auto text-[10px] text-zinc-400 hover:text-red-500 font-medium transition-colors shrink-0 flex items-center gap-1"
      >
        <X size={10} />
        Сбросить
      </button>
    </div>
  );
}
