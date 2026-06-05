/**
 * computeUnifiedGrid — единая сетка СВОД из атомов (dept-строк, 33 колонки).
 *
 * Источник истины = CalcEngine, считающий из атомов (НЕ формулы листов).
 * Один проход по строкам каждого ГРБС; каждая строка раскладывается по осям
 * активность(4) × метод(КП/ЕП) × период(мес/кв/год) × {кол-во, план, факт,
 * экономия по ФБ/КБ/МБ}. Листы — слой сверки (reconcileUnified), не источник.
 *
 * Канон колонок dept-листа (0-based, сверено с xlsx — метки column-map.ts врут,
 * PROGRAM_NAME/DESCRIPTION перепутаны):
 *   3  графа программы (X/Х/пусто = нет программы)
 *   5  активность (Программное мероприятие / Текущая деятельность)
 *   11 метод (начинается 'ЕП' → ep, иначе kp)
 *   13 план-дата (→ месяц), 14 план-квартал, 15 план-год
 *   16 факт-дата (Х/X/пусто = нет факта)
 *   7/8/9   план ФБ/КБ/МБ
 *   21/22/23 факт ФБ/КБ/МБ
 *   25/26/27 экономия ФБ/КБ/МБ
 *   29 гейт экономии ('да' = учитывать)
 *
 * Spec: docs/UNIFIED_SVOD_DESIGN.md §3, §4, §5, §7.
 */

import {
  ACTIVITY_SCOPES,
  matchesActivityScope,
  unifiedKey,
  emptyCell,
  type ActivityScope,
  type SvodMethod,
  type SvodPeriodKey,
  type UnifiedCell,
  type UnifiedGrid,
} from '@aemr/shared';
import { getMonthFromDate } from './recalculate.js';

// ── Канон колонок атома (0-based) ─────────────────────────────────
const COL = {
  PROGRAM: 3,
  ACTIVITY: 5,
  METHOD: 11,
  PLAN_DATE: 13,
  FACT_DATE: 16,
  PLAN_FB: 7,
  PLAN_KB: 8,
  PLAN_MB: 9,
  FACT_FB: 21,
  FACT_KB: 22,
  FACT_MB: 23,
  ECO_FB: 25,
  ECO_KB: 26,
  ECO_MB: 27,
  ECO_GATE: 29,
} as const;

/** Маркеры «нет факта» в столбце факт-даты (16). */
const FACT_EMPTY = new Set(['х', 'x', '']);

