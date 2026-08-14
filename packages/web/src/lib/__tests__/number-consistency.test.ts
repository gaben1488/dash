import { describe, expect, it } from 'vitest';
import { computeFilteredData } from '../../hooks/useFilteredData';
import { buildMultiDimMetricsFromFilteredData } from '../../hooks/useMultiDimMetrics';
import { recalcTotalsByActivity } from '../selectors/activity-aggregation';
import { activePeriodKeys } from '../selectors/period-resolution';
import { makeBudgetPlanFact } from '../selectors/budget-filter';
import type { DashboardData } from '@aemr/shared';
import type { PeriodMode, PeriodScope, YearFilter } from '../../store';

/**
 * ПРИЁМОЧНЫЙ ХАРНЕСС «ЭКРАН = ДВИЖОК».
 *
 * Экран дашборда собирается из семи блоков (плитки, ряды графика план/факт,
 * пирог способов, экономия, бюджеты, разбивка по видам деятельности, карточки
 * управлений), и каждый блок ходит в данные своей дорогой. Пока дороги ведут в
 * одно место, читатель видит согласованную картину; стоит одной свернуть —
 * на экране появляются числа, которые нельзя сложить друг с другом. Интервью
 * 14.08 (кластер А, пп. 5-6, 11-12, 17-20) — это ровно такие расхождения,
 * увиденные глазами исполнителя, а канон п.58 требует, чтобы у каждой карточки
 * периметр был объявлен и соблюдён.
 *
 * Харнесс устроен так: сначала строится построчная правда (18 синтетических
 * строк закупок с управлением, подведом, кварталом, месяцем, способом, видом
 * деятельности, тремя бюджетами плана и факта и подтверждённой экономией), из
 * неё собирается фикстура дашборда ровно той формы, что отдаёт роут
 * `/api/dashboard`, а затем по матрице состояний
 *
 *     {2026, all} × {год, q1..q4, месяцы 3-5, неделя}
 *                 × {все органы, один ГРБС, ГРБС+подвед}
 *                 × {все способы, ЕП, КП}                     = 144 состояния
 *
 * каждое число экрана сверяется с независимым пересчётом ТЕХ ЖЕ строк.
 * Расхождение печатается тройкой «состояние · блок · ожидалось/получено».
 *
 * Правило фикстуры: она внутренне непротиворечива по построению (год = сумма
 * кварталов, итог = ФБ+КБ+МБ, всего = КП+ЕП, всего = ПМ+ТД). Поэтому любое
 * расхождение здесь — дефект слоя отображения, а не спор с листом СВОД.
 * Известные развилки «оба неверны» (реестр расхождений §5) в фикстуру не
 * заводятся: их место — разбор на живых данных, а не приёмка экрана.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * КАК ЧИТАТЬ ЭТОТ ФАЙЛ (структура после разбора 14.08.2026)
 *
 * Первый прогон харнесса был красным: он и писался как реестр дефектов. Но
 * красный файл ничего не стережёт — он одинаково молчит и когда дефект на
 * месте, и когда рядом сломали что-то ещё. Поэтому каждая проверка разрезана
 * по той оси, на которой лежит дефект:
 *
 *   • проверка без пометки «ДОЛГ» — периметры БЕЗ известного долга. Это гейт:
 *     он зелёный и обязан таким остаться. Любая правка, уронившая его, —
 *     регресс.
 *   • проверка с пометкой «ДОЛГ» — периметры с известным долгом (классы
 *     Д-А…Д-Е ниже). Она написана наоборот: требует, чтобы нарушения ЕЩЁ
 *     были. Красная «ДОЛГ»-проверка означает «долг закрыт — перенеси
 *     состояния в гейт», а не поломку.
 *
 * Разрез не выдуман: замер 14.08 показал, что нарушения ложатся ровно на три
 * оси — фильтр способа, фильтр подведов, выбор месяцев. Ни одно нарушение не
 * приходится на состояния без них: дефолт «2026 · весь год · все управления»
 * и чистые кварталы сходятся полностью.
 *
 * ЧТО ЛЕЖИТ В ДОЛГЕ И ПОЧЕМУ ЭТО НЕ ЧИНИТСЯ ЗДЕСЬ
 *
 * Общая причина у Д-А…Д-Д одна: движок не отдаёт нужный разрез. Разбивки по
 * способу нет ни у подведов по периодам (`SubPeriodMetrics`), ни у бюджетов
 * (`planFB/KB/MB` существуют только суммарно, без деления КП/ЕП), а разбивки
 * по видам деятельности нет по месяцам (`byActivity` живёт на кварталах и
 * годе). Слой отображения не может показать срез, которого нет в данных, —
 * поэтому долг закрывается в движке (calc-engine-adapter.ts: кросс-разрезы
 * способ×период×подвед и способ×бюджет, byActivity по месяцам), а не
 * подкруткой селекторов. Канон п.55 такую переработку прямо разрешает.
 *
 *  Д-А. Фильтр способа (КП/ЕП) не доходит до денег бюджетной разбивки и
 *       бар-чарта управлений. Плитка «План» делится по способу
 *       (`totals-aggregation.ts` addMoney, kpPlanTotal/epPlanTotal), а
 *       `addBudget` внутри addCommon (:217) и обе денежные ветви
 *       `bar-data.ts` (:85, :104) складывают оба способа. На экране: КП
 *       1 540 в плитке против 2 135 в сумме ФБ+КБ+МБ и в столбцах.
 *  Д-Б. Тот же фильтр способа не доходит до подведов (`SubPeriodMetrics`
 *       разбивки по способу не несёт вовсе) и до экономии
 *       (`economy-metrics.ts` о способе не знает). Раскрытие управления по
 *       подведам под фильтром КП/ЕП показывает полные суммы.
 *  Д-В. Под фильтром подведов счётчики КП/ЕП берутся ГОДОВЫЕ независимо от
 *       выбранного периода (`totals-aggregation.ts` :178-179, помечено в коде
 *       как «честный годовой фолбэк»). Пирог способов при выбранном q1
 *       рисует год — ровно бейдж-который-врёт из интервью пп. 18-19.
 *  Д-Г. Под фильтром подведов деньги игнорируют фильтр способа: спред
 *       `...(d.quarters[qk] ?? {})` в `subordinate-override.ts` (:77) оставляет
 *       в квартале узла kp/ep-поля УПРАВЛЕНИЯ, а `stripMethodFields` чистит их
 *       только внутри aggregateNodeTotals.
 *  Д-Д. График план/факт под фильтром подведов рисует УПРАВЛЕНИЕ:
 *       `recalcSummaryByPeriod` (:54-61) читает те же непочищенные
 *       kpPlanTotal/epPlanTotal из оверрайднутого квартала. Незакрытый хвост
 *       бага #4: плитки уже показывают подвед, график ещё управление.
 *  Д-Е. Разбивка по видам деятельности живёт на своём периметре: `byActivity`
 *       подвед-оверрайдом не пересчитывается (показывает управление) и при
 *       выборе месяцев читает ЦЕЛЫЕ покрытые кварталы
 *       (`activePeriodKeys` → coveredQuarters), пока плитки считают месяцы.
 *  Д-Ж. ЗАКРЫТО 14.08. Нулевой знаменатель на слое карточек давал 0 %, а не
 *       «нет базы»: `useMultiDimMetrics.safePct` возвращал 0. Это тот самый
 *       вход в «8 управлений отстают от графика» при прочерках (пп. 14-16) и
 *       дефект §2 реестра расхождений «Ноль вместо „нет базы“». Теперь
 *       `safePct` отдаёт `null`, поля процентов `ExecutionMetrics` нullable,
 *       а квартальная дельта считается только когда план был в ОБОИХ
 *       кварталах. Проверка ниже — обычный гейт, не долг.
 *
 * Каждый провал печатает состояние, блок и пару ожидалось/получено.
 * ─────────────────────────────────────────────────────────────────────────
 */

