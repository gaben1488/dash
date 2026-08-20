/**
 * computeUnifiedGrid — единая сетка СВОД из атомов (dept-строк, 33 колонки).
 *
 * Источник истины = CalcEngine, считающий из атомов (НЕ формулы листов).
 * Один проход по строкам каждого ГРБС; каждая строка раскладывается по осям
 * активность(3: ВСЕ/ПМ/ТД, канон п.30) × метод(КП/ЕП) × период(мес/кв/год) × {кол-во, план, факт,
 * экономия по ФБ/КБ/МБ}. Листы — слой сверки (reconcileUnified), не источник.
 *
 * Канон колонок dept-листа (0-based, сверено с xlsx; совпадает с DEPT_COLUMNS
 * после унификации меток: PROGRAM_NAME=3 «графа программы», SUBPROGRAM=4):
 *   0  ID, 6 предмет (для отсева шапок/итогов)
 *   3  графа программы — Наименование программы (X/Х/пусто = нет программы)
 *   5  активность (Программное мероприятие / Текущая деятельность)
 *   11 метод (начинается 'ЕП' → ep, иначе kp)
 *   13 план-дата (→ месяц), 14 план-квартал (→ квартал+год-гейт), 15 план-год
 *   16 факт-дата (Х/X/-/—/н/д/… = нет факта)
 *   7/8/9   план ФБ/КБ/МБ
 *   21/22/23 факт ФБ/КБ/МБ
 *   25/26/27 экономия ФБ/КБ/МБ
 *   29 гейт экономии ('да' = учитывать)
 *
 * Период (квартал/год) берётся из план-КВАРТАЛА (14), как canonical recalculate.ts
 * (getQuarterKey(col O) — основа COUNTIFS листа СВОД ТД-ПМ), НЕ из месяца план-даты.
 * Месяц — из план-даты (13); если она не парсится, месяц = первый месяц квартала,
 * чтобы инвариант §7.2 (год = Σмес = Σкв) держался при недостающей дате.
 *
 * Spec: docs/UNIFIED_SVOD_DESIGN.md §3, §4, §5, §7.
 */

import {
  ACTIVITY_SCOPES,
  matchesActivityScope,
  unifiedKey,
  emptyCell,
  normalizeMethod,
  PROCUREMENT_METHODS,
  hasFactDate,
  isReadableDeptRow,
  type ActivityScope,
  type SvodMethod,
  type SvodPeriodKey,
  type UnifiedCell,
  type UnifiedGrid,
  toNumber,
} from '@aemr/shared';
import { getMonthFromDate } from './recalculate.js';

