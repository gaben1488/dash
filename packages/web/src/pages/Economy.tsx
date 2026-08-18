// ────────────────────────────────────────────────────────────────
// Страница «Экономия» — композиция.
//
// Вопросы читателя: «Где экономия?» → hero + график бюджетов;
// «Какое управление больше?» → рейтинг со спарклайнами; «Есть ли споры?» →
// счётчик расхождений; «Что делать?» → инлайн-рекомендации.
//
// Чистые вычисления — lib/economy/*; блоки интерфейса — components/economy/*.
// ────────────────────────────────────────────────────────────────

import { useState, useMemo, useCallback } from 'react';
import type { DepartmentSummary } from '@aemr/shared';
import clsx from 'clsx';
import { Activity, AlertTriangle, Building2, Download, Inbox, Layers, Loader2 } from 'lucide-react';
import { useStore } from '../store';
import { useFilteredData } from '../hooks/useFilteredData';
import { ECONOMY_EMPTY_STATE_COPY, buildEconomyInsight, economyBannerStatus } from '../lib/economy-copy';
import { budgetSelection } from '../lib/economy/budget';
import {
  buildBarChartData, buildDeptEconomy, computeEconomyTotals,
  flattenSubordinates, sortDeptEconomy,
} from '../lib/economy/dept-economy';
import {
  buildDeptSparks, buildPerDeptQuarterly, buildQuarterlyTrend,
  economySpark, mergeTrendWithDepts, pctSpark, quarterDeltas,
} from '../lib/economy/quarterly';
import { buildEconomyCsv, economyCsvFilename } from '../lib/economy/csv';
import { formatPct } from '../lib/economy/format';
import type { SortDir, SortField } from '../lib/economy/types';
import { Card, FOCUS_RING } from '../components/economy/primitives';
import { PeriodBadge } from '../components/PeriodBadge';
import { EconomyHero } from '../components/economy/EconomyHero';
import type { HeroMetric } from '../components/economy/EconomyHero';
import { EconomyCharts } from '../components/economy/EconomyCharts';
import { EconomyDeptTable } from '../components/economy/EconomyDeptTable';
import { EconomySubTable } from '../components/economy/EconomySubTable';
import { EconomyDisposalMock } from '../components/economy/EconomyDisposalMock';

/**
 * Какой колонкой таблицы «управляет» каждая плитка hero-полосы.
 * Подсветка плитки без последствий была бы имитацией: нажатие обязано
 * что-то менять на экране — здесь оно меняет порядок строк.
 */
const HERO_SORT: Record<HeroMetric, SortField> = {
  economy: 'economy',
  share: 'pct',
  high: 'pct',
  conflicts: 'conflicts',
};

/** Обратное соответствие: по какой колонке отсортировано — та плитка и активна. */
function heroMetricForSort(field: SortField): HeroMetric | null {
  if (field === 'economy') return 'economy';
  if (field === 'pct') return 'share';
  if (field === 'conflicts') return 'conflicts';
  return null;
}

/**
 * Спокойное состояние-заглушка: значок, утверждение, объяснение с действием.
 * `detail` — техническая строка от сервера; она идёт последней и мелким:
 * читателю сперва нужно понять, что делать, а не читать сообщение системы.
 */
function EconomyNotice({ icon, title, body, detail, tone = 'neutral' }: {
  icon: React.ReactNode; title: string; body: string; detail?: string;
  tone?: 'neutral' | 'alarm';
}) {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-center space-y-3 max-w-sm px-4">
        <div className={clsx(
          'w-12 h-12 rounded-xl flex items-center justify-center mx-auto',
          tone === 'alarm' ? 'bg-amber-500/10' : 'bg-emerald-500/10',
        )}>
          {icon}
        </div>
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{title}</p>
        <p className="text-[11px] text-zinc-500 leading-relaxed">{body}</p>
        {detail && <p className="text-[10px] text-zinc-500 dark:text-zinc-600 leading-relaxed">({detail})</p>}
      </div>
    </div>
  );
}

