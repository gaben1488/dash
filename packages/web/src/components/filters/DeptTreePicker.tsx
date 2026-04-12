import { useState, useRef, useEffect, useMemo } from 'react';
import { useStore } from '../../store';
import { Building2, ChevronDown, ChevronRight, Search, X, Check } from 'lucide-react';
import clsx from 'clsx';

/** Department list (matches @aemr/shared DEPARTMENTS) */
const DEPARTMENTS = [
  { id: 'uer', shortName: 'УЭР', name: 'Управление экономического развития' },
  { id: 'uio', shortName: 'УИО', name: 'Управление имущественных отношений' },
  { id: 'uagzo', shortName: 'УАГЗО', name: 'Управление архитектуры и градостроительства' },
  { id: 'ufbp', shortName: 'УФБП', name: 'Управление финансово-бюджетной политики' },
  { id: 'ud', shortName: 'УД', name: 'Управление делами' },
  { id: 'udtx', shortName: 'УДТХ', name: 'Управление дорожно-транспортного хозяйства' },
  { id: 'uksimp', shortName: 'УКСиМП', name: 'Управление культуры, спорта и молодёжной политики' },
  { id: 'uo', shortName: 'УО', name: 'Управление образования' },
] as const;

/** Accent colors per department */
const DEPT_COLORS: Record<string, { bar: string; bg: string; text: string }> = {
  'УЭР':     { bar: 'bg-blue-500',    bg: 'bg-blue-50 dark:bg-blue-950/30',    text: 'text-blue-600 dark:text-blue-400' },
  'УИО':     { bar: 'bg-emerald-500',  bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-600 dark:text-emerald-400' },
  'УАГЗО':   { bar: 'bg-amber-500',    bg: 'bg-amber-50 dark:bg-amber-950/30',  text: 'text-amber-600 dark:text-amber-400' },
  'УФБП':    { bar: 'bg-violet-500',   bg: 'bg-violet-50 dark:bg-violet-950/30', text: 'text-violet-600 dark:text-violet-400' },
  'УД':      { bar: 'bg-rose-500',     bg: 'bg-rose-50 dark:bg-rose-950/30',    text: 'text-rose-600 dark:text-rose-400' },
  'УДТХ':    { bar: 'bg-cyan-500',     bg: 'bg-cyan-50 dark:bg-cyan-950/30',    text: 'text-cyan-600 dark:text-cyan-400' },
  'УКСиМП':  { bar: 'bg-orange-500',   bg: 'bg-orange-50 dark:bg-orange-950/30', text: 'text-orange-600 dark:text-orange-400' },
  'УО':      { bar: 'bg-teal-500',     bg: 'bg-teal-50 dark:bg-teal-950/30',    text: 'text-teal-600 dark:text-teal-400' },
};

const DEFAULT_COLOR = { bar: 'bg-zinc-400', bg: 'bg-zinc-50 dark:bg-zinc-800', text: 'text-zinc-600 dark:text-zinc-400' };

/** Classify subordinate by name pattern */
type OrgType = 'МКУ' | 'МБУ' | 'Школы' | 'Детские сады' | 'Другое';

const ORG_TYPE_ORDER: OrgType[] = ['МКУ', 'МБУ', 'Школы', 'Детские сады', 'Другое'];

function classifySubordinate(name: string): OrgType {
  const lower = name.toLowerCase();
  if (lower.startsWith('мку') || lower.includes('"мку') || lower.includes('«мку')) return 'МКУ';
  if (lower.startsWith('мбу') || lower.includes('"мбу') || lower.includes('«мбу')) return 'МБУ';
  if (lower.includes('школ') || lower.includes('гимназ') || lower.includes('лицей') || lower.includes('ншдс') || lower.includes('сош') || lower.includes('оош') || lower.includes('нош')) return 'Школы';
  if (lower.includes('детск') || lower.includes('садик') || lower.includes('дс ') || lower.includes('доу') || lower.startsWith('дс') || lower.includes('мдоу') || lower.includes('мадоу')) return 'Детские сады';
  return 'Другое';
}

/** Group subordinates by type */
function groupByType(subs: string[]): Record<OrgType, string[]> {
  const groups: Record<OrgType, string[]> = {
    'МКУ': [], 'МБУ': [], 'Школы': [], 'Детские сады': [], 'Другое': [],
  };
  for (const sub of subs) {
    groups[classifySubordinate(sub)].push(sub);
  }
  return groups;
}

/** Highlight matching text with a yellow mark */
function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-200 dark:bg-yellow-700/60 text-inherit rounded-sm px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export function DeptTreePicker() {
  const {
    selectedDepartments,
    selectedSubordinates,
    toggleDepartment,
    toggleSubordinate,
    selectAllDepartments,
    subordinatesMap,
  } = useStore();

  const clearSubordinates = useStore((s) => s.clearSubordinates);

  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Focus search on open
  useEffect(() => {
    if (open) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [open]);

  const toggleExpand = (deptId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(deptId) ? next.delete(deptId) : next.add(deptId);
      return next;
    });
  };

  const toggleGroupExpand = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  // Chip label: show up to 2 org names or count
  const chipLabel = (() => {
    if (selectedDepartments.size === 0 && selectedSubordinates.size === 0) return 'Все организации';
    const names: string[] = [];
    if (selectedDepartments.size > 0) names.push(...selectedDepartments);
    if (selectedSubordinates.size > 0) {
      // show short versions of sub names (first 20 chars)
      for (const sub of selectedSubordinates) {
        names.push(sub.length > 20 ? sub.slice(0, 18) + '...' : sub);
      }
    }
    if (names.length <= 2) return names.join(', ');
    return `${names.length} выбрано`;
  })();

  const hasActiveSelection = selectedDepartments.size > 0 || selectedSubordinates.size > 0;
  const allDepsSelected = selectedDepartments.size === DEPARTMENTS.length;
  const normalizedSearch = search.trim().toLowerCase();

  // Filter departments and subs by search
  const filteredDepts = useMemo(() => {
    if (!normalizedSearch) return DEPARTMENTS;
    return DEPARTMENTS.filter((dept) => {
      const matchesDept = dept.shortName.toLowerCase().includes(normalizedSearch) ||
        dept.name.toLowerCase().includes(normalizedSearch);
      const subs = subordinatesMap[dept.shortName] ?? [];
      const matchesSub = subs.some(s => s.toLowerCase().includes(normalizedSearch));
      return matchesDept || matchesSub;
    });
  }, [normalizedSearch, subordinatesMap]);

  return (
    <div ref={ref} className="relative">
      {/* ── Trigger chip ── */}
      <button
        onClick={() => setOpen(!open)}
        className={clsx(
          'flex items-center gap-2 pl-2.5 pr-2 py-1.5 rounded-xl text-xs font-medium transition-all duration-200 border select-none',
          hasActiveSelection
            ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-200/80 dark:border-blue-700/60 text-blue-700 dark:text-blue-300 shadow-sm shadow-blue-500/10'
            : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-600 hover:shadow-sm',
        )}
      >
        <Building2
          size={14}
          className={clsx(
            'transition-colors',
            hasActiveSelection ? 'text-blue-500 dark:text-blue-400' : 'text-zinc-400',
          )}
        />
        <span className="font-semibold max-w-[160px] truncate">{chipLabel}</span>
        <ChevronDown
          size={12}
          className={clsx('text-zinc-400 transition-transform duration-200', open && 'rotate-180')}
        />
      </button>

      {/* ── Popover panel ── */}
      {open && (
        <div
          className={clsx(
            'absolute top-full left-0 mt-1.5 z-50 w-80 max-h-[450px] flex flex-col',
            'rounded-2xl shadow-xl shadow-black/10 dark:shadow-black/30',
            'border border-zinc-200/80 dark:border-zinc-700/60',
            'bg-white/95 dark:bg-zinc-800/95 backdrop-blur-xl',
            'animate-in fade-in slide-in-from-top-1 duration-150',
          )}
        >
          {/* ── Search + actions ── */}
          <div className="px-3 pt-3 pb-2 border-b border-zinc-100 dark:border-zinc-700/50 space-y-2">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                ref={searchInputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск организации..."
                className={clsx(
                  'w-full pl-8 pr-8 py-2 text-xs rounded-xl',
                  'bg-zinc-50 dark:bg-zinc-700/50',
                  'border border-zinc-200 dark:border-zinc-600',
                  'text-zinc-700 dark:text-zinc-300 placeholder-zinc-400',
                  'focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20',
                  'transition-all',
                )}
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                >
                  <X size={13} />
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={selectAllDepartments}
                className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
              >
                {allDepsSelected || selectedDepartments.size === 0 ? 'Выбрать все' : 'Снять все'}
              </button>
              {selectedSubordinates.size > 0 && (
                <button
                  onClick={clearSubordinates}
                  className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
                >
                  Сброс подведов
                </button>
              )}
            </div>
          </div>

          {/* ── Department cards ── */}
          <div className="py-1.5 px-1.5 overflow-y-auto flex-1 space-y-1">
            {filteredDepts.length === 0 && (
              <div className="text-center text-xs text-zinc-400 py-6">Ничего не найдено</div>
            )}
            {filteredDepts.map((dept) => {
              const deptId = dept.shortName;
              const colors = DEPT_COLORS[deptId] ?? DEFAULT_COLOR;
              const allSubs = subordinatesMap[deptId] ?? [];
              const filteredSubs = normalizedSearch
                ? allSubs.filter(s => s.toLowerCase().includes(normalizedSearch))
                : allSubs;
              const hasSubs = allSubs.length > 0;
              const isExpanded = expanded.has(deptId) || (normalizedSearch.length > 0 && filteredSubs.length > 0);
              const isDeptSelected = selectedDepartments.has(deptId);

              // Tri-state
              const selectedSubsForDept = allSubs.filter(s => selectedSubordinates.has(s));
              const isPartial = selectedSubsForDept.length > 0 && selectedSubsForDept.length < allSubs.length;
              const isAllSubsSelected = selectedSubsForDept.length === allSubs.length && allSubs.length > 0;

              // Group subordinates by type
              const grouped = groupByType(filteredSubs);

              return (
                <div key={dept.id} className="group/dept">
                  {/* ── Department card ── */}
                  <div
                    className={clsx(
                      'relative flex items-center gap-2 px-2.5 py-2 rounded-xl transition-all duration-150 cursor-pointer',
                      isDeptSelected || isAllSubsSelected
                        ? [colors.bg, 'ring-1 ring-inset ring-current/10']
                        : 'hover:bg-zinc-50 dark:hover:bg-zinc-700/40',
                    )}
                    onClick={() => toggleDepartment(deptId)}
                  >
                    {/* Accent bar */}
                    <div className={clsx('w-1 self-stretch rounded-full flex-shrink-0', colors.bar)} />

                    {/* Text content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={clsx('text-xs font-bold', colors.text)}>
                          <HighlightText text={deptId} query={normalizedSearch} />
                        </span>
                        {hasSubs && (
                          <span className="inline-flex items-center h-4 px-1.5 rounded-full bg-zinc-100 dark:bg-zinc-700 text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
                            {allSubs.length}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-zinc-500 dark:text-zinc-400 truncate leading-tight mt-0.5">
                        <HighlightText text={dept.name} query={normalizedSearch} />
                      </div>
                    </div>

                    {/* Checkbox / Checkmark */}
                    <div
                      className={clsx(
                        'w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all duration-150',
                        isDeptSelected
                          ? 'bg-blue-500 border-blue-500 shadow-sm shadow-blue-500/30'
                          : isPartial
                            ? 'bg-blue-200 dark:bg-blue-800 border-blue-400'
                            : 'border-zinc-300 dark:border-zinc-600 group-hover/dept:border-zinc-400 dark:group-hover/dept:border-zinc-500',
                      )}
                    >
                      {isDeptSelected && <Check size={12} className="text-white" strokeWidth={3} />}
                      {isPartial && !isDeptSelected && (
                        <div className="w-2 h-0.5 rounded-full bg-white" />
                      )}
                    </div>

                    {/* Expand toggle (stops propagation) */}
                    {hasSubs && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExpand(deptId);
                        }}
                        className={clsx(
                          'w-5 h-5 flex items-center justify-center rounded-md flex-shrink-0 transition-all',
                          'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300',
                          'hover:bg-zinc-200/60 dark:hover:bg-zinc-600/40',
                        )}
                      >
                        {isExpanded
                          ? <ChevronDown size={13} />
                          : <ChevronRight size={13} />
                        }
                      </button>
                    )}
                  </div>

                  {/* ── Subordinates (expanded) ── */}
                  <div
                    className={clsx(
                      'overflow-hidden transition-all duration-200',
                      isExpanded && hasSubs ? 'max-h-[2000px] opacity-100 mt-0.5' : 'max-h-0 opacity-0',
                    )}
                  >
                    <div className="ml-4 pl-3 border-l-2 border-zinc-200 dark:border-zinc-700/60 pb-1">
                      {ORG_TYPE_ORDER.map((orgType) => {
                        const items = grouped[orgType];
                        if (items.length === 0) return null;

                        const groupKey = `${deptId}:${orgType}`;
                        const isGroupExpanded = expandedGroups.has(groupKey) || items.length <= 3 || !!normalizedSearch;
                        const multipleGroups = Object.values(grouped).filter(g => g.length > 0).length > 1;

                        return (
                          <div key={orgType}>
                            {/* Group header */}
                            {filteredSubs.length > 3 && multipleGroups && (
                              <button
                                onClick={() => toggleGroupExpand(groupKey)}
                                className="flex items-center gap-1.5 pl-1 pr-2 py-1 text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider hover:text-zinc-600 dark:hover:text-zinc-300 w-full text-left transition-colors"
                              >
                                {isGroupExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                                <span>{orgType}</span>
                                <span className="inline-flex items-center h-3.5 px-1 rounded-full bg-zinc-100 dark:bg-zinc-700/60 text-[9px] font-semibold text-zinc-500 dark:text-zinc-400">
                                  {items.length}
                                </span>
                              </button>
                            )}

                            {/* Individual subordinate items */}
                            {isGroupExpanded && items.map((sub) => {
                              const isSubSelected = selectedSubordinates.has(sub);
                              return (
                                <div
                                  key={sub}
                                  onClick={() => toggleSubordinate(sub)}
                                  className={clsx(
                                    'flex items-center gap-2 pl-1.5 pr-2 py-1 rounded-lg cursor-pointer transition-all duration-100',
                                    isSubSelected
                                      ? 'bg-blue-50/60 dark:bg-blue-950/20'
                                      : 'hover:bg-zinc-50 dark:hover:bg-zinc-700/30',
                                  )}
                                >
                                  <div
                                    className={clsx(
                                      'w-3.5 h-3.5 rounded border-[1.5px] flex items-center justify-center flex-shrink-0 transition-all',
                                      isSubSelected
                                        ? 'bg-blue-500 border-blue-500'
                                        : 'border-zinc-300 dark:border-zinc-600',
                                    )}
                                  >
                                    {isSubSelected && <Check size={9} className="text-white" strokeWidth={3} />}
                                  </div>
                                  <span
                                    className="text-[11px] text-zinc-600 dark:text-zinc-400 text-left truncate leading-tight"
                                    title={sub}
                                  >
                                    <HighlightText text={sub} query={normalizedSearch} />
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
