import { useMemo, useState, useCallback } from 'react';
import { useStore } from '../store';
import clsx from 'clsx';
import { ChevronDown } from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════════
   ORG STRIP — Accordion + Chips (v3)

   - ГРБС header = click selects dept + all subs
   - "только упр." button = select dept only (no subs)
   - Sub chips = only real subordinates (self-references removed)
   - Names abbreviated uniformly to acronyms: МБОУ "Елизовская СШ №9" → ЕСШ9
   - Subs grouped by type with color tints
   - Strip width: 120px
   ═══════════════════════════════════════════════════════════════════ */

const DEPT_ABBR: Record<string, string> = {
  'УЭР': 'УЭР', 'УИО': 'УИО', 'УАГЗО': 'УАГЗО', 'УФБП': 'УФБП',
  'УД': 'УД', 'УДТХ': 'УДТХ', 'УКСиМП': 'УКСиМП', 'УО': 'УО',
};

const DEPT_COLORS = [
  '#3b82f6', '#8b5cf6', '#06b6d4', '#f59e0b',
  '#10b981', '#ef4444', '#ec4899', '#6366f1',
];

/** Sub-group patterns → label + tint */
const SUB_GROUPS: { pattern: RegExp; label: string; tint: string }[] = [
  { pattern: /школ|сош|сш|гимназ|лицей|[оо]ш\b/i, label: 'Школы', tint: '#3b82f6' },
  { pattern: /сад|дс\b|дош|доу|ДОУ/i, label: 'Д/сады', tint: '#10b981' },
  { pattern: /спорт|ск\b|дюсш|физ/i, label: 'Спорт', tint: '#f59e0b' },
  { pattern: /культур|дк\b|музей|библ|клуб|дши|дмш|школа искусств/i, label: 'Культ.', tint: '#8b5cf6' },
  { pattern: /цб\b|бух|центр.*бух/i, label: 'ЦБ', tint: '#71717a' },
  { pattern: /мто|хоз|ахо|хозу/i, label: 'Хоз.', tint: '#71717a' },
];

function detectGroup(name: string): { label: string; tint: string } | null {
  for (const g of SUB_GROUPS) {
    if (g.pattern.test(name)) return { label: g.label, tint: g.tint };
  }
  return null;
}

/** Check if a sub name is actually the department itself (self-reference).
 *  "Администрирование", "Опека", or when sub name contains the dept abbreviation. */
const SELF_REF_PATTERNS = /^администрир|^опека$|^управлен/i;
function isSelfReference(subName: string, deptId: string): boolean {
  if (subName === '_org_itself') return true;
  if (SELF_REF_PATTERNS.test(subName)) return true;
  // If the sub name is just the dept name in quotes
  if (subName === deptId || subName === `МКУ "${deptId}"`) return true;
  return false;
}

/** Abbreviate sub name to uniform short label for chip display.
 *  Strategy: strip all org-type prefixes + brackets, then shorten what remains.
 *  Examples:
 *    МБУ ДО "КДМШ" → КДМШ
 *    МБУ ДО «ДШИ п.Термальный» → ДШИ Терм.
 *    МБОУ «Елизовская СОШ №9» → ЕСОШ №9
 *    МКУ "ЦБ УО" → ЦБ УО
 *    МБУДО Подростковый центр «Патриот» → ЦПатриот
 *    МБУК «Районный ДК» → РДК
 */
