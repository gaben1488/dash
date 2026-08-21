import { useState, useMemo } from 'react';
import { useStore, type Page, type PeriodScope } from '../store';
import { useFilteredData } from '../hooks/useFilteredData';
import { FilterBreadcrumb } from '../components/FilterBreadcrumb';
import { periodDataLabel } from '../lib/period-label';
import { useMultiDimMetrics } from '../hooks/useMultiDimMetrics';
import { HeroKPICard, DeptBreakdown, BudgetBreakdown, TrustComponents } from '../components/HeroKPICard';
import { SkeletonKPIRow, SkeletonChart } from '../components/Skeleton';
import { CriticalBannerV2 } from '../components/CriticalBannerV2';
import { RatingTableV2, type DeptRowV2 } from '../components/RatingTableV2';
import { DrillPieChart } from '../components/charts/DrillPieChart';
import { KBTooltip } from '../components/ui/kb-tooltip';
import { PeriodBadge } from '../components/PeriodBadge';
import { PlanSemanticsNote } from '../components/PlanSemanticsNote';
import { AlertTriangle, Info } from 'lucide-react';
import {
  Cell, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  ComposedChart, Line, CartesianGrid,
} from 'recharts';
import { useTheme } from '../components/ThemeProvider';
import { getTooltipStyle, getAxisColor, getGridColor, getExecutionBarColor } from '../lib/chart-colors';
import { getThresholdColor } from '../lib/metrics-registry';
import { getFilteredEconomyTotal } from '../lib/economy-metrics';
import { pluralRu } from '../lib/economy-copy';
import { ORG_ITSELF_LABEL } from '../lib/subordinate-label';
import { formatPercent, formatMetricValue } from '../components/HeroKPICard';
import { buildPerimeter, type Perimeter } from '../lib/perimeter';
import { useOrgScope, type OrgScope } from '../lib/selectors/org-scope';
import { DeptPortrait } from '../components/dashboard/DeptPortrait';
import { CARD, CARD_SURFACE, RULE_HEAD } from '../components/dashboard/surfaces';
import type { DeptMetrics } from '../hooks/useMultiDimMetrics';
import { ORG_ITSELF_SENTINEL } from '@aemr/shared';
import { DASHBOARD_REPORT_KB_ADDITIONS, kbCardProps } from './kb-additions';
import { figure, ratio, toPercent, type FigureProvenance } from '../lib/figure';
import { officialProvenanceFor } from '../lib/provenance-registry';
import { productLabel, quarterLabel } from '@aemr/shared';

// ────────────────────────────────────────────────────────────────
// Пульт — главная страница: паспорт данных, замечания, ключевые показатели,
// рейтинг управлений, план против факта, сигналы.
//
// Правила, которые держит страница:
//   • Каждое число объяснимо: подпись из словаря продукта, происхождение
//     видно, у ключевых показателей — подсказка базы знаний.
//   • Нулевой знаменатель — не ноль процентов, а «нет плана». Проценты
//     никогда не усредняются: доля считается от суммы, а не как среднее
//     долей управлений.
//   • Пустое состояние называет ПРИЧИНУ и следующий шаг, а не «нет данных».
//   • Раскрытие происходит на месте; переход на другую страницу — отдельной
//     явной кнопкой.
//   • Ни одного внутреннего ключа и ни одной латиницы в видимом тексте
//     (закон продукта, дефект Д12 реестра).
// ────────────────────────────────────────────────────────────────

/** Подписи кварталов — канон @aemr/shared («1 кв»), не локальные строки. */
const QUARTER_KEYS = ['q1', 'q2', 'q3', 'q4'] as const;
const QUARTER_LABELS = [1, 2, 3, 4].map(quarterLabel);

/** Склонение «управление» по числу — через единственный дом склонения. */
function deptsWord(n: number): string {
  return pluralRu(n, 'управление', 'управления', 'управлений');
}

/**
 * Согласование «процентный пункт» с числом: при дробном значении — родительный
 * падеж единственного числа («5,3 процентного пункта»), при целом — обычное
 * склонение. Прежняя фраза «5 процентных пункта» такой формы в русском не имеет.
 */
function pointsWord(n: number): string {
  return Number.isInteger(n)
    ? pluralRu(n, 'процентный пункт', 'процентных пункта', 'процентных пунктов')
    : 'процентного пункта';
}

/**
 * Доля исполнения квартала: процент либо `null`, когда плана не было.
 * Ноль вместо `null` означал бы «исполнено ноль процентов» — кривая падала бы
 * на дно там, где работы просто не планировалось, а направление динамики
 * считалось бы по выдуманной точке.
 */
function quarterPct(fact: number, plan: number): number | null {
  return plan > 0 ? +((fact / plan) * 100).toFixed(1) : null;
}

/**
 * Направление по последним двум ИЗВЕСТНЫМ точкам ряда. Кварталы без плана в
 * сравнение не входят: раньше направление всегда считалось по концу года, и при
 * выборе первого квартала плитка сообщала о «падении» четвёртого.
 */
function trendOfKnown(series: Array<number | null>): 'up' | 'down' | 'stable' | undefined {
  const known = series.filter((v): v is number => v != null);
  if (known.length < 2) return undefined;
  const last = known[known.length - 1];
  const prev = known[known.length - 2];
  return last > prev ? 'up' : last < prev ? 'down' : 'stable';
}

/**
 * Паспорт данных (Д9 реестра дефектов): за какой период числа, откуда они,
 * какой это срез и когда прочитан источник. Раньше строка показывала только
 * время обновления, номер снимка и число ячеек — период и источник
 * приходилось угадывать.
 */
interface StatusLineData {
  lastRefreshed?: string | number | null;
  rowCount?: number | null;
  snapshot?: { metadata?: { cellsRead?: number | null } | null } | null;
}

function StatusLine({ data, fd }: { data: StatusLineData; fd: ReturnType<typeof useFilteredData> }) {
  // Период и месяцы читаются подпиской, а не через getState(): getState даёт
  // снимок на момент отрисовки и сам по себе перерисовку не вызывает — подпись
  // периода могла отстать от выбора в шапке.
  const period = useStore((s) => s.period);
  const activeMonths = useStore((s) => s.activeMonths);

  const refreshedAt = data?.lastRefreshed ? new Date(data.lastRefreshed) : null;
  const refreshedLabel = refreshedAt && !Number.isNaN(refreshedAt.getTime())
    ? refreshedAt.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;
  const cellsReadRaw = data?.snapshot?.metadata?.cellsRead ?? data?.rowCount ?? null;
  const deptCount = fd.allDepts?.length ?? fd.depts.length;
  const periodLabel = periodDataLabel({
    year: fd.dataYear,
    period: (period ?? 'year') as PeriodScope,
    activeMonths,
  });

  // Строка состояния — поверхность в потоке страницы, а не окно поверх неё:
  // в тёмной теме её отделяет светлота (zinc-800/70 против zinc-950 — 1,20:1),
  // и обводка ей не нужна (канон п.129).
  return (
    <div className="flex items-center gap-3 text-xs bg-white/80 dark:bg-zinc-800/70 backdrop-blur-sm rounded-2xl px-4 py-2.5 border border-zinc-200/60 dark:border-transparent flex-wrap">
      {/* Живой срез: пульс + слово (закон 6 — текстовый дубль визуального) */}
      <span className="flex items-center gap-1.5" title="Эфир: числа считаются по текущему состоянию книг, а не по архивному срезу недели">
        <span className="relative flex h-2 w-2" aria-hidden="true">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
        <span className="font-semibold text-emerald-600 dark:text-emerald-400">Эфир</span>
      </span>
      <span className="w-px h-3.5 bg-zinc-200 dark:bg-zinc-700" />
      <span className="text-zinc-500 dark:text-zinc-400" title="Период, за который посчитаны все числа на странице">
        Период: <strong className="text-zinc-700 dark:text-zinc-200 font-semibold">{periodLabel}</strong>
      </span>
      <span className="w-px h-3.5 bg-zinc-200 dark:bg-zinc-700" />
      <span className="text-zinc-500 dark:text-zinc-400" title="Источник: книги управлений в Google Таблицах, прочитанные сервером">
        Источник: <strong className="text-zinc-700 dark:text-zinc-200 font-semibold">{deptCount} {pluralRu(deptCount, 'книга', 'книги', 'книг')} управлений</strong>
      </span>
      <span className="w-px h-3.5 bg-zinc-200 dark:bg-zinc-700" />
      {/* Прочерк без объяснения не годится: если времени чтения нет, так и
          пишем — иначе пользователь читает «—» как поломку. */}
      <span className="text-zinc-500 dark:text-zinc-400">
        {refreshedLabel
          ? <>Прочитано: <strong className="text-zinc-700 dark:text-zinc-200 font-semibold">{refreshedLabel}</strong></>
          : <span title="Сервер не записал время последнего чтения книг">Время чтения книг сервер не записал</span>}
      </span>
      {cellsReadRaw != null && (
        <>
          <span className="w-px h-3.5 bg-zinc-200 dark:bg-zinc-700" />
          <span className="text-zinc-500 dark:text-zinc-400" title="Сколько ячеек листов прочитано в этом снимке">
            <strong className="text-zinc-600 dark:text-zinc-300 font-semibold tabular-nums">{cellsReadRaw.toLocaleString('ru-RU')}</strong> {pluralRu(cellsReadRaw, 'ячейка', 'ячейки', 'ячеек')}
          </span>
        </>
      )}
    </div>
  );
}

