// ────────────────────────────────────────────────────────────────
// Страница «Экономия» — композиция.
//
// Вопросы читателя: «Где экономия?» → hero + график бюджетов;
// «Какое управление больше?» → рейтинг со спарклайнами; «Есть ли споры?» →
// счётчик расхождений; «Что делать?» → инлайн-рекомендации.
//
// Чистые вычисления — lib/economy/*; блоки интерфейса — components/economy/*.
// ────────────────────────────────────────────────────────────────

import { useState, useMemo, useCallback, useEffect } from 'react';
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
import { ORG_ITSELF } from '../lib/economy/types';
import type { SortDir, SortField } from '../lib/economy/types';
import { useOrgScope } from '../lib/selectors/org-scope';
import { readingMoment } from '../lib/reading-moment';
import { periodScopePhrase } from '../lib/period-label';
import { ORG_ITSELF_LABEL } from '../lib/subordinate-label';
import { CHROME_BOX, Card, FOCUS_RING } from '../components/economy/primitives';
import { PeriodBadge } from '../components/PeriodBadge';
import { PageHeader } from '../components/ui/page-header';
import { EconomyHero } from '../components/economy/EconomyHero';
import type { HeroMetric } from '../components/economy/EconomyHero';
import { EconomyCharts } from '../components/economy/EconomyCharts';
import { EconomyDeptTable } from '../components/economy/EconomyDeptTable';
import { EconomySubTable } from '../components/economy/EconomySubTable';
import { EconomyDisposalMock } from '../components/economy/EconomyDisposalMock';
import { ECONOMY_CONFLICT_SIGNAL, EconomyConflictRows } from '../components/economy/EconomyConflictRows';
import type { ConflictIssue, ConflictSubScope } from '../components/economy/EconomyConflictRows';
import type { HeroSubScope } from '../components/economy/EconomyHero';

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
    selectedBudgets, selectedMethods, selectedActivities, deptOnlyMode, selectedDepartments,
    loading, error, dashboardData } = useStore();
  const fd = useFilteredData();
  const summaries = fd.depts as DepartmentSummary[];

  // ── Режим подведов (org-scope, приказ владельца 20.08.2026): один выбранный
  //    ГРБС «с подведомственными» переводит карточки страницы из строки
  //    управления в разбивку по учреждениям; «только ГРБС» — честная оговорка.
  //    Образец подключения — шапка lib/selectors/org-scope.ts.
  const orgScope = useOrgScope();

  const [expandedDepts, setExpandedDepts] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<SortField>('economy');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [showBudgetBreakdown, setShowBudgetBreakdown] = useState(false);
  const [tableView, setTableView] = useState<'departments' | 'subordinates'>('departments');
  // Нажатая плитка hero-полосы. Хранится отдельно от sortField, потому что
  // «Свыше 25 %» и «Доля от лимита» сортируют одной колонкой: выводить
  // подсветку из колонки — значит подсвечивать не то, что нажали.
  const [heroMetric, setHeroMetric] = useState<HeroMetric | null>('economy');
  // Раскрытие счётчика «Расхождения» до строк с адресами (канон п.119).
  const [conflictsOpen, setConflictsOpen] = useState(false);

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
    // Счётчик расхождений — раскрываемый (п.119): нажатие на плитку не только
    // сортирует таблицу, но и открывает список строк с адресами.
    if (metric === 'conflicts') setConflictsOpen(true);
  }, []);

  const budgets = useMemo(() => budgetSelection(selectedBudgets), [selectedBudgets]);

  // ── Оси шапки, которыми экономия НЕ сужается ──
  //
  //    Правило (ж) паспорта периметра (lib/perimeter.ts, канон п.58б): выбор в
  //    шапке, к числу не применимый, объявляется словами. Прежде страница
  //    подписывала способ закупки суффиксом баннера («способ конкурентные
  //    процедуры»), хотя `buildDeptEconomy` о `selectedMethods` не знает вовсе:
  //    подпись читалась как «сумма посчитана по этому способу» и врала.
  const isMethodFiltered = selectedMethods.size > 0;
  const isActivityFiltered = selectedActivities.size > 0;

  // Период берём канонический — тот же, которым считает весь остальной дашборд
  // (hooks/useFilteredData → resolvePeriodSelection). Собственный вывод периода
  // на этой странице давал расхождение с прочими экранами и удалён.
  const periodKey = fd.periodKey;
  // Месяцы шапки выбраны, а строки экономии размечены не точнее квартала:
  // `buildDeptEconomy` читает ровно `quarters[periodKey]`. Молчать об этом
  // нельзя — при выборе месяцев число вкладки шире выбора читателя.
  const hasActiveMonths = fd.periodResolution.hasActiveMonths;
  // Фраза периода — из общего дома подписей (`period-label`), а не своя копия:
  // вторая формулировка того же периода на соседних экранах расходится молча.
  const effectiveSpan = periodScopePhrase(periodKey, new Set<number>());

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

  // ── Производные режима подведов ──
  const singleDept = deptEconomy.length === 1 ? deptEconomy[0] : null;
  const withSubsMode = orgScope.mode === 'withSubs' && singleDept !== null;

  // В режиме «с подведомственными» строка ГРБС раскрывается сама: разбивка по
  // учреждениям — то, ради чего режим включён. Раскрытие сеется один раз на
  // выбор управления, свернуть руками читатель по-прежнему может.
  const singleDeptKey = singleDept?.dept ?? null;
  useEffect(() => {
    if (orgScope.mode === 'withSubs' && singleDeptKey) {
      setExpandedDepts(prev => prev.has(singleDeptKey) ? prev : new Set(prev).add(singleDeptKey));
    }
  }, [orgScope.mode, singleDeptKey]);

  // Канонические подведы управления, у которых в выборке нет ни одной строки:
  // присутствуют в разбивке с честным «строк нет» (орг-скоуп различает
  // «строк нет» и «организации нет»).
  const canonicalEmptySubs = useMemo(() => {
    if (!withSubsMode || !singleDept) return undefined;
    const live = new Set(singleDept.subordinates.map(s => s.name));
    return orgScope.subordinates
      .filter(g => g.key !== ORG_ITSELF && !live.has(g.key))
      .map(g => g.label);
  }, [withSubsMode, singleDept, orgScope.subordinates]);

  // Переход к строкам учреждения при УЖЕ выбранном управлении: фильтр ГРБС
  // не трогаем (toggleDepartment снял бы его), сужаем только организацию.
  const openSubRows = useCallback((subName: string) => {
    if (subName === ORG_ITSELF || subName === ORG_ITSELF_LABEL) navigateTo('data');
    else navigateTo('data', { subordinate: subName });
  }, [navigateTo]);

  // Правая панель hero-полосы в режиме подведов (org-scope).
  const heroSubScope: HeroSubScope | null = useMemo(() => {
    if (orgScope.mode === 'district' || !singleDept) return null;
    return {
      mode: orgScope.mode,
      deptLabel: singleDept.dept,
      hasSubs: orgScope.hasSubs,
      top: singleDept.subordinates
        .filter(s => s.name !== ORG_ITSELF)
        .slice(0, 4)
        .map(s => ({ name: s.name, economy: s.economy })),
      onOpenSub: openSubRows,
    };
  }, [orgScope.mode, orgScope.hasSubs, singleDept, openSubRows]);

  // Бар-чарт в режиме подведов: полосы — по учреждениям управления, а не по
  // единственному ГРБС (та самая разбивка, ради которой режим включён).
  const districtBarData = useMemo(() => buildBarChartData(sortedDeptEconomy), [sortedDeptEconomy]);
  const barChartData = useMemo(() => {
    if (!withSubsMode || !singleDept || singleDept.subordinates.length === 0) return districtBarData;
    return singleDept.subordinates.map(s => ({
      name: s.name === ORG_ITSELF ? ORG_ITSELF_LABEL : s.name,
      deptId: s.name,
      fb: s.budget.economyFB,
      kb: s.budget.economyKB,
      mb: s.budget.economyMB,
      total: s.economy,
      pct: s.pct,
      ownEco: 0,
      subsEco: 0,
      subCount: 0,
      topSubs: [],
    }));
  }, [withSubsMode, singleDept, districtBarData]);
  const subBarMode = withSubsMode && singleDept !== null && singleDept.subordinates.length > 0;

  // ── Строки-основания счётчика «Расхождения» (п.119). fd.issues уже
  //    отфильтрованы по выбранным управлениям — изоляция п.127 обеспечена входом.
  const conflictIssues = useMemo(
    () => ((fd.issues ?? []) as Array<ConflictIssue & { signal?: string }>)
      .filter(i => i?.signal === ECONOMY_CONFLICT_SIGNAL),
    [fd.issues],
  );

  // Режим подведов у карточки расхождений: строки-основания раскладываются по
  // учреждениям выбранного управления, организация без расхождений называется
  // словами (org-scope, приказ владельца 20.08).
  const conflictSubScope: ConflictSubScope | null = useMemo(() => {
    if (!withSubsMode || !singleDept) return null;
    return {
      deptLabel: singleDept.dept,
      hasSubs: orgScope.hasSubs,
      orgs: orgScope.subordinates.map(g => ({ key: g.key, label: g.label })),
    };
  }, [withSubsMode, singleDept, orgScope.hasSubs, orgScope.subordinates]);

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
    // Управление добавляется в фильтр, только если ещё не выбрано: toggle по
    // уже выбранному снял бы его — и Реестр открылся бы по всему району.
    if (!selectedDepartments.has(deptId)) toggleDepartment(deptId);
    navigateTo('data');
  }, [toggleDepartment, toggleSubordinate, navigateTo, selectedDepartments]);

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
  // ── Оси шапки, к экономии НЕ применимые, — словами, а не молчанием ──
  //
  //    Формулировки одной конструкции: «фильтр … экономию не сужает: <почему> —
  //    <как посчитано на самом деле>». Читатель, встретив такую фразу на второй
  //    вкладке, узнаёт её не перечитывая (правило «ж» паспорта периметра).
  const perimeterNotes: string[] = [];
  if (hasActiveMonths) {
    perimeterNotes.push(
      `Выбранные месяцы экономию не сужают: утверждённая экономия размечена не точнее квартала — числа выше посчитаны за ${effectiveSpan}.`,
    );
  }
  if (isMethodFiltered) {
    perimeterNotes.push(
      'Фильтр способа закупки экономию не сужает: утверждённая экономия способом в книгах не размечена — числа выше по всем способам.',
    );
  }
  if (isActivityFiltered) {
    perimeterNotes.push(
      'Фильтр вида деятельности экономию не сужает: строки утверждённой экономии видом деятельности не размечены.',
    );
  }
  // Режим «только ГРБС» математики вычитания не имеет (маркер UI): итоги
  // по-прежнему считаются по книге целиком — подпись обязана сказать правду,
  // а не обещать «без подведомственных».
  const deptOnlyTag = deptOnlyMode.size > 0
    ? `, у ${[...deptOnlyMode].join(', ')} скрыта разбивка по учреждениям (режим «только ГРБС»; итоги — по книге целиком)`
    : '';
  // «В норме» — только при нуле отклонений свыше 25 % И нуле расхождений.
  const bannerStatus = economyBannerStatus({ conflicts: totals.conflicts, over25: totals.highCount });

  // Момент чтения книг у чисел страницы (канон п.58: у каждого числа виден не
  // только период, но и момент, на который оно верно). Фразу собирает
  // единственный дом продукта — lib/reading-moment: незнание момента там не
  // выдаётся за свежесть, и своя копия подписи здесь была бы вторым домом.
  const readMoment = readingMoment({ readAt: dashboardData?.lastRefreshed ?? null });

  return (
    <div className="space-y-2.5">
      {/* ── Шапка страницы: заголовок + собственная подпись периода данных
            (канон п.58а: каждая карточка объявляет периметр; здесь — общий
            для баннера и hero-полосы, у блоков с иным периметром — своя
            оговорка на месте). ── */}
      {/* 21.08: шапка переведена на общий примитив `PageHeader` — тот же, что
          на остальных пяти страницах. Прежде «Экономия» держала собственную
          разметку заголовка первого уровня: пятая копия одного решения, кегль и
          краски правились отдельно от всех. */}
      <PageHeader
        title="Экономия"
        lead={
          'Утверждённая экономия торгов: где она возникла, из каких бюджетов и '
          + 'у каких управлений. Разница «план минус факт» экономией не считается.'
        }
        actions={
          // Скоуп числа и момент его чтения стоят вместе: период отвечает на
          // «за что посчитано», момент — на «когда это было верно» (п.58).
          // Тот же порядок, что на соседней вкладке «Конкуренция».
          <div className="flex flex-col items-end gap-1 shrink-0">
            <PeriodBadge />
            <span
              title={readMoment.phrase}
              className={clsx(
                'text-[9px] leading-tight text-right',
                // Остывшие числа говорят об этом сами: до подсказки читатель
                // может и не добраться.
                readMoment.stale
                  ? 'text-amber-700 dark:text-amber-400'
                  : 'text-zinc-500 dark:text-zinc-400',
              )}
            >
              {readMoment.label}
            </span>
          </div>
        }
      />

      {error && (
        <div
          role="alert"
          // Тихие рамки (п.129): в тёмной теме плашку отделяет светлота фона,
          // рамка остаётся только светлой теме.
          className="flex items-start gap-2 px-3 py-2 rounded-lg border border-amber-200 dark:border-transparent bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300"
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
          // Тихие рамки (п.129): тёмная тема — светлота фона вместо обводки.
          bannerStatus.ok
            ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-transparent text-emerald-700 dark:text-emerald-300'
            : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-transparent text-amber-700 dark:text-amber-300',
        )}
      >
        {formatMoney(totals.economy)} экономии{budgetTag}{deptOnlyTag} • {bannerStatus.label}
      </div>

      {/* ── Чем число баннера НЕ сужено вопреки шапке (канон п.58б, правило «ж»
            паспорта периметра). Оговорки стоят под самим числом, а не в
            тултипе: до подсказки читатель может и не добраться. ── */}
      {perimeterNotes.length > 0 && (
        <ul className="px-1 space-y-0.5" aria-label="Чем числа страницы не сужены">
          {perimeterNotes.map(note => (
            <li
              key={note}
              className="flex items-start gap-1.5 text-[10px] leading-relaxed text-amber-700 dark:text-amber-400"
            >
              <AlertTriangle size={10} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{note}</span>
            </li>
          ))}
        </ul>
      )}

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
        subScope={heroSubScope}
        // Спарклайн и дельта плиток считаются по всем кварталам года. При
        // суженной шапке плитка несёт два периметра сразу — и оба обязаны быть
        // названы внутри неё (канон п.58г).
        narrowedSpanLabel={periodKey !== 'year' || hasActiveMonths ? effectiveSpan : null}
      />

      {/* Подпись методики — у чисел hero-полосы и баннера (директива группы:
          методика называется рядом с каждой цифрой, не в глубине БЗ). */}
      <p className="px-1 text-[10px] text-zinc-500 leading-relaxed">
        Методика: экономия — только утверждённая финансовым органом по строкам
        книг управлений; «план минус факт» экономией не считается. Доля — экономия,
        делённая на лимит того же периметра. Подробности — при наведении на каждую цифру.
      </p>

      {/* ── Раскрытие счётчика «Расхождения» до строк с адресами (п.119):
            какая строка, что в ней, почему. Изоляция п.127 — fd.issues уже
            отфильтрованы по выбранным управлениям. ── */}
      <EconomyConflictRows
        issues={conflictIssues}
        conflictsTotal={totals.conflicts}
        lastRefreshed={dashboardData?.lastRefreshed ?? null}
        open={conflictsOpen}
        onToggle={() => setConflictsOpen(v => !v)}
        onOpenRegistry={() => navigateTo('data', { signals: [ECONOMY_CONFLICT_SIGNAL] })}
        subScope={conflictSubScope}
      />

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
      {/* Условие включает и месяцы: при выборе месяцев из двух кварталов
          `periodKey` остаётся 'year' (period-resolution.ts), и прежняя проверка
          `periodKey !== 'year'` оговорку не показывала — графики молча
          притворялись подчинёнными шапке. */}
      {(periodKey !== 'year' || hasActiveMonths) && (
        <p className="px-1 text-[10px] text-amber-700 dark:text-amber-400 leading-relaxed">
          Графики ниже показывают все кварталы года — выбор периода в шапке их не
          сужает. Итоги выше посчитаны за {effectiveSpan}.
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
        // Режим подведов: полосы — учреждения, клик ведёт к их строкам в Реестре.
        onBarClick={subBarMode ? openSubRows : toggleDepartment}
        barClickHint={subBarMode ? 'клик — строки учреждения в Реестре' : undefined}
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
              {/* Скоуп заголовка честный: при одном управлении — его имя,
                  а не «управления» во множественном числе. */}
              {singleDept
                ? (totals.share !== null
                  ? `${singleDept.dept}: сэкономлено ${formatPct(totals.share)} лимита`
                  : `Экономия ${singleDept.dept} (лимиты не заданы)`)
                : (totals.share !== null
                  ? `Управления сэкономили ${formatPct(totals.share)} своих лимитов`
                  : 'Экономия по управлениям (лимиты не заданы)')}
            </h2>

            {/* Переключатель вида — подложка, а не рамка (п.129): в тёмной теме
                сегмент отделяет светлота, обводка гаснет. */}
            <div className={clsx('flex items-center rounded-lg p-0.5 shrink-0', CHROME_BOX)}>
              {([
                { key: 'departments' as const, icon: Building2, label: `Управления (${deptEconomy.length})` },
                {
                  key: 'subordinates' as const,
                  icon: Layers,
                  // Счётчик считает и каноничные организации без строк: список
                  // ниже их показывает, и число обязано совпадать со списком.
                  label: `Подведомственные (${totals.subCount + (canonicalEmptySubs?.length ?? 0)})`,
                },
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
              'flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 rounded-lg transition-all shrink-0',
              CHROME_BOX,
              'hover:bg-zinc-200/70 dark:hover:bg-white/[0.07]',
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
              canonicalEmptySubs={canonicalEmptySubs}
              formatMoney={formatMoney}
              onToggleDepartment={toggleDepartment}
              onNavigateToSub={navigateToSub}
            />
          ) : (
            <EconomySubTable
              subs={allSubordinates}
              deptOnlyCount={totals.deptOnlyCount}
              // Режим подведов: каноничные организации без строк не пропадают
              // из плоского списка — «строк нет» и «организации нет» различимы.
              canonicalEmptySubs={canonicalEmptySubs}
              emptySubsDeptName={singleDept?.dept ?? null}
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
