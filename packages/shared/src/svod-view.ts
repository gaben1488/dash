/**
 * svod-view.ts — Сборка сетки «СВОД ТД-ПМ» из officialMetrics.
 *
 * `officialMetrics` — плоская карта (metricKey → NormalizedMetric), где числа
 * прочитаны НАПРЯМУЮ из ячеек листа СВОД ТД-ПМ (результаты формул COUNTIFS/SUMIFS,
 * полученные через Google Sheets API с UNFORMATTED_VALUE). Эта функция собирает
 * из неё структуру для «панели просмотра» — точную копию листа: сводный блок +
 * блок на каждый ГРБС, секции КП/ЕП, периоды «1 квартал» и «Год», 18 столбцов D–U.
 *
 * Принцип (мандат пользователя 2026-06-04): СВОД = канон. Здесь НЕТ пересчёта —
 * только чтение её ячеек. Единственное вычисление — строка ИТОГО (КП+ЕП), и она
 * собирается ровно так же, как в её листе: счётчики и суммы складываются, а
 * проценты пересчитываются (G = E/D по штукам, Q = (K−O)/K).
 */

import { DEPARTMENT_REGISTRY } from './department-registry.js';

/** Минимальная форма метрики — структурно совместима с NormalizedMetric. */
export interface SvodMetricLike {
  numericValue: number | null;
}

/** Плоская карта officialMetrics: metricKey → метрика. */
export type SvodMetricsMap = Record<string, SvodMetricLike | undefined>;

/** 18 столбцов D–U одной строки СВОД ТД-ПМ. Значения — как в её ячейках. */
export interface SvodRow {
  /** D — План (кол-во) */
  planCount: number | null;
  /** E — Факт (кол-во) */
  factCount: number | null;
  /** F — Отклонение (кол-во) */
  deviationCount: number | null;
  /** G — Исполнение, % (доля 0..1) */
  executionPct: number | null;
  /** H — ФБ план, тыс. руб. */
  planFB: number | null;
  /** I — КБ план */
  planKB: number | null;
  /** J — МБ план */
  planMB: number | null;
  /** K — Итого план */
  planTotal: number | null;
  /** L — ФБ факт */
  factFB: number | null;
  /** M — КБ факт */
  factKB: number | null;
  /** N — МБ факт */
  factMB: number | null;
  /** O — Итого факт */
  factTotal: number | null;
  /** P — Отклонение сумм */
  amountDeviation: number | null;
  /** Q — Потрачено, % (расход = O/K; шапка листа «Потрачено, %»; доля 0..1). Ключ исторически savingsPct — переименовать в spentPct отдельным шагом. */
  savingsPct: number | null;
  /** R — Экономия ФБ */
  economyFB: number | null;
  /** S — Экономия КБ */
  economyKB: number | null;
  /** T — Экономия МБ */
  economyMB: number | null;
  /** U — Экономия ИТОГО */
  economyTotal: number | null;
}

/** Секция (КП или ЕП) — два периода: 1 квартал и Год. */
export interface SvodSection {
  q1: SvodRow;
  year: SvodRow;
}

/** Блок одного ГРБС (или сводный): КП + ЕП + ИТОГО. */
export interface SvodBlock {
  /** Конкурентные процедуры (ЭА/ЭК/ЭЗК) */
  kp: SvodSection;
  /** Единственный поставщик */
  ep: SvodSection;
  /** ИТОГО = КП + ЕП (как в листе: суммы складываются, проценты пересчитаны) */
  total: SvodSection;
}

/** Вид блока по конкретному ГРБС. */
export interface SvodDepartmentView {
  id: string;
  name: string;
  shortName: string;
  block: SvodBlock;
}

/** Полная сетка СВОД ТД-ПМ для панели просмотра. */
export interface SvodView {
  /** Сводный блок (агрегат по всем ГРБС) — строки 9/14/21/26 листа */
  summary: SvodBlock;
  /** Блок на каждый из 8 ГРБС */
  departments: SvodDepartmentView[];
}

/** Период просмотра. */
export type SvodPeriod = 'q1' | 'year';

// ── Чтение ячеек ─────────────────────────────────────────────────────