export function Dashboard() {
  const { dashboardData, loading, error, navigateTo, formatMoney, procurementFilter, toggleDepartment, selectedDepartments } = useStore();
  const fd = useFilteredData();
  const mdm = useMultiDimMetrics();
  const isDark = useTheme(s => s.theme) === 'dark';
  const { contentStyle: tooltipStyle, itemStyle: tooltipItemStyle, labelStyle: tooltipLabelStyle } = getTooltipStyle(isDark);
  const cursorStyle = { fill: isDark ? 'rgba(148,163,184,0.12)' : 'rgba(0,0,0,0.06)', stroke: 'none' };

  const [expandedKpi, setExpandedKpi] = useState<string | null>(null);

  const { depts, barData, issues, periodKey } = fd;

  // ── Режим подведов (org-scope, приказ владельца 20.08.2026) ──
  // Один выбранный ГРБС переводит страницу в портретный режим: большая
  // карточка управления + разбивка карточек по подведам («с подведомственными»)
  // либо честная оговорка («только ГРБС»). Образец подключения — в шапке
  // lib/selectors/org-scope.ts; другие страницы повторяют его.
  const orgScope = useOrgScope();
  const portraitDm: DeptMetrics | null =
    orgScope.mode !== 'district' && mdm.departments.length === 1
      ? mdm.departments[0]
      : null;

  // ── Периметр плиток: за что именно посчитаны их числа ──
  // Собирается из ТОГО ЖЕ состояния, которым считал useFilteredData, иначе
  // подпись описывала бы не те числа, что нарисованы (канон п.58 «б»: бейдж,
  // унаследованный от фильтра, которому числа не подчиняются, запрещён).
  //   • год — ДАННЫХ: при расхождении с выбором шапки страница честно считает
  //     за год данных, и подпись обязана назвать именно его;
  //   • период — эффективный `periodKey` после resolvePeriodSelection;
  //   • месяцы — только когда фильтр периода задан явно: в недельном режиме
  //     useFilteredData их обнуляет, и неделя расчёт не сужает;
  //   • момент — «на сейчас»: Пульт читает эфир, архивного среза у плиток нет.
  const rawActiveMonths = useStore((s) => s.activeMonths);
  const periodMode = useStore((s) => s.periodMode);
  const selectedSubordinates = useStore((s) => s.selectedSubordinates);
  const perimeter = useMemo<Perimeter>(() => buildPerimeter({
    year: fd.yearMismatch ? fd.dataYear : fd.year,
    period: periodKey as PeriodScope,
    activeMonths: periodMode === 'week' ? [] : rawActiveMonths,
    departments: selectedDepartments,
    subordinates: selectedSubordinates,
    asOf: null,
  }), [
    fd.yearMismatch, fd.dataYear, fd.year, periodKey,
    periodMode, rawActiveMonths, selectedDepartments, selectedSubordinates,
  ]);

  // Подписи кварталов берутся из канона @aemr/shared («1 кв»), а не собираются
  // здесь строками с точкой. Ключ квартала едет вместе с точкой данных: раньше
  // переход по клику восстанавливал ключ обратным разбором подписи — стоило
  // поменять подпись, и навигация молча ломалась.
  const planFactData = useMemo(() => {
    const sbp = fd.summaryByPeriod;
    return QUARTER_KEYS.map((qk, i) => {
      const q = sbp[qk];
      const kpPlan = q?.kpPlan ?? 0;
      const epPlan = q?.epPlan ?? 0;
      const kpFact = q?.kpFact ?? 0;
      const epFact = q?.epFact ?? 0;
      return {
        name: QUARTER_LABELS[i],
        quarterKey: qk,
        plan: kpPlan + epPlan,
        fact: kpFact + epFact,
        kpPlan, epPlan, kpFact, epFact,
      };
    });
  }, [fd.summaryByPeriod]);

  const showStacked = procurementFilter === 'all';

  /** Переход в Аналитику за конкретный квартал по ключу из точки данных. */
  const goToQuarter = (quarterKey?: string, procurement?: 'single' | 'competitive') => {
    if (!quarterKey || !(QUARTER_KEYS as readonly string[]).includes(quarterKey)) return;
    navigateTo('analytics', procurement
      ? { period: quarterKey as PeriodScope, procurement }
      : { period: quarterKey as PeriodScope });
  };

  /**
   * Утверждение о данных вместо витринного названия графика: называем квартал
   * с наибольшим отставанием факта от плана. Считается ровно по тем же числам,
   * что нарисованы, — ничего не додумывается.
   */
  const planFactAssertion = useMemo(() => {
    const withPlan = planFactData.filter(d => d.plan > 0);
    if (withPlan.length === 0) return 'Плановых сумм за выбранный период в книгах нет.';
    const worst = withPlan.reduce((a, b) => (b.plan - b.fact > a.plan - a.fact ? b : a));
    const gap = worst.plan - worst.fact;
    if (gap <= 0) return 'Во всех кварталах с планом факт вышел не ниже плана.';
    const gapPct = +((gap / worst.plan) * 100).toFixed(1);
    return `Наибольший разрыв — ${worst.name}: факт ниже плана на ${formatMoney(gap)} (${formatPercent(gapPct)} плана квартала).`;
  }, [planFactData, formatMoney]);

  /**
   * Утверждение для графика исполнения: разрыв между лучшим и худшим
   * управлением по сумме. Управления без плана в сравнение не берутся.
   */
  const execAssertion = useMemo(() => {
    const rows = (barData ?? []).filter((d: any) => typeof d.pct === 'number' && (d.planTotal ?? 0) > 0);
    if (rows.length === 0) return 'За выбранный период плановых сумм у управлений нет — сравнивать нечего.';
    if (rows.length === 1) {
      const only = rows[0];
      return `В расчёте одно управление — ${only.name}: исполнено ${formatPercent(only.pct)} плановой суммы.`;
    }
    const best = rows.reduce((a: any, b: any) => (b.pct > a.pct ? b : a));
    const worst = rows.reduce((a: any, b: any) => (b.pct < a.pct ? b : a));
    const spread = +(best.pct - worst.pct).toFixed(1);
    return `Разрыв между управлениями — ${formatMetricValue(spread)} ${pointsWord(spread)}: ${best.name} впереди (${formatPercent(best.pct)}), ${worst.name} позади (${formatPercent(worst.pct)}).`;
  }, [barData]);

  // ── Ключевые показатели ──
  const heroKpis = useMemo(() => buildHeroKPIs(fd, perimeter), [fd, perimeter]);

  // Замечания для полосы — ЦЕЛИКОМ и со всеми полями карточки диагноста
  // (канон п.53): механизм (signal/checkId/title), подсказка (kbHint),
  // действие (recommendation) и адрес строки (sheet/row/cell). Группировку
  // по механизмам и свёртку адресов делает сама полоса.
  const bannerIssues = useMemo(
    () => fd.criticalIssues.concat(fd.warningIssues).map((iss: any) => ({
      id: iss.id,
      signal: iss.signal,
      checkId: iss.checkId,
      severity: iss.severity,
      title: iss.title,
      description: iss.description ?? iss.message,
      kbHint: iss.kbHint,
      recommendation: iss.recommendation,
      sheet: iss.sheet,
      cell: iss.cell,
      row: iss.row,
      rowSeq: iss.rowSeq,
      department: iss.department ?? iss.deptId,
      departmentId: iss.departmentId,
    })),
    [fd.criticalIssues, fd.warningIssues],
  );

  // ── Данные рейтинга управлений ──
  const ratingDepts = useMemo<DeptRowV2[]>(() => {
    // Порядок кварталов нужен, чтобы понять, с чем сравнивается текущий.
    const qOrder = QUARTER_KEYS as readonly string[];
    const curIdx = periodKey.startsWith('q') ? qOrder.indexOf(periodKey) : qOrder.length - 1;
    const prevIdx = curIdx > 0 ? curIdx - 1 : -1;

    return mdm.departments.map((dm) => {
      const d = dm.raw;
      // Кривая по кварталам. Само число берём то же, что считает слой метрик, —
      // пересчитывать его здесь значит завести второй источник правды. Меняется
      // только одно: квартал без плана даёт `null`, а не ноль, потому что
      // «нечего исполнять» и «исполнено ноль» — разные вещи.
      const spark = dm.quarters.map(q => (q.plan > 0 ? q.execPct : null));

      // Исполнение федерального бюджета за выбранный период
      let fbExecPct: number | null = null;
      const q = d.quarters?.[periodKey];
      if (q) {
        fbExecPct = quarterPct(q.factFB ?? 0, q.planFB ?? 0);
      }

      // Аппарат управления идёт первой строкой, дальше — подведомственные.
      // Замечания по организациям отдельно не считаются: проверки работают по
      // книге управления целиком, поэтому здесь честный `null`, а не ноль.
      const subs: DeptRowV2['subordinates'] = [];

      // Слой метрик отдаёт ноль там, где делить не на что. Для строки таблицы
      // это неверно: «плана нет» превращалось в «исполнено 0,0 %» и красилось
      // красным. Поэтому проценты берём только при ненулевом плане.
      const subRow = (name: string, m: typeof dm.total, isSelf?: boolean) => ({
        name,
        isSelf,
        execAmountPct: m.planTotal > 0 ? m.executionPct : null,
        execCountPct: m.planCount > 0 ? m.execCountPct : null,
        issueCount: null,
      });

      if (dm.orgSelf) subs.push(subRow(ORG_ITSELF_LABEL, dm.orgSelf.metrics, true));
      for (const s of dm.realSubs) subs.push(subRow(s.displayName, s.metrics));

      // Столбцы процентов: «нечего исполнять» (плана за период не было) — не то
      // же самое, что «исполнено ноль» (план был, факт нулевой). Различаем по
      // тому же кварталу, что и федеральный бюджет выше, иначе оба схлопываются
      // в одно число и становятся неразличимы для сортировки, цвета и подписи.
      const hasAmountPlan = (q?.planTotal ?? 0) > 0;
      const hasCountPlan = (q?.planCount ?? 0) > 0;

      // Изменение к предыдущему кварталу показываем ТОЛЬКО когда в обоих
      // кварталах был план. Иначе сравнение шло с нулём, приписанным кварталу
      // без плана, и управление получало эффектное «+62,0 п.п.» на пустом месте.
      const curQ = curIdx >= 0 ? dm.quarters[curIdx] : undefined;
      const prevQ = prevIdx >= 0 ? dm.quarters[prevIdx] : undefined;
      const comparable = !!curQ && !!prevQ && curQ.plan > 0 && prevQ.plan > 0;

      return {
        id: dm.deptId,
        name: dm.deptName,
        nameShort: dm.dept,
        execAmountPct: hasAmountPlan ? dm.total.executionPct : null,
        execCountPct: hasCountPlan ? dm.total.execCountPct : null,
        fbExecPct,
        trustScore: d.trustScore ?? null,
        issueCount: d.issueCount ?? 0,
        criticalIssueCount: d.criticalIssueCount ?? 0,
        sparkData: spark.some(v => v != null) ? spark : undefined,
        deltaQuarter: comparable && dm.delta ? +dm.delta.execPctChange.toFixed(1) : null,
        // Список отдаём всегда: пустой массив означает «подведов нет», а
        // отсутствие поля — «детализация не загружена». Раньше обе причины
        // сходились в одну фразу про незагруженный список.
        subordinates: subs,
      };
    });
  }, [mdm.departments, periodKey]);


  if (loading && !dashboardData) {
    return (
      <div className="space-y-4" role="status" aria-live="polite">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Читаем книги управлений — это занимает несколько секунд.
        </p>
        <SkeletonKPIRow count={4} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SkeletonChart />
          <SkeletonChart />
        </div>
      </div>
    );
  }

  // Заголовок ошибки — по-русски и о деле; технический текст сервера остаётся,
  // но мелким и отдельной строкой, чтобы не подменять собой объяснение.
  // Красный край карточки остаётся в обеих темах: здесь обводка — сам сигнал
  // тревоги, а не хром. Светлота поверхности — как у прочих карточек.
  if (error) {
    return (
      <div className={`${CARD_SURFACE} rounded-2xl shadow-lg dark:shadow-none border border-red-200/60 dark:border-transparent max-w-lg mx-auto mt-12 text-center p-8`} role="alert">
        <div className="w-14 h-14 rounded-2xl bg-red-50 dark:bg-red-500/10 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="text-red-500" size={28} aria-hidden="true" />
        </div>
        <p className="text-red-600 dark:text-red-400 font-bold mb-2 text-lg">Пульт не удалось собрать</p>
        <p className="text-sm text-zinc-600 dark:text-zinc-300 mb-3 leading-relaxed">
          Проверьте связь с сервером данных и доступ к книгам управлений, затем повторите чтение.
        </p>
        <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-6 leading-relaxed">
          ({error})
        </p>
        <button
          type="button"
          onClick={() => useStore.getState().fetchDashboard(true)}
          className="px-6 py-2.5 bg-gradient-to-r from-blue-600 to-blue-500 text-white rounded-xl text-sm font-semibold hover:shadow-lg hover:shadow-blue-500/25 transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        >
          Прочитать заново
        </button>
      </div>
    );
  }

  // Раньше здесь возвращался null — пользователь видел пустой экран без единого
  // слова и без способа что-то сделать.
  if (!dashboardData) {
    return (
      <div className={`${CARD} rounded-2xl shadow-sm dark:shadow-none max-w-lg mx-auto mt-12 text-center p-8`}>
        <div className="w-14 h-14 rounded-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mx-auto mb-4">
          <Info className="text-zinc-400" size={28} aria-hidden="true" />
        </div>
        <p className="font-bold mb-2 text-lg text-zinc-700 dark:text-zinc-200">Книги управлений ещё не прочитаны</p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6 leading-relaxed">
          Снимок данных на сервере пуст. Запустите чтение — Пульт соберётся из книг управлений.
        </p>
        <button
          type="button"
          onClick={() => useStore.getState().fetchDashboard(true)}
          className="px-6 py-2.5 bg-gradient-to-r from-blue-600 to-blue-500 text-white rounded-xl text-sm font-semibold hover:shadow-lg hover:shadow-blue-500/25 transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        >
          Прочитать книги
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* 1. Паспорт данных + активные фильтры (Д9, Д10 реестра дефектов) */}
      <div className="flex items-center gap-3 flex-wrap">
        <StatusLine data={dashboardData} fd={fd} />
      </div>
      {/* Активные фильтры: раньше компонент существовал, но не был отрисован —
          выбранные управления/способ/период молча резали все числа страницы. */}
      <FilterBreadcrumb />

      {/* Полоса замечаний ПЕРЕЕХАЛА в раздел «Сигналы проверок» (канон п.132):
          на одном экране она стояла третьим домом одного факта — рядом с
          плиткой «Критические замечания» (снята) и разделом сигналов.
          Теперь замечания живут в одном месте, и оттуда же открываются
          адреса строк. */}

      {/* Год выбранный и год данных не совпали */}
      {fd.yearMismatch && (
        /* Полосу оговорки в тёмной теме держит ЗАЛИВКА, а не коричневый край:
           прежняя пара «amber-950/30 плюс рамка amber-800» давала к фону
           1,055:1 — сама заливка не читалась, и всю работу делала та самая
           коричневая рамка, на которую жаловался владелец. Янтарь на десятую
           даёт 1,135:1 при пороге 1,12:1, текст на нём — 10:1. В светлой теме
           тонкая линия остаётся: на белом разница светлот не читается. */
        <div role="status" className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-transparent rounded-xl text-sm text-amber-700 dark:text-amber-400">
          <Info size={16} aria-hidden="true" />
          <span>Все числа ниже посчитаны за <strong>{fd.dataYear}</strong> год: данных за <strong>{fd.year}</strong> год в прочитанных книгах пока нет.</span>
        </div>
      )}

      {/* 3б. Портрет управления (приказ владельца 20.08.2026): когда выбран
          один ГРБС — большая карточка на видном месте, выше ряда показателей.
          Секция вставляется в поток целой строкой, остальная сетка не рвётся. */}
      {portraitDm && (
        <DeptPortrait
          dm={portraitDm}
          scope={orgScope}
          issues={issues ?? []}
          lastRefreshed={dashboardData.lastRefreshed ?? null}
          formatMoney={formatMoney}
          navigateTo={navigateTo}
        />
      )}

      {/* 4. Ряд ключевых показателей: клик разворачивает подробности на месте */}
      <section aria-label="Ключевые показатели за выбранный период">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {heroKpis.map(kpi => (
            <HeroKPICard
              key={kpi.metricKey}
              {...kpi}
              expanded={expandedKpi === kpi.metricKey}
              onToggleExpand={() => setExpandedKpi(expandedKpi === kpi.metricKey ? null : kpi.metricKey)}
              expandContent={() => (
                <KPIExpandPanel
                  kpi={kpi}
                  depts={depts}
                  periodKey={periodKey}
                  trust={fd.trust}
                  formatMoney={formatMoney}
                  toggleDepartment={toggleDepartment}
                  navigateTo={navigateTo}
                  orgScope={orgScope}
                  portraitDm={portraitDm}
                />
              )}
            />
          ))}
        </div>
      </section>

      {/* 5. Рейтинг управлений — главный элемент страницы.
          Секция рисуется ВСЕГДА: раньше при пустой выборке она молча исчезала,
          и пользователь не мог понять, фильтры это или сбой чтения. */}
      <section className={`${CARD} rounded-2xl shadow-sm dark:shadow-none p-5 hover:shadow-lg transition-shadow duration-300`}>
        {/* flex-wrap: на 360–430px плашка периода уходит на свою строку,
            а не сплющивает заголовок (п.73а). */}
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <KBTooltip metric="dept_rank">
            <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Рейтинг управлений
            </h3>
          </KBTooltip>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-zinc-400">
              {ratingDepts.length} {deptsWord(ratingDepts.length)} в расчёте
            </span>
            {/* Канон п.58: период данных — на каждой карточке */}
            <PeriodBadge />
          </div>
        </div>
        {/* Заголовок-утверждение о данных, а не витринное название */}
        {(() => {
          // execCountPct === null значит «нечего исполнять за период» (план=0), не 0 %.
          // Не считаем такие управления отстающими — им не с чем не справляться.
          const counted = ratingDepts.filter((d) => d.execCountPct != null);
          if (ratingDepts.length === 0) return null;
          if (counted.length === 0) {
            return (
              <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-2">
                Ни у одного управления за выбранный период плана нет — исполнять нечего.
              </p>
            );
          }
          const lagging = counted.filter((d) => (d.execCountPct as number) < 50);
          if (lagging.length > 0) {
            return (
              <p className="text-xs font-medium text-amber-600 dark:text-amber-400 mb-2">
                {lagging.length} {deptsWord(lagging.length)} {pluralRu(lagging.length, 'отстаёт', 'отстают', 'отстают')} от
                графика: исполнено меньше половины запланированных процедур.
              </p>
            );
          }
          return (
            <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400 mb-2">
              Все {counted.length} {deptsWord(counted.length)} с планом идут в графике: исполнено больше половины процедур.
            </p>
          );
        })()}
        <RatingTableV2
          departments={ratingDepts}
          showSubordinates={selectedDepartments.size > 0}
          onDeptClick={(deptId) => {
            // Идентификатор строки латинский, а фильтр в состоянии хранится по
            // краткому русскому имени — переводим здесь, иначе фильтр не сойдётся.
            const dept = depts.find((d: any) => d.department?.id === deptId);
            toggleDepartment(dept?.department?.nameShort ?? productLabel(deptId));
          }}
          onDeptDetail={(deptId) => navigateTo('data', { department: deptId })}
        />
      </section>

      {/* 6. План против факта по кварталам */}
      {planFactData.some(d => d.plan > 0 || d.fact > 0) ? (
        <section className={`${CARD} rounded-2xl shadow-sm dark:shadow-none p-5 hover:shadow-lg transition-shadow duration-300`}>
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <KBTooltip metric="plan_fact_quarterly">
              <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-1">
                План против факта по кварталам
                {showStacked && <span className="text-[10px] text-zinc-400 dark:text-zinc-500 ml-2 font-normal normal-case">(конкурентные и единственный поставщик вместе)</span>}
              </h3>
            </KBTooltip>
            {/* Период отвечает «за какое время», сноска семантики — «из чего
                сложен план»: у УДТХ это лимит, у остальных НМЦК (канон п.102). */}
            <div className="flex flex-col items-end gap-1">
              <PeriodBadge />
              <PlanSemanticsNote className="justify-end text-right" />
            </div>
          </div>
          <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-4">{planFactAssertion}</p>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={planFactData} barCategoryGap="20%">
              <CartesianGrid strokeDasharray="3 3" stroke={getGridColor(isDark)} />
              <XAxis dataKey="name" fontSize={11} tick={{ fill: getAxisColor(isDark) }} />
              <YAxis fontSize={10} tickFormatter={(v: number) => formatMoney(v)} tick={{ fill: getAxisColor(isDark) }} />
              <Tooltip
                contentStyle={tooltipStyle}
                itemStyle={tooltipItemStyle}
                labelStyle={tooltipLabelStyle}
                cursor={cursorStyle}
                content={showStacked ? ({ payload, label }) => {
                  if (!payload?.length) return null;
                  const d = payload[0]?.payload;
                  if (!d) return null;
                  return (
                    <div style={tooltipStyle} className="rounded-lg p-2.5 shadow-lg text-xs">
                      <p className="font-semibold mb-1">{label}</p>
                      <p>План конкурентных: <strong>{formatMoney(d.kpPlan)}</strong></p>
                      <p>План у единственного поставщика: <strong>{formatMoney(d.epPlan)}</strong></p>
                      {/* Черта перед итогом — линейка внутри подсказки, а не
                          обводка поверхности: цвет берём из словаря зоны, чтобы
                          в тёмной теме она была тише текста (канон п.129). */}
                      <p className={`border-t ${RULE_HEAD} mt-1 pt-1`}>План всего: <strong>{formatMoney(d.plan)}</strong></p>
                      <p className="mt-1">Факт: <strong>{formatMoney(d.fact)}</strong></p>
                    </div>
                  );
                } : undefined}
                formatter={showStacked ? undefined : (v: number, name: string) => [formatMoney(v), name]}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {/* Столбцы плана НЕ оборачивать во фрагмент: recharts 2.x обходит
                  собственных детей графика и React.Fragment не разворачивает —
                  бары молча не рисовались, на экране оставалась одна линия факта,
                  хотя тултип план показывал. Условие живёт в `hide`. */}
              <Bar dataKey="kpPlan" name="План конкурентных" stackId="plan" hide={!showStacked}
                legendType={showStacked ? 'rect' : 'none'}
                fill={isDark ? '#d6bf85' : '#8f7549'} barSize={32} radius={[0, 0, 0, 0]} cursor="pointer"
                onClick={(data: any) => goToQuarter(data?.quarterKey)}
              />
              <Bar dataKey="epPlan" name="План у единственного поставщика" stackId="plan" hide={!showStacked}
                legendType={showStacked ? 'rect' : 'none'}
                fill={isDark ? '#818cf8' : '#6366f1'} barSize={32} radius={[4, 4, 0, 0]} cursor="pointer"
                onClick={(data: any) => goToQuarter(data?.quarterKey, 'single')}
              />
              <Bar dataKey="plan" name="План" hide={showStacked}
                legendType={showStacked ? 'none' : 'rect'}
                fill={isDark ? '#d6bf85' : '#8f7549'} radius={[4, 4, 0, 0]} barSize={32} cursor="pointer"
                onClick={(data: any) => goToQuarter(data?.quarterKey)}
              />

              <Line type="monotone" dataKey="fact" name="Факт" stroke={isDark ? '#34d399' : '#10b981'} strokeWidth={2.5} dot={{ r: 4, fill: isDark ? '#34d399' : '#10b981' }} />
            </ComposedChart>
          </ResponsiveContainer>
          {/* Переход по кварталу словами. Щелчок по столбцу делает то же самое,
              но мышью и без единой подписи: догадаться, что столбец кликабелен,
              было невозможно, а с клавиатуры — недостижимо вовсе. */}
          <div className="flex items-center gap-2 flex-wrap mt-3 text-[11px] text-zinc-500 dark:text-zinc-400">
            <span>Разобрать квартал в Аналитике:</span>
            {planFactData.filter(d => d.plan > 0 || d.fact > 0).map(d => (
              <button
                key={d.quarterKey}
                type="button"
                onClick={() => goToQuarter(d.quarterKey)}
                title={`Открыть Аналитику за ${d.name}: план ${formatMoney(d.plan)}, факт ${formatMoney(d.fact)}`}
                className="px-2 py-0.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              >
                {d.name}
              </button>
            ))}
          </div>
        </section>
      ) : (
        <section className={`${CARD} rounded-2xl shadow-sm dark:shadow-none p-5`}>
          <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2">
            План против факта по кварталам
          </h3>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            За выбранный период и набор фильтров ни плановых, ни фактических сумм в книгах нет —
            строить сравнение не из чего. Снимите часть фильтров или выберите другой период.
          </p>
        </section>
      )}

      {/* 7. Пара графиков: исполнение по управлениям и доли по иерархии.
          Сетка отдаёт две трети ширины столбцам и треть — кругу. */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Исполнение по управлениям */}
        <div className={`lg:col-span-2 ${CARD} rounded-2xl shadow-sm dark:shadow-none p-5 hover:shadow-lg transition-shadow duration-300`}>
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <KBTooltip metric="execution_by_dept">
              <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-1">
                Исполнение по управлениям
              </h3>
            </KBTooltip>
            <PeriodBadge />
          </div>
          <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-4">{execAssertion}</p>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={barData} layout="vertical" margin={{ left: 0 }}>
              <XAxis type="number" domain={[0, (max: number) => Math.max(100, max + 5)]} fontSize={11} tickFormatter={(v) => `${v} %`} tick={{ fill: getAxisColor(isDark) }} />
              <YAxis type="category" dataKey="name" width={65} fontSize={11} tick={{ fill: getAxisColor(isDark) }} />
              <Tooltip
                content={({ payload }) => {
                  if (!payload?.[0]?.payload) return null;
                  const d = payload[0].payload;
                  return (
                    // Явный цвет текста обязателен: тултип рендерится в обёртке
                    // recharts и наследует цвет страницы — в тёмной теме это
                    // тёмный текст на тёмной подложке (жалоба п.24-25 интервью)
                    <div className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-transparent rounded-lg p-3 shadow-lg text-xs text-zinc-700 dark:text-zinc-100">
                      <p className="font-semibold text-zinc-800 dark:text-zinc-100 mb-1">{d.name}</p>
                      {d.pct != null
                        ? <p>По сумме: <strong>{formatPercent(d.pct)}</strong>{d.pct > 100 && <span className="ml-1 text-purple-500">факт выше плана</span>}</p>
                        : <p className="text-zinc-400">По сумме: плана за период нет</p>}
                      {d.execCountPct != null
                        ? <p>По количеству: <strong>{formatPercent(d.execCountPct)}</strong></p>
                        : <p className="text-zinc-400">По количеству: плана за период нет</p>}
                      <p>План: {formatMoney(d.planTotal)}</p>
                      <p>Факт: {formatMoney(d.factTotal)}</p>
                      <p>Конкурентных: {d.kpCount}; у единственного поставщика: {d.epCount}</p>
                    </div>
                  );
                }}
                cursor={cursorStyle}
              />
              {/* Щелчок по столбцу отбирает управление. Клавиатурный путь к
                  тому же действию есть в рейтинге выше — там каждая строка
                  настоящая кнопка, поэтому дублировать его здесь не нужно. */}
              <Bar dataKey="pct" name="По сумме" radius={[0, 4, 4, 0]} maxBarSize={18}
                onClick={(data: any) => { if (data?.nameShort) toggleDepartment(data.nameShort); else if (data?.name) toggleDepartment(data.name); }}
                className="cursor-pointer"
              >
                {barData.map((d: any, i: number) => (
                  <Cell key={i} fill={getExecutionBarColor(d.pct, isDark)} />
                ))}
              </Bar>
              <Line type="monotone" dataKey="execCountPct" name="По количеству"
                stroke={isDark ? '#f59e0b' : '#d97706'} strokeWidth={2}
                dot={{ r: 3, fill: isDark ? '#f59e0b' : '#d97706' }}
              />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="flex gap-3 text-[10px] text-zinc-400 dark:text-zinc-500 mt-2 flex-wrap">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" aria-hidden="true" /> меньше 50 %</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" aria-hidden="true" /> от 50 до 80 %</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden="true" /> больше 80 %</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-500" aria-hidden="true" /> больше 100 %: факт выше плана</span>
            <span className="flex items-center gap-1 ml-2"><span className="w-3 h-0.5 bg-amber-500 rounded" aria-hidden="true" /> линия — исполнение по количеству процедур</span>
          </div>
        </div>

        {/* Круг долей с раскрытием иерархии: управление → подведомственные */}
        <DrillPieChart
          mdm={mdm}
          procurementFilter={procurementFilter}
          formatMoney={formatMoney}
          onDeptToggle={toggleDepartment}
          onNavigate={navigateTo}
        />
      </section>

      {/* Единственный дом замечаний и сигналов на Пульсе (канон п.132):
          сводка с раскрытием адресов по управлениям — бывшая полоса — и
          плитки по родам сигналов. */}
      <BlindSpotsWidget
        issues={issues ?? []}
        signalCounts={fd.signalCounts}
        criticalCount={fd.criticalIssues.length}
        warningCount={fd.warningIssues.length}
        bannerIssues={bannerIssues}
        onOpenIssues={() => navigateTo('quality', { qualityTab: 'issues' })}
        onNavigate={(category, search) => navigateTo('quality', { category, search })}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Сборка ряда ключевых показателей
// ────────────────────────────────────────────────────────────────

/** Фраза для плитки, когда считать не из чего. */
const NO_PLAN_REASON = 'Плана за период нет';

/**
 * Провенанс числа плитки: чем посчитано плюс адрес официального источника.
 * Реестр официальных метрик снимка знает по ключу базы знаний, какими строками
 * СВОДа отвечает лист. Адрес пишется ровно настолько точно, насколько он
 * известен достоверно:
 *   • одна ячейка на всю плитку — лист и ячейка;
 *   • несколько ячеек одного листа (исполнение собирается из четырёх — КП и ЕП,
 *     план и заключено) — только имя листа: п.3 интервью просил именно его,
 *     а любая одна ячейка из четырёх была бы неправдой;
 *   • ничего достоверного — только движок. Выдуманного провенанса не бывает.
 */
function tileProvenance(engine: string, kbKey: string, periodKey: string): FigureProvenance {
  const official = officialProvenanceFor(kbKey, periodKey);
  const first = official[0];
  if (!first) return { engine };
  if (official.length === 1) return { engine, source: { sheet: first.sheet, cell: first.cell } };
  return official.every((s) => s.sheet === first.sheet)
    ? { engine, source: { sheet: first.sheet } }
    : { engine };
}

function buildHeroKPIs(fd: ReturnType<typeof useFilteredData>, perimeter: Perimeter) {
  const kpis: Array<Omit<import('../components/HeroKPICard').HeroKPICardProps, 'expanded' | 'onToggleExpand' | 'expandContent'>> = [];

  // 1. Исполнение — одна плитка на два измерения: по количеству процедур
  //    (главное число) и по сумме (дополнительное).
  {
    // Доли живут числителем и знаменателем до самой печати: процент считается
    // от СУММ, а не как среднее долей управлений. Нулевой знаменатель даёт
    // `null` с причиной — как прочерк листа, а не «исполнено 0 %».
    const countRatio = ratio({
      numerator: fd.totalFactCount,
      denominator: fd.totalPlanCount,
      unit: 'шт',
      perimeter,
      provenance: tileProvenance(
        'движок: заключено ÷ план по количеству позиций',
        'exec_count_pct',
        fd.periodKey,
      ),
      nullReason: NO_PLAN_REASON,
    });
    const amountRatio = ratio({
      numerator: fd.totalFact,
      denominator: fd.totalPlan,
      unit: 'тыс.руб',
      perimeter,
      provenance: tileProvenance(
        'движок: факт ÷ план по сумме',
        'execution_pct',
        fd.periodKey,
      ),
      nullReason: NO_PLAN_REASON,
    });
    const countFigure = toPercent(countRatio);
    const amountFigure = toPercent(amountRatio);

    // Кривая, дельта и оценка состояния читают уже посчитанное значение
    // фигуры — второй формулы того же процента на плитке не существует.
    const countPct = countFigure.value;
    const amountPct = amountFigure.value;

    // Кривые по кварталам для обоих измерений. Квартал без плана даёт `null`,
    // а не ноль: прежний ноль тянул кривую на дно в кварталах, до которых год
    // ещё не дошёл, и превращал «плана не было» в «исполнено ноль процентов».
    const countSpark = QUARTER_KEYS.map(qk => {
      let pc = 0, fc = 0;
      for (const d of fd.depts) {
        const q = d.quarters?.[qk];
        if (q) { pc += q.planCount ?? 0; fc += q.factCount ?? 0; }
      }
      return quarterPct(fc, pc);
    });
    const amountSpark = QUARTER_KEYS.map(qk => {
      let pt = 0, ft = 0;
      for (const d of fd.depts) {
        const q = d.quarters?.[qk];
        if (q) { pt += q.planTotal ?? 0; ft += q.factTotal ?? 0; }
      }
      return quarterPct(ft, pt);
    });

    // Состояние — по худшему из двух ИЗВЕСТНЫХ измерений. Отсутствующее
    // измерение в оценку не входит: иначе «нет плана» читалось бы как провал.
    const known = [countPct, amountPct].filter((v): v is number => v != null);
    const worstPct = known.length > 0 ? Math.min(...known) : null;
    const execStatus = worstPct == null
      ? 'normal' as const
      : worstPct >= 80 ? 'normal' as const : worstPct >= 50 ? 'warning' as const : 'critical' as const;

    kpis.push({
      metricKey: 'exec_count_pct',
      label: 'Исполнение',
      figure: countFigure,
      // `value`/`unit` остаются для кривой, дельты и подписи точек
      // («1 кв: 62,0 %») — печатает число только `figure`.
      value: countPct ?? 0,
      unit: '%',
      status: execStatus,
      trend: countPct == null ? undefined : trendOfKnown(countSpark),
      sparkData: countSpark.some(v => v != null) ? countSpark : undefined,
      sparkLabels: QUARTER_LABELS,
      // Дополнительное измерение — исполнение по сумме
      secondaryFigure: amountFigure,
      secondaryLabel: 'по сумме',
      secondaryUnit: '%',
      secondaryMetricKey: 'execution_pct',
      secondaryTrend: amountPct == null ? undefined : trendOfKnown(amountSpark),
      secondarySparkData: amountSpark.some(v => v != null) ? amountSpark : undefined,
    });
  }

  // Плитка «Критические замечания» СНЯТА 21.08.2026 (канон п.132: «сносы
  // дублей подтверждаю»). Она показывала то же число, что полоса замечаний
  // строкой ниже и что раздел «Сигналы проверок», — три дома одного факта на
  // одном экране. Владелец: «вижу карточку критические замечания,
  // неинформативную и дублирующую частично карточку N замечаний требуют
  // решения». Единственный дом замечаний на Пульсе — раздел «Сигналы
  // проверок», куда переехала и полоса. Ряд показателей остаётся про деньги и
  // исполнение: счётная величина без знаменателя ему чужда.

  // 3. Экономия. Плитка рисуется ВСЕГДА: раньше при нулевом плане она молча
  //    исчезала, и ряд показателей менял состав без единого слова.
  {
    const economyFigure = toPercent(ratio({
      numerator: getFilteredEconomyTotal(fd),
      denominator: fd.totalPlan,
      unit: 'тыс.руб',
      perimeter,
      provenance: tileProvenance(
        'движок: экономия ÷ план по сумме',
        'economy_rate',
        fd.periodKey,
      ),
      nullReason: NO_PLAN_REASON,
    }));
    kpis.push({
      metricKey: 'economy_rate',
      label: 'Экономия',
      figure: economyFigure,
      value: economyFigure.value ?? 0,
      unit: '%',
      status: economyFigure.value != null && economyFigure.value > 25 ? 'warning' : 'normal',
    });
  }

  // 4. Доверие к данным — двоичный показатель «норма / требует проверки».
  //    Когда оценки нет, плитка НЕ рисует «Норма»: отсутствие проверки — это
  //    не пройденная проверка. Раньше пустой балл давал зелёное «Норма».
  //    Балл доверия — не штуки, не деньги, не проценты и не дни: единицы для
  //    него в контракте `Figure` намеренно нет, поэтому плитка идёт прежним
  //    путём. Периметр она объявляет наравне со всеми — правило (а) канона
  //    п.58 не знает исключений для нечисловых карточек.
  const trustScore = fd.trust?.overall ?? null;
  if (trustScore == null) {
    kpis.push({
      metricKey: 'trust_binary',
      label: 'Доверие к данным',
      value: 0,
      emptyReason: 'Оценка ещё не рассчитана',
      perimeter,
      status: 'normal',
    });
  } else {
    const trustOk = trustScore >= 75;
    kpis.push({
      metricKey: 'trust_binary',
      label: 'Доверие к данным',
      value: trustScore,
      isTrust: true,
      trustOk,
      perimeter,
      status: trustOk ? 'normal' : 'warning',
    });
  }

  return kpis;
}

// ────────────────────────────────────────────────────────────────
// Разворот плитки: подробности на месте, без окна и без ухода со страницы
// ────────────────────────────────────────────────────────────────

type HeroKPI = ReturnType<typeof buildHeroKPIs>[number];

/**
 * Единица показателя в разбивке по управлениям. Умолчание — процент; здесь
 * перечислены показатели, для которых процент был бы неправдой: замечания
 * считаются штуками, доверие — баллом из ста.
 */
const BREAKDOWN_UNITS: Record<string, string> = {
  critical_issues: '',
  trust_binary: 'из 100',
};

/** Чем подписать пустую строку разбивки — по причине пустоты, а не «нет данных». */
const BREAKDOWN_EMPTY_LABELS: Record<string, string> = {
  critical_issues: 'не посчитано',
  trust_binary: 'не оценено',
};

function KPIExpandPanel({
  kpi,
  depts,
  periodKey,
  trust,
  formatMoney,
  toggleDepartment,
  navigateTo,
  orgScope,
  portraitDm,
}: {
  kpi: HeroKPI;
  depts: any[];
  periodKey: string;
  trust: any;
  formatMoney: (v: number) => string;
  toggleDepartment: (id: string) => void;
  navigateTo: (page: Page, params?: any) => void;
  /** Режим подведов страницы (org-scope); null-безопасно по умолчанию district. */
  orgScope?: OrgScope;
  /** Метрики единственного выбранного управления — источник разбивки по подведам. */
  portraitDm?: DeptMetrics | null;
}) {
  // Разбивка по управлениям. null здесь — «нечего исполнять», а не ноль:
  // строка покажет «нет плана», а не красную полосу на нуле.
  const isDualExecution = kpi.metricKey === 'exec_count_pct';
  const deptBreakdown = depts.map((d: any) => {
    const q = d.quarters?.[periodKey];
    let value: number | null;
    let secondaryValue: number | null | undefined;
    let colorClass: string | undefined;
    let secondaryColor: string | undefined;

    if (kpi.metricKey === 'exec_count_pct') {
      // Главное измерение — исполнение по количеству процедур
      value = quarterPct(q?.factCount ?? 0, q?.planCount ?? 0);
      colorClass = value != null ? getThresholdColor('dept_exec_count_pct', value) : undefined;
      // Дополнительное измерение — исполнение по сумме
      if (isDualExecution) {
        const pt = q?.planTotal ?? d.planTotal ?? 0;
        const ft = q?.factTotal ?? d.factTotal ?? 0;
        secondaryValue = quarterPct(ft, pt);
        secondaryColor = secondaryValue != null ? getThresholdColor('dept_exec_amount_pct', secondaryValue) : undefined;
      }
    } else if (kpi.metricKey === 'critical_issues') {
      // Отсутствие счёта — не ноль замечаний. Приведение к нулю выдавало
      // «замечаний нет» у управления, которое проверки ещё не прошли.
      value = d.criticalIssueCount ?? null;
      colorClass = value != null ? getThresholdColor('critical_issues', value) : undefined;
    } else if (kpi.metricKey === 'economy_rate') {
      // Экономия — только признанная (при поднятом флаге экономии), как на
      // плитке (getFilteredEconomyTotal). Прежде здесь стояла своя формула
      // (план − факт) / план: она считает недоисполнение, а не экономию, из-за
      // чего плитка и её собственный разворот показывали разные числа.
      const pt = q?.planTotal ?? d.planTotal ?? 0;
      const economy = q?.economyTotal ?? d.economyTotal ?? 0;
      value = quarterPct(economy, pt);
    } else {
      value = d.trustScore ?? null;
      colorClass = value != null ? getThresholdColor('dept_trust', value) : undefined;
    }

    const deptId: string = d.department?.id ?? '';
    return {
      id: deptId,
      // Ключ управления переводится словарём продукта: латинский слуг в
      // подписи недопустим, а «?» ничего не объясняет.
      name: d.department?.nameShort ?? (deptId ? productLabel(deptId) : 'Управление не указано'),
      value,
      secondaryValue,
      color: colorClass,
      secondaryColor,
    };
  });

  // ── Режим подведов (org-scope): выбран один ГРБС «с подведомственными» ──
  // Карточки, где разбивка по подведам осмысленна (исполнение, экономия),
  // переходят из одной строки ГРБС в разбивку по учреждениям: аппарат первым,
  // дальше подведы. Числа — тот же слой метрик (useMultiDimMetrics), вторых
  // формул здесь нет; «нет плана» остаётся прочерком, не нулём.
  const subBreakdownApplies = ['exec_count_pct', 'economy_rate'].includes(kpi.metricKey);
  const subBreakdown = (orgScope?.mode === 'withSubs' && portraitDm && subBreakdownApplies)
    ? [
        ...(portraitDm.orgSelf ? [{ entry: portraitDm.orgSelf, label: ORG_ITSELF_LABEL, key: ORG_ITSELF_SENTINEL }] : []),
        ...portraitDm.realSubs.map((s) => ({ entry: s, label: s.displayName, key: s.name })),
      ].map(({ entry, label, key }) => {
        const m = entry.metrics;
        let value: number | null;
        let secondaryValue: number | null | undefined;
        let colorClass: string | undefined;
        let secondaryColor: string | undefined;
        if (kpi.metricKey === 'exec_count_pct') {
          value = m.execCountPct;
          colorClass = value != null ? getThresholdColor('dept_exec_count_pct', value) : undefined;
          secondaryValue = m.executionPct;
          secondaryColor = secondaryValue != null ? getThresholdColor('dept_exec_amount_pct', secondaryValue) : undefined;
        } else {
          value = m.economyPct;
        }
        return { id: key, name: label, value, secondaryValue, color: colorClass, secondaryColor };
      })
    : null;

  // Разбивка по уровням бюджета — для исполнения и экономии
  const showBudget = ['exec_count_pct', 'economy_rate'].includes(kpi.metricKey);
  let fbTotal = 0, kbTotal = 0, mbTotal = 0;
  if (showBudget) {
    for (const d of depts) {
      const q = d.quarters?.[periodKey];
      fbTotal += q?.planFB ?? 0;
      kbTotal += q?.planKB ?? 0;
      mbTotal += q?.planMB ?? 0;
    }
  }

  // Слагаемые доверия
  const showTrust = kpi.metricKey === 'trust_binary';

  // Куда ведёт кнопка перехода и как она подписана. Подпись называет цель:
  // «Подробнее →» не говорит, куда попадёт пользователь.
  const NAV_TARGETS: Record<string, { page: Page; params: any; label: string }> = {
    exec_count_pct: { page: 'analytics', params: {}, label: 'Разобрать исполнение в Аналитике' },
    critical_issues: { page: 'quality', params: { qualityTab: 'issues' }, label: 'Открыть замечания в Контроле' },
    economy_rate: { page: 'economy', params: {}, label: 'Разобрать экономию' },
    trust_binary: { page: 'quality', params: { qualityTab: 'trust' }, label: 'Открыть доверие к данным в Контроле' },
  };
  const nav = NAV_TARGETS[kpi.metricKey] ?? { page: 'analytics' as Page, params: {}, label: 'Открыть Аналитику' };

  return (
    <div className="space-y-4">
      {/* Разбивка по управлениям — либо, в режиме одного ГРБС «с
          подведомственными» (org-scope), по подведам этого управления.
          Единица зависит от показателя: доверие — балл из ста, а не процент.
          Раньше столбец подписывался «87,0 %», хотя процентом это число не
          является: шкала совпала, смысл — нет. */}
      {subBreakdown ? (
        <>
          <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            По организациям управления
          </p>
          {subBreakdown.length <= 1 && (
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              У этого управления подведомственных учреждений нет — вся разбивка
              состоит из закупок аппарата.
            </p>
          )}
          <DeptBreakdown
            departments={subBreakdown}
            unit="%"
            primaryLabel={isDualExecution ? 'Количество' : undefined}
            secondaryLabel={isDualExecution ? 'Сумма' : undefined}
            secondaryUnit="%"
            emptyLabel="нет плана"
            onDeptClick={(id) => {
              // Щелчок по организации ведёт к её строкам-основаниям в Реестре;
              // аппарат (сентинел) открывает строки управления целиком.
              navigateTo('data', id === ORG_ITSELF_SENTINEL
                ? { department: portraitDm!.deptId }
                : { department: portraitDm!.deptId, subordinate: id });
            }}
          />
        </>
      ) : (
      <DeptBreakdown
        departments={deptBreakdown}
        unit={BREAKDOWN_UNITS[kpi.metricKey] ?? '%'}
        scaleTo={kpi.metricKey === 'trust_binary' ? 100 : undefined}
        primaryLabel={isDualExecution ? 'Количество' : undefined}
        secondaryLabel={isDualExecution ? 'Сумма' : undefined}
        secondaryUnit="%"
        emptyLabel={BREAKDOWN_EMPTY_LABELS[kpi.metricKey] ?? 'нет плана'}
        onDeptClick={(id) => {
          // Разбивка отдаёт латинский идентификатор, а фильтр в состоянии
          // хранится по краткому русскому имени — переводим здесь.
          const dept = depts.find((d: any) => d.department?.id === id);
          toggleDepartment(dept?.department?.nameShort ?? productLabel(id));
        }}
      />
      )}

      {/* Разбивка по уровням бюджета */}
      {showBudget && (
        (fbTotal + kbTotal + mbTotal) > 0
          ? <BudgetBreakdown fb={fbTotal} kb={kbTotal} mb={mbTotal} formatter={formatMoney} />
          : (
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              Разбивка по уровням бюджета за период не заполнена: в книгах управлений
              федеральные, краевые и муниципальные суммы плана пусты.
            </p>
          )
      )}

      {/* Слагаемые доверия */}
      {showTrust && (trust ? (
        <TrustComponents
          components={[
            { label: 'Качество данных', score: trust.dataQuality ?? trust.data_quality ?? 0, weight: '30 %', metricKey: 'trust_data_quality' },
            { label: 'Целостность формул', score: trust.formulaIntegrity ?? trust.formula_integrity ?? 0, weight: '25 %', metricKey: 'trust_formula_integrity' },
            { label: 'Соответствие правилам', score: trust.ruleCompliance ?? trust.rule_compliance ?? 0, weight: '20 %', metricKey: 'trust_rule_compliance' },
            { label: 'Согласованность сопоставлений', score: trust.mappingConsistency ?? trust.mapping_consistency ?? 0, weight: '15 %', metricKey: 'trust_mapping_consistency' },
            { label: 'Операционные риски', score: trust.operationalRisk ?? trust.operational_risk ?? 0, weight: '10 %', metricKey: 'trust_operational_risk' },
          ]}
        />
      ) : (
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          Оценка доверия в этом снимке не рассчитана — проверки ещё не отработали
          по прочитанным книгам.
        </p>
      ))}

      {/* Переход на страницу с полным разбором */}
      {/* Линейка перед действием карточки — разделитель, а не рамка: остаётся
          в обеих темах, но тише текста (канон п.129). */}
      <div className={`flex justify-end pt-2 border-t ${RULE_HEAD}`}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            navigateTo(nav.page, nav.params);
          }}
          className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 font-medium rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        >
          {nav.label}
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Блок сигналов проверок
// ────────────────────────────────────────────────────────────────

/**
 * Подпись сигнала из словаря продукта. Словарь возвращает сам ключ, когда не
 * знает его: такую строку — латиницу — в интерфейс не пускаем и говорим прямо,
 * что подписи нет. Пользователь не должен читать имя переменной.
 */
function signalLabel(signal: string): string {
  const label = productLabel(signal);
  const untranslated = /[A-Za-z_]/.test(label) && !/[А-Яа-яЁё]/.test(label);
  return untranslated ? 'Сигнал без подписи в словаре' : label;
}

function BlindSpotsWidget({
  issues,
  signalCounts: apiSignalCounts,
  criticalCount,
  warningCount,
  bannerIssues,
  onOpenIssues,
  onNavigate,
}: {
  issues: any[];
  signalCounts?: Record<string, number>;
  /** Счёт критических замечаний — для сводки, переехавшей из полосы. */
  criticalCount: number;
  /** Счёт предупреждений — там же. */
  warningCount: number;
  /** Замечания для раскрытия по управлениям (бывшая полоса). */
  bannerIssues: any[];
  /** Переход на страницу «Контроль», раздел «Замечания». */
  onOpenIssues: () => void;
  onNavigate: (category: string, search?: string) => void;
}) {
  const signalCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const iss of issues) {
      const sig = iss.signal;
      if (sig) counts[sig] = (counts[sig] || 0) + 1;
    }
    return { ...counts, ...(apiSignalCounts ?? {}) };
  }, [apiSignalCounts, issues]);

  // Подписи карточек берутся из словаря продукта (@aemr/shared): локальные
  // сокращения вроде «Факт > план» или «Факт < план дата» расходились с тем,
  // как тот же сигнал подписан в реестре строк, и читались как формулы.
  // Два сигнала словарь пока не знает (ТД с программой, год плана) — их
  // подпись задана здесь и вынесена в отчёт как долг словаря.
  //
  // Тексты подсказок — без псевдо-кода и без букв колонок листа: колонка
  // называется своим именем из шапки книги («Способ определения поставщика»,
  // «Год (план)»), а не буквой. Буква допустима только в адресе ячейки.
  const spots = [
    { signal: 'overdue', search: 'просрочк', metricKey: 'signal_overdue', color: 'red' },
    { signal: 'economyConflict', search: 'флаг эконом', metricKey: 'signal_economy_conflict', color: 'rose' },
    { signal: 'highEconomy', search: 'высокая экономия', metricKey: 'signal_high_economy', color: 'orange' },
    // Карточки четырёх сигналов ниже METRIC_KB пока не знает — их база
    // знаний живёт объектами в kb-additions.ts рядом со страницей (п.91:
    // у каждой метрики карточка; гейт вольёт записи в METRIC_KB одним
    // проходом). Тексты согласованы с канонами интервью 14.08.2026:
    // «факт без даты» — стадия «Закупка, проводимая в течение года» (п.71),
    // «без года плана» — класс «не обеспечено финансированием» (п.23).
    {
      signal: 'earlyClosure',
      search: 'раннее закрытие',
      color: 'amber',
      kbFallback: kbCardProps(DASHBOARD_REPORT_KB_ADDITIONS.signal_early_closure),
    },
    {
      signal: 'factWithoutDate',
      search: 'факт без даты',
      color: 'purple',
      kbFallback: kbCardProps(DASHBOARD_REPORT_KB_ADDITIONS.signal_fact_without_date),
    },
    {
      signal: 'dateWithoutFact',
      search: 'факт дата без сумм',
      color: 'cyan',
      kbFallback: kbCardProps(DASHBOARD_REPORT_KB_ADDITIONS.signal_date_without_fact),
    },
    // Карточка «ТД с программой» (tdWithProgram) УДАЛЕНА каноном п.30
    // (интервью 14.08.2026): заполненная графа программы у ТД — норма,
    // сигнал снят, срез «ТД-ПМ» упразднён.
    // Вводная 06.08: сверка лимита — строки без года плана невидимы для формул
    // официального листа СВОД.
    {
      label: DASHBOARD_REPORT_KB_ADDITIONS.signal_plan_year_missing.label,
      signal: 'planYearMissing',
      search: 'без года плана',
      color: 'orange',
      kbFallback: kbCardProps(DASHBOARD_REPORT_KB_ADDITIONS.signal_plan_year_missing),
    },
    // Карточка «Подвисший контракт» (stalledContract) УДАЛЕНА: проверка
    // снята каноном п.27 (интервью 14.08.2026), детектор всегда возвращает
    // false (core/pipeline/signals.ts, const stalledContract = false) —
    // карточка вечно показывала ноль и была мертва. Возвращать только
    // вместе с воскрешением проверки в ядре.
    { signal: 'factExceedsPlan', search: 'факт превыш', metricKey: 'signal_fact_exceeds_plan', color: 'indigo' },
    { signal: 'factDateBeforePlan', search: 'факт дата раньше', metricKey: 'signal_fact_date_before_plan', color: 'teal' },
  ].map(spot => ({
    ...spot,
    // Подпись словаря продукта; локальная — только если словарь ключ не знает.
    // Если словарь вернул сам ключ (латиница), карточка подписывается честной
    // заглушкой: имя переменной на экране хуже, чем признание, что подписи нет.
    label: (spot as { label?: string }).label ?? signalLabel(spot.signal),
  })) as Array<{
    label: string;
    signal: string;
    search: string;
    metricKey?: string;
    color: string;
    kbFallback?: ReturnType<typeof kbCardProps>;
  }>;

  // Плитки сигналов. В тёмной теме их отделяет от карточки светлота той же
  // ступени, что и у словаря поверхностей (surfaces.ts, TILE — white/[0.05],
  // контраст к карточке 1,144:1); собственная обводка в тёмной теме погашена, и
  // цветная линия возвращается только под курсором — как отклик на наведение, а
  // не как постоянная рамка (канон п.129). В светлой теме тонкая цветная линия
  // остаётся: на белом фоне разница светлот не читается.
  const colorMap: Record<string, { bg: string; border: string; text: string; number: string; glow: string }> = {
    red:    { bg: 'bg-red-500/8 dark:bg-white/[0.05]', border: 'border-red-500/15 dark:border-transparent hover:border-red-500/30 dark:hover:border-red-500/25', text: 'text-red-500/80', number: 'text-red-500', glow: 'hover:shadow-red-500/10' },
    rose:   { bg: 'bg-rose-500/8 dark:bg-white/[0.05]', border: 'border-rose-500/15 dark:border-transparent hover:border-rose-500/30 dark:hover:border-rose-500/25', text: 'text-rose-500/80', number: 'text-rose-500', glow: 'hover:shadow-rose-500/10' },
    orange: { bg: 'bg-orange-500/8 dark:bg-white/[0.05]', border: 'border-orange-500/15 dark:border-transparent hover:border-orange-500/30 dark:hover:border-orange-500/25', text: 'text-orange-500/80', number: 'text-orange-500', glow: 'hover:shadow-orange-500/10' },
    amber:  { bg: 'bg-amber-500/8 dark:bg-white/[0.05]', border: 'border-amber-500/15 dark:border-transparent hover:border-amber-500/30 dark:hover:border-amber-500/25', text: 'text-amber-500/80', number: 'text-amber-500', glow: 'hover:shadow-amber-500/10' },
    purple: { bg: 'bg-purple-500/8 dark:bg-white/[0.05]', border: 'border-purple-500/15 dark:border-transparent hover:border-purple-500/30 dark:hover:border-purple-500/25', text: 'text-purple-500/80', number: 'text-purple-500', glow: 'hover:shadow-purple-500/10' },
    cyan:   { bg: 'bg-cyan-500/8 dark:bg-white/[0.05]', border: 'border-cyan-500/15 dark:border-transparent hover:border-cyan-500/30 dark:hover:border-cyan-500/25', text: 'text-cyan-500/80', number: 'text-cyan-500', glow: 'hover:shadow-cyan-500/10' },
    blue:   { bg: 'bg-blue-500/8 dark:bg-white/[0.05]', border: 'border-blue-500/15 dark:border-transparent hover:border-blue-500/30 dark:hover:border-blue-500/25', text: 'text-blue-500/80', number: 'text-blue-500', glow: 'hover:shadow-blue-500/10' },
    indigo: { bg: 'bg-indigo-500/8 dark:bg-white/[0.05]', border: 'border-indigo-500/15 dark:border-transparent hover:border-indigo-500/30 dark:hover:border-indigo-500/25', text: 'text-indigo-500/80', number: 'text-indigo-500', glow: 'hover:shadow-indigo-500/10' },
    teal:   { bg: 'bg-teal-500/8 dark:bg-white/[0.05]', border: 'border-teal-500/15 dark:border-transparent hover:border-teal-500/30 dark:hover:border-teal-500/25', text: 'text-teal-500/80', number: 'text-teal-500', glow: 'hover:shadow-teal-500/10' },
  };

  const totalSpots = spots.reduce((s, c) => s + (signalCounts[c.signal] || 0), 0);

  // Заголовок-утверждение: называем самый частый сигнал, а не «Сигналы и
  // аномалии». Считается по тем же числам, что нарисованы на карточках.
  const leader = spots.reduce<{ label: string; count: number } | null>((best, spot) => {
    const count = signalCounts[spot.signal] || 0;
    return count > (best?.count ?? 0) ? { label: spot.label, count } : best;
  }, null);
  const assertion = totalSpots === 0
    ? 'Проверки прошли чисто: по текущему состоянию книг ни одного сигнала.'
    : leader
      ? `Чаще всего срабатывает «${leader.label}» — ${leader.count} ${pluralRu(leader.count, 'строка', 'строки', 'строк')} из ${totalSpots}.`
      : '';

  return (
    <section className={`${CARD} rounded-2xl shadow-sm dark:shadow-none p-5`}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <KBTooltip
            whatIs="Сигналы — отклонения в данных закупок, которые находит автоматическая проверка: просрочки, спорные флаги экономии, расхождения плана и факта. За каждым сигналом стоит своё правило из реестра проверок продукта."
            thresholdsFull={'🔴 просрочки и конфликт флага экономии — критические\n🟡 факт без даты и раннее закрытие — предупреждения\n🟢 ноль сигналов — данные чистые'}
            example="9 просрочек, 3 конфликта флага экономии, 1 строка с фактом выше плана"
            actions="Щелчок по карточке открывает страницу «Контроль» с отбором строк по этому сигналу."
          >
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Сигналы проверок
            </h2>
          </KBTooltip>
          <span
            className="text-[9px] px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 font-bold tabular-nums"
            title={`Всего срабатываний: ${totalSpots}`}
          >
            {totalSpots}
          </span>
        </div>
      </div>
      {/* Периметр блока — собственной подписью (канон п.58): сигналы считаются
          по строкам книг на момент последнего чтения; выбор периода в шапке
          их не сужает, поэтому унаследованный бейдж периода здесь запрещён. */}
      <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mb-2">
        Проверки всех строк книг · на момент последнего чтения · выбор периода в шапке на сигналы не действует
      </p>
      <p className={`text-xs font-medium mb-3 ${totalSpots === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-600 dark:text-zinc-300'}`}>
        {assertion}
      </p>

      {/* Сводка замечаний — бывшая отдельная полоса над страницей. Стоит
          внутри раздела, потому что говорит о том же: сколько строк книг
          требуют решения и каких. Раскрытие по управлениям и переход в
          «Контроль» живут прямо здесь. */}
      <div className="mb-4">
        <CriticalBannerV2
          criticalCount={criticalCount}
          warningCount={warningCount}
          issues={bannerIssues}
          onNavigate={onOpenIssues}
        />
      </div>
      {/* Девять карточек; подписи из словаря длиннее прежних сокращений —
          сетка расширена по ширине экрана. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
        {spots.map(spot => {
          const count = signalCounts[spot.signal] || 0;
          const colors = colorMap[spot.color] ?? colorMap.blue;
          const isActive = count > 0;
          // Неактивная карточка честно говорит, почему по ней нельзя перейти,
          // а не просто гаснет.
          const hint = isActive
            ? `Показать строки «${spot.label}» на странице «Контроль»`
            : `«${spot.label}»: в книгах сейчас таких строк нет — переходить не к чему`;
          return (
            <KBTooltip
              key={spot.signal}
              metric={spot.metricKey}
              {...(spot.kbFallback ?? {})}
            >
              {/* Карточка без срабатываний не выключается через `disabled`:
                  выключенная кнопка выпадает из обхода клавиатурой и не отдаёт
                  ни подсказки, ни всплывающего окна базы знаний — объяснение
                  «почему сюда нельзя перейти» становилось недоступно как раз
                  тем, кому оно нужнее всего. Вместо этого — `aria-disabled`
                  и пустой переход. */}
              <button
                type="button"
                onClick={() => { if (isActive) onNavigate(spot.signal, spot.search); }}
                aria-disabled={!isActive}
                aria-label={isActive
                  ? `${spot.label}: ${count} ${pluralRu(count, 'строка', 'строки', 'строк')}. Открыть на странице «Контроль»`
                  : `${spot.label}: срабатываний нет`}
                title={hint}
                className={`
                  ${colors.bg} border ${colors.border} rounded-xl p-3 text-left
                  transition-all duration-200 w-full
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400
                  ${isActive
                    ? `cursor-pointer hover:scale-[1.03] active:scale-[0.98] hover:shadow-lg ${colors.glow}`
                    : 'opacity-40 cursor-default'}
                `}
              >
                <div className={`text-xl font-bold tabular-nums leading-none ${isActive ? colors.number : 'text-zinc-300 dark:text-zinc-700'}`}>
                  {count}
                </div>
                <div className={`text-[10px] font-medium mt-1.5 leading-tight ${isActive ? colors.text : 'text-zinc-300 dark:text-zinc-600'}`}>
                  {spot.label}
                </div>
              </button>
            </KBTooltip>
          );
        })}
      </div>
    </section>
  );
}