// ── Канон колонок атома (0-based) ─────────────────────────────────
const COL = {
  ID: 0,
  PROGRAM: 3,
  ACTIVITY: 5,
  SUBJECT: 6,
  METHOD: 11,
  PLAN_DATE: 13,
  PLAN_QUARTER: 14,
  PLAN_YEAR: 15,
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

/** Префиксы шапок/итоговых строк по предмету (как recalculate.ts isSummaryRow). */
const SUMMARY_PREFIXES = ['итого', 'всего', 'справочно'] as const;

/** Известные методы закупки (для классификатора строк-данных). */
const KNOWN_METHODS = new Set<string>(PROCUREMENT_METHODS);

/**
 * Число листа — канон @aemr/shared (toNumber): пробелы-разряды и запятая
 * десятичная; пусто/'-'/нечисло → 0. Прежний parseFloat обрывался на
 * пробеле («1 234,56» → 1) — блок А п.1 пирамиды агрегации.
 */
function num(v: unknown): number {
  return toNumber(v) ?? 0;
}

/** Непустая ячейка (как recalculate.ts cellPresent). */
function cellPresent(v: unknown): boolean {
  return v != null && String(v).trim() !== '';
}

/**
 * Метод строки: канон normalizeMethod() (алиасы «ЭЕП»/«Ед. поставщик»/«ЕП (ст.93)»
 * → ЕП), а не startsWith('ЕП') — тот пропускал алиасы, не начинающиеся с этих
 * букв (чанк F, latent-баг, 0 в реальных данных на 2026-07-11, но словарь
 * METHOD_ALIAS_MAP документирует их как реально встречающиеся на других листах).
 *
 * SvodMethod бинарный ('kp'|'ep', без «неизвестно») — пусто/нераспознанный метод
 * попадает в 'kp' в обеих версиях (не новое поведение, ограничение типа грида).
 */
function methodOf(raw: unknown): SvodMethod {
  return normalizeMethod(raw) === 'ЕП' ? 'ep' : 'kp';
}


/**
 * Квартал из столбца план-квартала (14): 1..4 → q1..q4, иначе null.
 * Зеркало recalculate.ts getQuarterKey(col O) — основа COUNTIFS листа СВОД ТД-ПМ.
 */
function quarterOf(raw: unknown): { q: number; key: SvodPeriodKey } | null {
  const q = num(raw);
  if (q === 1 || q === 2 || q === 3 || q === 4) {
    return { q, key: `q${q}` as SvodPeriodKey };
  }
  return null;
}

/** Строка-шапка/итог (отсев по предмету, столбец 6). */
function isSummaryRow(row: unknown[]): boolean {
  const subject = String(row[COL.SUBJECT] ?? '').trim().toLowerCase();
  return SUMMARY_PREFIXES.some((p) => subject.startsWith(p));
}

/**
 * Эвристика «это реальная строка-данные» (зеркало recalculate.ts classifyRow):
 *   +3 известный метод (L) · +2 известный тип (F) · +2 план-суммы >0.009
 *   +1 план-дата (N) · +1 ID(0) или предмет(6).  Порог: score ≥ 3.
 * Защищает computeUnifiedGrid от сырых ИТОГО/мусорных строк (Task 5 ещё не реализован).
 */
function isDataRow(row: unknown[]): boolean {
  const method = normalizeMethod(row[COL.METHOD]);
  const hasMethod = method ? KNOWN_METHODS.has(method) : false;
  const typeText = String(row[COL.ACTIVITY] ?? '').trim().toLowerCase();
  const hasType = typeText.includes('текущая') || typeText.includes('программное мероприятие');
  const planMoney = num(row[COL.PLAN_FB]) + num(row[COL.PLAN_KB]) + num(row[COL.PLAN_MB]);
  const hasDate = cellPresent(row[COL.PLAN_DATE]);
  const hasIdOrSubject = cellPresent(row[COL.ID]) || cellPresent(row[COL.SUBJECT]);
  const score =
    (hasMethod ? 3 : 0) +
    (hasType ? 2 : 0) +
    (planMoney > 0.009 ? 2 : 0) +
    (hasDate ? 1 : 0) +
    (hasIdOrSubject ? 1 : 0);
  return score >= 3;
}

/** Учитывать ли экономию: гейт (столбец 29) == 'да'. */
function economyApproved(raw: unknown): boolean {
  return String(raw ?? '').trim().toLowerCase() === 'да';
}

/**
 * Аккумулирует вклад строки в ячейку сетки (создаёт пустую при первом доступе).
 * Гейты применяются ВЫШЕ (в computeUnifiedGrid): factCount/факт-суммы — только при
 * наличии факт-даты; экономия — только при countEconomy (fact && gate='да').
 * Здесь — чистое сложение готового contrib.
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
 * Период строки задаёт план-КВАРТАЛ (столбец 14) — он же гейт года (как
 * recalculate.ts: год/квартал считаются только при валидном план-квартале,
 * COUNTIFS-основа листа СВОД ТД-ПМ). Месяц берётся из план-даты (13); если она
 * не парсится — месяц = первый месяц квартала, чтобы держался §7.2 (год = Σмес = Σкв).
 * Строка без валидного план-квартала в периоды плана не входит.
 *
 * @param deptRows карта `grbsId → строки атома (unknown[][])`.
 *   Каждая строка — плоский массив колонок dept-листа (0-based).
 * @param targetYear если задан — строки с план-годом (столбец 15) ≠ targetYear
 *   пропускаются (лист считает per-year COUNTIFS; многолетний dept-лист иначе
 *   сваливается в одни ячейки). 0/пусто в столбце 15 не отсекается.
 */
export function computeUnifiedGrid(
  deptRows: Record<string, unknown[][]>,
  targetYear?: number,
): UnifiedGrid {
  const cells: Record<string, UnifiedCell> = {};
  const grbsIds: string[] = [];

  for (const grbsId of Object.keys(deptRows)) {
    grbsIds.push(grbsId);
    const rows = deptRows[grbsId] ?? [];

    for (const row of rows) {
      // Одна дверь длины строки (реестр багов 09.07.2026, п.13 «расчёт сводной
      // сетки без проверки длины строки»). Обрубок короче колонки K не может
      // быть закупкой: раньше он проходил дальше и добавлял в сетку плановую
      // процедуру с нулевыми суммами — счёт рос, деньги нет.
      if (!isReadableDeptRow(row)) continue;

      // Отсев шапок/итогов и не-данных (как recalculate.ts) — защита от сырых строк.
      if (isSummaryRow(row)) continue;
      if (!isDataRow(row)) continue;

      // Фильтр по план-году (столбец 15) — для многолетних листов.
      if (targetYear) {
        const rowYear = num(row[COL.PLAN_YEAR]);
        if (rowYear > 0 && rowYear !== targetYear) continue;
      }

      // Период = план-квартал (14). Нет валидного квартала → строка вне периодов плана.
      const quarter = quarterOf(row[COL.PLAN_QUARTER]);
      if (!quarter) continue;

      // Месяц из план-даты (13); если не парсится — первый месяц квартала (§7.2).
      const m = getMonthFromDate(row[COL.PLAN_DATE]) ?? (quarter.q - 1) * 3 + 1;

      const method = methodOf(row[COL.METHOD]);
      const fact = hasFactDate(row[COL.FACT_DATE]);
      const countEconomy = fact && economyApproved(row[COL.ECO_GATE]);

      const contrib = {
        planCount: 1, // плановая строка реестра — всегда 1
        factCount: fact ? 1 : 0,
        planFB: num(row[COL.PLAN_FB]),
        planKB: num(row[COL.PLAN_KB]),
        planMB: num(row[COL.PLAN_MB]),
        // факт-суммы считаются только при наличии факт-даты; иначе это не исполнение.
        factFB: fact ? num(row[COL.FACT_FB]) : 0,
        factKB: fact ? num(row[COL.FACT_KB]) : 0,
        factMB: fact ? num(row[COL.FACT_MB]) : 0,
        ecoFB: num(row[COL.ECO_FB]),
        ecoKB: num(row[COL.ECO_KB]),
        ecoMB: num(row[COL.ECO_MB]),
        countEconomy,
      };

      const monthKey = `m${m}` as SvodPeriodKey;
      const quarterKey = quarter.key;

      // Один проход по 3 срезам активности (ВСЕ/ПМ/ТД — канон п.30 интервью
      // 14.08.2026: срез «ТД-ПМ» упразднён, ТД-строки с заполненной графой
      // программы входят в ТД целиком); каждый подходящий срез получает вклад
      // в три периода (месяц/квартал/год).
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

function addCellInto(target: UnifiedCell, source: UnifiedCell): void {
  target.planCount += source.planCount;
  target.factCount += source.factCount;
  target.planFB += source.planFB;
  target.planKB += source.planKB;
  target.planMB += source.planMB;
  target.factFB += source.factFB;
  target.factKB += source.factKB;
  target.factMB += source.factMB;
  target.economyFB += source.economyFB;
  target.economyKB += source.economyKB;
  target.economyMB += source.economyMB;
}

function pickReconCell(grid: UnifiedGrid, method: SvodMethod, period: SvodPeriodKey, grbsId?: string): UnifiedCell {
  if (grbsId) return grid.cells[unifiedKey(grbsId, 'all', method, period)] ?? emptyCell();
  const acc = emptyCell();
  for (const id of grid.grbsIds) {
    const cell = grid.cells[unifiedKey(id, 'all', method, period)];
    if (cell) addCellInto(acc, cell);
  }
  return acc;
}

function reconStatus(deltaPct: number): UnifiedReconStatus {
  const abs = Math.abs(deltaPct);
  return abs < 1 ? 'ok' : abs < 5 ? 'warning' : 'high';
}

/**
 * Сверяет срез `ВСЕ` единой сетки против ячеек листа СВОД ТД-ПМ.
 *
 * Лист СВОД ТД-ПМ — сводный блок «ВСЕ» (ТД+ПМ, X37=`*`), периоды 1 кв+Год,
 * методы КП(competitive)/ЕП(sole). Сверяем grid['all', метод, период] по
 * кол-ву и суммам план/факт/экономия. Официальная метрика с numericValue=null
 * (нет ячейки) пропускается — нечего сверять.
 *
 * @param grid результат computeUnifiedGrid
 * @param officialMetrics плоская карта `metricKey → {numericValue}` из snapshot
 *   (ячейки листа СВОД ТД-ПМ; ключи — как в svod-view.ts / buildSvodView).
 * @param grbsId optional блок ГРБС для точечной сверки. Если не передан,
 *   сводные ключи (competitive / sole) сверяются с суммой всех ГРБС.
 */
export function reconcileUnified(
  grid: UnifiedGrid,
  officialMetrics: Record<string, UnifiedOfficialMetric | undefined>,
  grbsId?: string,
): UnifiedReconRow[] {
  const out: UnifiedReconRow[] = [];

  for (const method of ['kp', 'ep'] as const) {
    const prefix = METHOD_TO_OFFICIAL_PREFIX[method];
    for (const period of OFFICIAL_PERIODS) {
      const cell = pickReconCell(grid, method, period, grbsId);
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