/** Безопасный парсер числа: пусто/'-'/нечисло → 0. */
function num(v: unknown): number {
  if (v == null) return 0;
  const s = String(v).trim();
  if (s === '' || s === '-') return 0;
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/** Метод строки: столбец L начинается с 'ЕП' → ep, иначе kp. */
function methodOf(raw: unknown): SvodMethod {
  return String(raw ?? '').trim().toUpperCase().startsWith('ЕП') ? 'ep' : 'kp';
}

/** Есть ли факт: столбец 16 не пустой и не Х/X. */
function hasFact(raw: unknown): boolean {
  return !FACT_EMPTY.has(String(raw ?? '').trim().toLowerCase());
}

/** Учитывать ли экономию: гейт (столбец 29) == 'да'. */
function economyApproved(raw: unknown): boolean {
  return String(raw ?? '').trim().toLowerCase() === 'да';
}

/**
 * Аккумулирует вклад строки в ячейку сетки (создаёт пустую при первом доступе).
 * Факт-суммы добавляются всегда (освоенные суммы); экономия — только при gate=да.
 */
function addToCell(
  cells: Record<string, UnifiedCell>,
  key: string,
  contrib: {
    planCount: number;
    factCount: number;
    planFB: number; planKB: number; planMB: number;
    factFB: number; factKB: number; factMB: number;
    ecoFB: number; ecoKB: number; ecoMB: number;
    countEconomy: boolean;
  },
): void {
  let c = cells[key];
  if (!c) {
    c = emptyCell();
    cells[key] = c;
  }
  c.planCount += contrib.planCount;
  c.factCount += contrib.factCount;
  c.planFB += contrib.planFB;
  c.planKB += contrib.planKB;
  c.planMB += contrib.planMB;
  c.factFB += contrib.factFB;
  c.factKB += contrib.factKB;
  c.factMB += contrib.factMB;
  if (contrib.countEconomy) {
    c.economyFB += contrib.ecoFB;
    c.economyKB += contrib.ecoKB;
    c.economyMB += contrib.ecoMB;
  }
}

/**
 * Считает единую сетку СВОД из dept-строк всех ГРБС.
 *
 * @param deptRows карта `grbsId → строки атома (unknown[][])`.
 *   Каждая строка — плоский массив колонок dept-листа (0-based).
 *   Строка без распознанного месяца план-даты (столбец 13) пропускается.
 */
export function computeUnifiedGrid(deptRows: Record<string, unknown[][]>): UnifiedGrid {
  const cells: Record<string, UnifiedCell> = {};
  const grbsIds: string[] = [];

  for (const grbsId of Object.keys(deptRows)) {
    grbsIds.push(grbsId);
    const rows = deptRows[grbsId] ?? [];

    for (const row of rows) {
      if (!row) continue;

      // Период из план-даты — обязателен. Нет месяца → строка не попадает в сетку.
      const m = getMonthFromDate(row[COL.PLAN_DATE]);
      if (m == null) continue;
      const q = Math.ceil(m / 3);

      const method = methodOf(row[COL.METHOD]);
      const fact = hasFact(row[COL.FACT_DATE]);
      const countEconomy = economyApproved(row[COL.ECO_GATE]);

      const contrib = {
        planCount: 1, // плановая строка реестра — всегда 1
        factCount: fact ? 1 : 0,
        planFB: num(row[COL.PLAN_FB]),
        planKB: num(row[COL.PLAN_KB]),
        planMB: num(row[COL.PLAN_MB]),
        // факт-суммы — освоенные деньги, добавляем всегда (gate не про факт)
        factFB: num(row[COL.FACT_FB]),
        factKB: num(row[COL.FACT_KB]),
        factMB: num(row[COL.FACT_MB]),
        ecoFB: num(row[COL.ECO_FB]),
        ecoKB: num(row[COL.ECO_KB]),
        ecoMB: num(row[COL.ECO_MB]),
        countEconomy,
      };

      const monthKey = `m${m}` as SvodPeriodKey;
      const quarterKey = `q${q}` as SvodPeriodKey;

      // Один проход по 4 срезам активности; каждый подходящий срез получает вклад
      // в три периода (месяц/квартал/год). td_pm ⊂ td — правило в matchesActivityScope.
      for (const scope of ACTIVITY_SCOPES) {
        if (!matchesActivityScope(scope, row[COL.ACTIVITY], row[COL.PROGRAM])) continue;
        addToCell(cells, unifiedKey(grbsId, scope, method, monthKey), contrib);
        addToCell(cells, unifiedKey(grbsId, scope, method, quarterKey), contrib);
        addToCell(cells, unifiedKey(grbsId, scope, method, 'year'), contrib);
      }
    }
  }

  return {
    cells,
    grbsIds,
    scopes: [...ACTIVITY_SCOPES] as ActivityScope[],
  };
}

// ── reconcileUnified — сверка против листа СВОД ТД-ПМ ──────────────

/** Минимальная форма официальной метрики (структурно = NormalizedMetric / SvodMetricLike). */
export interface UnifiedOfficialMetric {
  numericValue: number | null;
}

export type UnifiedReconStatus = 'ok' | 'warning' | 'high';

export interface UnifiedReconRow {
  /** Ключ официальной метрики СВОД ТД-ПМ (напр. `competitive.q1.total_plan`). */
  key: string;
  /** Значение из CalcEngine-сетки (срез ВСЕ). */
  calc: number;
  /** Значение из ячейки листа СВОД ТД-ПМ. */
  official: number;
  /** Относительное расхождение, % (calc−official)/max(|official|,1)·100. */
  deltaPct: number;
  /** ok <1% · warning <5% · high ≥5%. */
  status: UnifiedReconStatus;
}

/** Метод сетки → префикс ключа официальной метрики листа СВОД ТД-ПМ (сводный блок). */
const METHOD_TO_OFFICIAL_PREFIX: Record<SvodMethod, string> = {
  kp: 'competitive',
  ep: 'sole',
};

/** Поле ячейки сетки → суффикс ключа официальной метрики. */
const FIELD_TO_OFFICIAL_SUFFIX: Array<{ suffix: string; pick: (c: UnifiedCell) => number }> = [
  { suffix: 'count', pick: (c) => c.planCount },
  { suffix: 'total_plan', pick: (c) => c.planFB + c.planKB + c.planMB },
  { suffix: 'total_fact', pick: (c) => c.factFB + c.factKB + c.factMB },
  { suffix: 'economy_total', pick: (c) => c.economyFB + c.economyKB + c.economyMB },
];

/** Периоды, которые покрывает лист СВОД ТД-ПМ. */
const OFFICIAL_PERIODS: SvodPeriodKey[] = ['q1', 'year'];

function reconStatus(deltaPct: number): UnifiedReconStatus {
  const abs = Math.abs(deltaPct);
  return abs < 1 ? 'ok' : abs < 5 ? 'warning' : 'high';
}

/**
 * Сверяет срез `ВСЕ` единой сетки против ячеек листа СВОД ТД-ПМ.
 *
 * Лист СВОД ТД-ПМ — сводный блок «ВСЕ» (ТД+ПМ, X37=`*`), периоды Q1+Год,
 * методы КП(competitive)/ЕП(sole). Сверяем grid['all', метод, период] по
 * кол-ву и суммам план/факт/экономия. Официальная метрика с numericValue=null
 * (нет ячейки) пропускается — нечего сверять.
 *
 * @param grid результат computeUnifiedGrid
 * @param officialMetrics плоская карта `metricKey → {numericValue}` из snapshot
 *   (ячейки листа СВОД ТД-ПМ; ключи — как в svod-view.ts / buildSvodView).
 * @param grbsId блок ГРБС для сверки (по умолчанию сводный — 'all' срез по всем).
 *   Сводные ключи (competitive / sole) агрегируют все ГРБС, поэтому grbsId
 *   должен указывать на ту же агрегированную сетку (обычно ключ сводного ГРБС).
 */
export function reconcileUnified(
  grid: UnifiedGrid,
  officialMetrics: Record<string, UnifiedOfficialMetric | undefined>,
  grbsId: string = grid.grbsIds[0] ?? 'all',
): UnifiedReconRow[] {
  const out: UnifiedReconRow[] = [];

  for (const method of ['kp', 'ep'] as const) {
    const prefix = METHOD_TO_OFFICIAL_PREFIX[method];
    for (const period of OFFICIAL_PERIODS) {
      const cell = grid.cells[unifiedKey(grbsId, 'all', method, period)] ?? emptyCell();
      for (const { suffix, pick } of FIELD_TO_OFFICIAL_SUFFIX) {
        const key = `${prefix}.${period}.${suffix}`;
        const official = officialMetrics[key]?.numericValue;
        // null/отсутствует → нечего сверять, пропускаем
        if (official == null || !Number.isFinite(official)) continue;
        const calc = pick(cell);
        const base = Math.max(Math.abs(official), 1);
        const deltaPct = ((calc - official) / base) * 100;
        out.push({ key, calc, official, deltaPct, status: reconStatus(deltaPct) });
      }
    }
  }

  return out;
}
