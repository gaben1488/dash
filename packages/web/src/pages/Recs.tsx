import { useState, useMemo, useEffect } from 'react';
import { useStore } from '../store';
import { useFilteredData } from '../hooks/useFilteredData';
import { api } from '../api';
import { Lightbulb, ChevronDown, ChevronUp, AlertTriangle, Info, Zap, HelpCircle, Inbox, Search } from 'lucide-react';
import clsx from 'clsx';

type RecType = 'critical' | 'warning' | 'action' | 'decision' | 'info';

interface Recommendation {
  id: string;
  type: RecType;
  dept: string;
  title: string;
  description: string;
  source: string;
  action: string;
}

const REC_CONFIG: Record<RecType, { label: string; bg: string; text: string; border: string; icon: typeof AlertTriangle }> = {
  critical: { label: 'Критическое', bg: 'bg-red-50 dark:bg-red-950/30', text: 'text-red-700 dark:text-red-400', border: 'border-red-200 dark:border-red-800', icon: AlertTriangle },
  warning: { label: 'Предупреждение', bg: 'bg-amber-50 dark:bg-amber-950/30', text: 'text-amber-700 dark:text-amber-400', border: 'border-amber-200 dark:border-amber-800', icon: AlertTriangle },
  action: { label: 'Действие', bg: 'bg-blue-50 dark:bg-blue-950/30', text: 'text-blue-700 dark:text-blue-400', border: 'border-blue-200 dark:border-blue-800', icon: Zap },
  decision: { label: 'Решение', bg: 'bg-purple-50 dark:bg-purple-950/30', text: 'text-purple-700 dark:text-purple-400', border: 'border-purple-200 dark:border-purple-800', icon: HelpCircle },
  info: { label: 'Информация', bg: 'bg-zinc-50 dark:bg-zinc-700/50', text: 'text-zinc-600 dark:text-zinc-400', border: 'border-zinc-200 dark:border-zinc-700', icon: Info },
};

function severityToRecType(severity: string): RecType {
  switch (severity) {
    case 'critical': case 'error': return 'critical';
    case 'significant': return 'warning';
    case 'warning': return 'action';
    case 'info': return 'info';
    default: return 'info';
  }
}

/** Generate category-specific recommendation text when issue.recommendation is missing */
function generateRecommendation(issue: any): string {
  const cat = issue.category ?? issue.ruleId ?? '';
  const cell = issue.cell ? `ячейке ${issue.cell}` : 'соответствующей ячейке';
  const sheet = issue.sheet ?? issue.departmentId ?? 'листе';
  const row = issue.row ? ` (строка ${issue.row})` : '';

  const map: Record<string, string> = {
    formula_continuity: `Проверьте формулу в ${cell} листа ${sheet}${row}. Возможен обрыв формульной цепочки — восстановите по образцу соседних строк.`,
    sum_check: `Сумма строк не совпадает с итогом в ${cell}${row}. Пересчитайте СУММ или проверьте диапазон.`,
    data_quality: `Проблема качества данных в ${cell} листа ${sheet}${row}. Проверьте заполненность и корректность.`,
    empty_metric: `Метрика в ${cell} пуста. Заполните значение или проверьте формулу.`,
    missing_value: `Отсутствует значение в ${cell}${row}. Убедитесь что данные введены.`,
    type_mismatch: `Несоответствие типа данных в ${cell}${row}. Ожидается числовое значение.`,
    mapping_consistency: `Расхождение СВОД vs пересчёт${row}. Перейдите на страницу Сверка для деталей.`,
    stalled_contract: `Закупка в ${sheet}${row} не завершена в срок. Обновите статус в колонке U.`,
    delayed_procedure: `Процедура в ${sheet}${row} просрочена. Проверьте даты (N/Q), обновите сроки.`,
    economy_anomaly: `Аномальная экономия в ${sheet}${row}. Снижение >25% — антидемпинг (44-ФЗ ст.37).`,
    fact_exceeds_plan: `Факт превышает план в ${sheet}${row}. Проверьте: доп. соглашение или ошибка ввода.`,
    single_participant: `Единственный участник в ${sheet}${row}. Задокументируйте основание выбора ЕП.`,
    rule_compliance: `Нарушение правила в ${sheet}${row}. Проверьте соответствие регламенту.`,
    operational_risk: `Операционный риск в ${sheet}${row}. Проверьте сроки и статус процедуры.`,
  };

  return map[cat] ?? `Проверьте данные в ${cell} листа ${sheet}${row}. Убедитесь в корректности значений и формул.`;
}

