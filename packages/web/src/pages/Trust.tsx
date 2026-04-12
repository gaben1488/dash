import { useState } from 'react';
import { useStore } from '../store';
import { useFilteredData } from '../hooks/useFilteredData';
import { ShieldCheck, TrendingDown, ChevronDown, ChevronRight, Info } from 'lucide-react';
import clsx from 'clsx';
import { TRUST_COMPONENT_CONFIG } from '@aemr/shared';
import type { TrustComponentId } from '@aemr/shared';

/** Russian descriptions for each trust component */
const COMPONENT_DESCRIPTIONS: Record<string, string> = {
  data_quality: 'Полнота и корректность значений в ячейках СВОД. Штрафы за пустые метрики, низкую уверенность распознавания, предупреждения типов данных.',
  formula_integrity: 'Непрерывность формул в столбцах. Обнаружение обрывов формульных цепочек, несовпадений сумм.',
  rule_compliance: 'Выполнение 12 правил проверки данных. Правила разделены по области: СВОД ТД-ПМ (6 правил: суммы бюджета O=L+M+N, % исполнения G=E/D*100, отклонение F=E-D, Q1≤Год, факт≤план, знак экономии), листы подразделений (5 правил: метод закупки L, тип F, статус AD, суммы Y=V+W+X и AC=Z+AA+AB, факт≤план Y≤K) и 1 общее (K=H+I+J). Каждое правило основано на реальной формуле таблиц, не на эвристике.',
  mapping_consistency: 'Совпадение официальных ячеек СВОД с построчным пересчётом. Допуск 1%. Чем ниже — тем больше метрик расходятся с расчётными значениями.',
  operational_risk: 'Просрочки, подвисшие контракты, нарушения логики экономии.',
};