function val(m: SvodMetricsMap, key: string): number | null {
  const v = m[key]?.numericValue;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Берёт первое непустое значение из списка ключей (для E: dept='fact', свод='fact_count'). */
function firstVal(m: SvodMetricsMap, keys: string[]): number | null {
  for (const k of keys) {
    const v = val(m, k);
    if (v !== null) return v;
  }
  return null;
}

function readRow(m: SvodMetricsMap, prefix: string): SvodRow {
  return {
    planCount: val(m, `${prefix}.count`),
    factCount: firstVal(m, [`${prefix}.fact`, `${prefix}.fact_count`]),
    deviationCount: val(m, `${prefix}.deviation`),
    executionPct: val(m, `${prefix}.percent`),
    planFB: val(m, `${prefix}.fb_plan`),
    planKB: val(m, `${prefix}.kb_plan`),
    planMB: val(m, `${prefix}.mb_plan`),
    planTotal: val(m, `${prefix}.total_plan`),
    factFB: val(m, `${prefix}.fb_fact`),
    factKB: val(m, `${prefix}.kb_fact`),
    factMB: val(m, `${prefix}.mb_fact`),
    factTotal: val(m, `${prefix}.total_fact`),
    amountDeviation: val(m, `${prefix}.amount_dev`),
    savingsPct: val(m, `${prefix}.savings_pct`),
    economyFB: val(m, `${prefix}.economy_fb`),
    economyKB: val(m, `${prefix}.economy_kb`),
    economyMB: val(m, `${prefix}.economy_mb`),
    economyTotal: val(m, `${prefix}.economy_total`),
  };
}

function readSection(m: SvodMetricsMap, prefixBase: string): SvodSection {
  return {
    q1: readRow(m, `${prefixBase}.q1`),
    year: readRow(m, `${prefixBase}.year`),
  };
}

// ── ИТОГО (КП + ЕП) ──────────────────────────────────────────────────

function add(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}

function ratio(num: number | null, den: number | null): number | null {
  if (den === null || den === 0) return null;
  return (num ?? 0) / den;
}

/** Складывает КП+ЕП в строку ИТОГО ровно как лист: суммы +, проценты пересчёт. */
function sumRows(a: SvodRow, b: SvodRow): SvodRow {
  const planCount = add(a.planCount, b.planCount);
  const factCount = add(a.factCount, b.factCount);
  const planTotal = add(a.planTotal, b.planTotal);
  const factTotal = add(a.factTotal, b.factTotal);
  return {
    planCount,
    factCount,
    deviationCount: add(a.deviationCount, b.deviationCount),
    executionPct: ratio(factCount, planCount), // G = E / D (по штукам, как ИТОГО листа)
    planFB: add(a.planFB, b.planFB),
    planKB: add(a.planKB, b.planKB),
    planMB: add(a.planMB, b.planMB),
    planTotal,
    factFB: add(a.factFB, b.factFB),
    factKB: add(a.factKB, b.factKB),
    factMB: add(a.factMB, b.factMB),
    factTotal,
    amountDeviation: add(a.amountDeviation, b.amountDeviation),
    // Q = «Потрачено, %» (шапка листа СВОД) = O/K = факт/план, как держат ячейки КП/ЕП
    // (orchestrator.ts: savings_pct = factSum/planSum). ИТОГО обязан быть той же семантики,
    // что суммируемые строки — НЕ (K−O)/K (это было бы «недоосвоено», обратный смысл).
    savingsPct: ratio(factTotal, planTotal),
    economyFB: add(a.economyFB, b.economyFB),
    economyKB: add(a.economyKB, b.economyKB),
    economyMB: add(a.economyMB, b.economyMB),
    economyTotal: add(a.economyTotal, b.economyTotal),
  };
}

function readBlock(m: SvodMetricsMap, kpBase: string, epBase: string): SvodBlock {
  const kp = readSection(m, kpBase);
  const ep = readSection(m, epBase);
  return {
    kp,
    ep,
    total: {
      q1: sumRows(kp.q1, ep.q1),
      year: sumRows(kp.year, ep.year),
    },
  };
}

// ── Публичный сборщик ────────────────────────────────────────────────

/**
 * Собирает полную сетку СВОД ТД-ПМ из officialMetrics (её ячеек).
 *
 * @param m officialMetrics из snapshot (или совместимая карта)
 */
export function buildSvodView(m: SvodMetricsMap): SvodView {
  // Сводный блок: competitive.* / sole.* (строки 9/14/21/26 листа)
  const summary = readBlock(m, 'competitive', 'sole');

  // По каждому ГРБС: grbs.{id}.kp.* / grbs.{id}.ep.*
  const departments: SvodDepartmentView[] = DEPARTMENT_REGISTRY.map((d) => ({
    id: d.latinId,
    name: d.fullName,
    shortName: d.shortName,
    block: readBlock(m, `grbs.${d.latinId}.kp`, `grbs.${d.latinId}.ep`),
  }));

  return { summary, departments };
}

/** true, если в карте вообще есть числа СВОД (иначе панель показывает пусто). */
export function hasSvodData(m: SvodMetricsMap | null | undefined): boolean {
  if (!m) return false;
  return (
    val(m, 'competitive.year.count') !== null ||
    val(m, 'competitive.q1.count') !== null ||
    val(m, 'sole.year.count') !== null
  );
}