export function EconomyPage() {
  const { formatMoney, toggleDepartment, toggleSubordinate, navigateTo,
    selectedBudgets, selectedMethods, deptOnlyMode,
    loading, error, dashboardData } = useStore();
  const fd = useFilteredData();
  const summaries = fd.depts as DepartmentSummary[];

  const [expandedDepts, setExpandedDepts] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<SortField>('economy');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [showBudgetBreakdown, setShowBudgetBreakdown] = useState(false);
  const [tableView, setTableView] = useState<'departments' | 'subordinates'>('departments');
  // Нажатая плитка hero-полосы. Хранится отдельно от sortField, потому что
  // «Свыше 25 %» и «Доля от лимита» сортируют одной колонкой: выводить
  // подсветку из колонки — значит подсвечивать не то, что нажали.
  const [heroMetric, setHeroMetric] = useState<HeroMetric | null>('economy');

  const toggleExpand = useCallback((dept: string) => {
    setExpandedDepts(prev => {
      const next = new Set(prev);
      if (next.has(dept)) next.delete(dept);
      else next.add(dept);
      return next;
    });
  }, []);

  const handleSort = useCallback((field: SortField) => {
    setSortDir(prev => sortField === field ? (prev === 'desc' ? 'asc' : 'desc') : 'desc');
    setSortField(field);
    // Сортировка колонкой перебивает выбор в hero-полосе: подсветка обязана
    // показывать текущее состояние таблицы, а не то, что нажимали раньше.
    setHeroMetric(prev => (prev !== null && HERO_SORT[prev] === field ? prev : heroMetricForSort(field)));
  }, [sortField]);

  const handleHeroMetric = useCallback((metric: HeroMetric) => {
    // Нажатие на плитку всегда ставит «сначала самые крупные»: читатель
    // спрашивает «где больше всего», а не «где меньше всего».
    setHeroMetric(metric);
    setSortField(HERO_SORT[metric]);
    setSortDir('desc');
    setTableView('departments');
  }, []);

  const budgets = useMemo(() => budgetSelection(selectedBudgets), [selectedBudgets]);

  // ── Способ закупки — только для суффикса баннера ──
  const isMethodFiltered = selectedMethods.size > 0;
  const mKP = !isMethodFiltered || selectedMethods.has('competitive');
  const mEP = !isMethodFiltered || selectedMethods.has('single');

  // Период берём канонический — тот же, которым считает весь остальной дашборд
  // (hooks/useFilteredData → resolvePeriodSelection). Собственный вывод периода
  // на этой странице давал расхождение с прочими экранами и удалён.
  const periodKey = fd.periodKey;

  // ── Данные: строки управлений → сортировка → агрегаты → ряды графиков ──
  const deptEconomy = useMemo(
    () => buildDeptEconomy({ summaries, periodKey, budgets, deptOnlyMode }),
    [summaries, periodKey, budgets, deptOnlyMode],
  );
  const sortedDeptEconomy = useMemo(
    () => sortDeptEconomy(deptEconomy, sortField, sortDir),
    [deptEconomy, sortField, sortDir],
  );
  const allSubordinates = useMemo(() => flattenSubordinates(deptEconomy), [deptEconomy]);
  const totals = useMemo(() => computeEconomyTotals(deptEconomy), [deptEconomy]);
  const barChartData = useMemo(() => buildBarChartData(sortedDeptEconomy), [sortedDeptEconomy]);

  const quarterlyTrend = useMemo(() => buildQuarterlyTrend(summaries, budgets), [summaries, budgets]);
  const perDeptQuarterly = useMemo(() => buildPerDeptQuarterly(summaries, budgets), [summaries, budgets]);
  const trendData = useMemo(() => mergeTrendWithDepts(quarterlyTrend, perDeptQuarterly), [quarterlyTrend, perDeptQuarterly]);
  const deptSparks = useMemo(() => buildDeptSparks(summaries, budgets), [summaries, budgets]);
  const ecoSpark = useMemo(() => economySpark(quarterlyTrend), [quarterlyTrend]);
  const reductionSpark = useMemo(() => pctSpark(quarterlyTrend), [quarterlyTrend]);
  const deltas = useMemo(() => quarterDeltas(ecoSpark, reductionSpark), [ecoSpark, reductionSpark]);

  const downloadCSV = useCallback(() => {
    const blob = new Blob([buildEconomyCsv(deptEconomy)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = economyCsvFilename(); a.click();
    URL.revokeObjectURL(url);
  }, [deptEconomy]);

  const navigateToSub = useCallback((deptId: string, subName?: string) => {
    if (subName) toggleSubordinate(subName);
    toggleDepartment(deptId);
    navigateTo('data');
  }, [toggleDepartment, toggleSubordinate, navigateTo]);

  // ── Состояния до данных (после всех хуков) ──

  if (loading && !dashboardData) {
    return (
      <EconomyNotice
        icon={<Loader2 className="text-emerald-500/60 animate-spin" size={24} />}
        title="Читаем книги управлений"
        body="Собираем плановые и фактические суммы за выбранный период. Обычно это занимает несколько секунд."
      />
    );
  }

  // Ошибка без данных — экран целиком. Ошибка поверх уже загруженных данных
  // разбирается ниже полосой: прятать посчитанные цифры из-за неудачного
  // обновления вреднее, чем показать их с честной пометкой о свежести.
  if (error && !dashboardData) {
    return (
      <EconomyNotice
        tone="alarm"
        icon={<AlertTriangle className="text-amber-500/70" size={24} />}
        title="Данные по экономии не загрузились"
        body="Проверьте доступ к книгам управлений и запустите обновление на странице «Система». Если ошибка повторяется — обратитесь к администратору."
        detail={error}
      />
    );
  }

  if (deptEconomy.length === 0) {
    // Две разные пустоты — две разные причины и два разных действия.
    const nothingLoaded = (fd.allDepts?.length ?? 0) === 0;
    return nothingLoaded ? (
      <EconomyNotice
        icon={<Inbox className="text-emerald-500/60" size={24} />}
        title={ECONOMY_EMPTY_STATE_COPY.title}
        body={ECONOMY_EMPTY_STATE_COPY.body}
      />
    ) : (
      <EconomyNotice
        icon={<Inbox className="text-emerald-500/60" size={24} />}
        title="Под текущие фильтры не попало ни одного управления"
        body="За выбранный период, способ закупки и бюджет строк нет. Снимите часть фильтров в шапке — например, расширьте период до года."
      />
    );
  }

  // ── Баннер-утверждение: сумма + активные фильтры + статус нормы ──
  const budgetTag = budgets.filtered
    ? `, бюджеты ${[budgets.fb && 'ФБ', budgets.kb && 'КБ', budgets.mb && 'МБ'].filter(Boolean).join(', ')}`
    : '';
  const methodTag = isMethodFiltered
    ? `, способ ${[mKP && 'конкурентные процедуры', mEP && 'единственный поставщик'].filter(Boolean).join(' и ')}`
    : '';
  const deptOnlyTag = deptOnlyMode.size > 0
    ? `, без подведомственных у ${[...deptOnlyMode].join(', ')}`
    : '';
  // «В норме» — только при нуле отклонений свыше 25 % И нуле расхождений.
  const bannerStatus = economyBannerStatus({ conflicts: totals.conflicts, over25: totals.highCount });

  return (
    <div className="space-y-2.5">
      {/* ── Шапка страницы: заголовок + собственная подпись периода данных
            (канон п.58а: каждая карточка объявляет периметр; здесь — общий
            для баннера и hero-полосы, у блоков с иным периметром — своя
            оговорка на месте). ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-zinc-800 dark:text-zinc-100">Экономия</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-2xl mt-0.5">
            Утверждённая экономия торгов: где она возникла, из каких бюджетов и
            у каких управлений. Разница «план минус факт» экономией не считается.
          </p>
        </div>
        <PeriodBadge />
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 px-3 py-2 rounded-lg border border-amber-200 dark:border-amber-700/40 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300"
        >
          <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div className="text-xs leading-relaxed">
            Числа ниже посчитаны по ранее загруженным данным — последнее обновление не прошло.
            Запустите обновление на странице «Система».
            <span className="block text-[10px] text-amber-600/80 dark:text-amber-400/60">({error})</span>
          </div>
        </div>
      )}

      <div
        role="status"
        className={clsx(
          'px-3 py-2 rounded-lg border text-xs font-medium',
          bannerStatus.ok
            ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-700/40 text-emerald-700 dark:text-emerald-300'
            : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700/40 text-amber-700 dark:text-amber-300',
        )}
      >
        {formatMoney(totals.economy)} экономии{budgetTag}{methodTag}{deptOnlyTag} • {bannerStatus.label}
      </div>

      <EconomyHero
        rows={deptEconomy}
        totals={totals}
        economySpark={ecoSpark}
        pctSpark={reductionSpark}
        deltas={deltas}
        heroMetric={heroMetric}
        onHeroMetric={handleHeroMetric}
        formatMoney={formatMoney}
        onToggleDepartment={toggleDepartment}
      />

      {/* Подпись методики — у чисел hero-полосы и баннера (директива группы:
          методика называется рядом с каждой цифрой, не в глубине БЗ). */}
      <p className="px-1 text-[10px] text-zinc-500 leading-relaxed">
        Методика: экономия — только утверждённая финансовым органом по строкам
        книг управлений; «план минус факт» экономией не считается. Доля — экономия,
        делённая на лимит того же периметра. Подробности — при наведении на каждую цифру.
      </p>

      {/* ═══ Сводка одним предложением ═══ */}
      <div className="flex items-center gap-2 px-1 animate-[fadeIn_500ms_ease-out_200ms_both]">
        <Activity size={10} className="text-emerald-500/60 shrink-0" aria-hidden="true" />
        <p className="text-[10px] text-zinc-500 leading-relaxed">
          {buildEconomyInsight({
            // Только отфильтрованный набор — лидер и расхождения не могут назвать чужое управление.
            depts: sortedDeptEconomy.map(d => ({ dept: d.dept, economy: d.economy })),
            totalEconomy: totals.economy,
            totalPlan: totals.plan,
            mbEconomy: totals.mbEco,
            highEconomyCount: totals.highCount,
            conflicts: totals.conflicts,
            formatMoney,
          })}
        </p>
      </div>

      {/* Квартальный график живёт своим периметром — весь год по кварталам.
          При суженном периоде шапки об этом сказано вслух (канон п.58б/г):
          унаследованный бейдж здесь был бы ложью. */}
      {periodKey !== 'year' && (
        <p className="px-1 text-[10px] text-amber-700 dark:text-amber-400 leading-relaxed">
          Графики ниже показывают все кварталы года — выбор периода в шапке их не
          сужает. Итоги выше посчитаны за выбранный период.
        </p>
      )}

      <EconomyCharts
        barChartData={barChartData}
        trendData={trendData}
        perDeptQuarterly={perDeptQuarterly}
        deptCount={deptEconomy.length}
        showBudgetBreakdown={showBudgetBreakdown}
        onToggleBudgetBreakdown={() => setShowBudgetBreakdown(v => !v)}
        formatMoney={formatMoney}
        onBarClick={toggleDepartment}
      />

      {/* ── Шов с «Конкуренцией» (канон п.91-8): цена отказа от конкурса —
            родня динамики экономии, определения на обеих вкладках общие
            (среднее снижение считается по тем же состоявшимся торгам). ── */}
      <div className="flex items-center gap-2 px-1">
        <p className="text-[10px] text-zinc-500 leading-relaxed">
          Сколько экономии теряется на закупках без торгов — оценка «цена отказа
          от конкурса» по этой же статистике торгов:
        </p>
        <button
          type="button"
          onClick={() => navigateTo('competition')}
          className={clsx(
            'inline-flex items-center gap-1 text-[10px] font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap',
            FOCUS_RING,
          )}
        >
          открыть «Конкуренцию»
        </button>
      </div>

      {/* ═══ Таблица экономии — герой страницы ═══ */}
      <Card accent="blue">
        <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-zinc-200/70 dark:border-white/[0.04]">
          <div className="flex items-center gap-3 min-w-0">
            {/* Заголовок-утверждение: говорит, что показывает таблица, а не как называется */}
            <h2 className="text-xs font-bold text-zinc-800 dark:text-zinc-200 tracking-tight truncate">
              {totals.share !== null
                ? `Управления сэкономили ${formatPct(totals.share)} своих лимитов`
                : 'Экономия по управлениям (лимиты не заданы)'}
            </h2>

            <div className="flex items-center bg-zinc-100 dark:bg-white/[0.04] rounded-lg p-0.5 border border-zinc-200/70 dark:border-white/[0.04] shrink-0">
              {([
                { key: 'departments' as const, icon: Building2, label: `Управления (${deptEconomy.length})` },
                { key: 'subordinates' as const, icon: Layers, label: `Подведомственные (${totals.subCount})` },
              ]).map(v => (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => setTableView(v.key)}
                  aria-pressed={tableView === v.key}
                  className={clsx(
                    'flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold rounded-md transition-all uppercase tracking-wider whitespace-nowrap',
                    FOCUS_RING,
                    tableView === v.key
                      ? 'bg-zinc-200/70 dark:bg-white/[0.08] text-zinc-800 dark:text-zinc-200 shadow-sm'
                      : 'text-zinc-500 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400',
                  )}
                >
                  <v.icon size={9} aria-hidden="true" />{v.label}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={downloadCSV}
            aria-label="Выгрузить таблицу экономии файлом для Excel"
            title="Скачать таблицу файлом для Excel (разделитель — точка с запятой)"
            className={clsx(
              'flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/[0.04] transition-all border border-zinc-200/70 dark:border-white/[0.04] shrink-0',
              FOCUS_RING,
            )}
          >
            <Download size={9} aria-hidden="true" /> Выгрузить
          </button>
        </div>

        <div className="overflow-x-auto">
          {tableView === 'departments' ? (
            <EconomyDeptTable
              rows={sortedDeptEconomy}
              totals={totals}
              expandedDepts={expandedDepts}
              onToggleExpand={toggleExpand}
              sortField={sortField}
              sortDir={sortDir}
              onSort={handleSort}
              deptSparks={deptSparks}
              budgetFiltered={budgets.filtered}
              formatMoney={formatMoney}
              onToggleDepartment={toggleDepartment}
              onNavigateToSub={navigateToSub}
            />
          ) : (
            <EconomySubTable
              subs={allSubordinates}
              deptOnlyCount={totals.deptOnlyCount}
              formatMoney={formatMoney}
              onNavigateToSub={navigateToSub}
            />
          )}
        </div>
      </Card>

      {/* ── МАКЕТ «Распоряжение экономией» (канон п.101д, вопрос 72):
            владелец решает по скриншоту, на какие статусы распадается
            свободная экономия. Числа иллюстративные из констант компонента —
            к данным книг блок не подключён до решения владельца. ── */}
      <EconomyDisposalMock formatMoney={formatMoney} />
    </div>
  );
}
