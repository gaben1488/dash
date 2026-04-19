/**
 * OrgRail — Inline visible org filter chips
 *
 * 8 ГРБС always visible as glass chips (like drums).
 * Click = toggle filter. No popup for basic use.
 * Subordinate popover only for deep drill-down.
 *
 * Anti-Slop: unique per-dept color dot, glass recipe matching drums.
 * Identity: empty Set = "Все" = no filter.
 */
import { useState, useRef, useEffect, useMemo } from 'react';
import { useStore } from '../../store';
import { DEPARTMENT_REGISTRY } from '@aemr/shared';
import { ChevronDown, Check, X, Search } from 'lucide-react';
import clsx from 'clsx';

const DEPARTMENTS = DEPARTMENT_REGISTRY.map(d => ({
  id: d.latinId,
  short: d.shortName,
  full: d.fullName,
}));

/** Per-dept accent — matches DeptTreePicker palette */
const DEPT_DOT: Record<string, string> = {
  'УЭР':     '#3b82f6',
  'УИО':     '#10b981',
  'УАГЗО':   '#f59e0b',
  'УФБП':    '#8b5cf6',
  'УД':      '#f43f5e',
  'УДТХ':    '#06b6d4',
  'УКСиМП':  '#f97316',
  'УО':      '#14b8a6',
};

/** Classify subordinate by name pattern */
function classifySubordinate(name: string): string {
  const lower = name.toLowerCase();
  if (lower.startsWith('мку') || lower.includes('"мку') || lower.includes('«мку')) return 'МКУ';
  if (lower.startsWith('мбу') || lower.includes('"мбу') || lower.includes('«мбу')) return 'МБУ';
  if (lower.includes('школ') || lower.includes('гимназ') || lower.includes('лицей') || lower.includes('сош')) return 'Школы';
  if (lower.includes('детск') || lower.includes('садик') || lower.includes('доу') || lower.includes('мадоу')) return 'Д/С';
  return 'Другое';
}

/** Group subordinates by type */
function groupByType(subs: string[]): { type: string; items: string[] }[] {
  const map = new Map<string, string[]>();
  for (const s of subs) {
    const t = classifySubordinate(s);
    if (!map.has(t)) map.set(t, []);
    map.get(t)!.push(s);
  }
  return [...map.entries()].map(([type, items]) => ({ type, items }));
}

