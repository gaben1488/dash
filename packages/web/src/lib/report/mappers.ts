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
   * Официальный аналог плитки в слое снимков (dotted-ключ REPORT_MAP) —
   * дверь для дельта-бейджа «к прошлому снимку». Однозначного аналога той же
   * семантики в СВОДе нет → поля нет, плитка честно живёт без дельты.
   */
  officialKey?: string;
}

interface ScopeCounts {
  kp: Report['integralSummary']['year']['kp'];
  ep: Report['integralSummary']['year']['ep'];
  total: Report['integralSummary']['year']['total'];
}

/** Пять плиток одного скоупа: план/факт/исполнение + КП/ЕП раздельно. */
function scopeTiles(scope: ScopeCounts, badge: string): KpiVM[] {
  return [
    {
      metricKey: 'plan_count',
      value: fmtCount(scope.total.planCount),
      unit: '',
      periodBadge: badge,
      source: scope.total.origin,
      tier: 'compact',
    },
    {
      metricKey: 'fact_count',
      value: fmtCount(scope.total.doneCount),
      unit: '',
      periodBadge: badge,
      source: scope.total.origin,
      tier: 'compact',
    },
    {
      metricKey: 'exec_count_pct',
      value: fmtPct(scope.total.pct),
      unit: '',
      periodBadge: badge,
      source: scope.total.origin,
      tier: 'hero',
    },
    {
      metricKey: 'comp_exec_count_pct',
      value: fmtPct(scope.kp.pct),
      unit: '',
      periodBadge: `${badge} · ${fmtCount(scope.kp.doneCount)} из ${fmtCount(scope.kp.planCount)}`,
      source: scope.kp.origin,
      tier: 'compact',
    },
    {
      metricKey: 'ep_exec_count_pct',
      value: fmtPct(scope.ep.pct),
      unit: '',
      periodBadge: `${badge} · ${fmtCount(scope.ep.doneCount)} из ${fmtCount(scope.ep.planCount)}`,
      source: scope.ep.origin,
      tier: 'compact',
    },
  ];
}

/**
 * Плиткам скоупа проставляется официальный аналог из слоя снимков — там,
 * где он однозначен (исполнение КП/ЕП; см. officialAnalogKey). Остальные
 * плитки остаются как есть: без аналога нет и дельты.
 */
function stampOfficialKeys(tiles: KpiVM[], scope: KpiScope): KpiVM[] {
  return tiles.map((t) => {
    const officialKey = officialAnalogKey(t.metricKey, scope);
    return officialKey === undefined ? t : { ...t, officialKey };
  });
}

/**
 * Интегральная сводка → плитки: год (план/факт/% + КП/ЕП), квартал (то же),
 * деньги года (лимит/факт/экономия ИТОГО). Source каждой плитки — из
 * origin-поля соответствующего числа.
 */
export function integralKpiRow(report: Report): KpiVM[] {
  const { period, integralSummary } = report;
  const yearBadge = `${period.year} · год`;
  const quarterBadge = quarterLabel(period.quarter);
  const money = integralSummary.money;
  const moneyTiles: KpiVM[] = [
    {
      metricKey: 'plan_total',
      value: fmtThousands(money.plan.total),
      unit: 'тыс. ₽',
      periodBadge: yearBadge,
      source: money.plan.origin,
      tier: 'compact',
    },
    {
      metricKey: 'fact_total',
      value: fmtThousands(money.fact.total),
      unit: 'тыс. ₽',
      periodBadge: yearBadge,
      source: money.fact.origin,
      tier: 'compact',
    },
    {
      metricKey: 'economy_total',
      value: fmtThousands(money.economy.total),
      unit: 'тыс. ₽',
      periodBadge: yearBadge,
      source: money.economy.origin,
      tier: 'compact',
    },
    // Остаток к заключению — прямой запрос коллег: «сколько в плановых
    // деньгах по оставшимся процедурам». origin не нужен: pending_* всегда
    // наш пересчёт (см. PendingRemainder в core).
    {
      metricKey: 'pending_count',
      value: fmtCount(integralSummary.pending.year.count),
      unit: '',
      periodBadge: yearBadge,
      source: 'calc',
      tier: 'compact',
    },
    {
      metricKey: 'pending_total',
      value: fmtThousands(integralSummary.pending.year.total),
      unit: 'тыс. ₽',
      periodBadge: yearBadge,
      source: 'calc',
      tier: 'compact',
    },
  ];
  return [
    ...stampOfficialKeys(scopeTiles(integralSummary.year, yearBadge), 'year'),
    ...stampOfficialKeys(scopeTiles(integralSummary.quarter, quarterBadge), period.quarter),
    // Деньги «итого» = КП+ЕП: единой официальной ячейки нет — без аналога
    ...moneyTiles,
  ];
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
