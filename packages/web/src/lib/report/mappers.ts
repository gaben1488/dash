/**
 * Мапперы Report → view-модели страницы «Отчёт» (дуга-3, волна 2B).
 *
 * Чистый слой без React: форматирование чисел по правилам продукта
 * (процент с одним знаком и запятой, «нет плана» вместо нуля при D = 0 —
 * канон quarterExecution) и сборка секций ГРБС для контрактных элементов.
 * Подписи метрик страница берёт через productLabel по metricKey из этих
 * view-моделей — свободного текста подписей здесь нет.
 */
import type { BudgetMoney, GrbsReportBlock, PendingPosition, RecommendationPair, Report, ReportSignal } from '@aemr/core';
import { isoOfDayNumber, quarterLabel } from '@aemr/shared';
import { formatDateCell } from '../sheet-date';
import { officialAnalogKey, type KpiScope } from './kpi-delta';

/** Происхождение view-модели — структурно совместим с ElementSource контракта. */
export type ViewSource = 'calc' | 'svod' | 'mixed';

// ── Форматтеры (канон продукта) ─────────────────────────────

/** Целое со стандартной ru-RU группировкой разрядов. */
export function fmtCount(n: number): string {
  return Math.round(n).toLocaleString('ru-RU');
}

/**
 * Процент: один знак после запятой, запятая-разделитель, «нет плана» при null
 * (канон quarterExecution: D = 0 → pct = null, не 0 и не 100).
 */
export function fmtPct(pct: number | null): string {
  if (pct === null) return 'нет плана';
  return `${(Math.round(pct * 10) / 10).toFixed(1).replace('.', ',')}%`;
}

/** Сумма в тыс. руб. — то же целочисленное ru-RU (алиас, не вторая копия). */
export const fmtThousands = fmtCount;

/**
 * Дата среза «дд.мм.гггг» из period.asOfDay (номер суток dayNumberOf).
 * UTC-компоненты, не toLocaleDateString: локальное форматирование западнее
 * Гринвича сдвинуло бы срез-четверг на среду.
 */
export function fmtAsOfDate(asOfDay: number): string {
  // Каноны вместо ручных UTC-геттеров: номер суток → ISO → «дд.мм.гггг».
  return formatDateCell(isoOfDayNumber(asOfDay));
}

// ── Интегральная сводка → ряд KPI-плиток ────────────────────

export interface KpiVM {
  /** Ключ канон-словаря (METRIC_LABELS) — подпись рендерит KpiTile через productLabel */
  metricKey: string;
  value: string;
  unit: string;
  /** Честный скоуп числа: «2026 · год», «1 кв», … */
  periodBadge: string;
  source: ViewSource;
  tier: 'hero' | 'compact';
  /**
   * Из чего сложилось число — по частям: «заключено », 2 440, « из », 2 819.
   * Часть с metricKey несёт СВОЮ базу знаний по наведению. Так переплавка
   * не съела метрики, которые до неё стояли отдельными плитками
   * (plan_count/fact_count, счётчики КП и ЕП): плиток нет — ключи живы.
   */
  formula?: FormulaPart[];
  /** Процент для бара плитки (null — нет базы, бар не рисуется). */
  meter?: number | null;
  /** Смысловой акцент: способ закупки, тревога, экономия. */
  accent?: 'neutral' | 'brand' | 'violet' | 'amber' | 'emerald';
  /** Состав денежной плитки — тройка ФБ/КБ/МБ (страница рисует BudgetTriple). */
  budget?: { fb: number; kb: number; mb: number };
  /**
   * Официальный аналог плитки в слое снимков (dotted-ключ REPORT_MAP) —
   * дверь для дельта-бейджа «к прошлому снимку». Однозначного аналога той же
   * семантики в СВОДе нет → поля нет, плитка честно живёт без дельты.
   */
  officialKey?: string;
}

/** Кусок формулы: текст-связка либо число со своим ключом метрики. */
export interface FormulaPart {
  text: string;
  /** Задан — часть кликабельна для БЗ (KbHover). */
  metricKey?: string;
}

interface ScopeCounts {
  kp: Report['integralSummary']['year']['kp'];
  ep: Report['integralSummary']['year']['ep'];
  total: Report['integralSummary']['year']['total'];
}

/**
 * Герой скоупа: главный процент исполнения крупно, с формулой и баром.
 * Отставание (<70 %) подсвечивается янтарём — цвет говорит раньше, чем
 * читатель сравнит числа; слово «заключено N из M» дублирует и то, и другое.
 */