function abbreviateSub(name: string): string {
  // 1. Strip org-type prefix completely
  let inner = name
    .replace(/^(?:МКУ|МБУ\s*ДО|МБУДО|МБУК|МБОУ|МАОУ|МАУ|МБУ|МБДОУ|МАДОУ|МКОУ|МУП)\s*/i, '')
    .trim();

  // 2. Remove ALL quote/bracket pairs: «», "", ""
  inner = inner.replace(/[«»""]/g, '').trim();

  // 3. If already short (<=7 chars) — return as-is
  if (inner.length <= 7) return inner;

  // 4. If all-caps abbreviation (possibly with spaces/numbers) — return as-is
  if (/^[А-ЯЁA-Z\s\d№.]+$/.test(inner) && inner.length <= 12) return inner;

  // 5. Extract number (№9, №12) to append later
  const numMatch = inner.match(/№\s*(\d+)/);
  const num = numMatch ? ` №${numMatch[1]}` : '';
  let base = inner.replace(/№\s*\d+/g, '').trim();

  // 6. Remove location prefixes: п., г., с., пос., etc.
  base = base.replace(/\b(?:п|г|с|пос|ст|мкр)\.\s*/gi, '');

  // 7. Split into words, build short form
  const SKIP = /^(и|в|на|по|для|от|из|при|им|имени|муниципальное|муниципальная|муниципальный|бюджетное|казённое|автономное)$/i;
  const words = base.split(/[\s\-–]+/).filter(w => w.length > 0 && !SKIP.test(w));

  if (words.length === 0) return inner;

  if (words.length === 1) {
    const w = words[0];
    // Already an abbreviation
    if (/^[А-ЯЁ]{2,6}$/.test(w)) return w + num;
    // Truncate long single word
    return (w.length > 8 ? w.slice(0, 7) + '.' : w) + num;
  }

  // Multi-word: take first letter of each, but keep existing abbreviations whole
  const parts = words.map(w => {
    if (/^[А-ЯЁA-Z]{2,5}$/.test(w)) return w;  // СОШ, ДШИ, ДК — keep
    if (/^[А-ЯЁA-Z][а-яё]+$/.test(w) && w.length <= 4) return w; // Луч — keep
    return w[0].toUpperCase();
  });

  return parts.join('') + num;
}

const COLLAPSE_THRESHOLD = 5;
const COLLAPSED_SHOW = 4;