// ────────────────────────────────────────────────────────────
// 1. Построчная правда
// ────────────────────────────────────────────────────────────

type Method = 'kp' | 'ep';
/** Канон п.30 (интервью 14.08): видов деятельности ровно два — ПМ и ТД. */
type Activity = 'pm' | 'td';
type Budgets = readonly [fb: number, kb: number, mb: number];

interface Row {
  dept: string;
  sub: string;
  quarter: 1 | 2 | 3 | 4;
  month: number;
  method: Method;
  activity: Activity;
  plan: Budgets;
  /** null — контракт не заключён (нет даты факта): строка живёт в плане, не в факте. */
  fact: Budgets | null;
  /** Подтверждённая флагом AD экономия (Z+AA+AB), а не «план − факт». */
  economy: Budgets;
}

const ROWS: Row[] = [
  // ── I квартал ──
  { dept: 'УО', sub: '_org_itself', quarter: 1, month: 1, method: 'kp', activity: 'pm', plan: [100, 50, 25], fact: [90, 45, 20], economy: [10, 5, 5] },
  { dept: 'УО', sub: 'МБОУ №1', quarter: 1, month: 2, method: 'ep', activity: 'td', plan: [0, 30, 70], fact: [0, 28, 66], economy: [0, 2, 4] },
  { dept: 'УО', sub: 'МБДОУ №2', quarter: 1, month: 3, method: 'kp', activity: 'td', plan: [40, 0, 60], fact: null, economy: [0, 0, 0] },
  { dept: 'УЭР', sub: '_org_itself', quarter: 1, month: 3, method: 'ep', activity: 'pm', plan: [15, 15, 15], fact: [15, 15, 10], economy: [0, 0, 5] },
  // ── II квартал ──
  { dept: 'УО', sub: '_org_itself', quarter: 2, month: 4, method: 'kp', activity: 'td', plan: [200, 0, 0], fact: [180, 0, 0], economy: [20, 0, 0] },
  { dept: 'УО', sub: 'МБОУ №1', quarter: 2, month: 5, method: 'ep', activity: 'pm', plan: [0, 0, 120], fact: [0, 0, 111], economy: [0, 0, 9] },
  { dept: 'УО', sub: 'МБДОУ №2', quarter: 2, month: 6, method: 'kp', activity: 'pm', plan: [35, 35, 30], fact: [35, 35, 30], economy: [0, 0, 0] },
  { dept: 'УЭР', sub: 'МКУ ЦБ', quarter: 2, month: 4, method: 'kp', activity: 'td', plan: [0, 90, 10], fact: null, economy: [0, 0, 0] },
  { dept: 'УЭР', sub: '_org_itself', quarter: 2, month: 5, method: 'ep', activity: 'td', plan: [70, 0, 0], fact: [63, 0, 0], economy: [7, 0, 0] },
  // ── III квартал ──
  { dept: 'УО', sub: '_org_itself', quarter: 3, month: 7, method: 'kp', activity: 'pm', plan: [300, 100, 50], fact: [290, 95, 45], economy: [10, 5, 5] },
  { dept: 'УО', sub: 'МБОУ №1', quarter: 3, month: 8, method: 'kp', activity: 'td', plan: [0, 0, 80], fact: [0, 0, 80], economy: [0, 0, 0] },
  { dept: 'УО', sub: 'МБДОУ №2', quarter: 3, month: 9, method: 'ep', activity: 'td', plan: [25, 25, 0], fact: null, economy: [0, 0, 0] },
  { dept: 'УЭР', sub: '_org_itself', quarter: 3, month: 8, method: 'ep', activity: 'pm', plan: [0, 55, 45], fact: [0, 50, 40], economy: [0, 5, 5] },
  { dept: 'УЭР', sub: 'МКУ ЦБ', quarter: 3, month: 9, method: 'kp', activity: 'pm', plan: [120, 0, 0], fact: [110, 0, 0], economy: [10, 0, 0] },
  // ── IV квартал ──
  { dept: 'УО', sub: '_org_itself', quarter: 4, month: 10, method: 'ep', activity: 'td', plan: [10, 20, 30], fact: null, economy: [0, 0, 0] },
  { dept: 'УО', sub: 'МБОУ №1', quarter: 4, month: 11, method: 'kp', activity: 'pm', plan: [150, 0, 0], fact: [140, 0, 0], economy: [10, 0, 0] },
  { dept: 'УЭР', sub: '_org_itself', quarter: 4, month: 12, method: 'kp', activity: 'td', plan: [0, 0, 65], fact: [0, 0, 60], economy: [0, 0, 5] },
  { dept: 'УЭР', sub: 'МКУ ЦБ', quarter: 4, month: 10, method: 'ep', activity: 'pm', plan: [45, 5, 0], fact: [45, 5, 0], economy: [0, 0, 0] },
];

const DEPT_META: Record<string, { id: string; name: string }> = {
  'УО': { id: 'uo', name: 'Управление образования' },
  'УЭР': { id: 'uer', name: 'Управление экономического развития' },
};
const DEPT_ORDER = ['УО', 'УЭР'];
const SUBS_MAP: Record<string, string[]> = {
  'УО': ['_org_itself', 'МБОУ №1', 'МБДОУ №2'],
  'УЭР': ['_org_itself', 'МКУ ЦБ'],
};

// ────────────────────────────────────────────────────────────
// 2. Независимый пересчёт по строкам (эталон)
// ────────────────────────────────────────────────────────────

interface Agg {
  planTotal: number; factTotal: number;
  planCount: number; factCount: number;
  kpCount: number; epCount: number;
  kpFactCount: number; epFactCount: number;
  kpPlanTotal: number; kpFactTotal: number;
  epPlanTotal: number; epFactTotal: number;
  planFB: number; planKB: number; planMB: number;
  factFB: number; factKB: number; factMB: number;
  economyTotal: number; economyFB: number; economyKB: number; economyMB: number;
}

function emptyAgg(): Agg {
  return {
    planTotal: 0, factTotal: 0, planCount: 0, factCount: 0,
    kpCount: 0, epCount: 0, kpFactCount: 0, epFactCount: 0,
    kpPlanTotal: 0, kpFactTotal: 0, epPlanTotal: 0, epFactTotal: 0,
    planFB: 0, planKB: 0, planMB: 0, factFB: 0, factKB: 0, factMB: 0,
    economyTotal: 0, economyFB: 0, economyKB: 0, economyMB: 0,
  };
}

