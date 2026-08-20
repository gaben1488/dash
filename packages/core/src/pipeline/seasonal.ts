/**
 * seasonal.ts — сезонные аномалии закупок (вынесено из dataset-signals.ts, чанк G-3).
 *
 * Ответственность: детектор сезонных нарушений (ремонт школ вне каникул, зимние
 * дорожные работы, декабрьский рывок, всплеск 4 кв) + его типы.
 *
 * Зависимости: DEPT_COLUMNS + общий аксессор ячейки (utils/row-cells).
 * Обратной зависимости на dataset-signals нет — цикл невозможен.
 */
import { DEPT_COLUMNS, isReadableDeptRow, parseSheetDate } from '@aemr/shared';
import { strFromRow } from '../utils/row-cells.js';

// ────────────────────────────────────────────────────────────
// 11. Seasonal Anomaly Detection
// ────────────────────────────────────────────────────────────

/** Regex patterns for seasonal signal detection */
const SEASONAL_RE = {
  repair: /ремонт|модерниз|реконструк/i,
  school: /школ|образов|детс|гимназ|лицей/i,
  food: /питан|пищ|обед|завтрак|столов/i,
  road: /дорог|асфальт|покрыт|тротуар|благоуст/i,
  fuel: /топлив|угл[яеьюи]|мазут|дизельн|ГСМ|котельн.*снабж/i,
  boiler: /котельн|отоплен|теплоснабж/i,
  // signed-паттерн (/подписан|заключен|исполнен/) СНЯТ 14.08.2026 — канон
  // п.27 интервью: статус «заключено» выводится только из структурной даты
  // факта (Q), свободный текст U машинно не интерпретируется (тот же класс,
  // что баг #16 охоты: «не заключен» матчился как «заключен»).
} as const;

/**
 * Parse a DD.MM.YYYY date string (or Date object) from a row cell.
 * Returns null for invalid / missing values.
 */
function parseDateFromCell(val: unknown): Date | null {
  // Делегирует единому канону @aemr/shared/parseSheetDate. Раньше своя копия НЕ
  // понимала Google-serial → 7 сезонных детекторов были мертвы на 6/8 листов.
  return parseSheetDate(val);
}

/** Seasonal anomaly type identifiers */
export type SeasonalAnomalyType =
  | 'SCHOOL_REPAIR_OUTSIDE_HOLIDAYS'
  | 'LATE_SCHOOL_FOOD_CONTRACT'
  | 'WINTER_ROAD_WORK'
  | 'LATE_FUEL_PROCUREMENT'
  | 'BOILER_REPAIR_HEATING_SEASON'
  | 'Q4_SPENDING_SPIKE'
  | 'DECEMBER_RUSH_CONTRACT';

/** Seasonal anomaly detected at dataset level */
export interface SeasonalAnomaly {
  type: SeasonalAnomalyType;
  severity: 'critical' | 'high' | 'medium';
  /** Index in the rows array (-1 for aggregate signals like Q4_SPENDING_SPIKE) */
  rowIndex: number;
  // Управление известно не всегда: часть признаков считается по всей книге.
  deptId?: string | undefined;
  /** Human-readable Russian description */
  description: string;
  /** Signal-specific data */
  details: Record<string, unknown>;
}