export function OrgStrip() {
  const {
    subordinatesMap,
    selectedDepartments,
    toggleDepartment,
    selectAllDepartments,
    selectedSubordinates,
    toggleSubordinate,
    deptOnlyMode,
    setDeptOnly,
    clearDeptOnly,
  } = useStore();

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = useCallback((deptId: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(deptId)) next.delete(deptId);
      else next.add(deptId);
      return next;
    });
  }, []);

  const departments = useMemo(() => {
    return Object.entries(subordinatesMap).map(([deptId, subs], idx) => {
      // Filter out self-references
      const realSubs = subs.filter(s => !isSelfReference(s, deptId));

      // Group subs by detected type
      const grouped: { group: string; tint: string; items: string[] }[] = [];
      const ungrouped: string[] = [];
      for (const sub of realSubs) {
        const g = detectGroup(sub);
        if (g) {
          const existing = grouped.find(x => x.group === g.label);
          if (existing) existing.items.push(sub);
          else grouped.push({ group: g.label, tint: g.tint, items: [sub] });
        } else {
          ungrouped.push(sub);
        }
      }

      return {
        id: deptId,
        abbr: DEPT_ABBR[deptId] ?? deptId,
        realSubs,
        grouped,
        ungrouped,
        color: DEPT_COLORS[idx % DEPT_COLORS.length],
      };
    });
  }, [subordinatesMap]);

  const noFilter = selectedDepartments.size === 0 && selectedSubordinates.size === 0;
  const totalDepts = departments.length;
  const totalSubs = departments.reduce((s, d) => s + d.realSubs.length, 0);

  return (
    <aside className="ob-strip" aria-label="Организации" data-selective={!noFilter || undefined}>
      {/* "Все" toggle */}
      <button
        className={clsx('ob-vse', noFilter && 'ob-vse-active')}
        onClick={selectAllDepartments}
        title={`${totalDepts} управлений, ${totalSubs} подведов`}
      >
        <span className="ob-vse-dot" />
        <span className="ob-vse-label">Все</span>
        <span className="ob-vse-count">{totalDepts + totalSubs}</span>
      </button>

      {/* Scrollable accordion */}
      <div className="ob-scroll">
        {departments.map((dept) => {
          const isDeptSelected = selectedDepartments.has(dept.id);
          const isDeptOnly = deptOnlyMode.has(dept.id);
          const isActive = noFilter || isDeptSelected;
          const hasSubs = dept.realSubs.length > 0;
          const isLarge = dept.realSubs.length > COLLAPSE_THRESHOLD;
          const isExpanded = expanded.has(dept.id);

          // Build flat list for rendering
          const allItems = [
            ...dept.ungrouped.map(s => ({ sub: s, groupTint: null as string | null })),
            ...dept.grouped.flatMap(g =>
              g.items.map(s => ({ sub: s, groupTint: g.tint }))
            ),
          ];
          const visibleItems = isLarge && !isExpanded
            ? allItems.slice(0, COLLAPSED_SHOW)
            : allItems;
          const hiddenCount = isLarge && !isExpanded
            ? allItems.length - COLLAPSED_SHOW
            : 0;

          return (
            <div key={dept.id} className="ob-dept" data-active={isActive || undefined}>
              {/* ГРБС header — click = dept + all subs */}
              <button
                className={clsx('ob-dept-btn', isActive && !deptOnlyMode.has(dept.id) && 'ob-dept-active')}
                onClick={() => {
                  if (selectedDepartments.has(dept.id) && !deptOnlyMode.has(dept.id)) {
                    // Already selected with subs → deselect
                    toggleDepartment(dept.id);
                  } else {
                    // Select dept + all subs: clear deptOnly, toggle dept on
                    clearDeptOnly(dept.id);
                    if (!selectedDepartments.has(dept.id)) {
                      toggleDepartment(dept.id);
                    }
                  }
                }}
                title={`${dept.id} — выбрать с подведами`}
              >
                <span className="ob-dept-bar" style={{ background: dept.color }} />
                <span className="ob-dept-name">{dept.abbr}</span>
                {hasSubs && (
                  <span className="ob-dept-num" style={{ color: dept.color }}>
                    {dept.realSubs.length}
                  </span>
                )}
              </button>

              {/* "Только управление" — dept only, no subs */}
              {hasSubs && (
                <button
                  className={clsx(
                    'ob-dept-only',
                    deptOnlyMode.has(dept.id) && 'ob-dept-only-active'
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (deptOnlyMode.has(dept.id)) {
                      // Already in dept-only → deselect entirely
                      clearDeptOnly(dept.id);
                      if (selectedDepartments.has(dept.id)) toggleDepartment(dept.id);
                    } else {
                      // Activate dept-only mode
                      setDeptOnly(dept.id);
                    }
                  }}
                  title={`Только ${dept.abbr} (без подведов)`}
                  style={{ borderColor: `${dept.color}25` }}
                >
                  только управление
                </button>
              )}

              {/* Subordinate chips — real subs only */}
              {hasSubs && (
                <div className="ob-chips">
                  {visibleItems.map(({ sub, groupTint }) => {
                    const subActive = !isDeptOnly && (noFilter || selectedSubordinates.has(sub) || (isDeptSelected && selectedSubordinates.size === 0));
                    const chipLabel = abbreviateSub(sub);
                    const chipColor = groupTint ?? dept.color;
                    return (
                      <button
                        key={sub}
                        className={clsx('ob-chip', subActive && 'ob-chip-active')}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isDeptOnly) clearDeptOnly(dept.id);
                          toggleSubordinate(sub);
                        }}
                        title={sub}
                        style={subActive
                          ? { borderColor: chipColor, color: chipColor }
                          : groupTint
                            ? { borderColor: `${groupTint}30` }
                            : undefined
                        }
                      >
                        {chipLabel}
                      </button>
                    );
                  })}

                  {isLarge && (
                    <button
                      className="ob-chip ob-chip-more"
                      onClick={() => toggleExpand(dept.id)}
                      title={isExpanded ? 'Свернуть' : `Ещё ${hiddenCount}`}
                      style={{ color: dept.color }}
                    >
                      {isExpanded ? (
                        <><ChevronDown size={8} className="rotate-180" /> свернуть</>
                      ) : (
                        <>+{hiddenCount}</>
                      )}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