/** Эталонная свёртка набора строк — единственный источник «ожидалось». */
function agg(rows: Row[]): Agg {
  const a = emptyAgg();
  for (const r of rows) {
    const [pf, pk, pm] = r.plan;
    const plan = pf + pk + pm;
    const [ff, fk, fm] = r.fact ?? [0, 0, 0];
    const fact = ff + fk + fm;
    a.planCount += 1;
    a.planTotal += plan;
    a.planFB += pf; a.planKB += pk; a.planMB += pm;
    if (r.fact) {
      a.factCount += 1;
      a.factTotal += fact;
      a.factFB += ff; a.factKB += fk; a.factMB += fm;
    }
    if (r.method === 'kp') {
      a.kpCount += 1;
      a.kpPlanTotal += plan;
      if (r.fact) { a.kpFactCount += 1; a.kpFactTotal += fact; }
    } else {
      a.epCount += 1;
      a.epPlanTotal += plan;
      if (r.fact) { a.epFactCount += 1; a.epFactTotal += fact; }
    }
    const [ef, ek, em] = r.economy;
    a.economyFB += ef; a.economyKB += ek; a.economyMB += em;
    a.economyTotal += ef + ek + em;
  }
  return a;
}

const pct1 = (num: number, den: number): number | null =>
  den > 0 ? +((num / den) * 100).toFixed(1) : null;

// ────────────────────────────────────────────────────────────
// 3. Сборка фикстуры дашборда (форма роута /api/dashboard)
// ────────────────────────────────────────────────────────────

const QUARTER_KEYS = ['q1', 'q2', 'q3', 'q4'] as const;

/** Квартал/месяц управления — форма роута: со счётчиками и деньгами по способу. */
function periodBlock(rows: Row[]): Record<string, number | null> {
  const a = agg(rows);
  return {
    ...a,
    executionPct: pct1(a.factTotal, a.planTotal),
    execCountPct: pct1(a.factCount, a.planCount),
  };
}

/**
 * Квартал/месяц ПОДВЕДА — форма `SubPeriodMetrics` (calc-engine-adapter.ts):
 * разбивки по способу у подведов НЕТ. Это не упрощение фикстуры, а факт слоя
 * данных, и именно из него растут расхождения подвед-срезов.
 */
function subPeriodBlock(rows: Row[]): Record<string, number | null> {
  const a = agg(rows);
  return {
    planCount: a.planCount, factCount: a.factCount,
    planTotal: a.planTotal, factTotal: a.factTotal,
    planFB: a.planFB, planKB: a.planKB, planMB: a.planMB,
    factFB: a.factFB, factKB: a.factKB, factMB: a.factMB,
    economyTotal: a.economyTotal,
    economyFB: a.economyFB, economyKB: a.economyKB, economyMB: a.economyMB,
    executionPct: pct1(a.factTotal, a.planTotal),
    execCountPct: pct1(a.factCount, a.planCount),
  };
}

function activityBlock(rows: Row[]) {
  const of = (kind: Activity) => {
    const a = agg(rows.filter(r => r.activity === kind));
    return {
      planCount: a.planCount, factCount: a.factCount,
      planTotal: a.planTotal, factTotal: a.factTotal,
      planFB: a.planFB, planKB: a.planKB, planMB: a.planMB,
      factFB: a.factFB, factKB: a.factKB, factMB: a.factMB,
      economyTotal: a.economyTotal,
      economyFB: a.economyFB, economyKB: a.economyKB, economyMB: a.economyMB,
      execCountPct: pct1(a.factCount, a.planCount),
    };
  };
  const zero = of('pm');
  return {
    program: of('pm'),
    // Канон п.30: значение больше не выдаётся — вид деятельности ровно два.
    current_program: Object.fromEntries(Object.keys(zero).map(k => [k, 0])),
    current_non_program: of('td'),
  };
}

function subEntry(name: string, rows: Row[]) {
  const a = agg(rows);
  const quarters: Record<string, unknown> = {};
  for (const qk of QUARTER_KEYS) {
    quarters[qk] = subPeriodBlock(rows.filter(r => `q${r.quarter}` === qk));
  }
  const months: Record<number, unknown> = {};
  for (let mi = 1; mi <= 12; mi++) {
    const mr = rows.filter(r => r.month === mi);
    if (mr.length > 0) months[mi] = subPeriodBlock(mr);
  }
  return {
    name,
    rowCount: rows.length,
    planTotal: a.planTotal, factTotal: a.factTotal,
    planFB: a.planFB, planKB: a.planKB, planMB: a.planMB,
    factFB: a.factFB, factKB: a.factKB, factMB: a.factMB,
    executionPct: pct1(a.factTotal, a.planTotal),
    execCountPct: pct1(a.factCount, a.planCount),
    competitiveCount: a.kpCount,
    epCount: a.epCount,
    economyTotal: a.economyTotal,
    economyFB: a.economyFB, economyKB: a.economyKB, economyMB: a.economyMB,
    quarters, months,
  };
}

function buildDashboardData() {
  const departmentSummaries = DEPT_ORDER.map(short => {
    const deptRows = ROWS.filter(r => r.dept === short);
    const a = agg(deptRows);

    const quarters: Record<string, unknown> = {};
    for (const qk of QUARTER_KEYS) {
      quarters[qk] = periodBlock(deptRows.filter(r => `q${r.quarter}` === qk));
    }
    // Роут отдаёт и ключ 'year' — год как отдельная строка сетки.
    quarters.year = periodBlock(deptRows);

    const months: Record<number, unknown> = {};
    for (let mi = 1; mi <= 12; mi++) {
      const mr = deptRows.filter(r => r.month === mi);
      if (mr.length > 0) months[mi] = periodBlock(mr);
    }

    const byActivity: Record<string, unknown> = {};
    for (const qk of QUARTER_KEYS) {
      byActivity[qk] = activityBlock(deptRows.filter(r => `q${r.quarter}` === qk));
    }
    byActivity.year = activityBlock(deptRows);

    return {
      department: { id: DEPT_META[short].id, nameShort: short, name: DEPT_META[short].name },
      planTotal: a.planTotal,
      factTotal: a.factTotal,
      executionPercent: pct1(a.factTotal, a.planTotal),
      economyTotal: a.economyTotal,
      economyFB: a.economyFB, economyKB: a.economyKB, economyMB: a.economyMB,
      competitiveCount: a.kpCount,
      soleCount: a.epCount,
      issueCount: 0, criticalIssueCount: 0, trustScore: 100,
      status: 'normal' as const,
      quarters, months, byActivity,
      subordinates: SUBS_MAP[short].map(s => subEntry(s, deptRows.filter(r => r.sub === s))),
      signalCounts: {},
      economyConflicts: 0,
    };
  });

  const summaryByPeriod: Record<string, unknown> = {};
  for (const pk of [...QUARTER_KEYS, 'year'] as const) {
    const rows = pk === 'year' ? ROWS : ROWS.filter(r => `q${r.quarter}` === pk);
    const a = agg(rows);
    summaryByPeriod[pk] = {
      kpCount: a.kpCount, kpFactCount: a.kpFactCount, kpPlan: a.kpPlanTotal, kpFact: a.kpFactTotal,
      kpPercent: a.kpCount > 0 ? a.kpFactCount / a.kpCount : 0,
      epCount: a.epCount, epFactCount: a.epFactCount, epPlan: a.epPlanTotal, epFact: a.epFactTotal,
      epPercent: a.epCount > 0 ? a.epFactCount / a.epCount : 0,
      fbPlan: a.planFB, kbPlan: a.planKB, mbPlan: a.planMB,
      fbFact: a.factFB, kbFact: a.factKB, mbFact: a.factMB,
      source: 'calculated' as const,
    };
  }

  return {
    departmentSummaries,
    summaryByPeriod,
    kpiCards: [],
    recentIssues: [],
    signalCounts: {},
    trust: null,
    snapshot: { issues: [], deltas: [] },
    year: 2026,
  };
}