export function OrgRail() {
  const {
    selectedDepartments,
    selectedSubordinates,
    toggleDepartment,
    toggleSubordinate,
    selectAllDepartments,
    clearSubordinates,
    subordinatesMap,
  } = useStore();

  const [expandedDept, setExpandedDept] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const popRef = useRef<HTMLDivElement>(null);

  const isAll = selectedDepartments.size === 0 && selectedSubordinates.size === 0;

  // Close popover on outside click
  useEffect(() => {
    if (!expandedDept) return;
    const handler = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setExpandedDept(null);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [expandedDept]);

  return (
    <div className="org-rail" ref={popRef}>
      {/* "Все" chip */}
      <button
        className={clsx('org-chip', isAll && 'org-chip-active')}
        onClick={() => {
          if (!isAll) {
            // Clear all selections = back to identity
            if (selectedDepartments.size > 0) selectAllDepartments();
            if (selectedSubordinates.size > 0) clearSubordinates();
            // If selectAll doesn't clear, toggle each
            if (selectedDepartments.size > 0) {
              for (const d of selectedDepartments) toggleDepartment(d);
            }
          }
        }}
        title="Все организации (нет фильтра)"
      >
        <span className="org-chip-dot" style={{ background: 'linear-gradient(135deg, #3b82f6, #10b981, #f59e0b)' }} />
        <span className="org-chip-label">Все</span>
      </button>

      {/* 8 ГРБС chips */}
      {DEPARTMENTS.map((dept) => {
        const isSelected = selectedDepartments.has(dept.short);
        const subsForDept = subordinatesMap[dept.short] ?? [];
        const selectedSubsCount = subsForDept.filter(s => selectedSubordinates.has(s)).length;
        const hasSubSelection = selectedSubsCount > 0;
        const hasSubs = subsForDept.length > 0;
        const isExpanded = expandedDept === dept.short;
        const dotColor = DEPT_DOT[dept.short] ?? '#71717a';

        return (
          <div key={dept.id} className="relative">
            <button
              className={clsx(
                'org-chip',
                (isSelected || hasSubSelection) && 'org-chip-active',
              )}
              onClick={() => {
                toggleDepartment(dept.short);
                setExpandedDept(null);
              }}
              title={dept.full}
            >
              <span
                className="org-chip-dot"
                style={{ backgroundColor: dotColor }}
              />
              <span className="org-chip-label">{dept.short}</span>

              {/* Subordinate count badge */}
              {hasSubSelection && (
                <span className="org-chip-badge">{selectedSubsCount}</span>
              )}

              {/* Expand arrow for subordinates */}
              {hasSubs && (
                <span
                  className="org-chip-expand"
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpandedDept(isExpanded ? null : dept.short);
                    setSearch('');
                  }}
                >
                  <ChevronDown
                    size={10}
                    className={clsx('transition-transform duration-200', isExpanded && 'rotate-180')}
                  />
                </span>
              )}
            </button>

            {/* ── Subordinate popover (only when expanded) ── */}
            {isExpanded && hasSubs && (
              <SubordinatePanel
                deptShort={dept.short}
                deptFull={dept.full}
                subs={subsForDept}
                dotColor={dotColor}
                search={search}
                setSearch={setSearch}
                selectedSubordinates={selectedSubordinates}
                toggleSubordinate={toggleSubordinate}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ─── Subordinate Panel (shown on expand) ─────────────────────── */

function SubordinatePanel({
  deptShort, deptFull, subs, dotColor, search, setSearch,
  selectedSubordinates, toggleSubordinate,
}: {
  deptShort: string;
  deptFull: string;
  subs: string[];
  dotColor: string;
  search: string;
  setSearch: (v: string) => void;
  selectedSubordinates: Set<string>;
  toggleSubordinate: (v: string) => void;
}) {
  const normalizedSearch = search.trim().toLowerCase();
  const filtered = normalizedSearch
    ? subs.filter(s => s.toLowerCase().includes(normalizedSearch))
    : subs;
  const groups = useMemo(() => groupByType(filtered), [filtered]);

  return (
    <div className="org-sub-panel">
      {/* Header */}
      <div className="px-3 pt-2.5 pb-2 border-b border-zinc-200/50 dark:border-zinc-700/50">
        <div className="flex items-center gap-2 mb-2">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: dotColor }} />
          <span className="text-[11px] font-bold text-zinc-700 dark:text-zinc-200">{deptShort}</span>
          <span className="text-[10px] text-zinc-400 truncate">{deptFull}</span>
          <span className="ml-auto text-[10px] text-zinc-400 font-mono">{subs.length}</span>
        </div>
        {subs.length > 5 && (
          <div className="relative">
            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск..."
              autoFocus
              className="w-full pl-6 pr-6 py-1.5 text-[10px] rounded-lg bg-zinc-50 dark:bg-zinc-700/50 border border-zinc-200 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 placeholder-zinc-400 focus:outline-none focus:border-blue-400 transition-all"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
              >
                <X size={10} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Subordinate list */}
      <div className="py-1 px-1.5 max-h-[280px] overflow-y-auto">
        {filtered.length === 0 && (
          <div className="text-center text-[10px] text-zinc-400 py-4">Не найдено</div>
        )}
        {groups.map(({ type, items }) => (
          <div key={type}>
            {groups.length > 1 && (
              <div className="px-2 py-1 text-[9px] font-bold text-zinc-400 uppercase tracking-wider">{type}</div>
            )}
            {items.map((sub) => {
              const isSelected = selectedSubordinates.has(sub);
              return (
                <button
                  key={sub}
                  onClick={() => toggleSubordinate(sub)}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-all duration-100',
                    isSelected
                      ? 'bg-blue-50/60 dark:bg-blue-950/20'
                      : 'hover:bg-zinc-50 dark:hover:bg-zinc-700/30',
                  )}
                >
                  <div
                    className={clsx(
                      'w-3.5 h-3.5 rounded border-[1.5px] flex items-center justify-center flex-shrink-0 transition-all',
                      isSelected
                        ? 'bg-blue-500 border-blue-500'
                        : 'border-zinc-300 dark:border-zinc-600',
                    )}
                  >
                    {isSelected && <Check size={9} className="text-white" strokeWidth={3} />}
                  </div>
                  <span
                    className="text-[10px] text-zinc-600 dark:text-zinc-400 truncate"
                    title={sub}
                  >
                    {sub}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