export function detectSeasonalAnomalies(
  rows: unknown[][],
  deptId?: string,
  referenceDate?: Date,
): SeasonalAnomaly[] {
  const now = referenceDate ?? new Date();
  const results: SeasonalAnomaly[] = [];

  // Per-row counters for Q4_SPENDING_SPIKE
  let totalFactRows = 0;
  let q4FactRows = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    // Одна дверь длины строки (реестр багов 09.07.2026, пп.12-13): здесь стояло
    // «не короче 21», у соседей — 25, у единой сетки — ничего.
    if (!isReadableDeptRow(row)) continue;

    const subordinate = strFromRow(row, DEPT_COLUMNS.SUBORDINATE);
    const description = strFromRow(row, DEPT_COLUMNS.PROGRAM_NAME); // D=3 «графа программы» (ист. имя description)
    const subprogram = strFromRow(row, DEPT_COLUMNS.SUBPROGRAM);    // E=4 подпрограмма
    const status = strFromRow(row, DEPT_COLUMNS.DEVIATION_REASON);
    const factDate = parseDateFromCell(row[DEPT_COLUMNS.FACT_DATE]);
    const planDate = parseDateFromCell(row[DEPT_COLUMNS.PLAN_DATE]);

    // Track Q4 stats
    if (factDate) {
      totalFactRows++;
      const month = factDate.getMonth(); // 0-based: Oct=9, Nov=10, Dec=11
      if (month >= 9) q4FactRows++;
    }

    const descOrProg = description + ' ' + subprogram;
    const contextAll = subordinate + ' ' + description + ' ' + subprogram;

    // 1. SCHOOL_REPAIR_OUTSIDE_HOLIDAYS — ремонт школ вне каникул
    if (
      SEASONAL_RE.repair.test(descOrProg) &&
      SEASONAL_RE.school.test(contextAll) &&
      factDate
    ) {
      const month = factDate.getMonth(); // 0=Jan..11=Dec
      // School year = September(8) through May(4)
      if (month >= 8 || month <= 4) {
        results.push({
          type: 'SCHOOL_REPAIR_OUTSIDE_HOLIDAYS',
          severity: 'critical',
          rowIndex: i,
          deptId,
          description: `Ремонт образовательного учреждения в учебный период (${factDate.toLocaleDateString('ru-RU')})`,
          details: { subordinate, description, factDate: factDate.toISOString(), month: month + 1 },
        });
      }
    }

    // 2. LATE_SCHOOL_FOOD_CONTRACT — контракт на питание не заключён после 15 августа
    // «Не заключён» = нет даты факта Q (канон п.27): прежний гейт по тексту
    // статуса пропускал строку со словами «контракт заключен» без даты.
    if (
      SEASONAL_RE.food.test(description) &&
      SEASONAL_RE.school.test(contextAll) &&
      !factDate
    ) {
      // Determine procurement year from plan date or reference date
      const procYear = planDate ? planDate.getFullYear() : now.getFullYear();
      const deadline = new Date(procYear, 7, 15); // August 15
      if (now > deadline) {
        results.push({
          type: 'LATE_SCHOOL_FOOD_CONTRACT',
          severity: 'high',
          rowIndex: i,
          deptId,
          description: `Контракт на школьное питание не заключён после 15.08.${procYear}`,
          details: { subordinate, description, status, deadline: deadline.toISOString() },
        });
      }
    }

    // 3. WINTER_ROAD_WORK — дорожные работы зимой
    if (SEASONAL_RE.road.test(description) && factDate) {
      const month = factDate.getMonth(); // Dec=11, Jan=0, Feb=1, Mar=2
      if (month === 11 || month <= 2) {
        results.push({
          type: 'WINTER_ROAD_WORK',
          severity: 'critical',
          rowIndex: i,
          deptId,
          description: `Дорожные/благоустроительные работы в зимний период (${factDate.toLocaleDateString('ru-RU')})`,
          details: { description, factDate: factDate.toISOString(), month: month + 1 },
        });
      }
    }

    // 4. LATE_FUEL_PROCUREMENT — топливо не закуплено к отопительному сезону
    // «Не закуплено» = нет даты факта Q (канон п.27, см. п.2 выше).
    if (
      SEASONAL_RE.fuel.test(description) &&
      !factDate
    ) {
      const procYear = planDate ? planDate.getFullYear() : now.getFullYear();
      const deadline = new Date(procYear, 8, 1); // September 1
      if (now > deadline) {
        results.push({
          type: 'LATE_FUEL_PROCUREMENT',
          severity: 'critical',
          rowIndex: i,
          deptId,
          description: `Топливо/ГСМ не закуплено к началу отопительного сезона (01.09.${procYear})`,
          details: { description, status, deadline: deadline.toISOString() },
        });
      }
    }

    // 5. BOILER_REPAIR_HEATING_SEASON — ремонт котельной в отопительный сезон
    if (
      SEASONAL_RE.boiler.test(description) &&
      SEASONAL_RE.repair.test(description) &&
      factDate
    ) {
      const month = factDate.getMonth(); // Oct=9..Apr=3
      if (month >= 9 || month <= 3) {
        results.push({
          type: 'BOILER_REPAIR_HEATING_SEASON',
          severity: 'high',
          rowIndex: i,
          deptId,
          description: `Ремонт котельной/теплоснабжения в отопительный сезон (${factDate.toLocaleDateString('ru-RU')})`,
          details: { description, factDate: factDate.toISOString(), month: month + 1 },
        });
      }
    }

    // 7. DECEMBER_RUSH_CONTRACT — подозрительно быстрый контракт в декабре
    // Сама дата факта и есть признак заключения (канон п.27): прежнее
    // требование слова «подписан» в статусе пропускало строки без него.
    if (
      factDate &&
      planDate &&
      factDate.getMonth() === 11 // December
    ) {
      const diffMs = factDate.getTime() - planDate.getTime();
      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays >= 0 && diffDays < 15) {
        results.push({
          type: 'DECEMBER_RUSH_CONTRACT',
          severity: 'medium',
          rowIndex: i,
          deptId,
          description: `Контракт заключён за ${diffDays} дн. в декабре (план→факт < 15 дн.)`,
          details: {
            description,
            planDate: planDate.toISOString(),
            factDate: factDate.toISOString(),
            daysDiff: diffDays,
          },
        });
      }
    }
  }

  // 6. Q4_SPENDING_SPIKE — аномальная концентрация в 4 кв
  if (totalFactRows > 0) {
    const q4Share = q4FactRows / totalFactRows;
    if (q4Share > 0.40) {
      results.push({
        type: 'Q4_SPENDING_SPIKE',
        severity: 'high',
        rowIndex: -1,
        deptId,
        description: `${Math.round(q4Share * 100)}% контрактов заключены в IV квартале (порог 40%)`,
        details: { q4FactRows, totalFactRows, q4Share: Math.round(q4Share * 100) / 100 },
      });
    }
  }

  return results;
}