const DASHBOARD = buildDashboardData();

// ────────────────────────────────────────────────────────────
// 4. Матрица состояний
// ────────────────────────────────────────────────────────────

interface PeriodState {
  label: string;
  period: PeriodScope;
  months: number[];
  mode: PeriodMode;
  /** Строчный предикат периода — эталон считает по нему, а не по коду экрана. */
  rows: (r: Row) => boolean;
}

const PERIOD_STATES: PeriodState[] = [
  { label: 'весь год', period: 'year', months: [], mode: 'explicit', rows: () => true },
  { label: 'q1', period: 'q1', months: [], mode: 'explicit', rows: r => r.quarter === 1 },
  { label: 'q2', period: 'q2', months: [], mode: 'explicit', rows: r => r.quarter === 2 },
  { label: 'q3', period: 'q3', months: [], mode: 'explicit', rows: r => r.quarter === 3 },
  { label: 'q4', period: 'q4', months: [], mode: 'explicit', rows: r => r.quarter === 4 },
  { label: 'месяцы 3-5', period: 'year', months: [3, 4, 5], mode: 'explicit', rows: r => r.month >= 3 && r.month <= 5 },
  // Неделя: месяцы недели легаси-писателями попадают в activeMonths, но фильтром
  // не являются (баг #5) — периметр обязан остаться годовым.
  { label: 'неделя (мес. 8 в week-режиме)', period: 'year', months: [8], mode: 'week', rows: () => true },
];

interface OrgState {
  label: string;
  depts: string[];
  subs: string[];
  rows: (r: Row) => boolean;
}

const ORG_STATES: OrgState[] = [
  { label: 'все органы', depts: [], subs: [], rows: () => true },
  { label: 'один ГРБС (УО)', depts: ['УО'], subs: [], rows: r => r.dept === 'УО' },
  { label: 'ГРБС+подвед (УО · МБОУ №1)', depts: ['УО'], subs: ['МБОУ №1'], rows: r => r.dept === 'УО' && r.sub === 'МБОУ №1' },
];

interface MethodState {
  label: string;
  methods: string[];
  rows: (r: Row) => boolean;
}

const METHOD_STATES: MethodState[] = [
  { label: 'все способы', methods: [], rows: () => true },
  { label: 'ЕП', methods: ['single'], rows: r => r.method === 'ep' },
  { label: 'КП', methods: ['competitive'], rows: r => r.method === 'kp' },
];

const YEAR_STATES: YearFilter[] = [2026, 'all'];

interface State {
  label: string;
  year: YearFilter;
  p: PeriodState;
  o: OrgState;
  m: MethodState;
}

function allStates(): State[] {
  const out: State[] = [];
  for (const year of YEAR_STATES) {
    for (const p of PERIOD_STATES) {
      for (const o of ORG_STATES) {
        for (const m of METHOD_STATES) {
          out.push({ label: `год ${year} · ${p.label} · ${o.label} · ${m.label}`, year, p, o, m });
        }
      }
    }
  }
  return out;
}

function inputsFor(s: State) {
  return {
    // Фикстура несёт ровно те поля, что читает расчёт; остальное в DashboardData
    // (issueSummary, lastRefreshed и пр.) к числам экрана отношения не имеет.
    dashboardData: DASHBOARD as unknown as DashboardData,
    selectedDepartments: new Set(s.o.depts),
    selectedSubordinates: new Set(s.o.subs),
    deptOnlyMode: new Set<string>(),
    subordinatesMap: SUBS_MAP,
    period: s.p.period,
    activeMonths: new Set(s.p.months),
    periodMode: s.p.mode,
    selectedMethods: new Set(s.m.methods),
    selectedActivities: new Set<string>(),
    selectedBudgets: new Set<string>(),
    activityFilter: 'all' as const,
    searchQuery: '',
    year: s.year,
    dataYear: 2026,
    loading: false,
  };
}

/** Сумма столбца бар-чарта — единственное место, где читается его форма. */
interface BarDatum { planTotal?: number; factTotal?: number }
function sumBars(bars: unknown[], field: 'planTotal' | 'factTotal'): number {
  return (bars as BarDatum[]).reduce((acc, b) => acc + (b[field] ?? 0), 0);
}

/** Экран состояния: всё, что читают блоки дашборда, одним пакетом. */
function screen(s: State) {
  const fd = computeFilteredData(inputsFor(s));
  const mdm = buildMultiDimMetricsFromFilteredData(fd);
  return { fd, mdm };
}

/** Эталон: строки состояния без фильтра способа и с ним. */
function reference(s: State) {
  const base = ROWS.filter(r => s.p.rows(r) && s.o.rows(r));
  return { all: agg(base), byMethod: agg(base.filter(s.m.rows)), rows: base };
}

// ────────────────────────────────────────────────────────────
// 5. Протокол провала: состояние · блок · ожидалось/получено
// ────────────────────────────────────────────────────────────

const EPS = 1e-6;
/**
 * Сколько нарушений печатать. Один дефект периметра даёт сотню строк матрицы;
 * читателю нужны первые примеры и общий счёт, а не простыня.
 */
const PRINT_LIMIT = 12;

class Report {
  private readonly lines: string[] = [];
  private count = 0;

  private add(state: string, block: string, expected: unknown, got: unknown): void {
    this.count += 1;
    if (this.lines.length < PRINT_LIMIT) {
      this.lines.push(
        `\nСОСТОЯНИЕ: ${state}\n  БЛОК:      ${block}\n  ожидалось: ${String(expected)}\n  получено:  ${String(got)}`,
      );
    }
  }

  /** Сверка с эталоном: `null` = «нет базы», и ноль его не заменяет. */
  eq(state: string, block: string, expected: number | null, got: unknown): void {
    const ok = expected === null
      ? got === null
      : typeof got === 'number' && Math.abs(got - expected) <= EPS;
    if (!ok) this.add(state, block, expected, got);
  }

  /** Сверка двух блоков экрана между собой (инвариант одного периметра). */
  same(state: string, block: string, left: number, right: number): void {
    if (Math.abs(left - right) > EPS) this.add(state, block, left, right);
  }

