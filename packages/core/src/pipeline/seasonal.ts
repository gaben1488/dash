/**
 * seasonal.ts — сезонные аномалии закупок (вынесено из dataset-signals.ts, чанк G-3).
 *
 * Ответственность: детектор сезонных нарушений (ремонт школ вне каникул, зимние
 * дорожные работы, декабрьский рывок, всплеск 4 кв) + его типы.
 *
 * Зависимости: DEPT_COLUMNS + общий аксессор ячейки (utils/row-cells).
 * Обратной зависимости на dataset-signals нет — цикл невозможен.
 */
import { DEPT_COLUMNS, isReadableDeptRow, parseSheetDate, parseSheetNumber, dayNumberOf, productCalendarDay, PRODUCT_UTC_OFFSET_HOURS, SEASONAL_PATTERNS, SEASONAL_PARAMETERS, SEASONAL_RULES, SEASONAL_SCREENING_NOTE, seasonalDeadlineLabel, type SeasonalRuleId } from '@aemr/shared';
import { strFromRow } from '../utils/row-cells.js';

// ────────────────────────────────────────────────────────────
// 11. Seasonal Anomaly Detection
// ────────────────────────────────────────────────────────────

const SEASONAL_RE = SEASONAL_PATTERNS;

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
export type SeasonalAnomalyType = SeasonalRuleId;

/** Seasonal anomaly detected at dataset level */
export interface SeasonalAnomaly {
  type: SeasonalAnomalyType;
  assessment?: 'screening';
  nextAction?: string;
  limitation?: string;
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
  const nowDay = productCalendarDay(now, PRODUCT_UTC_OFFSET_HOURS);
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
    const description = strFromRow(row, DEPT_COLUMNS.SUBJECT); // Subject G, never program D.
    const subprogram = strFromRow(row, DEPT_COLUMNS.PROGRAM_NAME) + ' ' + strFromRow(row, DEPT_COLUMNS.SUBPROGRAM);
    const status = strFromRow(row, DEPT_COLUMNS.DEVIATION_REASON);
    const sourceFactDate = parseDateFromCell(row[DEPT_COLUMNS.FACT_DATE]);
    const factDay = dayNumberOf(sourceFactDate);
    const factDate = factDay !== null && factDay <= nowDay ? sourceFactDate : null;
    const hasMoney = [DEPT_COLUMNS.FB_FACT, DEPT_COLUMNS.KB_FACT, DEPT_COLUMNS.MB_FACT, DEPT_COLUMNS.TOTAL_FACT]
      .some(index => { const value = parseSheetNumber(row[index]); return value !== null && value !== 0; });
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
      if (SEASONAL_PARAMETERS.schoolYearMonths.some(value => value === month + 1)) {
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
      !sourceFactDate && !hasMoney && planDate && dayNumberOf(planDate)! <= nowDay
    ) {
      // Determine procurement year from plan date or reference date
      const procYear = planDate ? planDate.getFullYear() : now.getFullYear();
      const deadline = new Date(procYear, SEASONAL_PARAMETERS.foodDeadline.month - 1, SEASONAL_PARAMETERS.foodDeadline.day); // August 15
      if (nowDay > dayNumberOf(deadline)!) {
        results.push({
          type: 'LATE_SCHOOL_FOOD_CONTRACT',
          severity: 'high',
          rowIndex: i,
          deptId,
          description: `Школьное питание: нет подтверждённого завершения позиции после внутренней даты просмотра ${seasonalDeadlineLabel('food', procYear)}`,
          details: { subordinate, description, status, deadline: deadline.toISOString() },
        });
      }
    }

    // 3. WINTER_ROAD_WORK — дорожные работы зимой
    if (SEASONAL_RE.road.test(description) && factDate) {
      const month = factDate.getMonth(); // Dec=11, Jan=0, Feb=1, Mar=2
      if (SEASONAL_PARAMETERS.winterRoadMonths.some(value => value === month + 1)) {
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
      !sourceFactDate && !hasMoney && planDate && dayNumberOf(planDate)! <= nowDay
    ) {
      const procYear = planDate ? planDate.getFullYear() : now.getFullYear();
      const deadline = new Date(procYear, SEASONAL_PARAMETERS.fuelDeadline.month - 1, SEASONAL_PARAMETERS.fuelDeadline.day); // September 1
      if (nowDay > dayNumberOf(deadline)!) {
        results.push({
          type: 'LATE_FUEL_PROCUREMENT',
          severity: 'critical',
          rowIndex: i,
          deptId,
          description: `Топливо/ГСМ: нет подтверждённого завершения позиции после внутренней даты просмотра ${seasonalDeadlineLabel('fuel', procYear)}`,
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
      if (SEASONAL_PARAMETERS.heatingMonths.some(value => value === month + 1)) {
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
      if (diffDays >= 0 && diffDays < SEASONAL_PARAMETERS.shortDecemberDays) {
        results.push({
          type: 'DECEMBER_RUSH_CONTRACT',
          severity: 'medium',
          rowIndex: i,
          deptId,
          description: `Контракт заключён за ${diffDays} дн. в декабре (план→факт < ${SEASONAL_PARAMETERS.shortDecemberDays} дн.)`,
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
    if (q4Share > SEASONAL_PARAMETERS.fourthQuarterShare) {
      results.push({
        type: 'Q4_SPENDING_SPIKE',
        severity: 'high',
        rowIndex: -1,
        deptId,
        description: `${Math.round(q4Share * 100)}% контрактов заключены в IV квартале (внутренний ориентир ${Math.round(SEASONAL_PARAMETERS.fourthQuarterShare * 100)}%)`,
        details: { q4FactRows, totalFactRows, q4Share: Math.round(q4Share * 100) / 100 },
      });
    }
  }

  return results.map(result => ({ ...result, assessment: 'screening' as const,
    nextAction: SEASONAL_RULES[result.type].action, limitation: SEASONAL_SCREENING_NOTE }));
}