function heroTile(scope: ScopeCounts, badge: string): KpiVM {
  const pct = scope.total.pct;
  return {
    metricKey: 'exec_count_pct',
    value: fmtPct(pct),
    unit: '',
    periodBadge: badge,
    source: scope.total.origin,
    tier: 'hero',
    formula: [
      { text: 'заключено ' },
      { text: fmtCount(scope.total.doneCount), metricKey: 'fact_count' },
      { text: ' из ' },
      { text: fmtCount(scope.total.planCount), metricKey: 'plan_count' },
      { text: ' позиций' },
    ],
    meter: pct,
    accent: pct !== null && pct < 70 ? 'amber' : 'brand',
  };
}

/** Две плитки способов одного скоупа: конкурентные и единственный поставщик. */
function methodTiles(scope: ScopeCounts, badge: string): KpiVM[] {
  return [
    {
      metricKey: 'comp_exec_count_pct',
      value: fmtPct(scope.kp.pct),
      unit: '',
      periodBadge: badge,
      source: scope.kp.origin,
      tier: 'compact',
      formula: [
        { text: fmtCount(scope.kp.doneCount), metricKey: 'comp_fact_count' },
        { text: ' из ' },
        { text: fmtCount(scope.kp.planCount), metricKey: 'competitive_count' },
      ],
      meter: scope.kp.pct,
      accent: 'brand',
    },
    {
      metricKey: 'ep_exec_count_pct',
      value: fmtPct(scope.ep.pct),
      unit: '',
      periodBadge: badge,
      source: scope.ep.origin,
      tier: 'compact',
      formula: [
        { text: fmtCount(scope.ep.doneCount), metricKey: 'ep_fact_count' },
        { text: ' из ' },
        { text: fmtCount(scope.ep.planCount), metricKey: 'ep_count' },
      ],
      meter: scope.ep.pct,
      accent: 'violet',
    },
  ];
}

/**
 * Плиткам скоупа проставляется официальный аналог из слоя снимков — там,
 * где он однозначен (исполнение КП/ЕП; см. officialAnalogKey). Остальные
 * плитки остаются как есть: без аналога нет и дельты.
 */
function stampOfficialKeys(tiles: KpiVM[], scope: KpiScope, reportYear: number): KpiVM[] {
  return tiles.map((t) => {
    const officialKey = officialAnalogKey(t.metricKey, scope, reportYear);
    return officialKey === undefined ? t : { ...t, officialKey };
  });
}

/** Строка сверки остатка: наш пересчёт против яруса официального листа. */
export interface RemainderRowVM {
  /** Ключ БЗ показателя строки. */
  metricKey: string;
  label: string;
  /** Уточнение под подписью по частям — счётчик несёт свой ключ БЗ. */
  hint: FormulaPart[];
  value: string;
  budget: { fb: number; kb: number; mb: number };
  /** Префикс ключей БЗ бюджетной тройки. */
  budgetPrefix: 'pending' | 'economy';
  source: ViewSource;
  /** Адрес ИТОГО на листе СВОД («O2») — ссылка к первичке; null у расчёта. */
  cell: string | null;
  accent?: 'neutral' | 'emerald';
}

/** Интегральная сводка целиком: четыре яруса вместо ряда равных плиток. */
export interface IntegralSummaryVM {
  /** Год и отчётный квартал — главные проценты. */
  hero: KpiVM[];
  /** Способы: КП/ЕП года и квартала. */
  methods: KpiVM[];
  /** Деньги года: лимит, факт, утверждённая экономия — с составом бюджетов. */
  money: KpiVM[];
  /** Остаток к заключению: наш расчёт и обе официальные строки листа. */
  remainder: RemainderRowVM[];
  /**
   * Подпись расхождения нашего остатка с официальным ярусом (null — листа
   * нет или расхождение нулевое). Обе стороны показаны как есть: продукт
   * не подгоняет свой пересчёт под лист и не молчит о разнице.
   */
  remainderDiff: string | null;
}