  /** Пустая строка = нарушений нет; иначе vitest печатает протокол. */
  toString(): string {
    if (this.count === 0) return '';
    const tail = this.count > PRINT_LIMIT ? `\n… и ещё ${this.count - PRINT_LIMIT} того же вида\n` : '\n';
    return `${this.count} нарушений:${this.lines.join('')}${tail}`;
  }
}

const STATES = allStates();

// ────────────────────────────────────────────────────────────
// 5a. Оси долга и разрез проверок
// ────────────────────────────────────────────────────────────

/** Выбран способ (КП или ЕП) — классы Д-А, Д-Б. */
const methodFiltered = (s: State): boolean => s.m.methods.length > 0;
/** Выбраны подведы — классы Д-В, Д-Г, Д-Д. */
const subFiltered = (s: State): boolean => s.o.subs.length > 0;
/** Выбраны месяцы как настоящий фильтр (не «неделя») — класс Д-Е. */
const monthsSelected = (s: State): boolean => s.p.mode === 'explicit' && s.p.months.length > 0;

/** Тело проверки: заполняет протокол по одному состоянию. */
type Check = (rep: Report, s: State) => void;

/** Прогон тела по подмножеству состояний; пустая строка = нарушений нет. */
function run(states: State[], body: Check): string {
  const rep = new Report();
  for (const s of states) body(rep, s);
  return rep.toString();
}

const not = <T,>(p: (x: T) => boolean) => (x: T): boolean => !p(x);

/**
 * Пара «гейт + реестр долга» на одну проверку.
 *
 * `debt` отбирает состояния с известным дефектом. Остальные обязаны быть
 * зелёными сейчас и впредь — это гейт.
 *
 * Долговая половина написана НАОБОРОТ: она требует, чтобы нарушения ещё были.
 * Так реестр остаётся живым в обе стороны. Починили дефект — тест краснеет и
 * говорит «долг закрыт, перенеси состояния в гейт»; сломали что-то рядом так,
 * что расчёт падает с исключением, — тест тоже краснеет, потому что исключение
 * проходит наружу. `it.fails` здесь не годится: он засчитал бы за «ожидаемый
 * провал» любое падение, включая чужую опечатку.
 */
function gateAndDebt(
  title: string,
  debtTitle: string,
  debt: (s: State) => boolean,
  body: Check,
  states: State[] = STATES,
): void {
  it(title, () => {
    expect(run(states.filter(not(debt)), body)).toBe('');
  });
  it(debtTitle, () => {
    const debtStates = states.filter(debt);
    expect(debtStates.length).toBeGreaterThan(0);
    // Пустая строка = нарушений нет = долг закрыт: см. комментарий выше.
    expect(run(debtStates, body)).not.toBe('');
  });
}

// ────────────────────────────────────────────────────────────
// 6. Инварианты
// ────────────────────────────────────────────────────────────

/**
 * Состояния без фильтра способа и без фильтра подведов. Это тот периметр,
 * который сегодня сходится целиком, — и он обязан оставаться зелёным при любой
 * правке ниже. Отдельный блок нужен, чтобы регресс в работающей части не
 * растворился в красноте реестра дефектов.
 */
const BASE_STATES = STATES.filter(s => s.m.methods.length === 0 && s.o.subs.length === 0);

describe('базовый периметр (дефолт, кварталы, месяцы, один ГРБС) — обязан быть зелёным', () => {
  it('все блоки состояния считают одно множество строк', () => {
    const rep = new Report();
    for (const s of BASE_STATES) {
      const { fd, mdm } = screen(s);
      const ref = reference(s);
      const b = mdm.totals.budget;

      rep.eq(s.label, 'плитка «План»', ref.all.planTotal, fd.totalPlan);
      rep.eq(s.label, 'плитка «Факт»', ref.all.factTotal, fd.totalFact);
      rep.eq(s.label, 'плитка «План, шт.»', ref.all.planCount, fd.totalPlanCount);
      rep.eq(s.label, 'плитка «Заключено, шт.»', ref.all.factCount, fd.totalFactCount);
      rep.eq(s.label, 'пирог КП', ref.all.kpCount, fd.totalKP);
      rep.eq(s.label, 'пирог ЕП', ref.all.epCount, fd.totalEP);
      rep.eq(s.label, 'плитка «Экономия»', ref.all.economyTotal, fd.totalEconomy);
      rep.same(s.label, 'КП + ЕП = всего', ref.all.planCount, fd.totalKP + fd.totalEP);
      rep.same(s.label, 'ФБ+КБ+МБ = План', fd.totalPlan, b.planFB + b.planKB + b.planMB);
      rep.same(s.label, 'ФБ+КБ+МБ = Факт', fd.totalFact, b.factFB + b.factKB + b.factMB);
      rep.same(s.label, 'Σ бар-чарта = План',
        fd.totalPlan, sumBars(fd.barData, 'planTotal'));
      rep.same(s.label, 'Σ карточек = План',
        fd.totalPlan, mdm.departments.reduce((a, d) => a + d.total.planTotal, 0));
      rep.eq(s.label, 'исполнение по счёту (%)',
        pct1(ref.all.factCount, ref.all.planCount), fd.overallExecCountPct);
    }
    expect(rep.toString()).toBe('');
  });
});

