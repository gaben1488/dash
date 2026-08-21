import { useState, useMemo, useEffect } from 'react';
import { SEVERITY_LABELS, productLabel } from '@aemr/shared';
import { useStore } from '../store';
import { useFilteredData } from '../hooks/useFilteredData';
import { ORIGIN_LABELS } from '../components/IssueList';
import { api, humanizeRequestError } from '../api';
import { resolveRecommendation, type RecommendationOrigin } from '../lib/selectors/recommendation-source';
import { pluralRu } from '../lib/economy-copy';
import { Lightbulb, ChevronDown, ChevronUp, AlertTriangle, Info, Inbox, Search } from 'lucide-react';
import clsx from 'clsx';

/**
 * Серьёзность замечания — она же вес рекомендации.
 *
 * Раньше страница переводила серьёзность в собственную шкалу («предупреждение»
 * становилось «действием», «существенное» — «предупреждением») и держала тип
 * «решение», который не выдавался никогда: счётчик «N решений» был обречён на
 * ноль. Своя шкала поверх канонической ничего не добавляла, зато переименовывала
 * серьёзность и расходилась со страницей «Замечания». Осталась одна шкала —
 * SEVERITY_LABELS из @aemr/shared.
 */
type RecSeverity = 'critical' | 'significant' | 'warning' | 'info';

const SEVERITY_ORDER: readonly RecSeverity[] = ['critical', 'significant', 'warning', 'info'];

const SEV_CONFIG: Record<RecSeverity, { label: string; bg: string; text: string; border: string; icon: typeof AlertTriangle }> = {
  critical: { label: SEVERITY_LABELS.critical.label, bg: 'bg-red-50 dark:bg-red-950/30', text: 'text-red-700 dark:text-red-400', border: 'border-red-200 dark:border-transparent', icon: AlertTriangle },
  significant: { label: SEVERITY_LABELS.significant.label, bg: 'bg-orange-50 dark:bg-orange-950/30', text: 'text-orange-700 dark:text-orange-400', border: 'border-orange-200 dark:border-transparent', icon: AlertTriangle },
  warning: { label: SEVERITY_LABELS.warning.label, bg: 'bg-amber-50 dark:bg-amber-950/30', text: 'text-amber-700 dark:text-amber-400', border: 'border-amber-200 dark:border-transparent', icon: AlertTriangle },
  info: { label: SEVERITY_LABELS.info.label, bg: 'bg-zinc-50 dark:bg-zinc-700/50', text: 'text-zinc-600 dark:text-zinc-400', border: 'border-zinc-200 dark:border-transparent', icon: Info },
};

/** Серьёзность конвейера → шкала показа ('error' лечится как критическое). */
function toRecSeverity(severity: unknown): RecSeverity {
  switch (severity) {
    case 'critical':
    case 'error':
      return 'critical';
    case 'significant':
      return 'significant';
    case 'warning':
      return 'warning';
    default:
      return 'info';
  }
}

const DEPT_UNKNOWN_LABEL = 'Управление не указано';

function deptLabel(dept: string): string {
  return dept ? productLabel(dept) : DEPT_UNKNOWN_LABEL;
}

function recsWord(n: number): string {
  return pluralRu(n, 'рекомендация', 'рекомендации', 'рекомендаций');
}

function issuesWord(n: number): string {
  return pluralRu(n, 'замечание', 'замечания', 'замечаний');
}

interface Recommendation {
  id: string;
  severity: RecSeverity;
  /** Ключ управления; пустая строка = управление не проставлено. */
  dept: string;
  title: string;
  description: string;
  source: string;
  /** Канонический текст рекомендации; null — готового текста нет. */
  action: string | null;
  actionOrigin: RecommendationOrigin;
  /** Место в книге: «лист УО, ячейка K1481». */
  where: string | null;
}