export function RecsPage() {
  const { dashboardData } = useStore();
  const fd = useFilteredData();
  const [openDepts, setOpenDepts] = useState<Set<string>>(new Set());

  // Use centralized filtered issues (respects dept, subordinate, search, period)
  const recs: Recommendation[] = useMemo(() => {
    const filtered = fd.issues;
    if (!filtered || filtered.length === 0) return [];
    return filtered.map((issue: any, idx: number) => ({
      id: issue.id ?? `R-${String(idx + 1).padStart(3, '0')}`,
      type: severityToRecType(issue.severity),
      dept: issue.departmentId || issue.sheet || 'Разные',
      title: issue.title || issue.message || 'Замечание',
      description: issue.description || '',
      source: issue.origin || 'Проверка данных',
      action: issue.recommendation || generateRecommendation(issue),
    }));
  }, [fd.issues]);

  // Auto-open departments with critical issues on first load
  const initialOpen = useMemo(() => {
    const depts = new Set<string>();
    for (const r of recs) {
      if (r.type === 'critical') depts.add(r.dept);
    }
    return depts;
  }, [recs]);

  // Use initialOpen only when openDepts hasn't been touched
  const [hasInteracted, setHasInteracted] = useState(false);
  const effectiveOpen = hasInteracted ? openDepts : initialOpen;

  const deptGroups = new Map<string, Recommendation[]>();
  for (const r of recs) {
    const list = deptGroups.get(r.dept) ?? [];
    list.push(r);
    deptGroups.set(r.dept, list);
  }

  const critCount = recs.filter(r => r.type === 'critical').length;
  const warnCount = recs.filter(r => r.type === 'warning').length;
  const actionCount = recs.filter(r => r.type === 'action').length;
  const decisionCount = recs.filter(r => r.type === 'decision').length;
  const infoCount = recs.filter(r => r.type === 'info').length;

  const toggleDept = (dept: string) => {
    setHasInteracted(true);
    const next = new Set(effectiveOpen);
    next.has(dept) ? next.delete(dept) : next.add(dept);
    setOpenDepts(next);
  };

  if (recs.length === 0) {
    return (
      <div className="space-y-6">
        <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 p-12 text-center">
          <Inbox className="mx-auto text-zinc-300 dark:text-zinc-600 mb-4" size={48} />
          <h2 className="text-lg font-semibold text-zinc-600 dark:text-zinc-300 mb-2">Рекомендаций пока нет</h2>
          <p className="text-sm text-zinc-400 dark:text-zinc-500 max-w-md mx-auto">
            Рекомендации формируются автоматически на основе замечаний, выявленных при анализе данных.
            Загрузите данные из Google Sheets для получения рекомендаций.
          </p>
        </div>
        <NormalizationSection />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Lightbulb className="text-amber-500" size={22} />
            <div>
              <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{recs.length} рекомендаций</h2>
              <p className="text-xs text-zinc-400 dark:text-zinc-500">Умные советы на основе анализа данных</p>
            </div>
          </div>
          <div className="flex gap-2 text-xs">
            {critCount > 0 && <span className="px-2.5 py-1 rounded-full bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 font-medium">{critCount} крит.</span>}
            {warnCount > 0 && <span className="px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 font-medium">{warnCount} предупр.</span>}
            {actionCount > 0 && <span className="px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 font-medium">{actionCount} действий</span>}
            {decisionCount > 0 && <span className="px-2.5 py-1 rounded-full bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400 font-medium">{decisionCount} решений</span>}
            {infoCount > 0 && <span className="px-2.5 py-1 rounded-full bg-zinc-50 dark:bg-zinc-700/50 text-zinc-600 dark:text-zinc-400 font-medium">{infoCount} инфо</span>}
          </div>
        </div>
      </div>

      {/* Department accordions */}
      <div className="space-y-3">
        {Array.from(deptGroups.entries()).map(([dept, groupRecs]) => {
          const open = effectiveOpen.has(dept);
          const hasCritical = groupRecs.some(r => r.type === 'critical');
          return (
            <div key={dept} className={clsx('bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border overflow-hidden', hasCritical ? 'border-red-200 dark:border-red-500/30' : 'border-zinc-100 dark:border-zinc-700/50')}>
              <button
                onClick={() => toggleDept(dept)}
                className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-zinc-50 dark:hover:bg-zinc-700/30 transition"
              >
                <div className="flex items-center gap-3">
                  <span className={clsx(
                    'w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold',
                    hasCritical ? 'bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400' : 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400'
                  )}>
                    {dept.slice(0, 2)}
                  </span>
                  <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{dept}</span>
                  <span className="text-xs text-zinc-400 dark:text-zinc-500">{groupRecs.length} рекомендаций</span>
                </div>
                <div className="flex items-center gap-2">
                  {groupRecs.filter(r => r.type === 'critical').length > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400 font-medium">
                      {groupRecs.filter(r => r.type === 'critical').length} крит.
                    </span>
                  )}
                  {open ? <ChevronUp size={14} className="text-zinc-400" /> : <ChevronDown size={14} className="text-zinc-400" />}
                </div>
              </button>

              {open && (
                <div className="border-t border-zinc-100 dark:border-zinc-700/50 divide-y divide-zinc-100 dark:divide-zinc-700/50">
                  {groupRecs.map(rec => {
                    const cfg = REC_CONFIG[rec.type];
                    const Icon = cfg.icon;
                    return (
                      <div key={rec.id} className={clsx('p-4', cfg.bg)}>
                        <div className="flex items-start gap-3">
                          <Icon size={16} className={clsx('flex-shrink-0 mt-0.5', cfg.text)} />
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className={clsx('text-[10px] px-1.5 py-0.5 rounded-full font-medium border', cfg.bg, cfg.text, cfg.border)}>
                                {cfg.label}
                              </span>
                            </div>
                            <h4 className="text-sm font-medium text-zinc-800 dark:text-white">{rec.title}</h4>
                            <p className="text-xs text-zinc-600 dark:text-zinc-300 mt-1">{rec.description}</p>
                            <div className="flex items-center gap-4 mt-2 text-[10px] text-zinc-400 dark:text-zinc-500">
                              <span>Источник: <strong className="text-zinc-600 dark:text-zinc-300">{rec.source}</strong></span>
                            </div>
                            <div className="mt-2 px-3 py-2 bg-white/60 dark:bg-zinc-900/30 rounded-lg border border-zinc-200/50 dark:border-zinc-700/50">
                              <p className="text-xs text-zinc-700 dark:text-zinc-200">
                                <strong className="text-blue-600 dark:text-blue-400">Действие:</strong> {rec.action}
                              </p>
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
        if (!cancelled) setSubjects(data.subjects ?? []);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
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
      <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 p-6">
        <p className="text-sm text-zinc-400 dark:text-zinc-500">Загрузка данных нормализации...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 p-6">
        <p className="text-sm text-red-500">Ошибка загрузки: {error}</p>
      </div>
    );
  }

  if (multiDept.length === 0 && similar.length === 0) return null;

  return (
    <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-700/30 transition"
      >
        <div className="flex items-center gap-3">
          <Search className="text-indigo-500" size={20} />
          <div className="text-left">
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Нормализация данных</h2>
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              {multiDept.length} предметов в нескольких управлениях, {similar.length} похожих
            </p>
          </div>
        </div>
        {expanded ? <ChevronUp size={14} className="text-zinc-400" /> : <ChevronDown size={14} className="text-zinc-400" />}
      </button>

      {expanded && (
        <div className="border-t border-zinc-100 dark:border-zinc-700/50 p-5 space-y-6">
          {/* Multi-department subjects */}
          {multiDept.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-3">
                Предметы в нескольких управлениях ({multiDept.length})
              </h3>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {multiDept.slice(0, 50).map((s, i) => (
                  <div key={i} className="flex items-start gap-3 px-3 py-2 bg-zinc-50 dark:bg-zinc-900/30 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-zinc-700 dark:text-zinc-200 truncate" title={s.text}>{s.text}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] text-zinc-400">{s.count} записей</span>
                        <div className="flex gap-1 flex-wrap">
                          {s.departments.map(d => (
                            <span key={d} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400">
                              {d}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Similar subjects */}
          {similar.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-3">
                Похожие предметы ({similar.length})
              </h3>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {similar.slice(0, 50).map((s, i) => (
                  <div key={i} className="px-3 py-2 bg-amber-50 dark:bg-amber-950/20 rounded-lg">
                    <p className="text-sm text-zinc-700 dark:text-zinc-200 truncate" title={s.text}>{s.text}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-zinc-400">{s.count} записей</span>
                      <div className="flex gap-1 flex-wrap">
                        {s.departments.map(d => (
                          <span key={d} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400">
                            {d}
                          </span>
                        ))}
                      </div>
                    </div>
                    {s.similarTo && s.similarTo.length > 0 && (
                      <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">
                        Похоже на: {s.similarTo.slice(0, 3).join('; ')}
                        {s.similarTo.length > 3 && ` (+${s.similarTo.length - 3})`}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