describe('матрица «экран = движок»: итоги блоков против построчного пересчёта', () => {
  // Деньги подчиняются способу (kpPlanTotal/epPlanTotal), счётчики закупок —
  // общие для состояния: это и есть заявленный контракт блока плиток.
  const tiles: Check = (rep, s) => {
    const { fd } = screen(s);
    const ref = reference(s);
    rep.eq(s.label, 'плитка «План, тыс. руб.»', ref.byMethod.planTotal, fd.totalPlan);
    rep.eq(s.label, 'плитка «Факт, тыс. руб.»', ref.byMethod.factTotal, fd.totalFact);
    rep.eq(s.label, 'плитка «План, шт.»', ref.all.planCount, fd.totalPlanCount);
    rep.eq(s.label, 'плитка «Заключено, шт.»', ref.all.factCount, fd.totalFactCount);
  };
  gateAndDebt(
    'плитки (план, факт, счётчики) считают ровно строки состояния',
    // Д-Б/Д-Г: под подведами денег по способу взять неоткуда — SubPeriodMetrics
    // разбивки КП/ЕП не несёт, и плитка показывает суммы обоих способов.
    'ДОЛГ Д-Г: подвед + способ — деньги плиток не делятся по способу',
    s => methodFiltered(s) && subFiltered(s),
    tiles,
  );

  const methodPie: Check = (rep, s) => {
    const { fd } = screen(s);
    const ref = reference(s);
    rep.eq(s.label, 'пирог «Способ закупки» · сектор КП', ref.byMethod.kpCount, fd.totalKP);
    rep.eq(s.label, 'пирог «Способ закупки» · сектор ЕП', ref.byMethod.epCount, fd.totalEP);
  };
  gateAndDebt(
    'пирог способов: КП и ЕП — те же строки, что у плиток',
    // Д-В: под подведами счётчики КП/ЕП берутся ГОДОВЫЕ (единственная
    // существующая база — competitiveCount/soleCount узла), поэтому пирог при
    // выбранном квартале рисует год — тот самый бейдж-который-врёт (пп. 18-19).
    'ДОЛГ Д-В: подвед — счётчики способов годовые независимо от периода',
    subFiltered,
    methodPie,
  );

  it('экономия считается на строках состояния', () => {
    const rep = new Report();
    for (const s of STATES) {
      const { fd } = screen(s);
      const ref = reference(s);
      // Экономия считается по всем способам всегда: `economy-metrics.ts` о КП/ЕП
      // не знает. Здесь это зафиксировано как ФАКТ поведения, а не как канон —
      // под фильтром способа плитка «Экономия» живёт на чужом периметре (Д-Б).
      rep.eq(s.label, 'плитка «Экономия»', ref.all.economyTotal, fd.totalEconomy);
    }
    expect(rep.toString()).toBe('');
  });

  it('бюджеты (ФБ/КБ/МБ) считают строки состояния', () => {
    const rep = new Report();
    for (const s of STATES) {
      const { mdm } = screen(s);
      const ref = reference(s);
      const b = mdm.totals.budget;
      rep.eq(s.label, 'бюджеты · план ФБ', ref.all.planFB, b.planFB);
      rep.eq(s.label, 'бюджеты · план КБ', ref.all.planKB, b.planKB);
      rep.eq(s.label, 'бюджеты · план МБ', ref.all.planMB, b.planMB);
      rep.eq(s.label, 'бюджеты · факт ФБ', ref.all.factFB, b.factFB);
      rep.eq(s.label, 'бюджеты · факт КБ', ref.all.factKB, b.factKB);
      rep.eq(s.label, 'бюджеты · факт МБ', ref.all.factMB, b.factMB);
    }
    expect(rep.toString()).toBe('');
  });

  const planFactChart: Check = (rep, s) => {
    const { fd } = screen(s);
    for (const qk of QUARTER_KEYS) {
      const q = fd.summaryByPeriod[qk] ?? {};
      const qRows = ROWS.filter(r => `q${r.quarter}` === qk && s.o.rows(r));
      const a = agg(qRows);
      const showKP = s.m.methods.length === 0 || s.m.methods.includes('competitive');
      const showEP = s.m.methods.length === 0 || s.m.methods.includes('single');
      rep.eq(s.label, `график · ${qk} · план КП`, showKP ? a.kpPlanTotal : 0, q.kpPlan ?? 0);
      rep.eq(s.label, `график · ${qk} · факт КП`, showKP ? a.kpFactTotal : 0, q.kpFact ?? 0);
      rep.eq(s.label, `график · ${qk} · план ЕП`, showEP ? a.epPlanTotal : 0, q.epPlan ?? 0);
      rep.eq(s.label, `график · ${qk} · факт ЕП`, showEP ? a.epFactTotal : 0, q.epFact ?? 0);
    }
  };
  // График живёт на квартальной сетке — берём состояния, где период её не сужает.
  const CHART_STATES = STATES.filter(x => x.p.label === 'весь год' || x.p.mode === 'week');
  gateAndDebt(
    'ряды графика план/факт по кварталам совпадают с построчным пересчётом',
    // Д-Д: `recalcSummaryByPeriod` читает kpPlanTotal/epPlanTotal из
    // оверрайднутого квартала, куда спред занёс метод-поля УПРАВЛЕНИЯ, —
    // плитки уже показывают подвед, график ещё управление.
    'ДОЛГ Д-Д: подвед — график план/факт рисует управление, а не подвед',
    subFiltered,
    planFactChart,
    CHART_STATES,
  );
});

describe('инвариант 1 — целое равно сумме частей', () => {
  const kpEpWhole: Check = (rep, s) => {
    const { fd } = screen(s);
    const ref = reference(s);
    rep.eq(s.label, 'КП + ЕП = всего закупок', ref.byMethod.planCount, fd.totalKP + fd.totalEP);
  };
  gateAndDebt(
    'КП + ЕП = всего закупок состояния',
    // Д-В: годовые счётчики способов под подведами не складываются в счёт периода.
    'ДОЛГ Д-В: подвед — КП + ЕП не равны числу закупок периода',
    subFiltered,
    kpEpWhole,
  );

  const budgetIsWhole: Check = (rep, s) => {
    const { fd, mdm } = screen(s);
    const b = mdm.totals.budget;
    rep.same(s.label, 'ФБ+КБ+МБ = План', fd.totalPlan, b.planFB + b.planKB + b.planMB);
    rep.same(s.label, 'ФБ+КБ+МБ = Факт', fd.totalFact, b.factFB + b.factKB + b.factMB);
  };
  gateAndDebt(
    'ФБ + КБ + МБ = итог плана и итог факта',
    // Д-А: плитка «План» делится по способу, а `addBudget` внутри addCommon
    // складывает оба — деления бюджетов по способу в данных попросту нет
    // (planFB/KB/MB существуют только суммарно). На экране: КП 1 540 в плитке
    // против 2 135 в сумме ФБ+КБ+МБ.
    'ДОЛГ Д-А: способ — бюджетная разбивка не делится по КП/ЕП',
    methodFiltered,
    budgetIsWhole,
  );

  /**
   * Год против суммы четырёх кварталов. Живёт на своём наборе (орган × способ),
   * поэтому разрез сделан руками: долг — те же подведы (Д-В), у которых счётчики
   * способов годовые и потому в сумму кварталов не складываются.
   */
  const yearVsQuarters = (orgs: OrgState[]): string => {
    const rep = new Report();
    for (const o of orgs) {
      for (const m of METHOD_STATES) {
        const year = screen({ label: '', year: 2026, p: PERIOD_STATES[0], o, m });
        let plan = 0, fact = 0, planCount = 0, factCount = 0, kp = 0, ep = 0, eco = 0;
        for (let i = 1; i <= 4; i++) {
          const q = screen({ label: '', year: 2026, p: PERIOD_STATES[i], o, m });
          plan += q.fd.totalPlan; fact += q.fd.totalFact;
          planCount += q.fd.totalPlanCount; factCount += q.fd.totalFactCount;
          kp += q.fd.totalKP; ep += q.fd.totalEP; eco += q.fd.totalEconomy;
        }
        const label = `год против Σ кварталов · ${o.label} · ${m.label}`;
        rep.same(label, 'Σ q1..q4 = год · План', year.fd.totalPlan, plan);
        rep.same(label, 'Σ q1..q4 = год · Факт', year.fd.totalFact, fact);
        rep.same(label, 'Σ q1..q4 = год · План, шт.', year.fd.totalPlanCount, planCount);
        rep.same(label, 'Σ q1..q4 = год · Заключено, шт.', year.fd.totalFactCount, factCount);
        rep.same(label, 'Σ q1..q4 = год · КП', year.fd.totalKP, kp);
        rep.same(label, 'Σ q1..q4 = год · ЕП', year.fd.totalEP, ep);
        rep.same(label, 'Σ q1..q4 = год · Экономия', year.fd.totalEconomy, eco);
      }
    }
    return rep.toString();
  };

  it('сумма кварталов = год', () => {
    expect(yearVsQuarters(ORG_STATES.filter(not(o => o.subs.length > 0)))).toBe('');
  });
  it('ДОЛГ Д-В: подвед — Σ кварталов по КП/ЕП не сходится с годом', () => {
    expect(yearVsQuarters(ORG_STATES.filter(o => o.subs.length > 0))).not.toBe('');
  });

  const pmPlusTd: Check = (rep, s) => {
    const { fd } = screen(s);
    const ref = reference(s);
    const periodKeys = activePeriodKeys(fd.periodResolution);
    const bpf = makeBudgetPlanFact(new Set<string>());
    const of = (key: string) =>
      recalcTotalsByActivity(fd.depts, { actKeys: [key], periodKeys, budgetPlanFact: bpf });
    const pm = of('program');
    const td = of('current_non_program');
    const legacy = of('current_program');

    rep.eq(s.label, 'вид деятельности · упразднённый срез ТД-ПМ обязан быть пуст', 0, legacy.totalPlan);
    rep.eq(s.label, 'вид деятельности · ПМ + ТД = План', ref.all.planTotal, pm.totalPlan + td.totalPlan);
    rep.eq(s.label, 'вид деятельности · ПМ + ТД = Факт', ref.all.factTotal, pm.totalFact + td.totalFact);
  };
  gateAndDebt(
    'ПМ + ТД = всего (видов деятельности ровно два — канон п.30)',
    // Д-Е: `byActivity` не пересчитывается подвед-оверрайдом (показывает
    // управление) и при выборе месяцев читает ЦЕЛЫЕ покрытые кварталы, пока
    // плитки считают месяцы: помесячной базы у byActivity в данных нет.
    'ДОЛГ Д-Е: подвед и месяцы — виды деятельности живут на своём периметре',
    s => subFiltered(s) || monthsSelected(s),
    pmPlusTd,
  );
});