export function buildIntegralSummary(report: Report): IntegralSummaryVM {
  const { period, integralSummary, official } = report;
  const yearBadge = `${period.year} · год`;
  const quarterBadge = quarterLabel(period.quarter);
  const money = integralSummary.money;
  const pending = integralSummary.pending.year;

  const moneyTile = (
    metricKey: string,
    m: { fb: number; kb: number; mb: number; total: number; origin: ViewSource },
    accent: KpiVM['accent'],
  ): KpiVM => ({
    metricKey,
    value: fmtThousands(m.total),
    unit: 'тыс. ₽',
    periodBadge: yearBadge,
    source: m.origin,
    tier: 'compact',
    accent,
    budget: { fb: m.fb, kb: m.kb, mb: m.mb },
  });

  const remainder: RemainderRowVM[] = [];
  if (pending.count > 0 || pending.total > 0) {
    remainder.push({
      metricKey: 'pending_total',
      label: 'Наш пересчёт строк книг',
      hint: [
        { text: fmtCount(pending.count), metricKey: 'pending_count' },
        { text: ' позиций без даты заключения' },
      ],
      value: fmtThousands(pending.total),
      budget: { fb: pending.fb, kb: pending.kb, mb: pending.mb },
      budgetPrefix: 'pending',
      source: 'calc',
      cell: null,
    });
  }
  if (official?.remainderToConclude) {
    const r = official.remainderToConclude;
    remainder.push({
      metricKey: 'pending_total',
      label: 'Официальный лист СВОД',
      hint: [{ text: 'ярус «Остаток к заключ.» шапки листа' }],
      value: fmtThousands(r.total),
      budget: { fb: r.fb, kb: r.kb, mb: r.mb },
      budgetPrefix: 'pending',
      source: 'svod',
      cell: r.cell,
    });
  }
  if (official?.calcEconomy) {
    const e = official.calcEconomy;
    remainder.push({
      metricKey: 'economy_total',
      label: 'Расчётная экономия по остатку',
      hint: [{ text: 'та самая строка ручного отчёта' }],
      value: fmtThousands(e.total),
      budget: { fb: e.fb, kb: e.kb, mb: e.mb },
      budgetPrefix: 'economy',
      source: 'svod',
      cell: e.cell,
      accent: 'emerald',
    });
  }

  const officialTotal = official?.remainderToConclude?.total ?? 0;
  const delta = official?.remainderToConclude ? pending.total - officialTotal : null;
  const remainderDiff = delta !== null && officialTotal > 0 && Math.abs(delta) >= 1
    ? `Расхождение с официальным листом: ${delta > 0 ? '+' : '−'}${fmtThousands(Math.abs(delta))} тыс. руб. ` +
      `(${fmtPct((Math.abs(delta) / officialTotal) * 100)}). Обе стороны показаны как есть: наш пересчёт идёт ` +
      'по строкам книг, лист считает свой ярус — периметры могут отличаться.'
    : null;

  return {
    hero: [
      { ...heroTile(integralSummary.year, yearBadge), ...officialStamp('exec_count_pct', 'year', period.year) },
      { ...heroTile(integralSummary.quarter, quarterBadge), ...officialStamp('exec_count_pct', period.quarter, period.year) },
    ],
    methods: [
      ...stampOfficialKeys(methodTiles(integralSummary.year, yearBadge), 'year', period.year),
      ...stampOfficialKeys(methodTiles(integralSummary.quarter, quarterBadge), period.quarter, period.year),
    ],
    money: [
      moneyTile('plan_total', money.plan, 'neutral'),
      moneyTile('fact_total', money.fact, 'neutral'),
      moneyTile('economy_total', money.economy, 'emerald'),
    ],
    remainder,
    remainderDiff,
  };
}

/** Официальный аналог одной плитки — как объект-накладка (spread). */
function officialStamp(metricKey: string, scope: KpiScope, year: number): { officialKey?: string } {
  const officialKey = officialAnalogKey(metricKey, scope, year);
  return officialKey === undefined ? {} : { officialKey };
}

// ── Блок ГРБС → view-модель секции ──────────────────────────

export interface MethodRowVM {
  /** Семейство способа — канон продукта (кириллические коды) */
  methodKey: 'КП' | 'ЕП';
  plan: number;
  fact: number;
  /** Числовой процент для бара (null = «нет плана», бар не рисуется). */
  pct: number | null;
  pctText: string;
}

/** Пара «расчёт против СВОД» для DiffText; подпись — productLabel(metricKey). */
export interface SvodPairVM {
  metricKey: string;
  calc: number;
  svod: number;
  /** Адрес ячейки листа СВОД («E268») — откуда взято официальное число. */
  svodCell?: string;
}

