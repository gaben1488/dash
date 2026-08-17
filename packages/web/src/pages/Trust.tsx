// ── Страница «Доверие»: индекс надёжности данных, пять компонентов,
//    разрез по управлениям и факторы снижения.
//
//    07.08.2026 — переплавка под читателя-руководителя. Было: методология
//    писалась языком исходников (логарифмические штрафы, `signal:dataQuality`,
//    «O=L+M+N», «rule-book», «CalcEngine») и, что хуже, ВРАЛА — формулы
//    остались от старой версии счётчика: логарифм давно заменён линейным
//    штрафом по серьёзности, множитель пустых метрик 40 → 25, у каждого
//    компонента появился пол в 10 баллов. Стало: объяснение берётся из
//    канонической базы знаний (@aemr/core METRIC_KB, ключи trust_*), которая
//    ведётся вместе со счётчиком и потому не может разойтись с ним молча,
//    плюс подстановка ЖИВЫХ чисел этого экрана. Латинская отметка A–F
//    заменена русским словом: школьная шкала США читателю ничего не говорит.

import { useState } from 'react';
import { useStore } from '../store';
import { useFilteredData } from '../hooks/useFilteredData';
import { ShieldCheck, TrendingDown, ChevronDown, ChevronRight, Info, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { CHECK_REGISTRY, THRESHOLDS, TRUST_COMPONENT_CONFIG, productLabel } from '@aemr/shared';
import type { TrustComponentId, TrustComponent } from '@aemr/shared';
import { buildTrustViewModel } from '../lib/trust-metrics';
import { kbFor } from '../lib/kb/metric-kb';
import { natureOf } from '../lib/diagnostics/nature-categories';

// ── Локальные view-model типы для данных доверия (источники из useFilteredData — any[]).
interface TrustIssue {
  severity?: string;
  title?: string;
  description?: string;
  sheet?: string;
  cell?: string;
  category?: string;
  departmentId?: string;
  group?: string;
  origin?: string;
  kbHint?: string;
}
interface TrustDelta {
  withinTolerance: boolean;
  deltaPercent: number | null;
  label?: string;
  metricKey?: string;
  /** Адрес официальной ячейки СВОД — единственный адрес, который можно показать читателю. */
  sourceCell?: string;
}
interface TrustDept {
  trustScore?: number;
  department?: { id?: string; name?: string; nameShort?: string };
  issueCount?: number;
  criticalIssueCount?: number;
  trustComponents?: TrustComponent[];
}
interface TrustFactor {
  severity: string;
  text: string;
  description: string;
  ref: string | null;
  category: string;
  departmentId: string;
  /** Природа замечания (канон п.88/26б): заполнение / формулы листа / исполнение. */
  natureLabel: string;
}

// ────────────────────────────────────────────────────────────
// Словари и мелкие утилиты
// ────────────────────────────────────────────────────────────

/** Компонент доверия → ключ канонической записи базы знаний (@aemr/core METRIC_KB). */
const COMPONENT_KB_KEYS: Record<string, string> = {
  data_quality: 'trust_data_quality',
  formula_integrity: 'trust_formula_integrity',
  rule_compliance: 'trust_rule_compliance',
  mapping_consistency: 'trust_mapping_consistency',
  operational_risk: 'trust_operational_risk',
};

/**
 * Запасное описание компонента — только на случай, если каноническая запись
 * базы знаний по какой-то причине не пришла. Пишется теми же словами, что и
 * канон: без имён столбцов и внутренних ключей.
 */
const COMPONENT_FALLBACK_DESCRIPTIONS: Record<string, string> = {
  data_quality: 'Насколько полно и уверенно прочитаны показатели снимка: много ли пустых значений и мест, где разбор сомневался в прочитанном.',
  formula_integrity: 'Сходится ли арифметика внутри книг: равен ли итог сумме трёх бюджетов, верно ли пересчитаны процент исполнения и отклонение.',
  rule_compliance: 'Соблюдаются ли правила ведения плана-графика: заполнены ли обязательные поля, допустим ли способ закупки, есть ли обоснование там, где оно обязательно.',
  mapping_consistency: 'Сходится ли наш расчёт по строкам с официальными числами листа СВОД ТД-ПМ.',
  operational_risk: 'Сколько в данных операционной беды: просрочки, подвисшие контракты, факт выше плана, спорная экономия.',
};

/** Короткая подпись столбца таблицы управлений (полное название — в подсказке столбца). */
const COMPONENT_SHORT_LABELS: Record<string, string> = {
  data_quality: 'Данные',
  formula_integrity: 'Формулы',
  rule_compliance: 'Правила',
  mapping_consistency: 'Сверка',
  operational_risk: 'Риски',
};

/** Область действия проверки → подпись группы в разборе нарушений. */
const CHECK_SCOPE_LABELS: Record<string, string> = {
  svod: 'Лист «СВОД ТД-ПМ»',
  department: 'Листы управлений',
  both: 'Общие для всех листов',
};

/** Реестр проверок по идентификатору и по прежнему идентификатору — читаем только имена. */
const CHECK_BY_KEY = new Map<string, (typeof CHECK_REGISTRY)[number]>();
for (const check of CHECK_REGISTRY) {
  CHECK_BY_KEY.set(check.id, check);
  if (check.legacyId) CHECK_BY_KEY.set(check.legacyId, check);
}

/**
 * Русское имя проверки. Раньше здесь звался productLabel, но словарь продукта
 * идентификаторы правил не содержит — и на экран уезжал сырой ключ вида
 * `budget_sum_fact`. Имена лежат в реестре проверок, берём оттуда.
 */
function checkName(id: string): string {
  return CHECK_BY_KEY.get(id)?.name ?? 'Проверка вне реестра проверок';
}

function checkScopeLabel(id: string): string {
  const scope = CHECK_BY_KEY.get(id)?.scope;
  return CHECK_SCOPE_LABELS[scope ?? ''] ?? 'Область проверки не указана';
}

const NUM1 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/**
 * «Откуда» без служебного хвоста «Путь в движке: …»: адрес кода — провенанс
 * для разработчика, читателю он ничего не объясняет (правило §1 запуска).
 */
function kbSourceForReader(source: string): string {
  return source.split('\nПуть в движке:')[0].trim();
}

// ────────────────────────────────────────────────────────────
// Шкала надёжности словами вместо латинской отметки A–F
// ────────────────────────────────────────────────────────────

type VerdictTone = 'high' | 'good' | 'medium' | 'low' | 'critical';

const VERDICTS: { min: number; tone: VerdictTone; label: string }[] = [
  { min: THRESHOLDS.TRUST.A, tone: 'high', label: 'Высокая' },
  { min: THRESHOLDS.TRUST.B, tone: 'good', label: 'Хорошая' },
  { min: THRESHOLDS.TRUST.C, tone: 'medium', label: 'Удовлетворительная' },
  { min: THRESHOLDS.TRUST.D, tone: 'low', label: 'Низкая' },
  { min: -Infinity, tone: 'critical', label: 'Критически низкая' },
];

function trustVerdict(score: number): { tone: VerdictTone; label: string } {
  const found = VERDICTS.find((v) => score >= v.min) ?? VERDICTS[VERDICTS.length - 1];
  return { tone: found.tone, label: found.label };
}

/** Словесная шкала целиком — печатается в объяснении, чтобы балл читался без справочника. */
const VERDICT_SCALE_TEXT = [
  `${THRESHOLDS.TRUST.A} и выше — высокая`,
  `от ${THRESHOLDS.TRUST.B} — хорошая`,
  `от ${THRESHOLDS.TRUST.C} — удовлетворительная`,
  `от ${THRESHOLDS.TRUST.D} — низкая`,
  `ниже ${THRESHOLDS.TRUST.D} — критически низкая`,
].join(', ');

function verdictColor(tone: VerdictTone) {
  switch (tone) {
    case 'high': return { bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-400' };
    case 'good': return { bg: 'bg-blue-50 dark:bg-blue-950/30', text: 'text-blue-700 dark:text-blue-400' };
    case 'medium': return { bg: 'bg-amber-50 dark:bg-amber-950/30', text: 'text-amber-700 dark:text-amber-400' };
    case 'low': return { bg: 'bg-orange-50 dark:bg-orange-950/30', text: 'text-orange-700 dark:text-orange-400' };
    default: return { bg: 'bg-red-50 dark:bg-red-950/30', text: 'text-red-700 dark:text-red-400' };
  }
}

function scoreColor(score: number) {
  if (score >= THRESHOLDS.TRUST.A) return 'bg-emerald-500';
  if (score >= THRESHOLDS.TRUST.B) return 'bg-blue-500';
  if (score >= THRESHOLDS.TRUST.C) return 'bg-amber-500';
  if (score >= THRESHOLDS.TRUST.D) return 'bg-orange-500';
  return 'bg-red-500';
}

function cellColor(score: number) {
  if (score >= THRESHOLDS.TRUST.A) return 'text-emerald-600 dark:text-emerald-400';
  if (score >= THRESHOLDS.TRUST.B) return 'text-blue-600 dark:text-blue-400';
  if (score >= THRESHOLDS.TRUST.C) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

function cellBg(score: number) {
  if (score >= 80) return 'bg-emerald-500/10';
  if (score >= THRESHOLDS.TRUST.C) return 'bg-amber-500/10';
  return 'bg-red-500/10';
}

function gaugeStroke(score: number): string {
  if (score >= THRESHOLDS.TRUST.A) return '#10b981';
  if (score >= THRESHOLDS.TRUST.B) return '#bfa161';
  if (score >= THRESHOLDS.TRUST.C) return '#f59e0b';
  return '#ef4444';
}

// ────────────────────────────────────────────────────────────
// Страница
// ────────────────────────────────────────────────────────────

export function TrustPage() {
  const { dashboardData, navigateTo, refresh, loading } = useStore();
  const fd = useFilteredData();
  const [expandedComponent, setExpandedComponent] = useState<string | null>(null);

  if (!dashboardData) {
    return (
      <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-amber-200 dark:border-amber-700/50 p-12 text-center">
        <ShieldCheck size={40} className="mx-auto text-amber-400 dark:text-amber-500 mb-3" />
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">Надёжность не оценена — данные не прочитаны</p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4 max-w-md mx-auto">
          Индекс считается по снимку рабочих книг. Снимка нет: книги ещё не читались в этой сессии
          либо чтение не завершилось. Обновите данные и вернитесь на вкладку.
        </p>
        <button
          onClick={() => { void refresh(); }}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : undefined} />
          {loading ? 'Читаем книги…' : 'Прочитать книги'}
        </button>
      </div>
    );
  }

  const trustData = dashboardData.trust;

  // Когда выбраны отдельные управления, индекс пересобирается по ним, а не
  // берётся общий — иначе фильтр врал бы: цифра относилась бы ко всем.
  const hasDeptFilter = fd.hasDeptFilter || fd.hasSubFilter;
  const filteredDeptSummaries = [...fd.depts].sort((a: TrustDept, b: TrustDept) => (a.trustScore ?? 0) - (b.trustScore ?? 0));

  const scopedToFilter = hasDeptFilter && filteredDeptSummaries.length > 0;
  const trustView = buildTrustViewModel(trustData, scopedToFilter ? filteredDeptSummaries : []);
  const overallScore = trustView.overallScore;
  const components = trustView.components;

  const verdict = trustVerdict(overallScore);
  const vc = verdictColor(verdict.tone);

  const deptSummaries = filteredDeptSummaries;

  // Замечания и сверки берутся отфильтрованными — раскрытие компонента
  // обязано показывать те же строки, по которым посчитан балл на экране.
  const filteredIssues = fd.issues;
  const deltas = fd.deltas;

  const factors: TrustFactor[] = filteredIssues
    .filter((issue: TrustIssue) => issue.severity === 'critical' || issue.severity === 'significant')
    .map((issue: TrustIssue) => ({
      severity: issue.severity as string,
      text: issue.title as string,
      description: issue.description as string,
      // Адрес показываем только когда он полный: «лист!ячейка». Полу-адрес
      // или прочерк читателю ничего не доказывают — тогда строки просто нет.
      ref: issue.sheet && issue.cell ? `${issue.sheet}!${issue.cell}` : null,
      category: issue.category as string,
      departmentId: issue.departmentId as string,
      // Категория по природе (канон п.88/26б) — подписью у каждого фактора.
      natureLabel: natureOf({ category: issue.category, group: issue.group }).label,
    }));

  const criticalFactors = factors.filter((f) => f.severity === 'critical').length;

  // Подстановка живых чисел: читатель видит ровно ту арифметику, что дала
  // балл на экране, а не абстрактную формулу.
  const totalWeight = components.reduce((sum, c) => sum + c.weight, 0);
  const liveOverall = components.length > 0 && totalWeight > 0
    ? `${overallScore} = (${components.map((c) => `${c.score} × ${c.weight}`).join(' + ')}) ÷ ${totalWeight}`
    : null;

  const weakest = components.length > 0
    ? components.reduce((min, c) => (c.score < min.score ? c : min))
    : null;
  const worstDept = deptSummaries.length > 0 ? deptSummaries[0] : null;

  return (
    <div className="space-y-6">
      {/* Главный индекс + компоненты */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Индекс */}
        <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 p-6 flex flex-col items-center justify-center">
          <div className="relative w-48 h-24 mb-4">
            <svg viewBox="0 0 200 100" className="w-full h-full" role="img" aria-label={`Надёжность данных: ${overallScore} из 100, оценка «${verdict.label}»`}>
              <path d="M 10 100 A 90 90 0 0 1 190 100" fill="none" className="stroke-zinc-200 dark:stroke-zinc-700" strokeWidth="14" strokeLinecap="round" />
              <path
                d="M 10 100 A 90 90 0 0 1 190 100"
                fill="none"
                stroke={gaugeStroke(overallScore)}
                strokeWidth="14"
                strokeLinecap="round"
                strokeDasharray={`${(overallScore / 100) * 283} 283`}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-end pb-1" aria-hidden="true">
              <span className="text-4xl font-bold text-zinc-800 dark:text-white tabular-nums">{overallScore}</span>
            </div>
          </div>
          <span className={clsx('text-lg font-bold px-4 py-1 rounded-full text-center', vc.bg, vc.text)}>{verdict.label}</span>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2 text-center">
            Качество заполнения книг: {overallScore} из 100
          </p>
          {scopedToFilter && (
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-1 text-center">
              Считается по выбранным управлениям ({filteredDeptSummaries.length}), а не по всему району
            </p>
          )}
          {/* Подпись периметра (канон п.58): индекс считается по последнему
              прочтению книг целиком — периоду и месяцам шапки не подчиняется. */}
          <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1 text-center">
            Периметр: 2026 · вся книга · {scopedToFilter ? 'выбранные управления' : 'все управления'} · на момент последнего чтения
          </p>

          <details className="mt-3 w-full group">
            <summary className="text-[11px] text-blue-600 dark:text-blue-400 cursor-pointer hover:text-blue-700 flex items-center gap-1 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">
              <Info size={11} /> Как получается этот балл
            </summary>
            <div className="mt-2 space-y-2 text-[11px] leading-relaxed">
              {liveOverall && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-0.5">
                    Сейчас на экране
                  </div>
                  <p className="font-mono text-[10px] text-zinc-700 dark:text-zinc-200 break-words">{liveOverall}</p>
                </div>
              )}
              <p className="text-zinc-600 dark:text-zinc-300">
                Балл — средневзвешенная оценка пяти сторон данных. Вес показывает, насколько сторона
                важна для итога: качество данных весит больше всех, операционные риски — меньше всех.
                Каждый компонент раскрывается ниже: там сказано, что именно он проверяет и что его роняет.
              </p>
              <p className="text-zinc-600 dark:text-zinc-300">
                Словами балл читается так: {VERDICT_SCALE_TEXT}.
              </p>
              <p className="text-zinc-500 dark:text-zinc-400">
                Средневзвешенное прячет провал одной стороны: при слабом качестве данных итог
                держится за счёт остальных. Поэтому смотреть надо не только на общий балл,
                но и на самый низкий компонент.
              </p>
            </div>
          </details>
        </div>

        {/* Пять компонентов с раскрытием */}
        <div className="lg:col-span-2 bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 p-6">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-1">
            {weakest
              ? `Слабое место — «${weakest.label}»: ${weakest.score} из 100`
              : 'Из чего складывается надёжность'}
          </h3>
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mb-4">
            Раскройте строку, чтобы увидеть, что проверяет компонент и какие замечания его роняют.
          </p>
          {components.length === 0 ? (
            <div className="rounded-lg border border-amber-200 dark:border-amber-800/60 bg-amber-50/50 dark:bg-amber-950/20 p-4">
              <p className="text-xs text-zinc-700 dark:text-zinc-200 font-medium mb-1">Компоненты надёжности не рассчитаны</p>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                {scopedToFilter
                  ? 'У выбранных управлений нет собственных оценок в этом снимке. Снимите фильтр по управлениям либо обновите данные.'
                  : 'Снимок прочитан, но оценка надёжности в нём отсутствует. Обновите данные — оценка считается при разборе книг.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {components.map((c: TrustComponent) => {
                const isExpanded = expandedComponent === c.name;
                const kb = kbFor(COMPONENT_KB_KEYS[c.name] ?? '');
                const description = kb?.what ?? COMPONENT_FALLBACK_DESCRIPTIONS[c.name] ?? '';
                const componentIssues = getComponentIssues(c.name, filteredIssues, deltas);
                const contribution = totalWeight > 0 ? (c.score * c.weight) / totalWeight : 0;
                const panelId = `trust-component-${c.name}`;

                return (
                  <div key={c.name} className="rounded-lg border border-zinc-100 dark:border-zinc-700/40 overflow-hidden">
                    <button
                      onClick={() => setExpandedComponent(isExpanded ? null : c.name)}
                      aria-expanded={isExpanded}
                      aria-controls={panelId}
                      className="w-full text-left px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-700/20 transition focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-500"
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
                              {c.criticalIssues > 0 ? `${c.criticalIssues} крит.` : ''}{c.criticalIssues > 0 && c.issues > 0 ? ' / ' : ''}{c.issues > 0 ? `${c.issues} ${plural(c.issues, 'замечание', 'замечания', 'замечаний')}` : ''}
                            </span>
                          )}
                          <span className={clsx('text-sm font-bold tabular-nums', cellColor(c.score))}>{c.score}</span>
                        </div>
                      </div>
                      <div
                        className="h-2 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden ml-6"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={c.score}
                        aria-label={`${c.label}: ${c.score} из 100`}
                      >
                        <div
                          className={clsx('h-full rounded-full transition-all duration-500', scoreColor(c.score))}
                          style={{ width: `${c.score}%` }}
                        />
                      </div>
                    </button>

                    {isExpanded && (
                      <div id={panelId} className="px-4 pb-4 border-t border-zinc-100 dark:border-zinc-700/40">
                        {/* Живая подстановка: вклад ИМЕННО этого балла в итог */}
                        <div className="mt-3 ml-5 mb-3 text-[11px] font-mono text-zinc-700 dark:text-zinc-200">
                          {c.score} × {c.weight} ÷ {totalWeight} = {NUM1.format(contribution)} —
                          {' '}столько этот компонент даёт в общий балл {overallScore}
                        </div>

                        <div className="flex items-start gap-2 mb-3">
                          <Info size={14} className="text-blue-400 mt-0.5 flex-shrink-0" />
                          <p className="text-xs text-zinc-600 dark:text-zinc-300">{description}</p>
                        </div>

                        {kb && (
                          <div className="ml-5 mb-3 space-y-2">
                            <KbBlock label="Как считается" text={kb.how} />
                            <KbBlock label="Откуда берутся данные" text={kbSourceForReader(kb.source)} />
                            {kb.pitfalls && <KbBlock label="О чём легко ошибиться" text={kb.pitfalls} />}
                          </div>
                        )}

                        {/* Счётчики снимка (сколько пустых, сколько предупреждений) —
                            их пишет сам счётчик; при фильтре по управлениям строка
                            заменяется честным указанием охвата. */}
                        {c.details && !c.details.startsWith('Фильтр:') && (
                          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3 ml-5">Счёт по снимку: {c.details}</p>
                        )}
                        {scopedToFilter && (
                          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3 ml-5">
                            Среднее по {filteredDeptSummaries.length}{' '}
                            {plural(filteredDeptSummaries.length, 'выбранному управлению', 'выбранным управлениям', 'выбранным управлениям')}
                          </p>
                        )}

                        {/* Разбор нарушений по правилам */}
                        {c.name === 'rule_compliance' && componentIssues.length > 0 && (
                          <RuleBreakdown issues={componentIssues} />
                        )}

                        {/* Список связанных замечаний для остальных компонентов */}
                        {c.name !== 'rule_compliance' && (
                          componentIssues.length > 0 ? (
                            <div className="ml-5 space-y-1.5">
                              <p className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 mb-1">
                                {componentIssues.length > 5
                                  ? `Связанные замечания: показаны 5 из ${componentIssues.length}`
                                  : `Связанные замечания: ${componentIssues.length}`}
                              </p>
                              {componentIssues.slice(0, 5).map((issue: TrustIssue, idx: number) => (
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
                                <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
                                  Остальные {componentIssues.length - 5} — на вкладке «Замечания».
                                </p>
                              )}
                            </div>
                          ) : (
                            <p className="ml-5 text-xs text-zinc-500 dark:text-zinc-400">
                              {c.score >= THRESHOLDS.TRUST.A
                                ? 'Замечаний по этому компоненту нет — балл держится сам.'
                                : 'Замечаний в текущем срезе нет: балл снижают счётчики снимка, а не отдельные строки (см. «Как считается»).'}
                            </p>
                          )
                        )}

                        {c.name === 'mapping_consistency' && (
                          <button
                            onClick={() => navigateTo('quality', { qualityTab: 'recon' })}
                            className="ml-5 mt-2 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 font-medium rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
                          >
                            Перейти к сверке →
                          </button>
                        )}
                        {c.name === 'rule_compliance' && (
                          <button
                            onClick={() => navigateTo('quality', { qualityTab: 'issues' })}
                            className="ml-5 mt-2 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 font-medium rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
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

      {/* Разрез по управлениям */}
      <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 overflow-hidden">
        <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-700/50">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
            {worstDept
              ? `Слабее всех данные у «${worstDept.department?.nameShort ?? worstDept.department?.name ?? 'управления без названия'}»: ${worstDept.trustScore ?? 0} из 100`
              : 'Надёжность по управлениям'}
          </h3>
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
            Отсортировано: худшие сверху. Строка открывает сверку по этому управлению.
          </p>
        </div>
        {deptSummaries.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <p className="text-xs text-zinc-600 dark:text-zinc-300 font-medium mb-1">По управлениям показывать нечего</p>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              {hasDeptFilter
                ? 'Выбранные управления не попали в снимок. Снимите фильтр по управлениям в шапке.'
                : 'Снимок не содержит разреза по управлениям — обновите данные.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Надёжность данных по управлениям и по пяти компонентам</caption>
              <thead>
                <tr className="bg-zinc-50 dark:bg-zinc-900/50 text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                  <th scope="col" className="px-5 py-3 text-left">Управление</th>
                  <th scope="col" className="px-3 py-3 text-center">Общий</th>
                  {components.map((c: TrustComponent) => (
                    <th key={c.name} scope="col" className="px-2 py-3 text-center" title={c.label}>
                      {COMPONENT_SHORT_LABELS[c.name] ?? c.label}
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-3 text-center">Замечаний</th>
                  <th scope="col" className="px-3 py-3 text-center">Из них критических</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
                {deptSummaries.map((d: TrustDept) => {
                  const score = d.trustScore ?? 0;
                  const deptComponents = d.trustComponents ?? [];
                  const deptName = d.department?.nameShort ?? d.department?.name ?? 'Управление без названия';

                  return (
                    <tr
                      key={d.department?.id ?? d.department?.name}
                      className="hover:bg-zinc-50 dark:hover:bg-zinc-700/30 transition"
                    >
                      <th scope="row" className="px-5 py-3 text-left font-medium text-zinc-700 dark:text-zinc-200">
                        {/* Кнопка, а не клик по строке: переход обязан быть доступен
                            с клавиатуры (критерий доступности §8 плана запуска). */}
                        <button
                          onClick={() => navigateTo('quality', { qualityTab: 'recon', department: d.department?.id })}
                          className="text-left hover:text-blue-600 dark:hover:text-blue-400 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
                          aria-label={`Открыть сверку по управлению «${deptName}»`}
                        >
                          {deptName}
                        </button>
                      </th>
                      <td className="px-3 py-3 text-center">
                        <span className={clsx('font-bold text-xs px-2 py-0.5 rounded tabular-nums', cellBg(score), cellColor(score))}>
                          {score}
                        </span>
                      </td>
                      {components.map((c: TrustComponent) => {
                        const dc = deptComponents.find((tc: TrustComponent) => tc.name === c.name);
                        const cs = dc?.score ?? null;
                        return (
                          <td key={c.name} className="px-2 py-3 text-center">
                            {cs !== null ? (
                              <span className={clsx('text-xs font-semibold tabular-nums', cellColor(cs))}>{cs}</span>
                            ) : (
                              <span className="text-xs text-zinc-400 dark:text-zinc-500" title={`«${c.label}» по этому управлению не считался: в снимке нет его оценки`}>
                                не считался
                              </span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-3 py-3 text-center text-zinc-600 dark:text-zinc-300 text-xs tabular-nums">{d.issueCount ?? 0}</td>
                      <td className="px-3 py-3 text-center tabular-nums">
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

      {/* Факторы снижения */}
      <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 p-5">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-4 flex items-center gap-2">
          <TrendingDown size={16} className="text-red-500" />
          {factors.length > 0
            ? `Балл снижают ${factors.length} ${plural(factors.length, 'замечание', 'замечания', 'замечаний')}, из них критических — ${criticalFactors}`
            : 'Что снижает надёжность'}
        </h3>
        {factors.length === 0 ? (
          <p className="text-xs text-zinc-600 dark:text-zinc-300">
            Критических и значимых замечаний в текущем срезе нет. Если балл всё равно низкий,
            причина в счётчиках снимка — раскройте компонент выше и прочитайте «Как считается».
          </p>
        ) : (
          <div className="space-y-2">
            {factors.slice(0, 20).map((f: TrustFactor, i: number) => (
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
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {f.ref && <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-mono">{f.ref}</span>}
                    {f.departmentId && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-700 text-zinc-500">{productLabel(f.departmentId)}</span>
                    )}
                    {/* Природа замечания (п.88/26б): читателю сразу видно,
                        это дисциплина ввода, дефект листа или сама закупка. */}
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400">{f.natureLabel}</span>
                  </div>
                </div>
              </div>
            ))}
            {factors.length > 20 && (
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Показаны 20 самых серьёзных из {factors.length}. Полный список — на вкладке «Замечания».
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Подкомпоненты
// ────────────────────────────────────────────────────────────

/** Подписанный абзац объяснения — той же формы, что попап базы знаний. */
function KbBlock({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-0.5">{label}</div>
      <p className="text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300 whitespace-pre-line">{text}</p>
    </div>
  );
}

/**
 * Разбор нарушений правил: сгруппирован по области действия проверки
 * (лист СВОД / листы управлений / общие). Группы больше не перечисляются
 * руками — берутся из реестра проверок, поэтому новое правило появится
 * в разборе само, а не потеряется в «прочих».
 */
function RuleBreakdown({ issues }: { issues: TrustIssue[] }) {
  const UNKNOWN = '__unknown__';
  const byCheck = new Map<string, number>();
  for (const issue of issues) {
    const key = issue.category || UNKNOWN;
    byCheck.set(key, (byCheck.get(key) ?? 0) + 1);
  }

  const byScope = new Map<string, { key: string; name: string; count: number }[]>();
  for (const [key, count] of byCheck) {
    const name = key === UNKNOWN ? 'Правило в замечании не указано' : checkName(key);
    const scope = key === UNKNOWN ? 'Область проверки не указана' : checkScopeLabel(key);
    const bucket = byScope.get(scope) ?? [];
    bucket.push({ key, name, count });
    byScope.set(scope, bucket);
  }

  return (
    <div className="ml-5 mb-3">
      <p className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 mb-2">Нарушения по правилам:</p>
      {[...byScope.entries()].map(([scope, rules]) => (
        <div key={scope} className="mb-2">
          <p className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-1">{scope}</p>
          {rules
            .sort((a, b) => b.count - a.count)
            .map((rule) => (
              <div key={rule.key} className="flex items-start justify-between gap-3 text-xs py-0.5 px-2 rounded hover:bg-zinc-50 dark:hover:bg-zinc-700/20">
                <span className="text-zinc-600 dark:text-zinc-300 text-[11px]">{rule.name}</span>
                <span className={clsx('text-[11px] font-semibold tabular-nums shrink-0', rule.count > 10 ? 'text-red-500' : 'text-amber-500')}>
                  {rule.count}
                </span>
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Отбор замечаний под компонент (зеркало scorer.ts)
// ────────────────────────────────────────────────────────────

/**
 * Замечания, относящиеся к компоненту доверия. Отбор ОБЯЗАН совпадать
 * с серверным счётчиком (core/trust/scorer.ts), иначе раскрытие покажет
 * не те строки, по которым посчитан балл.
 */
function getComponentIssues(componentName: string, issues: TrustIssue[], deltas: TrustDelta[]): TrustIssue[] {
  // «Согласованность привязок» считается по сверкам, а не по замечаниям.
  if (componentName === 'mapping_consistency') {
    return deltas
      .filter((d: TrustDelta) => !d.withinTolerance)
      .map((d: TrustDelta) => {
        // Доля расхождения известна не всегда: официал бывает нулевым или
        // отсутствует, и тогда делить не на что. Правило чисел запрещает
        // выдавать выдуманную величину, а «?%» читается как поломка
        // интерфейса — поэтому говорим прямо, что доля не рассчитана.
        const pct = d.deltaPercent;
        const pctKnown = typeof pct === 'number' && Number.isFinite(pct);
        return {
          title: pctKnown
            ? `${d.label}: расхождение ${pct.toFixed(1)}%`
            : `${d.label}: расхождение вне допуска, доля не рассчитана`,
          severity: pctKnown && Math.abs(pct) > 5 ? 'critical' : 'significant',
          // Адрес показываем только настоящий — ячейку листа СВОД. Внутренний
          // ключ метрики адресом не является и читателю ничего не доказывает.
          ...(d.sourceCell ? { sheet: 'СВОД ТД-ПМ', cell: d.sourceCell } : {}),
        };
      });
  }

  const config = TRUST_COMPONENT_CONFIG[componentName as TrustComponentId];
  if (!config || config.issueGroups.length === 0) return [];

  const groups = new Set<string>(config.issueGroups);

  return issues.filter((i: TrustIssue) => {
    // Основной путь: поле группы, если оно заполнено.
    if (i.group) return groups.has(i.group);
    // Запасной путь: старое сопоставление по категории.
    return matchLegacyCategory(i, componentName);
  });
}

function matchLegacyCategory(i: TrustIssue, componentName: string): boolean {
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