describe('инвариант 2 — один периметр на все блоки состояния', () => {
  const onePerimeter: Check = (rep, s) => {
    {
      const { fd, mdm } = screen(s);

      const barPlan = sumBars(fd.barData, 'planTotal');
      const barFact = sumBars(fd.barData, 'factTotal');
      rep.same(s.label, 'Σ бар-чарта = плитка «План»', fd.totalPlan, barPlan);
      rep.same(s.label, 'Σ бар-чарта = плитка «Факт»', fd.totalFact, barFact);

      const cardPlan = mdm.departments.reduce((acc, d) => acc + d.total.planTotal, 0);
      const cardFact = mdm.departments.reduce((acc, d) => acc + d.total.factTotal, 0);
      const cardKp = mdm.departments.reduce((acc, d) => acc + d.total.competitiveCount, 0);
      const cardEp = mdm.departments.reduce((acc, d) => acc + d.total.epCount, 0);
      const cardEco = mdm.departments.reduce((acc, d) => acc + d.total.economyTotal, 0);
      rep.same(s.label, 'Σ карточек управлений = плитка «План»', fd.totalPlan, cardPlan);
      rep.same(s.label, 'Σ карточек управлений = плитка «Факт»', fd.totalFact, cardFact);
      rep.same(s.label, 'Σ карточек управлений = пирог КП', fd.totalKP, cardKp);
      rep.same(s.label, 'Σ карточек управлений = пирог ЕП', fd.totalEP, cardEp);
      rep.same(s.label, 'Σ карточек управлений = плитка «Экономия»', fd.totalEconomy, cardEco);

      rep.same(s.label, 'итог mdm = плитка «План»', fd.totalPlan, mdm.totals.planTotal);
      rep.same(s.label, 'итог mdm = плитка «Факт»', fd.totalFact, mdm.totals.factTotal);
    }
  };
  gateAndDebt(
    'плитки, карточки управлений, бар-чарт и пирог считают одно множество строк',
    // Д-А: обе денежные ветви `bar-data.ts` складывают оба способа, пока плитка
    // делится по способу; карточки управлений тянут за собой ту же разбивку.
    'ДОЛГ Д-А: способ — бар-чарт и карточки складывают оба способа',
    methodFiltered,
    onePerimeter,
  );

  const subsSumToDept: Check = (rep, s) => {
    const { mdm } = screen(s);
    for (const d of mdm.departments) {
      const parts = [...(d.orgSelf ? [d.orgSelf] : []), ...d.realSubs];
      const plan = parts.reduce((acc, p) => acc + p.metrics.planTotal, 0);
      const fact = parts.reduce((acc, p) => acc + p.metrics.factTotal, 0);
      rep.same(`${s.label} · ${d.dept}`, 'Σ подведов = План управления', d.total.planTotal, plan);
      rep.same(`${s.label} · ${d.dept}`, 'Σ подведов = Факт управления', d.total.factTotal, fact);
    }
  };
  gateAndDebt(
    'подведы управления складываются в само управление',
    // Д-Б: фильтр способа доходит до управления (kpPlanTotal/epPlanTotal), но
    // не до подведов — у SubPeriodMetrics разбивки по способу нет вовсе,
    // поэтому части остаются полными, когда целое уже срезано.
    'ДОЛГ Д-Б: способ — подведы не делятся по КП/ЕП и не складываются в целое',
    methodFiltered,
    subsSumToDept,
  );

  const activitySamePeriod: Check = (rep, s) => {
    const { fd } = screen(s);
    const ref = reference(s);
    const bpf = makeBudgetPlanFact(new Set<string>());
    const both = recalcTotalsByActivity(fd.depts, {
      actKeys: ['program', 'current_program', 'current_non_program'],
      periodKeys: activePeriodKeys(fd.periodResolution),
      budgetPlanFact: bpf,
    });
    rep.eq(s.label, 'виды деятельности · период тот же, что у плиток (План)', ref.all.planTotal, both.totalPlan);
    rep.eq(s.label, 'виды деятельности · период тот же, что у плиток (Факт)', ref.all.factTotal, both.totalFact);
  };
  gateAndDebt(
    'разбивка по видам деятельности считает тот же период, что плитки',
    // Д-Е, та же причина: подвед-оверрайд byActivity не трогает, а при выборе
    // месяцев `activePeriodKeys` отдаёт покрытые КВАРТАЛЫ.
    'ДОЛГ Д-Е: подвед и месяцы — виды деятельности читают чужой период',
    s => subFiltered(s) || monthsSelected(s),
    activitySamePeriod,
  );
});