/** Structured methodology for each trust component — real formulas from scorer.ts */
const METHODOLOGY_SECTIONS: { title: string; abbr: string; weight: number; body: string }[] = [
  {
    title: 'Качество данных',
    abbr: 'ДК',
    weight: 30,
    body: [
      'Оценивает полноту и корректность метрик, загруженных из СВОД.',
      '',
      'Штраф за пустые метрики: (кол-во пустых / всего метрик) \u00d7 40 баллов.',
      'Штраф за низкую уверенность (<0.7): (кол-во / всего) \u00d7 20 баллов.',
      'Штраф за предупреждения типов: min(N \u00d7 2, 20) баллов.',
      '',
      'Пример: 27 метрик, 3 пустых, 2 с низкой уверенностью, 5 предупреждений:',
      '100 \u2212 (3/27)\u00d740 \u2212 (2/27)\u00d720 \u2212 min(10, 20) = 100 \u2212 4.4 \u2212 1.5 \u2212 10 = 84 балла.',
      '',
      'Сигналы: dataQuality (пустые D/K/L), factWithoutDate, dateWithoutFact, formulaBroken.',
    ].join('\n'),
  },
  {
    title: 'Целостность формул',
    abbr: 'ЦФ',
    weight: 25,
    body: [
      'Проверяет формульные связи: budgetMismatch (H+I+J\u2260K), обрывы формул (#REF, #VALUE), ',
      'несовпадения сумм (budget_sum_plan, budget_sum_fact), % исполнения, отклонения, Q1\u2264Год.',
      '',
      'Формула (логарифмический штраф):',
      '  score = 100',
      '         \u2212 min(log\u2082(critical + 1) \u00d7 15, 85)',
      '         \u2212 min(log\u2082(significant + 1) \u00d7 5, 30)',
      '         \u2212 min(minor \u00d7 2, 15)',
      '',
      'Пример: 7 критических, 3 значимых, 10 минорных:',
      '100 \u2212 log\u2082(8)\u00d715 \u2212 log\u2082(4)\u00d75 \u2212 min(20,15) = 100 \u2212 45 \u2212 10 \u2212 15 = 30 баллов.',
    ].join('\n'),
  },
  {
    title: 'Правила СВОД',
    abbr: 'ПР',
    weight: 20,
    body: [
      '12 правил из rule-book, разделённых по области:',
      '',
      'СВОД ТД-ПМ (6): budget_sum_fact (O=L+M+N), execution_percentage (G=E/D\u00d7100),',
      '  deviation_calc (F=E\u2212D), q1_leq_year (Q1\u2264Год), fact_leq_plan, economy_sign_check.',
      'Подразделения (5): method_validation (L), type_validation (F), dept_fact_sum (Y=V+W+X),',
      '  dept_economy_sum (AC=Z+AA+AB), dept_fact_leq_plan (Y\u2264K).',
      'Все листы (1): budget_sum_plan (K=H+I+J).',
      '',
      'Штраф по каждому правилу: rate = нарушений / строк.',
      '  Критическое правило: rate \u00d7 30;  некритическое: rate \u00d7 15.',
      'Итого: 100 \u2212 \u2211 штрафов по всем нарушенным правилам.',
    ].join('\n'),
  },
  {
    title: 'Согласованность привязок',
    abbr: 'СП',
    weight: 15,
    body: [
      'Сверка официальных ячеек СВОД с построчным пересчётом (CalcEngine).',
      'Только метрики, где оба значения присутствуют.',
      '',
      'Градация кредита за каждую метрику:',
      '  \u0394 \u2264 1%  \u2192 1.0 балл (полное совпадение)',
      '  1% < \u0394 \u2264 5%  \u2192 0.5 балла (частичное)',
      '  \u0394 > 5%  \u2192 0 баллов',
      '',
      'Итого: round(\u2211 кредитов / кол-во сравниваемых \u00d7 100).',
      'Пример: 20 метрик, 15 совпадают, 3 в диапазоне 1\u20135%, 2 > 5%:',
      '(15 + 1.5 + 0) / 20 \u00d7 100 = 82 балла.',
    ].join('\n'),
  },
  {
    title: 'Операционные риски',
    abbr: 'ОР',
    weight: 10,
    body: [
      'Сигналы: overdue (просрочки), stalledContract (подвисшие контракты),',
      'earlyClosure, factDateBeforePlan, factExceedsPlan (факт > плана),',
      'highEconomy (\u0394 > порога), epRisk (риски ЕП).',
      '',
      'Формула (логарифмический штраф, идентичен ЦФ):',
      '  score = 100',
      '         \u2212 min(log\u2082(critical + 1) \u00d7 15, 85)',
      '         \u2212 min(log\u2082(significant + 1) \u00d7 5, 30)',
      '         \u2212 min(warning \u00d7 2, 15)',
      '',
      'Пример: 3 крит., 5 знач., 20 предупр.:',
      '100 \u2212 log\u2082(4)\u00d715 \u2212 log\u2082(6)\u00d75 \u2212 min(40,15) = 100 \u2212 30 \u2212 13 \u2212 15 = 42 балла.',
    ].join('\n'),
  },
];

/** Overall methodology intro */
const METHODOLOGY_INTRO = 'Индекс = взвешенная сумма 5 компонентов: \u2211(score\u1d62 \u00d7 weight\u1d62) / \u2211 weight\u1d62. Грейд: A \u2265 90, B \u2265 75, C \u2265 60, D \u2265 40, F < 40.';

/** Rule IDs grouped by scope for the expanded rule breakdown */
const RULE_GROUPS: { label: string; ruleIds: string[] }[] = [
  { label: 'СВОД ТД-ПМ', ruleIds: ['budget_sum_fact', 'execution_percentage', 'deviation_calc', 'q1_leq_year', 'fact_leq_plan', 'economy_sign_check'] },
  { label: 'Подразделения', ruleIds: ['method_validation', 'type_validation', 'dept_fact_sum', 'dept_economy_sum', 'dept_fact_leq_plan'] },
  { label: 'Все листы', ruleIds: ['budget_sum_plan'] },
];