export interface GrbsSectionVM {
  dept: string;
  deptLabel: string;
  /** 'mixed' когда в квартале есть официальные счётчики СВОД, иначе 'calc' */
  source: ViewSource;
  /** «40,0%» либо «нет плана» */
  executionPct: string;
  /** Формула-подпись: «заключено 6 из 15» */
  executionCaption: string;
  pendingCount: number;
  /** «Не заключено: 9» / «Все плановые процедуры квартала заключены» / «—» */
  pendingLabel: string;
  /** Незаключённые позиции квартала с пояснениями из листа (ядро, канон эфира). */
  pendingPositions: PendingPosition[];
  /** Пары «рекомендация УЭР → ответ ГРБСа» по строкам года (ядро). */
  recommendations: RecommendationPair[];
  methodRows: MethodRowVM[];
  yearLine: string;
  /** Плоская строка денег — для «Копировать текстом»; UI рендерит тройки из money. */
  moneyLine: string;
  /** Сырые тройки года — цветная разметка ФБ/КБ/МБ на странице (BudgetTriple). */
  money: { plan: BudgetMoney; fact: BudgetMoney };
  /** null — экономии нет (total = 0), строка не рисуется */
  economyLine: string | null;
  signals: ReportSignal[];
  /** null — лист СВОД по кварталу не передан, сверки нет */
  svodPairs: SvodPairVM[] | null;
  /** Подпись под сверкой: почему её числа расходятся с отчётными (null — не расходятся). */
  svodNote: string | null;
}

function pendingLabelOf(execution: { planCount: number }, pendingCount: number): string {
  if (pendingCount > 0) return `Не заключено: ${fmtCount(pendingCount)}`;
  if (execution.planCount === 0) return 'План на квартал отсутствует';
  return 'Все плановые процедуры квартала заключены';
}

/** Блок ГРБС из Report → плоская view-модель секции страницы. */
export function buildGrbsSection(block: GrbsReportBlock): GrbsSectionVM {
  const q = block.quarter;
  const y = block.year;
  // Сверка идёт по q.live — расчёту БЕЗ гейта среза: формулы СВОДа дату факта
  // не сравнивают ни с чем и всегда считают «на сейчас». Сравнение отчётных
  // чисел (на срез) с живым официалом давало мнимые расхождения (УО +12, УЭР +1).
  const cells = q.svodCells;
  const svodPairs: SvodPairVM[] | null = q.svod
    ? [
        { metricKey: 'competitive_count', calc: q.live.kp.planCount, svod: q.svod.kp.planCount, ...(cells ? { svodCell: cells.kp.plan } : {}) },
        { metricKey: 'comp_fact_count', calc: q.live.kp.doneCount, svod: q.svod.kp.doneCount, ...(cells ? { svodCell: cells.kp.fact } : {}) },
        { metricKey: 'ep_count', calc: q.live.ep.planCount, svod: q.svod.ep.planCount, ...(cells ? { svodCell: cells.ep.plan } : {}) },
        { metricKey: 'ep_fact_count', calc: q.live.ep.doneCount, svod: q.svod.ep.doneCount, ...(cells ? { svodCell: cells.ep.fact } : {}) },
      ]
    : null;
  // Сколько заключено после среза — этим объясняется разрыв между отчётными
  // числами секции и колонкой сверки.
  const afterSlice =
    (q.live.kp.doneCount - q.methods.kp.doneCount) + (q.live.ep.doneCount - q.methods.ep.doneCount);
  return {
    dept: block.dept,
    deptLabel: block.deptLabel,
    source: q.svod ? 'mixed' : 'calc',
    executionPct: fmtPct(q.execution.pct),
    executionCaption: `заключено ${fmtCount(q.execution.doneCount)} из ${fmtCount(q.execution.planCount)}`,
    pendingCount: q.pendingCount,
    pendingLabel: pendingLabelOf(q.execution, q.pendingCount),
    methodRows: [
      { methodKey: 'КП', plan: q.methods.kp.planCount, fact: q.methods.kp.doneCount, pct: q.methods.kp.pct, pctText: fmtPct(q.methods.kp.pct) },
      { methodKey: 'ЕП', plan: q.methods.ep.planCount, fact: q.methods.ep.doneCount, pct: q.methods.ep.pct, pctText: fmtPct(q.methods.ep.pct) },
    ],
    yearLine: `За год: заключено ${fmtCount(y.counts.doneCount)} из ${fmtCount(y.counts.planCount)} (${fmtPct(y.counts.pct)})` +
      (y.pendingCount > 0 ? `, не заключено ${fmtCount(y.pendingCount)}` : ''),
    moneyLine: `Лимит ${fmtThousands(block.money.plan.total)} тыс. руб., факт ${fmtThousands(block.money.fact.total)} тыс. руб.`,
    money: block.money,
    economyLine: block.economy.total > 0
      ? `Экономия: ${fmtThousands(block.economy.total)} тыс. руб.`
      : null,
    pendingPositions: block.quarter.pendingPositions,
    recommendations: block.recommendations,
    signals: block.signals,
    svodPairs,
    svodNote: afterSlice > 0
      ? `Сверка — на текущий момент, как считает СВОД. После даты среза заключено ${fmtCount(afterSlice)} — ` +
        'в отчётные числа выше они не входят.'
      : null,
  };
}