describe('инвариант 3 — процент есть отношение сумм, а не среднее процентов', () => {
  it('исполнение по деньгам и по счёту = отношение итогов состояния', () => {
    const rep = new Report();
    for (const s of STATES) {
      const { fd, mdm } = screen(s);
      rep.eq(s.label, 'исполнение по счёту (%)',
        pct1(fd.totalFactCount, fd.totalPlanCount), fd.overallExecCountPct);
      if (fd.totalPlan > 0) {
        rep.eq(s.label, 'исполнение по деньгам (%)',
          pct1(fd.totalFact, fd.totalPlan), mdm.totals.executionPct);
      }
    }
    expect(rep.toString()).toBe('');
  });

  it('на неравных управлениях отношение сумм отличается от среднего процентов', () => {
    // Страж самого теста: если бы обе формулы совпадали на фикстуре, проверка
    // выше ничего не стерегла бы.
    const s: State = { label: 'контроль', year: 2026, p: PERIOD_STATES[0], o: ORG_STATES[0], m: METHOD_STATES[0] };
    const { fd, mdm } = screen(s);
    // На этом состоянии (весь год, все органы) план есть у каждого управления,
    // поэтому `executionPct` здесь заведомо число; `?? 0` — только для типа.
    const avg = mdm.departments.reduce((acc, d) => acc + (d.total.executionPct ?? 0), 0) / mdm.departments.length;
    expect(pct1(fd.totalFact, fd.totalPlan)).not.toBe(+avg.toFixed(1));
  });
});

describe('инвариант 4 — нулевой знаменатель даёт «нет базы», а не ноль', () => {
  it('месяц без строк управления не рисует исполнение 0 %', () => {
    // УО не имеет строк в декабре: знаменателя нет, и «0 %» здесь — ложь,
    // из которой рейтинг делает вывод «отстаёт от графика» (интервью пп. 14-16).
    const s: State = {
      label: 'год 2026 · декабрь · один ГРБС (УО) · все способы',
      year: 2026,
      p: { label: 'декабрь', period: 'year', months: [12], mode: 'explicit', rows: r => r.month === 12 },
      o: ORG_STATES[1],
      m: METHOD_STATES[0],
    };
    const { fd } = screen(s);
    const rep = new Report();
    rep.eq(s.label, 'плитка «План, шт.» пуста', 0, fd.totalPlanCount);
    rep.eq(s.label, 'исполнение по счёту при нулевом знаменателе', null, fd.overallExecCountPct);
    expect(rep.toString()).toBe('');
  });

  it('карточка управления без плана тоже говорит «нет базы», а не 0 %', () => {
    // Д-Ж: слой карточек (useMultiDimMetrics.safePct) отвечает нулём там, где
    // знаменателя нет. Ноль читается как «исполнение 0 %», и рейтинг делает из
    // отсутствия данных вывод «отстаёт от графика» (интервью пп. 14-16,
    // реестр расхождений §2 «Ноль вместо „нет базы“»).
    const s: State = {
      label: 'год 2026 · декабрь · один ГРБС (УО) · все способы',
      year: 2026,
      p: { label: 'декабрь', period: 'year', months: [12], mode: 'explicit', rows: r => r.month === 12 },
      o: ORG_STATES[1],
      m: METHOD_STATES[0],
    };
    const { mdm } = screen(s);
    const rep = new Report();
    for (const d of mdm.departments) {
      const label = `${s.label} · ${d.dept}`;
      if (d.total.planTotal === 0) {
        rep.eq(label, 'карточка · исполнение по деньгам без плана', null, d.total.executionPct);
      }
      if (d.total.planCount === 0) {
        rep.eq(label, 'карточка · исполнение по счёту без плана', null, d.total.execCountPct);
      }
    }
    expect(rep.toString()).toBe('');
  });
});

describe('инвариант 5 — фильтр туда-обратно возвращает исходные числа', () => {
  it('снятие фильтра восстанавливает числа состояния «по умолчанию»', () => {
    const rep = new Report();
    const base: State = { label: 'дефолт', year: 2026, p: PERIOD_STATES[0], o: ORG_STATES[0], m: METHOD_STATES[0] };
    const before = screen(base).fd;

    for (const s of STATES) {
      // Тудa: любое состояние матрицы. Обратно: тот же дефолт.
      screen(s);
      const after = screen(base).fd;
      const label = `дефолт → ${s.label} → дефолт`;
      rep.same(label, 'возврат · План', before.totalPlan, after.totalPlan);
      rep.same(label, 'возврат · Факт', before.totalFact, after.totalFact);
      rep.same(label, 'возврат · План, шт.', before.totalPlanCount, after.totalPlanCount);
      rep.same(label, 'возврат · Заключено, шт.', before.totalFactCount, after.totalFactCount);
      rep.same(label, 'возврат · КП', before.totalKP, after.totalKP);
      rep.same(label, 'возврат · ЕП', before.totalEP, after.totalEP);
      rep.same(label, 'возврат · Экономия', before.totalEconomy, after.totalEconomy);
    }
    expect(rep.toString()).toBe('');
  });

  it('расчёт не пишет в исходные данные (залипание невозможно по построению)', () => {
    const snapshotJson = JSON.stringify(DASHBOARD);
    for (const s of STATES) screen(s);
    expect(JSON.stringify(DASHBOARD)).toBe(snapshotJson);
  });
});

describe('инвариант 6 — выбор недели не меняет числа блоков «весь год»', () => {
  it('week-режим оставляет годовой периметр (баг #5: невидимый месяц)', () => {
    const rep = new Report();
    const yearState = PERIOD_STATES.find(p => p.label === 'весь год')!;
    const weekState = PERIOD_STATES.find(p => p.mode === 'week')!;

    for (const o of ORG_STATES) {
      for (const m of METHOD_STATES) {
        const y = screen({ label: '', year: 2026, p: yearState, o, m }).fd;
        const w = screen({ label: '', year: 2026, p: weekState, o, m }).fd;
        const label = `неделя против года · ${o.label} · ${m.label}`;
        rep.same(label, 'неделя не сужает · План', y.totalPlan, w.totalPlan);
        rep.same(label, 'неделя не сужает · Факт', y.totalFact, w.totalFact);
        rep.same(label, 'неделя не сужает · План, шт.', y.totalPlanCount, w.totalPlanCount);
        rep.same(label, 'неделя не сужает · КП', y.totalKP, w.totalKP);
        rep.same(label, 'неделя не сужает · ЕП', y.totalEP, w.totalEP);
        rep.same(label, 'неделя не сужает · Экономия', y.totalEconomy, w.totalEconomy);
        rep.eq(label, 'неделя не сужает · ключ периода', null, w.periodKey === 'year' ? null : w.periodKey);
      }
    }
    expect(rep.toString()).toBe('');
  });

  it('ось года не является клиентским фильтром: 2026 и «все годы» дают одни числа', () => {
    const rep = new Report();
    for (const p of PERIOD_STATES) {
      for (const o of ORG_STATES) {
        for (const m of METHOD_STATES) {
          const a = screen({ label: '', year: 2026, p, o, m }).fd;
          const b = screen({ label: '', year: 'all', p, o, m }).fd;
          const label = `${p.label} · ${o.label} · ${m.label}`;
          rep.same(label, 'год 2026 = «все годы» · План', a.totalPlan, b.totalPlan);
          rep.same(label, 'год 2026 = «все годы» · Факт', a.totalFact, b.totalFact);
          rep.same(label, 'год 2026 = «все годы» · КП+ЕП', a.totalKP + a.totalEP, b.totalKP + b.totalEP);
        }
      }
    }
    expect(rep.toString()).toBe('');
  });
});