export function RecsPage() {
  const { dashboardData } = useStore();
  const fd = useFilteredData();
  const [openDepts, setOpenDepts] = useState<Set<string>>(new Set());

  // Use centralized filtered issues (respects dept, subordinate, search, activity)
  const recs: Recommendation[] = useMemo(() => {
    const filtered = fd.issues;
    if (!filtered || filtered.length === 0) return [];
    return filtered.map((issue: any, idx: number) => {
      const resolved = resolveRecommendation(issue);
      return {
        id: issue.id ?? `rec-${idx}`,
        severity: toRecSeverity(issue.severity),
        dept: issue.departmentId || issue.sheet || '',
        title: issue.title || issue.message || 'Замечание без заголовка',
        description: issue.description || '',
        source: issue.origin ? (ORIGIN_LABELS[issue.origin] ?? productLabel(issue.origin)) : 'Проверка данных',
        action: resolved.text,
        actionOrigin: resolved.origin,
        where: resolved.where,
      };
    });
  }, [fd.issues]);

  // Auto-open departments with critical issues on first load
  const initialOpen = useMemo(() => {
    const depts = new Set<string>();
    for (const r of recs) {
      if (r.severity === 'critical') depts.add(r.dept);
    }
    return depts;
  }, [recs]);

  // Use initialOpen only when openDepts hasn't been touched
  const [hasInteracted, setHasInteracted] = useState(false);
  const effectiveOpen = hasInteracted ? openDepts : initialOpen;

  const deptGroups = useMemo(() => {
    const groups = new Map<string, Recommendation[]>();
    for (const r of recs) {
      const list = groups.get(r.dept) ?? [];
      list.push(r);
      groups.set(r.dept, list);
    }
    return groups;
  }, [recs]);

  const bySeverity = useMemo(() => {
    const counts: Record<RecSeverity, number> = { critical: 0, significant: 0, warning: 0, info: 0 };
    for (const r of recs) counts[r.severity] += 1;
    return counts;
  }, [recs]);

  /** Сколько рекомендаций без готового текста — это признаётся вслух, а не заметается. */
  const withoutText = useMemo(() => recs.filter(r => r.action === null).length, [recs]);

  const toggleDept = (dept: string) => {
    setHasInteracted(true);
    const next = new Set(effectiveOpen);
    if (next.has(dept)) next.delete(dept);
    else next.add(dept);
    setOpenDepts(next);
  };

  if (recs.length === 0) {
    // Пустота бывает трёх разных причин, и путать их нельзя: «книги не читали»,
    // «нарушений нет» и «всё скрыл отбор шапки» требуют разных действий.
    const allIssues: unknown[] = dashboardData?.snapshot?.issues ?? dashboardData?.recentIssues ?? [];
    const hiddenByFilters = allIssues.length > 0;
    return (
      <div className="space-y-6">
        <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-transparent p-12 text-center">
          <Inbox className="mx-auto text-zinc-300 dark:text-zinc-600 mb-4" size={48} aria-hidden="true" />
          <h2 className="text-lg font-semibold text-zinc-600 dark:text-zinc-300 mb-2">
            {!dashboardData
              ? 'Книги закупок ещё не прочитаны'
              : hiddenByFilters
                ? 'Под отбор шапки не подошло ни одно замечание'
                : 'Замечаний нет — рекомендовать нечего'}
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-md mx-auto">
            {!dashboardData
              ? 'Рекомендация — это часть проверки, нашедшей замечание. Нажмите «Обновить» в шапке: система перечитает книги управлений и прогонит проверки.'
              : hiddenByFilters
                ? `Всего в последнем прогоне ${allIssues.length} ${issuesWord(allIssues.length)}. Их скрыл отбор в шапке — управление, подведомственная организация, вид деятельности или поиск. Снимите отбор, чтобы увидеть рекомендации.`
                : 'Проверки не нашли нарушений в прочитанных книгах. Как только замечание появится, здесь будет и рекомендация из его проверки.'}
          </p>
        </div>
        <NormalizationSection />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary — заголовок говорит о данных, а не называет витрину */}
      <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-transparent p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3">
            <Lightbulb className="text-amber-500 mt-0.5" size={22} aria-hidden="true" />
            <div>
              {/* Заголовок утверждает про данные; счёт и слово рядом не согласуются
                  падежами — фраза построена так, чтобы работать при любом числе. */}
              <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                {bySeverity.critical > 0
                  ? `Критических замечаний: ${bySeverity.critical} — их разбирают первыми`
                  : `Критических замечаний нет. Всего рекомендаций: ${recs.length}`}
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 max-w-2xl">
                Текст каждой рекомендации принадлежит проверке, которая нашла замечание. Своего совета продукт не сочиняет:
                где у проверки готового текста нет, так и написано.
                {withoutText > 0 && ` Сейчас без текста — ${withoutText} из ${recs.length}.`}
              </p>
            </div>
          </div>
          <div className="flex gap-2 text-xs flex-wrap">
            {SEVERITY_ORDER.filter(s => bySeverity[s] > 0).map(s => {
              const cfg = SEV_CONFIG[s];
              return (
                <span key={s} className={clsx('px-2.5 py-1 rounded-full font-medium', cfg.bg, cfg.text)}>
                  {cfg.label}: {bySeverity[s]}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {/* Department accordions */}
      <div className="space-y-3">
        {Array.from(deptGroups.entries()).map(([dept, groupRecs]) => {
          const open = effectiveOpen.has(dept);
          const criticalCount = groupRecs.filter(r => r.severity === 'critical').length;
          const label = deptLabel(dept);
          const panelId = `recs-dept-${dept || 'unknown'}`;
          return (
            <div key={dept || 'unknown'} className={clsx('bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border overflow-hidden', criticalCount > 0 ? 'border-red-200 dark:border-transparent' : 'border-zinc-100 dark:border-transparent')}>
              <button
                onClick={() => toggleDept(dept)}
                aria-expanded={open}
                aria-controls={panelId}
                className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-zinc-50 dark:hover:bg-zinc-700/30 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset"
              >
                <span className="flex items-center gap-3 text-left">
                  <span className={clsx(
                    'w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0',
                    criticalCount > 0 ? 'bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400' : 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400'
                  )} aria-hidden="true">
                    {label.slice(0, 2)}
                  </span>
                  <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{label}</span>
                  <span className="text-xs text-zinc-400 dark:text-zinc-500">
                    {groupRecs.length} {recsWord(groupRecs.length)}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  {criticalCount > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400 font-medium">
                      {SEV_CONFIG.critical.label}: {criticalCount}
                    </span>
                  )}
                  {open ? <ChevronUp size={14} className="text-zinc-400" aria-hidden="true" /> : <ChevronDown size={14} className="text-zinc-400" aria-hidden="true" />}
                </span>
              </button>

              {open && (
                <div id={panelId} className="border-t border-zinc-100 dark:border-zinc-700/50 divide-y divide-zinc-100 dark:divide-zinc-700/50">
                  {groupRecs.map(rec => {
                    const cfg = SEV_CONFIG[rec.severity];
                    const Icon = cfg.icon;
                    return (
                      <div key={rec.id} className={clsx('p-4', cfg.bg)}>
                        <div className="flex items-start gap-3">
                          <Icon size={16} className={clsx('flex-shrink-0 mt-0.5', cfg.text)} aria-hidden="true" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className={clsx('text-[10px] px-1.5 py-0.5 rounded-full font-medium border', cfg.bg, cfg.text, cfg.border)}>
                                {cfg.label}
                              </span>
                            </div>
                            <h4 className="text-sm font-medium text-zinc-800 dark:text-white">{rec.title}</h4>
                            {rec.description && <p className="text-xs text-zinc-600 dark:text-zinc-300 mt-1">{rec.description}</p>}
                            <div className="flex items-center gap-4 mt-2 text-[10px] text-zinc-500 dark:text-zinc-400">
                              <span>Нашла проверка: <strong className="text-zinc-600 dark:text-zinc-300">{rec.source}</strong></span>
                              {rec.where && <span>Место в книге: <strong className="text-zinc-600 dark:text-zinc-300">{rec.where}</strong></span>}
                            </div>
                            <div className="mt-2 px-3 py-2 bg-white/60 dark:bg-zinc-900/30 rounded-lg border border-zinc-200/50 dark:border-transparent">
                              {rec.action ? (
                                <p className="text-xs text-zinc-700 dark:text-zinc-200">
                                  <strong className="text-blue-600 dark:text-blue-400">Что сделать:</strong> {rec.action}
                                </p>
                              ) : (
                                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                  <strong className="text-zinc-600 dark:text-zinc-300">Готовой рекомендации нет.</strong>{' '}
                                  У этой проверки текст не заполнен, а сочинять совет за неё продукт не станет.
                                  {rec.where
                                    ? ` Разберите по описанию замечания: ${rec.where}.`
                                    : ' Разберите по описанию замечания.'}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Normalization section */}
      <NormalizationSection />
    </div>
  );
}

// ────────────────────────────────────────────────────────
// Normalization section: subjects analysis
// ────────────────────────────────────────────────────────

interface SubjectEntry {
  text: string;
  count: number;
  departments: string[];
  similarTo?: string[];
}

/** Сколько предметов показываем в каждом списке; остаток называется числом. */
const SUBJECT_VISIBLE_LIMIT = 50;

function subjectsWord(n: number): string {
  return pluralRu(n, 'предмет', 'предмета', 'предметов');
}

function recordsWord(n: number): string {
  return pluralRu(n, 'запись', 'записи', 'записей');
}

function NormalizationSection() {
  const [subjects, setSubjects] = useState<SubjectEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getSubjects()
      .then((data: { subjects: SubjectEntry[] }) => {
        if (!cancelled) { setSubjects(data.subjects ?? []); setError(null); }
      })
      .catch((err: unknown) => {
        // Текст движка («Failed to fetch») по-русски не бывает — переводим тем
        // же домом фраз, что и остальные страницы.
        if (!cancelled) setError(humanizeRequestError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const multiDept = useMemo(
    () => subjects.filter(s => s.departments.length > 1),
    [subjects],
  );

  const similar = useMemo(
    () => subjects.filter(s => s.similarTo && s.similarTo.length > 0),
    [subjects],
  );

  if (loading) {
    return (
      <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-transparent p-6">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Сверяем предметы закупок между управлениями…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-transparent p-6">
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
          Сверка предметов закупок не выполнена
        </p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
          Совпадающие и похожие предметы сейчас показать нечем — на рекомендации выше это не влияет. Обновите страницу
          или повторите позже. <span className="text-zinc-400 dark:text-zinc-500">({error})</span>
        </p>
      </div>
    );
  }

  if (multiDept.length === 0 && similar.length === 0) return null;

  return (
    <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-transparent overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        aria-controls="normalization-panel"
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-700/30 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset"
      >
        <span className="flex items-center gap-3">
          <Search className="text-indigo-500" size={20} aria-hidden="true" />
          <span className="text-left">
            <span className="block text-sm font-semibold text-zinc-700 dark:text-zinc-200">Одинаковые закупки в разных управлениях</span>
            <span className="block text-xs text-zinc-500 dark:text-zinc-400">
              Предметов, которые закупают сразу несколько управлений: {multiDept.length}. С близкими названиями: {similar.length}
            </span>
          </span>
        </span>
        {expanded ? <ChevronUp size={14} className="text-zinc-400" aria-hidden="true" /> : <ChevronDown size={14} className="text-zinc-400" aria-hidden="true" />}
      </button>

      {expanded && (
        <div id="normalization-panel" className="border-t border-zinc-100 dark:border-zinc-700/50 p-5 space-y-6">
          {/* Multi-department subjects */}
          {multiDept.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-3">
                Один предмет — несколько управлений: {multiDept.length} {subjectsWord(multiDept.length)}
              </h3>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {multiDept.slice(0, SUBJECT_VISIBLE_LIMIT).map((s, i) => (
                  <div key={i} className="flex items-start gap-3 px-3 py-2 bg-zinc-50 dark:bg-zinc-900/30 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-zinc-700 dark:text-zinc-200 truncate" title={s.text}>{s.text}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-[10px] text-zinc-500 dark:text-zinc-400">{s.count} {recordsWord(s.count)}</span>
                        <div className="flex gap-1 flex-wrap">
                          {s.departments.map(d => (
                            <span key={d} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400">
                              {deptLabel(d)}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {/* Список подрезан — молчать об этом нельзя: заголовок называет одно число, глаза видят другое. */}
              {multiDept.length > SUBJECT_VISIBLE_LIMIT && (
                <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                  Показаны первые {SUBJECT_VISIBLE_LIMIT} из {multiDept.length}; остальные {multiDept.length - SUBJECT_VISIBLE_LIMIT} в список не поместились.
                </p>
              )}
            </div>
          )}

          {/* Similar subjects */}
          {similar.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-3">
                Близкие названия одного и того же: {similar.length} {subjectsWord(similar.length)}
              </h3>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {similar.slice(0, SUBJECT_VISIBLE_LIMIT).map((s, i) => (
                  <div key={i} className="px-3 py-2 bg-amber-50 dark:bg-amber-950/20 rounded-lg">
                    <p className="text-sm text-zinc-700 dark:text-zinc-200 truncate" title={s.text}>{s.text}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-[10px] text-zinc-500 dark:text-zinc-400">{s.count} {recordsWord(s.count)}</span>
                      <div className="flex gap-1 flex-wrap">
                        {s.departments.map(d => (
                          <span key={d} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400">
                            {deptLabel(d)}
                          </span>
                        ))}
                      </div>
                    </div>
                    {s.similarTo && s.similarTo.length > 0 && (
                      <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-1">
                        Похоже на: {s.similarTo.slice(0, 3).join('; ')}
                        {s.similarTo.length > 3 && ` и ещё ${s.similarTo.length - 3}`}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              {similar.length > SUBJECT_VISIBLE_LIMIT && (
                <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                  Показаны первые {SUBJECT_VISIBLE_LIMIT} из {similar.length}; остальные {similar.length - SUBJECT_VISIBLE_LIMIT} в список не поместились.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