const COMPONENT_SHORT_LABELS: Record<string, string> = {
  data_quality: 'ДК',
  formula_integrity: 'ЦФ',
  rule_compliance: 'ПР',
  mapping_consistency: 'СП',
  operational_risk: 'ОР',
};

function gradeColor(grade: string) {
  switch (grade) {
    case 'A': return { bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-400', border: 'border-emerald-200 dark:border-emerald-800' };
    case 'B': return { bg: 'bg-blue-50 dark:bg-blue-950/30', text: 'text-blue-700 dark:text-blue-400', border: 'border-blue-200 dark:border-blue-800' };
    case 'C': return { bg: 'bg-amber-50 dark:bg-amber-950/30', text: 'text-amber-700 dark:text-amber-400', border: 'border-amber-200 dark:border-amber-800' };
    case 'D': return { bg: 'bg-orange-50 dark:bg-orange-950/30', text: 'text-orange-700 dark:text-orange-400', border: 'border-orange-200 dark:border-orange-800' };
    default: return { bg: 'bg-red-50 dark:bg-red-950/30', text: 'text-red-700 dark:text-red-400', border: 'border-red-200 dark:border-red-800' };
  }
}

function scoreColor(score: number) {
  if (score >= 90) return 'bg-emerald-500';
  if (score >= 75) return 'bg-blue-500';
  if (score >= 60) return 'bg-amber-500';
  if (score >= 40) return 'bg-orange-500';
  return 'bg-red-500';
}

function cellColor(score: number) {
  if (score >= 90) return 'text-emerald-600 dark:text-emerald-400';
  if (score >= 75) return 'text-blue-600 dark:text-blue-400';
  if (score >= 60) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

function cellBg(score: number) {
  if (score >= 80) return 'bg-emerald-500/10';
  if (score >= 60) return 'bg-amber-500/10';
  return 'bg-red-500/10';
}

function scoreToGrade(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

export function TrustPage() {
  const { dashboardData, navigateTo } = useStore();
  const fd = useFilteredData();
  const [expandedComponent, setExpandedComponent] = useState<string | null>(null);

  if (!dashboardData) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <ShieldCheck size={48} className="mx-auto text-zinc-300 dark:text-zinc-600 mb-3" />
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Нет данных для отображения. Загрузите данные из Google Sheets.</p>
        </div>
      </div>
    );
  }

  const trustData = dashboardData.trust;

  // When departments are filtered, compute weighted average trust from filtered depts
  const hasDeptFilter = fd.hasDeptFilter || fd.hasSubFilter;
  const filteredDeptSummaries = [...fd.depts].sort((a: any, b: any) => (a.trustScore ?? 0) - (b.trustScore ?? 0));

  let overallScore: number;
  let components: any[];
  if (hasDeptFilter && filteredDeptSummaries.length > 0) {
    // Weighted average of filtered dept trust scores (equal weight per dept)
    const scores = filteredDeptSummaries.map((d: any) => d.trustScore ?? 0);
    overallScore = Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length);

    // Merge component scores across filtered depts
    const allComponentNames = trustData?.components?.map((c: any) => c.name) ?? [];
    components = allComponentNames.map((name: string) => {
      const globalComp = trustData?.components?.find((c: any) => c.name === name);
      const deptScores = filteredDeptSummaries
        .map((d: any) => d.trustComponents?.find((tc: any) => tc.name === name)?.score)
        .filter((s: any) => s != null) as number[];
      const avgScore = deptScores.length > 0
        ? Math.round(deptScores.reduce((a, b) => a + b, 0) / deptScores.length)
        : (globalComp?.score ?? 0);
      return { ...globalComp, score: avgScore };
    });
  } else {
    overallScore = trustData?.overall ?? 0;
    components = trustData?.components ?? [];
  }

  const overallGrade = scoreToGrade(overallScore);
  const gc = gradeColor(overallGrade);

  const deptSummaries = filteredDeptSummaries;

  // Use filtered issues (respects dept filter) for drill-down
  const filteredIssues = fd.issues;
  const deltas = fd.deltas;

  const factors = filteredIssues
    .filter((issue: any) => issue.severity === 'critical' || issue.severity === 'significant')
    .map((issue: any) => ({
      severity: issue.severity as string,
      text: issue.title as string,
      description: issue.description as string,
      ref: issue.sheet && issue.cell ? `${issue.sheet}!${issue.cell}` : (issue.sheet ?? '—'),
      category: issue.category as string,
      departmentId: issue.departmentId as string,
    }));

  return (
    <div className="space-y-6">
      {/* Main gauge + components */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Gauge */}
        <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 p-6 flex flex-col items-center justify-center">
          <div className="relative w-48 h-24 mb-4">
            <svg viewBox="0 0 200 100" className="w-full h-full">
              <path d="M 10 100 A 90 90 0 0 1 190 100" fill="none" className="stroke-zinc-200 dark:stroke-zinc-700" strokeWidth="14" strokeLinecap="round" />
              <path
                d="M 10 100 A 90 90 0 0 1 190 100"
                fill="none"
                stroke={overallScore >= 90 ? '#10b981' : overallScore >= 75 ? '#3b82f6' : overallScore >= 60 ? '#f59e0b' : '#ef4444'}
                strokeWidth="14"
                strokeLinecap="round"
                strokeDasharray={`${(overallScore / 100) * 283} 283`}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-end pb-1">
              <span className="text-4xl font-bold text-zinc-800 dark:text-white">{overallScore}</span>
            </div>
          </div>
          <span className={clsx('text-2xl font-bold px-4 py-1 rounded-full', gc.bg, gc.text)}>{overallGrade}</span>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2">Индекс надёжности данных</p>
          <details className="mt-3 w-full">
            <summary className="text-[10px] text-blue-500 cursor-pointer hover:text-blue-600 flex items-center gap-1">
              <Info size={10} /> Методология расчёта
            </summary>
            <div className="mt-2 space-y-2">
              <p className="text-[10px] text-zinc-600 dark:text-zinc-300 font-medium leading-relaxed">{METHODOLOGY_INTRO}</p>
              {METHODOLOGY_SECTIONS.map(s => (
                <details key={s.abbr} className="group">
                  <summary className="text-[10px] text-zinc-600 dark:text-zinc-300 cursor-pointer hover:text-blue-500 font-medium flex items-center gap-1">
                    <span className="text-blue-500">{s.abbr}</span> {s.title} ({s.weight}%)
                  </summary>
                  <pre className="text-[9px] text-zinc-500 dark:text-zinc-400 mt-1 ml-3 leading-relaxed whitespace-pre-wrap font-sans">{s.body}</pre>
                </details>
              ))}
            </div>
          </details>
        </div>

        {/* 5 Components with drill-down */}
        <div className="lg:col-span-2 bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 p-6">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-4">Компоненты доверия</h3>
          {components.length === 0 ? (
            <p className="text-xs text-zinc-400 dark:text-zinc-500">Компоненты доверия отсутствуют.</p>
          ) : (
            <div className="space-y-3">
              {components.map((c: any) => {
                const isExpanded = expandedComponent === c.name;
                const description = COMPONENT_DESCRIPTIONS[c.name] ?? c.details ?? '';
                const componentIssues = getComponentIssues(c.name, filteredIssues, deltas);

                return (
                  <div key={c.name} className="rounded-lg border border-zinc-100 dark:border-zinc-700/40 overflow-hidden">
                    <button
                      onClick={() => setExpandedComponent(isExpanded ? null : c.name)}
                      className="w-full text-left px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-700/20 transition"
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          {isExpanded ? <ChevronDown size={14} className="text-zinc-400" /> : <ChevronRight size={14} className="text-zinc-400" />}
                          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">{c.label}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400 font-medium">
                            вес: {c.weight}%
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          {(c.issues > 0 || c.criticalIssues > 0) && (
                            <span className="text-[10px] text-red-500 font-medium">
                              {c.criticalIssues > 0 ? `${c.criticalIssues} крит.` : ''}{c.criticalIssues > 0 && c.issues > 0 ? ' / ' : ''}{c.issues > 0 ? `${c.issues} замеч.` : ''}
                            </span>
                          )}
                          <span className={clsx('text-sm font-bold', cellColor(c.score))}>{c.score}%</span>
                        </div>
                      </div>
                      <div className="h-2 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden ml-6">
                        <div
                          className={clsx('h-full rounded-full transition-all duration-500', scoreColor(c.score))}
                          style={{ width: `${c.score}%` }}
                        />
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="px-4 pb-4 border-t border-zinc-100 dark:border-zinc-700/40">
                        <div className="mt-3 flex items-start gap-2 mb-3">
                          <Info size={14} className="text-blue-400 mt-0.5 flex-shrink-0" />
                          <p className="text-xs text-zinc-600 dark:text-zinc-300">{description}</p>
                        </div>
                        {c.details && c.details !== description && (
                          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3 ml-5">{c.details}</p>
                        )}

                        {/* Per-rule breakdown for rule_compliance */}
                        {c.name === 'rule_compliance' && componentIssues.length > 0 && (() => {
                          const byCat: Record<string, number> = {};
                          componentIssues.forEach((i: any) => { byCat[i.category || 'unknown'] = (byCat[i.category || 'unknown'] || 0) + 1; });
                          return (
                            <div className="ml-5 mb-3">
                              <p className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 mb-2">Нарушения по правилам:</p>
                              {RULE_GROUPS.map(group => {
                                const groupRules = group.ruleIds.filter(id => byCat[id]);
                                if (groupRules.length === 0) return null;
                                return (
                                  <div key={group.label} className="mb-2">
                                    <p className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-1">{group.label}</p>
                                    {groupRules.map(id => (
                                      <div key={id} className="flex items-center justify-between text-xs py-0.5 px-2 rounded hover:bg-zinc-50 dark:hover:bg-zinc-700/20">
                                        <span className="text-zinc-600 dark:text-zinc-300 font-mono text-[11px]">{id}</span>
                                        <span className={clsx('text-[11px] font-semibold', byCat[id] > 10 ? 'text-red-500' : byCat[id] > 0 ? 'text-amber-500' : 'text-emerald-500')}>
                                          {byCat[id]}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                );
                              })}
                              {/* Rules not in groups */}
                              {Object.entries(byCat)
                                .filter(([id]) => !RULE_GROUPS.some(g => g.ruleIds.includes(id)))
                                .map(([id, count]) => (
                                  <div key={id} className="flex items-center justify-between text-xs py-0.5 px-2">
                                    <span className="text-zinc-600 dark:text-zinc-300 font-mono text-[11px]">{id}</span>
                                    <span className="text-[11px] font-semibold text-amber-500">{count}</span>
                                  </div>
                                ))}
                            </div>
                          );
                        })()}

                        {/* Generic issues list for other components */}
                        {c.name !== 'rule_compliance' && componentIssues.length > 0 ? (
                          <div className="ml-5 space-y-1.5">
                            <p className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 mb-1">
                              Связанные замечания ({componentIssues.length}):
                            </p>
                            {componentIssues.slice(0, 5).map((issue: any, idx: number) => (
                              <div key={idx} className={clsx(
                                'text-xs p-2 rounded',
                                issue.severity === 'critical' ? 'bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-300'
                                  : 'bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300',
                              )}>
                                <span className="font-medium">{issue.title}</span>
                                {issue.sheet && issue.cell && (
                                  <span className="text-[10px] ml-2 opacity-70 font-mono">{issue.sheet}!{issue.cell}</span>
                                )}
                                {issue.kbHint && (
                                  <p className="text-[10px] mt-0.5 opacity-60 leading-tight">{issue.kbHint}</p>
                                )}
                              </div>
                            ))}
                            {componentIssues.length > 5 && (
                              <p className="text-[10px] text-zinc-400">...и ещё {componentIssues.length - 5}</p>
                            )}
                          </div>
                        ) : c.name !== 'rule_compliance' ? (
                          <p className="ml-5 text-xs text-zinc-400">Связанных замечаний нет.</p>
                        ) : null}

                        {c.name === 'mapping_consistency' && (
                          <button
                            onClick={() => navigateTo('quality', { qualityTab: 'recon' })}
                            className="ml-5 mt-2 text-xs text-blue-500 hover:text-blue-600 font-medium"
                          >
                            Перейти к сверке →
                          </button>
                        )}
                        {c.name === 'rule_compliance' && (
                          <button
                            onClick={() => navigateTo('quality', { qualityTab: 'issues' })}
                            className="ml-5 mt-2 text-xs text-blue-500 hover:text-blue-600 font-medium"
                          >
                            Все замечания →
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Department table with 5 component columns */}
      <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 overflow-hidden">
        <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-700/50">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Доверие по управлениям</h3>
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
            Отсортировано: худшие сверху. ДК=Данные, ЦФ=Формулы, ПР=Правила, СП=Сверка, ОР=Операц.
          </p>
        </div>
        {deptSummaries.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <p className="text-xs text-zinc-400 dark:text-zinc-500">Данные по управлениям отсутствуют.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-zinc-50 dark:bg-zinc-900/50 text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                  <th className="px-5 py-3 text-left">Управление</th>
                  <th className="px-3 py-3 text-center">Общий</th>
                  {components.map((c: any) => (
                    <th key={c.name} className="px-2 py-3 text-center" title={c.label}>
                      {COMPONENT_SHORT_LABELS[c.name] ?? c.name.slice(0, 2).toUpperCase()}
                    </th>
                  ))}
                  <th className="px-3 py-3 text-center">Замеч.</th>
                  <th className="px-3 py-3 text-center">Крит.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
                {deptSummaries.map((d: any) => {
                  const score = d.trustScore ?? 0;
                  const grade = scoreToGrade(score);
                  const deptComponents = d.trustComponents ?? [];

                  return (
                    <tr
                      key={d.department?.id ?? d.department?.name}
                      className="hover:bg-zinc-50 dark:hover:bg-zinc-700/30 transition cursor-pointer"
                      onClick={() => navigateTo('quality', { qualityTab: 'recon', department: d.department?.id })}
                    >
                      <td className="px-5 py-3 font-medium text-zinc-700 dark:text-zinc-200">
                        {d.department?.nameShort ?? d.department?.name ?? '—'}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className={clsx('font-bold text-xs px-2 py-0.5 rounded', cellBg(score), cellColor(score))}>
                          {score}
                        </span>
                      </td>
                      {components.map((c: any) => {
                        const dc = deptComponents.find((tc: any) => tc.name === c.name);
                        const cs = dc?.score ?? null;
                        return (
                          <td key={c.name} className="px-2 py-3 text-center">
                            {cs !== null ? (
                              <span className={clsx('text-xs font-semibold', cellColor(cs))}>{cs}</span>
                            ) : (
                              <span className="text-xs text-zinc-300">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-3 py-3 text-center text-zinc-600 dark:text-zinc-300 text-xs">{d.issueCount ?? 0}</td>
                      <td className="px-3 py-3 text-center">
                        {(d.criticalIssueCount ?? 0) > 0
                          ? <span className="text-red-600 font-semibold text-xs">{d.criticalIssueCount}</span>
                          : <span className="text-zinc-400 text-xs">0</span>
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Top factors */}
      <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 p-5">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-4 flex items-center gap-2">
          <TrendingDown size={16} className="text-red-500" />
          Факторы снижения доверия
        </h3>
        {factors.length === 0 ? (
          <p className="text-xs text-zinc-400 dark:text-zinc-500">Критических и значительных замечаний не обнаружено.</p>
        ) : (
          <div className="space-y-2">
            {factors.slice(0, 20).map((f: any, i: number) => (
              <div key={i} className={clsx(
                'flex items-start gap-3 p-3 rounded-lg',
                f.severity === 'critical' && 'bg-red-50 dark:bg-red-950/20',
                f.severity === 'significant' && 'bg-orange-50 dark:bg-orange-950/20',
              )}>
                <span className={clsx(
                  'w-2 h-2 rounded-full mt-1.5 flex-shrink-0',
                  f.severity === 'critical' && 'bg-red-500',
                  f.severity === 'significant' && 'bg-orange-500',
                )} />
                <div className="flex-1">
                  <p className="text-xs text-zinc-700 dark:text-zinc-200 font-medium">{f.text}</p>
                  {f.description && (
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">{f.description}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-mono">{f.ref}</span>
                    {f.departmentId && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-700 text-zinc-500">{f.departmentId}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Map trust component name to issue categories.
 * MUST match scorer.ts filters exactly to avoid frontend/backend divergence.
 */
/** Group-based issue filtering aligned with scorer.ts via TRUST_COMPONENT_CONFIG */
function getComponentIssues(componentName: string, issues: any[], deltas: any[]): any[] {
  // mapping_consistency uses deltas, not issues
  if (componentName === 'mapping_consistency') {
    return deltas
      .filter((d: any) => !d.withinTolerance)
      .map((d: any) => ({
        title: `${d.label}: расхождение ${d.deltaPercent?.toFixed(1) ?? '?'}%`,
        severity: Math.abs(d.deltaPercent ?? 0) > 5 ? 'critical' : 'significant',
        sheet: 'СВОД',
        cell: d.metricKey,
      }));
  }

  const config = TRUST_COMPONENT_CONFIG[componentName as TrustComponentId];
  if (!config || config.issueGroups.length === 0) return [];

  const groups = new Set<string>(config.issueGroups);

  return issues.filter((i: any) => {
    // Primary: use group field if populated
    if (i.group) return groups.has(i.group);
    // Fallback: legacy category matching
    return matchLegacyCategory(i, componentName);
  });
}

function matchLegacyCategory(i: any, componentName: string): boolean {
  switch (componentName) {
    case 'data_quality':
      return i.category === 'signal:dataQuality' ||
        i.category === 'signal:factWithoutDate' ||
        i.category === 'signal:dateWithoutFact' ||
        i.category === 'signal:formulaBroken' ||
        i.origin === 'runtime_error';
    case 'formula_integrity':
      return i.category === 'formula_continuity' ||
        i.category === 'execution_percentage' ||
        i.category === 'deviation_calc' ||
        i.category === 'q1_leq_year' ||
        i.category === 'budget_sum_plan' ||
        i.category === 'budget_sum_fact' ||
        i.category === 'signal:budgetMismatch';
    case 'rule_compliance':
      return i.origin === 'spreadsheet_rule';
    case 'operational_risk':
      return i.category === 'signal:overdue' ||
        i.category === 'signal:stalledContract' ||
        i.category === 'signal:earlyClosure' ||
        i.category === 'signal:factDateBeforePlan' ||
        i.category === 'signal:factExceedsPlan' ||
        i.category === 'signal:highEconomy' ||
        i.category === 'signal:economyConflict' ||
        i.category === 'signal:epRisk';
    default:
      return false;
  }
}
