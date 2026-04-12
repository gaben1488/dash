/**
 * report-map.ts — Полная карта ячеек листа «СВОД ТД-ПМ»
 *
 * Структура столбцов:
 *   D  — План (кол-во)          H  — ФБ план     L  — ФБ факт     U — Экономия
 *   E  — Факт (кол-во)          I  — КБ план     M  — КБ факт
 *   F  — Отклонение (план-факт)  J  — МБ план     N  — МБ факт
 *   G  — Исполнение %            K  — Итого план   O  — Итого факт
 *
 * Все суммы в тыс. руб.
 */

import type { ReportMapEntry, Department } from './types.js';

// ────────────────────────────────────────────────────────────────
// 1. Идентификаторы департаментов (ГРБС)
// ────────────────────────────────────────────────────────────────

/** Идентификаторы всех 8 ГРБС */
export const DEPARTMENT_IDS = [
  'uer', 'uio', 'uagzo', 'ufbp', 'ud', 'udtx', 'uksimp', 'uo',
] as const;

export type DepartmentId = (typeof DEPARTMENT_IDS)[number];

/** Полные русские наименования управлений */
export const DEPARTMENT_NAMES: Record<DepartmentId, string> = {
  uer:    'Управление экономического развития',
  uio:    'Управление имущественных отношений',
  uagzo:  'Управление архитектуры, градостроительства и земельных отношений',
  ufbp:   'Управление финансово-бюджетной политики',
  ud:     'Управление делами',
  udtx:   'Управление дорожно-транспортного хозяйства',
  uksimp: 'Управление культуры, спорта и молодёжной политики',
  uo:     'Управление образования',
} as const;

/** Краткие русские наименования */
export const DEPARTMENT_SHORT_NAMES: Record<DepartmentId, string> = {
  uer:    'УЭР',
  uio:    'УИО',
  uagzo:  'УАГЗО',
  ufbp:   'УФБП',
  ud:     'УД',
  udtx:   'УДТХ',
  uksimp: 'УКСиМП',
  uo:     'УО',
} as const;

// ────────────────────────────────────────────────────────────────
// 2. Название листа
// ────────────────────────────────────────────────────────────────

/** Имя сводного листа в Google Sheets */
export const SVOD_SHEET = 'СВОД ТД-ПМ' as const;

// ────────────────────────────────────────────────────────────────
// 3. Маппинг столбцов → 0-based индекс
// ────────────────────────────────────────────────────────────────

/**
 * Столбцы листа СВОД ТД-ПМ: буква → 0-based индекс.
 * A=0, B=1, ... Z=25, AA=26, AB=27, ... AG=32
 */
export const COLUMNS = {
  A: 0,   B: 1,   C: 2,   D: 3,   E: 4,   F: 5,   G: 6,
  H: 7,   I: 8,   J: 9,   K: 10,  L: 11,  M: 12,  N: 13,
  O: 14,  P: 15,  Q: 16,  R: 17,  S: 18,  T: 19,  U: 20,
  V: 21,  W: 22,  X: 23,  Y: 24,  Z: 25,
  AA: 26, AB: 27, AC: 28, AD: 29, AE: 30, AF: 31, AG: 32,
} as const;

export type ColumnLetter = keyof typeof COLUMNS;

/** Столбцы, содержащие формулы (ожидаем, что НЕ будут вручную) */
export const FORMULA_COLUMNS: ColumnLetter[] = [
  'K', 'O', 'P', 'R', 'S', 'T', 'Y', 'Z', 'AA', 'AB', 'AC',
];

/** Столбцы с правилами валидации данных */
export const RULE_COLUMNS = {
  /** F (5) — Отклонение: должно быть = D - E */
  F: COLUMNS.F,
  /** L (11) — ФБ факт: проверка целостности */
  L: COLUMNS.L,
  /** AD (29) — Признак/флаг */
  AD: COLUMNS.AD,
} as const;

// ────────────────────────────────────────────────────────────────
// 4. Конфигурация строк по департаменту
// ────────────────────────────────────────────────────────────────

/**
 * Блок строк для одного ГРБС в листе СВОД ТД-ПМ.
 *
 * Каждый блок содержит:
 * - КП (конкурентные процедуры): Q1 и Year
 * - ЕП (единственный поставщик): Q1 и Year
 * - Итоговая строка ЕП (ЕП Total)
 * - Процент ЕП (%ЕП)
 * - Ячейки экономии (КП и ЕП), если есть
 */
export interface DepartmentRowConfig {
  /** Идентификатор ГРБС */
  id: DepartmentId;
  /** Конкурентные процедуры — строка 1 квартала */
  kpQ1: number;
  /** Конкурентные процедуры — строка года */
  kpYear: number;
  /** Единственный поставщик — строка 1 квартала */
  epQ1: number;
  /** Единственный поставщик — строка года */
  epYear: number;
  /** Итоговая строка ЕП (общее количество) — ячейка столбца D или E */
  epTotalCell: string;
  /** Процент ЕП — ячейка столбца G */
  epPercentCell: string;
  /** Экономия по КП (столбец U), null если не заполняется */
  economyKpCell: string | null;
  /** Экономия по ЕП (столбец U), null если не заполняется */
  economyEpCell: string | null;
  /** Экономия КП ФБ (столбец R) */
  economyKpFbCell?: string | null;
  /** Экономия КП КБ (столбец S) */
  economyKpKbCell?: string | null;
  /** Экономия КП МБ (столбец T) */
  economyKpMbCell?: string | null;
  /** Экономия ЕП ФБ (столбец R) */
  economyEpFbCell?: string | null;
  /** Экономия ЕП КБ (столбец S) */
  economyEpKbCell?: string | null;
  /** Экономия ЕП МБ (столбец T) */
  economyEpMbCell?: string | null;
}

/**
 * Конфигурация строк для каждого ГРБС.
 *
 * Ряды указаны как номера строк Google Sheets (1-based).
 * Столбцы D..U читаются из каждой строки.
 */
export const DEPARTMENT_ROWS: Record<DepartmentId, DepartmentRowConfig> = {
  uer: {
    id: 'uer',
    kpQ1: 42,   kpYear: 47,
    epQ1: 53,   epYear: 58,
    epTotalCell: 'D58',   epPercentCell: 'G64',
    economyKpCell: 'U47', economyEpCell: 'U58',
    economyKpFbCell: 'R47', economyKpKbCell: 'S47', economyKpMbCell: 'T47',
    economyEpFbCell: 'R58', economyEpKbCell: 'S58', economyEpMbCell: 'T58',
  },
  uio: {
    id: 'uio',
    kpQ1: 72,   kpYear: 77,
    epQ1: 83,   epYear: 88,
    epTotalCell: 'D88',   epPercentCell: 'G94',
    economyKpCell: 'U77', economyEpCell: 'U88',
    economyKpFbCell: 'R77', economyKpKbCell: 'S77', economyKpMbCell: 'T77',
    economyEpFbCell: 'R88', economyEpKbCell: 'S88', economyEpMbCell: 'T88',
  },
  uagzo: {
    id: 'uagzo',
    kpQ1: 102,  kpYear: 107,
    epQ1: 113,  epYear: 118,
    epTotalCell: 'D118',  epPercentCell: 'G124',
    economyKpCell: 'U107', economyEpCell: 'U118',
    economyKpFbCell: 'R107', economyKpKbCell: 'S107', economyKpMbCell: 'T107',
    economyEpFbCell: 'R118', economyEpKbCell: 'S118', economyEpMbCell: 'T118',
  },
  ufbp: {
    id: 'ufbp',
    kpQ1: 132,  kpYear: 137,
    epQ1: 143,  epYear: 148,
    epTotalCell: 'D148',  epPercentCell: 'G154',
    economyKpCell: 'U137', economyEpCell: 'U148',
    economyKpFbCell: 'R137', economyKpKbCell: 'S137', economyKpMbCell: 'T137',
    economyEpFbCell: 'R148', economyEpKbCell: 'S148', economyEpMbCell: 'T148',
  },
  ud: {
    id: 'ud',
    kpQ1: 163,  kpYear: 168,
    epQ1: 175,  epYear: 180,
    epTotalCell: 'D180',  epPercentCell: 'G186',
    economyKpCell: 'U168', economyEpCell: 'U180',
    economyKpFbCell: 'R168', economyKpKbCell: 'S168', economyKpMbCell: 'T168',
    economyEpFbCell: 'R180', economyEpKbCell: 'S180', economyEpMbCell: 'T180',
  },
  udtx: {
    id: 'udtx',
    kpQ1: 195,  kpYear: 200,
    epQ1: 206,  epYear: 211,
    epTotalCell: 'D211',  epPercentCell: 'G217',
    economyKpCell: 'U200', economyEpCell: 'U211',
    economyKpFbCell: 'R200', economyKpKbCell: 'S200', economyKpMbCell: 'T200',
    economyEpFbCell: 'R211', economyEpKbCell: 'S211', economyEpMbCell: 'T211',
  },
  uksimp: {
    id: 'uksimp',
    kpQ1: 225,  kpYear: 230,
    epQ1: 236,  epYear: 241,
    epTotalCell: 'D241',  epPercentCell: 'G247',
    economyKpCell: 'U230', economyEpCell: 'U241',
    economyKpFbCell: 'R230', economyKpKbCell: 'S230', economyKpMbCell: 'T230',
    economyEpFbCell: 'R241', economyEpKbCell: 'S241', economyEpMbCell: 'T241',
  },
  uo: {
    id: 'uo',
    kpQ1: 255,  kpYear: 260,
    epQ1: 266,  epYear: 271,
    epTotalCell: 'D271',  epPercentCell: 'G277',
    economyKpCell: 'U260', economyEpCell: 'U271',
    economyKpFbCell: 'R260', economyKpKbCell: 'S260', economyKpMbCell: 'T260',
    economyEpFbCell: 'R271', economyEpKbCell: 'S271', economyEpMbCell: 'T271',
  },
} as const;

// ────────────────────────────────────────────────────────────────
// 5. Сводные строки (СВОД)
// ────────────────────────────────────────────────────────────────

/** Строки общего свода (агрегация по всем ГРБС) */
export const SUMMARY_ROWS = {
  /** КП — 1 квартал (конкурентные, Q1) */
  kpQ1: 9,
  /** КП — Год (конкурентные, Year) */
  kpYear: 14,
  /** ЕП — 1 квартал (единственный поставщик, Q1) */
  epQ1: 21,
  /** ЕП — Год (единственный поставщик, Year) */
  epYear: 26,
} as const;

// ────────────────────────────────────────────────────────────────
// 6. Backward-compatible DEPARTMENTS array
// ────────────────────────────────────────────────────────────────

/**
 * Массив департаментов (обратная совместимость).
 * Используется в dashboard.ts, demo-data.ts и др.
 */
// Canonical sheet name per department.
// УЭР/УО/УКСиМП/УД → лист "Все" (имя листа-вкладки, НЕ "все листы").
// УФБП/УДТХ/УИО/УАГЗО → одноимённый лист.
const DEPT_SHEET_NAMES: Record<string, string> = {
  uer: 'Все', uo: 'Все', uksimp: 'Все', ud: 'Все',
  uio: 'УИО', uagzo: 'УАГЗО', ufbp: 'УФБП', udtx: 'УДТХ',
};

export const DEPARTMENTS: Department[] = DEPARTMENT_IDS.map((id) => {
  const cfg = DEPARTMENT_ROWS[id];
  return {
    id,
    name: DEPARTMENT_NAMES[id],
    nameShort: DEPARTMENT_SHORT_NAMES[id],
    sheetName: DEPT_SHEET_NAMES[id] ?? DEPARTMENT_SHORT_NAMES[id],
    svodRange: { startRow: cfg.kpQ1, endRow: cfg.kpQ1 + 30 },
    controlCells: {
      q1Percent: `G${cfg.epQ1}`,
      ...(cfg.economyEpCell ? { economyEp: cfg.economyEpCell } : {}),
      ...(cfg.economyKpCell ? { economyKp: cfg.economyKpCell } : {}),
    },
  };
});

// ────────────────────────────────────────────────────────────────
// 7. Вспомогательные функции: чтение ячеек
// ────────────────────────────────────────────────────────────────

/**
 * Тип данных листа: двумерный массив (строки × столбцы).
 * Индекс [0] = строка 1 Google Sheets.
 */
export type SheetData = unknown[][];

/**
 * Извлекает значение ячейки из двумерного массива данных.
 *
 * @param sheetData — данные листа (0-based массив строк)
 * @param row — номер строки (1-based, как в Google Sheets)
 * @param col — 0-based индекс столбца (из COLUMNS)
 * @returns значение ячейки или null
 */
export function extractMetric(
  sheetData: SheetData,
  row: number,
  col: number,
): number | null {
  // Строка 1 в Sheets → индекс 0 в массиве
  const rowIdx = row - 1;
  if (rowIdx < 0 || rowIdx >= sheetData.length) return null;
  const rowData = sheetData[rowIdx];
  if (!rowData || col < 0 || col >= rowData.length) return null;

  const raw = rowData[col];
  if (raw === null || raw === undefined || raw === '') return null;

  const num = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(num) ? num : null;
}

/**
 * Парсит адрес ячейки вида "D61" → { col: 3, row: 61 }
 */
function parseCellAddress(cell: string): { col: number; row: number } | null {
  const match = cell.match(/^([A-Z]{1,2})(\d+)$/);
  if (!match) return null;
  const letter = match[1] as ColumnLetter;
  const row = parseInt(match[2], 10);
  const col = COLUMNS[letter];
  if (col === undefined || !Number.isFinite(row)) return null;
  return { col, row };
}

/**
 * Извлекает числовое значение из ячейки по адресу (например "U46").
 * Возвращает null если адрес не указан, невалиден или ячейка пуста.
 */
function extractCellValue(sheetData: SheetData, cellAddr: string | null | undefined): number | null {
  if (!cellAddr) return null;
  const addr = parseCellAddress(cellAddr);
  if (!addr) return null;
  return extractMetric(sheetData, addr.row, addr.col);
}

// ────────────────────────────────────────────────────────────────
// 8. Метрики строки: что извлекаем из каждой строки блока
// ────────────────────────────────────────────────────────────────

/** Набор метрик, извлекаемый из одной строки блока */
export interface RowMetrics {
  /** План (кол-во) — D */
  planCount: number | null;
  /** Факт (кол-во) — E */
  factCount: number | null;
  /** Отклонение (план-факт) — F */
  deviation: number | null;
  /** Исполнение % — G */
  executionPercent: number | null;
  /** ФБ план — H */
  fbPlan: number | null;
  /** КБ план — I */
  kbPlan: number | null;
  /** МБ план — J */
  mbPlan: number | null;
  /** Итого план (K = H+I+J) — K */
  totalPlan: number | null;
  /** ФБ факт — L */
  fbFact: number | null;
  /** КБ факт — M */
  kbFact: number | null;
  /** МБ факт — N */
  mbFact: number | null;
  /** Итого факт (O = L+M+N) — O */
  totalFact: number | null;
  /** Отклонение сумм (K-O) — P */
  amountDeviation: number | null;
  /** Потеряно/Экономия % — Q */
  savingsPercent: number | null;
  /** Экономия ФБ — R */
  economyFB: number | null;
  /** Экономия КБ — S */
  economyKB: number | null;
  /** Экономия МБ — T */
  economyMB: number | null;
  /** Экономия ИТОГО (R+S+T) — U */
  economyTotal: number | null;
}

/**
 * Извлекает стандартный набор метрик из одной строки (D..U).
 */
function extractRowMetrics(sheetData: SheetData, row: number): RowMetrics {
  return {
    planCount:        extractMetric(sheetData, row, COLUMNS.D),
    factCount:        extractMetric(sheetData, row, COLUMNS.E),
    deviation:        extractMetric(sheetData, row, COLUMNS.F),
    executionPercent: extractMetric(sheetData, row, COLUMNS.G),
    fbPlan:           extractMetric(sheetData, row, COLUMNS.H),
    kbPlan:           extractMetric(sheetData, row, COLUMNS.I),
    mbPlan:           extractMetric(sheetData, row, COLUMNS.J),
    totalPlan:        extractMetric(sheetData, row, COLUMNS.K),
    fbFact:           extractMetric(sheetData, row, COLUMNS.L),
    kbFact:           extractMetric(sheetData, row, COLUMNS.M),
    mbFact:           extractMetric(sheetData, row, COLUMNS.N),
    totalFact:        extractMetric(sheetData, row, COLUMNS.O),
    amountDeviation:  extractMetric(sheetData, row, COLUMNS.P),
    savingsPercent:   extractMetric(sheetData, row, COLUMNS.Q),
    economyFB:        extractMetric(sheetData, row, COLUMNS.R),
    economyKB:        extractMetric(sheetData, row, COLUMNS.S),
    economyMB:        extractMetric(sheetData, row, COLUMNS.T),
    economyTotal:     extractMetric(sheetData, row, COLUMNS.U),
  };
}

// ────────────────────────────────────────────────────────────────
// 9. buildDepartmentMetrics — все метрики одного ГРБС
// ────────────────────────────────────────────────────────────────

/** Полный набор метрик ГРБС */
export interface DepartmentMetrics {
  id: DepartmentId;
  name: string;
  shortName: string;
  /** КП Q1 (конкурентные, 1 квартал) */
  kpQ1: RowMetrics;
  /** КП Year (конкурентные, год) */
  kpYear: RowMetrics;
  /** ЕП Q1 (единственный поставщик, 1 квартал) */
  epQ1: RowMetrics;
  /** ЕП Year (единственный поставщик, год) */
  epYear: RowMetrics;
  /** Итого ЕП — значение из ячейки epTotalCell */
  epTotal: number | null;
  /** Процент ЕП — значение из ячейки epPercentCell */
  epPercent: number | null;
  /** Экономия по КП (столбец U) */
  economyKp: number | null;
  /** Экономия по ЕП (столбец U) */
  economyEp: number | null;
  /** Экономия КП ФБ (столбец R) */
  economyKpFb: number | null;
  /** Экономия КП КБ (столбец S) */
  economyKpKb: number | null;
  /** Экономия КП МБ (столбец T) */
  economyKpMb: number | null;
  /** Экономия ЕП ФБ (столбец R) */
  economyEpFb: number | null;
  /** Экономия ЕП КБ (столбец S) */
  economyEpKb: number | null;
  /** Экономия ЕП МБ (столбец T) */
  economyEpMb: number | null;
}

/**
 * Извлекает все метрики для указанного ГРБС из данных листа СВОД ТД-ПМ.
 *
 * @param sheetData — полные данные листа СВОД ТД-ПМ
 * @param deptId — идентификатор ГРБС
 */
export function buildDepartmentMetrics(
  sheetData: SheetData,
  deptId: DepartmentId,
): DepartmentMetrics {
  const cfg = DEPARTMENT_ROWS[deptId];

  // Извлекаем 4 основных блока строк
  const kpQ1 = extractRowMetrics(sheetData, cfg.kpQ1);
  const kpYear = extractRowMetrics(sheetData, cfg.kpYear);
  const epQ1 = extractRowMetrics(sheetData, cfg.epQ1);
  const epYear = extractRowMetrics(sheetData, cfg.epYear);

  // ЕП итого
  let epTotal: number | null = null;
  const totalAddr = parseCellAddress(cfg.epTotalCell);
  if (totalAddr) {
    epTotal = extractMetric(sheetData, totalAddr.row, totalAddr.col);
  }

  // %ЕП
  let epPercent: number | null = null;
  const pctAddr = parseCellAddress(cfg.epPercentCell);
  if (pctAddr) {
    epPercent = extractMetric(sheetData, pctAddr.row, pctAddr.col);
  }

  // Экономия КП (ИТОГО + побюджетная)
  const economyKp = extractCellValue(sheetData, cfg.economyKpCell);
  const economyKpFb = extractCellValue(sheetData, cfg.economyKpFbCell);
  const economyKpKb = extractCellValue(sheetData, cfg.economyKpKbCell);
  const economyKpMb = extractCellValue(sheetData, cfg.economyKpMbCell);

  // Экономия ЕП (ИТОГО + побюджетная)
  const economyEp = extractCellValue(sheetData, cfg.economyEpCell);
  const economyEpFb = extractCellValue(sheetData, cfg.economyEpFbCell);
  const economyEpKb = extractCellValue(sheetData, cfg.economyEpKbCell);
  const economyEpMb = extractCellValue(sheetData, cfg.economyEpMbCell);

  return {
    id: deptId,
    name: DEPARTMENT_NAMES[deptId],
    shortName: DEPARTMENT_SHORT_NAMES[deptId],
    kpQ1,
    kpYear,
    epQ1,
    epYear,
    epTotal,
    epPercent,
    economyKp,
    economyEp,
    economyKpFb,
    economyKpKb,
    economyKpMb,
    economyEpFb,
    economyEpKb,
    economyEpMb,
  };
}

// ────────────────────────────────────────────────────────────────
// 10. buildSummaryMetrics — сводные метрики (СВОД)
// ────────────────────────────────────────────────────────────────

/** Метрики сводного блока */
export interface SummaryMetrics {
  /** КП Q1 (конкурентные, 1 квартал) — строка 9 */
  kpQ1: RowMetrics;
  /** КП Year (конкурентные, год) — строка 14 */
  kpYear: RowMetrics;
  /** ЕП Q1 (единственный поставщик, 1 квартал) — строка 21 */
  epQ1: RowMetrics;
  /** ЕП Year (единственный поставщик, год) — строка 26 */
  epYear: RowMetrics;
}

/**
 * Извлекает сводные метрики (агрегированные по всем ГРБС).
 *
 * @param sheetData — полные данные листа СВОД ТД-ПМ
 */
export function buildSummaryMetrics(sheetData: SheetData): SummaryMetrics {
  return {
    kpQ1:   extractRowMetrics(sheetData, SUMMARY_ROWS.kpQ1),
    kpYear: extractRowMetrics(sheetData, SUMMARY_ROWS.kpYear),
    epQ1:   extractRowMetrics(sheetData, SUMMARY_ROWS.epQ1),
    epYear: extractRowMetrics(sheetData, SUMMARY_ROWS.epYear),
  };
}

// ────────────────────────────────────────────────────────────────
// 11. REPORT_MAP — backward-compatible flat metric list
// ────────────────────────────────────────────────────────────────

/**
 * Плоский список метрик для обратной совместимости с пайплайном,
 * demo-data и маршрутами API.
 *
 * Каждая запись указывает конкретную ячейку в СВОД ТД-ПМ.
 */

/**
 * Определения столбцов D-U для генерации записей REPORT_MAP.
 * Каждый столбец → ключ метрики + лейбл + тип.
 */
const ROW_COLUMN_DEFS: Array<{
  col: string;
  keySuffix: string;
  labelSuffix: string;
  overrides: Partial<ReportMapEntry>;
}> = [
  { col: 'D', keySuffix: 'count',       labelSuffix: 'план (кол-во)',    overrides: { valueType: 'integer', sourceUnit: 'count', displayUnit: 'count' } },
  { col: 'E', keySuffix: 'fact',        labelSuffix: 'факт (кол-во)',    overrides: { valueType: 'integer', sourceUnit: 'count', displayUnit: 'count' } },
  { col: 'F', keySuffix: 'deviation',   labelSuffix: 'отклонение',       overrides: {} },
  { col: 'G', keySuffix: 'percent',     labelSuffix: 'исполнение %',     overrides: { valueType: 'percent', sourceUnit: 'percent', displayUnit: 'percent', tolerance: 0.01 } },
  { col: 'H', keySuffix: 'fb_plan',     labelSuffix: 'ФБ план',          overrides: {} },
  { col: 'I', keySuffix: 'kb_plan',     labelSuffix: 'КБ план',          overrides: {} },
  { col: 'J', keySuffix: 'mb_plan',     labelSuffix: 'МБ план',          overrides: {} },
  { col: 'K', keySuffix: 'total_plan',  labelSuffix: 'итого план',       overrides: {} },
  { col: 'L', keySuffix: 'fb_fact',     labelSuffix: 'ФБ факт',          overrides: {} },
  { col: 'M', keySuffix: 'kb_fact',     labelSuffix: 'КБ факт',          overrides: {} },
  { col: 'N', keySuffix: 'mb_fact',     labelSuffix: 'МБ факт',          overrides: {} },
  { col: 'O', keySuffix: 'total_fact',  labelSuffix: 'итого факт',       overrides: {} },
  { col: 'P', keySuffix: 'amount_dev',  labelSuffix: 'откл. сумм',       overrides: {} },
  { col: 'Q', keySuffix: 'savings_pct', labelSuffix: 'экономия %',       overrides: { valueType: 'percent', sourceUnit: 'percent', displayUnit: 'percent' } },
  { col: 'R', keySuffix: 'economy_fb',  labelSuffix: 'экономия ФБ',      overrides: {} },
  { col: 'S', keySuffix: 'economy_kb',  labelSuffix: 'экономия КБ',      overrides: {} },
  { col: 'T', keySuffix: 'economy_mb',  labelSuffix: 'экономия МБ',      overrides: {} },
  { col: 'U', keySuffix: 'economy_total', labelSuffix: 'экономия ИТОГО', overrides: {} },
];

function entry(
  metricKey: string,
  label: string,
  sourceCell: string,
  overrides: Partial<ReportMapEntry> = {},
): ReportMapEntry {
  return {
    metricKey,
    label,
    originType: 'official',
    period: 'annual',
    valueType: 'currency',
    sourceUnit: 'thousand_rubles',
    displayUnit: 'thousand_rubles',
    sourceSheet: SVOD_SHEET,
    sourceCell,
    group: 'competitive',
    fallbackPolicy: 'null',
    ...overrides,
  };
}

/**
 * Генерирует REPORT_MAP записи для одной строки (все 18 столбцов D-U).
 */
function buildRowEntries(
  prefix: string,
  labelPrefix: string,
  row: number,
  base: Partial<ReportMapEntry>,
): ReportMapEntry[] {
  return ROW_COLUMN_DEFS.map(def =>
    entry(
      `${prefix}.${def.keySuffix}`,
      `${labelPrefix} ${def.labelSuffix}`,
      `${def.col}${row}`,
      { ...base, ...def.overrides },
    ),
  );
}

export const REPORT_MAP: ReportMapEntry[] = [
  // ═══════════════════════════════════════════════════════
  // Общий свод: КП (конкурентные)
  // ═══════════════════════════════════════════════════════

  // --- КП Q1 (строка 9) ---
  entry('competitive.q1.count',       'КП Q1: план (кол-во)',       'D9',  { valueType: 'integer', sourceUnit: 'count', displayUnit: 'count', period: 'q1', subgroup: 'plan' }),
  entry('competitive.q1.fact_count',  'КП Q1: факт (кол-во)',       'E9',  { valueType: 'integer', sourceUnit: 'count', displayUnit: 'count', period: 'q1', subgroup: 'fact' }),
  entry('competitive.q1.deviation',   'КП Q1: отклонение',          'F9',  { period: 'q1', subgroup: 'deviation' }),
  entry('competitive.q1.percent',     'КП Q1: исполнение %',        'G9',  { valueType: 'percent', sourceUnit: 'percent', displayUnit: 'percent', period: 'q1', subgroup: 'execution', tolerance: 0.01 }),
  entry('competitive.q1.fb_plan',     'КП Q1: ФБ план',             'H9',  { period: 'q1', subgroup: 'budget' }),
  entry('competitive.q1.kb_plan',     'КП Q1: КБ план',             'I9',  { period: 'q1', subgroup: 'budget' }),
  entry('competitive.q1.mb_plan',     'КП Q1: МБ план',             'J9',  { period: 'q1', subgroup: 'budget' }),
  entry('competitive.q1.total_plan',  'КП Q1: итого план',          'K9',  { period: 'q1', subgroup: 'budget' }),
  entry('competitive.q1.fb_fact',     'КП Q1: ФБ факт',             'L9',  { period: 'q1', subgroup: 'budget_fact' }),
  entry('competitive.q1.kb_fact',     'КП Q1: КБ факт',             'M9',  { period: 'q1', subgroup: 'budget_fact' }),
  entry('competitive.q1.mb_fact',     'КП Q1: МБ факт',             'N9',  { period: 'q1', subgroup: 'budget_fact' }),
  entry('competitive.q1.total_fact',  'КП Q1: итого факт',          'O9',  { period: 'q1', subgroup: 'budget_fact' }),
  entry('competitive.q1.amount_dev',  'КП Q1: откл. сумм',          'P9',  { period: 'q1', subgroup: 'deviation' }),
  entry('competitive.q1.savings_pct', 'КП Q1: экономия %',          'Q9',  { period: 'q1', subgroup: 'economy', valueType: 'percent', sourceUnit: 'percent', displayUnit: 'percent' }),
  entry('competitive.q1.economy_fb',  'КП Q1: экономия ФБ',         'R9',  { period: 'q1', subgroup: 'economy' }),
  entry('competitive.q1.economy_kb',  'КП Q1: экономия КБ',         'S9',  { period: 'q1', subgroup: 'economy' }),
  entry('competitive.q1.economy_mb',  'КП Q1: экономия МБ',         'T9',  { period: 'q1', subgroup: 'economy' }),
  entry('competitive.q1.economy_total','КП Q1: экономия ИТОГО',     'U9',  { period: 'q1', subgroup: 'economy' }),

  // --- КП Year (строка 14) ---
  entry('competitive.year.count',       'КП год: план (кол-во)',     'D14', { valueType: 'integer', sourceUnit: 'count', displayUnit: 'count', subgroup: 'plan' }),
  entry('competitive.year.fact_count',  'КП год: факт (кол-во)',     'E14', { valueType: 'integer', sourceUnit: 'count', displayUnit: 'count', subgroup: 'fact' }),
  entry('competitive.year.deviation',   'КП год: отклонение',        'F14', { subgroup: 'deviation' }),
  entry('competitive.year.percent',     'КП год: исполнение %',      'G14', { valueType: 'percent', sourceUnit: 'percent', displayUnit: 'percent', subgroup: 'execution', tolerance: 0.01 }),
  entry('competitive.year.fb_plan',     'КП год: ФБ план',           'H14', { subgroup: 'budget' }),
  entry('competitive.year.kb_plan',     'КП год: КБ план',           'I14', { subgroup: 'budget' }),
  entry('competitive.year.mb_plan',     'КП год: МБ план',           'J14', { subgroup: 'budget' }),
  entry('competitive.year.total_plan',  'КП год: итого план',        'K14', { subgroup: 'budget' }),
  entry('competitive.year.fb_fact',     'КП год: ФБ факт',           'L14', { subgroup: 'budget_fact' }),
  entry('competitive.year.kb_fact',     'КП год: КБ факт',           'M14', { subgroup: 'budget_fact' }),
  entry('competitive.year.mb_fact',     'КП год: МБ факт',           'N14', { subgroup: 'budget_fact' }),
  entry('competitive.year.total_fact',  'КП год: итого факт',        'O14', { subgroup: 'budget_fact' }),
  entry('competitive.year.amount_dev',  'КП год: откл. сумм',       'P14', { subgroup: 'deviation' }),
  entry('competitive.year.savings_pct', 'КП год: экономия %',       'Q14', { subgroup: 'economy', valueType: 'percent', sourceUnit: 'percent', displayUnit: 'percent' }),
  entry('competitive.year.economy_fb',  'КП год: экономия ФБ',      'R14', { subgroup: 'economy' }),
  entry('competitive.year.economy_kb',  'КП год: экономия КБ',      'S14', { subgroup: 'economy' }),
  entry('competitive.year.economy_mb',  'КП год: экономия МБ',      'T14', { subgroup: 'economy' }),
  entry('competitive.year.economy_total','КП год: экономия ИТОГО',  'U14', { subgroup: 'economy' }),

  // ═══════════════════════════════════════════════════════
  // Общий свод: ЕП (единственный поставщик)
  // ═══════════════════════════════════════════════════════

  // --- ЕП Q1 (строка 21) ---
  entry('sole.q1.count',       'ЕП Q1: план (кол-во)',       'D21', { group: 'sole', valueType: 'integer', sourceUnit: 'count', displayUnit: 'count', period: 'q1', subgroup: 'plan' }),
  entry('sole.q1.fact_count',  'ЕП Q1: факт (кол-во)',       'E21', { group: 'sole', valueType: 'integer', sourceUnit: 'count', displayUnit: 'count', period: 'q1', subgroup: 'fact' }),
  entry('sole.q1.deviation',   'ЕП Q1: отклонение',          'F21', { group: 'sole', period: 'q1', subgroup: 'deviation' }),
  entry('sole.q1.percent',     'ЕП Q1: исполнение %',        'G21', { group: 'sole', valueType: 'percent', sourceUnit: 'percent', displayUnit: 'percent', period: 'q1', subgroup: 'execution', tolerance: 0.01 }),
  entry('sole.q1.fb_plan',     'ЕП Q1: ФБ план',             'H21', { group: 'sole', period: 'q1', subgroup: 'budget' }),
  entry('sole.q1.kb_plan',     'ЕП Q1: КБ план',             'I21', { group: 'sole', period: 'q1', subgroup: 'budget' }),
  entry('sole.q1.mb_plan',     'ЕП Q1: МБ план',             'J21', { group: 'sole', period: 'q1', subgroup: 'budget' }),
  entry('sole.q1.total_plan',  'ЕП Q1: итого план',          'K21', { group: 'sole', period: 'q1', subgroup: 'budget' }),
  entry('sole.q1.fb_fact',     'ЕП Q1: ФБ факт',             'L21', { group: 'sole', period: 'q1', subgroup: 'budget_fact' }),
  entry('sole.q1.kb_fact',     'ЕП Q1: КБ факт',             'M21', { group: 'sole', period: 'q1', subgroup: 'budget_fact' }),
  entry('sole.q1.mb_fact',     'ЕП Q1: МБ факт',             'N21', { group: 'sole', period: 'q1', subgroup: 'budget_fact' }),
  entry('sole.q1.total_fact',  'ЕП Q1: итого факт',          'O21', { group: 'sole', period: 'q1', subgroup: 'budget_fact' }),
  entry('sole.q1.amount_dev',  'ЕП Q1: откл. сумм',          'P21', { group: 'sole', period: 'q1', subgroup: 'deviation' }),
  entry('sole.q1.savings_pct', 'ЕП Q1: экономия %',          'Q21', { group: 'sole', period: 'q1', subgroup: 'economy', valueType: 'percent', sourceUnit: 'percent', displayUnit: 'percent' }),
  entry('sole.q1.economy_fb',  'ЕП Q1: экономия ФБ',         'R21', { group: 'sole', period: 'q1', subgroup: 'economy' }),
  entry('sole.q1.economy_kb',  'ЕП Q1: экономия КБ',         'S21', { group: 'sole', period: 'q1', subgroup: 'economy' }),
  entry('sole.q1.economy_mb',  'ЕП Q1: экономия МБ',         'T21', { group: 'sole', period: 'q1', subgroup: 'economy' }),
  entry('sole.q1.economy_total','ЕП Q1: экономия ИТОГО',     'U21', { group: 'sole', period: 'q1', subgroup: 'economy' }),

  // --- ЕП Year (строка 26) ---
  entry('sole.year.count',       'ЕП год: план (кол-во)',     'D26', { group: 'sole', valueType: 'integer', sourceUnit: 'count', displayUnit: 'count', subgroup: 'plan' }),
  entry('sole.year.fact_count',  'ЕП год: факт (кол-во)',     'E26', { group: 'sole', valueType: 'integer', sourceUnit: 'count', displayUnit: 'count', subgroup: 'fact' }),
  entry('sole.year.deviation',   'ЕП год: отклонение',        'F26', { group: 'sole', subgroup: 'deviation' }),
  entry('sole.year.percent',     'ЕП год: исполнение %',      'G26', { group: 'sole', valueType: 'percent', sourceUnit: 'percent', displayUnit: 'percent', subgroup: 'execution', tolerance: 0.01 }),
  entry('sole.year.fb_plan',     'ЕП год: ФБ план',           'H26', { group: 'sole', subgroup: 'budget' }),
  entry('sole.year.kb_plan',     'ЕП год: КБ план',           'I26', { group: 'sole', subgroup: 'budget' }),
  entry('sole.year.mb_plan',     'ЕП год: МБ план',           'J26', { group: 'sole', subgroup: 'budget' }),
  entry('sole.year.total_plan',  'ЕП год: итого план',        'K26', { group: 'sole', subgroup: 'budget' }),
  entry('sole.year.fb_fact',     'ЕП год: ФБ факт',           'L26', { group: 'sole', subgroup: 'budget_fact' }),
  entry('sole.year.kb_fact',     'ЕП год: КБ факт',           'M26', { group: 'sole', subgroup: 'budget_fact' }),
  entry('sole.year.mb_fact',     'ЕП год: МБ факт',           'N26', { group: 'sole', subgroup: 'budget_fact' }),
  entry('sole.year.total_fact',  'ЕП год: итого факт',        'O26', { group: 'sole', subgroup: 'budget_fact' }),
  entry('sole.year.amount_dev',  'ЕП год: откл. сумм',        'P26', { group: 'sole', subgroup: 'deviation' }),
  entry('sole.year.savings_pct', 'ЕП год: экономия %',        'Q26', { group: 'sole', subgroup: 'economy', valueType: 'percent', sourceUnit: 'percent', displayUnit: 'percent' }),
  entry('sole.year.economy_fb',  'ЕП год: экономия ФБ',       'R26', { group: 'sole', subgroup: 'economy' }),
  entry('sole.year.economy_kb',  'ЕП год: экономия КБ',       'S26', { group: 'sole', subgroup: 'economy' }),
  entry('sole.year.economy_mb',  'ЕП год: экономия МБ',       'T26', { group: 'sole', subgroup: 'economy' }),
  entry('sole.year.economy_total','ЕП год: экономия ИТОГО',   'U26', { group: 'sole', subgroup: 'economy' }),

  // ═══════════════════════════════════════════════════════
  // По ГРБС: метрики департаментов
  // ═══════════════════════════════════════════════════════
  ...buildDepartmentReportEntries(),
];

/**
 * Генерирует REPORT_MAP записи для всех 8 ГРБС.
 * Для каждого департамента создаёт записи для всех 18 столбцов (D-U)
 * по 4 строкам (КП Q1, КП Year, ЕП Q1, ЕП Year),
 * а также ЕП итого, %ЕП и побюджетные экономии.
 */
function buildDepartmentReportEntries(): ReportMapEntry[] {
  const entries: ReportMapEntry[] = [];

  for (const deptId of DEPARTMENT_IDS) {
    const cfg = DEPARTMENT_ROWS[deptId];
    const short = DEPARTMENT_SHORT_NAMES[deptId];
    const prefix = `grbs.${deptId}`;
    const base: Partial<ReportMapEntry> = { group: 'grbs', subgroup: deptId, departmentId: deptId };

    // КП Q1 — все 18 столбцов
    entries.push(...buildRowEntries(`${prefix}.kp.q1`, `${short}: КП Q1`, cfg.kpQ1, { ...base, period: 'q1' }));

    // КП Year — все 18 столбцов
    entries.push(...buildRowEntries(`${prefix}.kp.year`, `${short}: КП год`, cfg.kpYear, base));

    // ЕП Q1 — все 18 столбцов
    entries.push(...buildRowEntries(`${prefix}.ep.q1`, `${short}: ЕП Q1`, cfg.epQ1, { ...base, period: 'q1' }));

    // ЕП Year — все 18 столбцов
    entries.push(...buildRowEntries(`${prefix}.ep.year`, `${short}: ЕП год`, cfg.epYear, base));

    // ЕП итого и %ЕП
    entries.push(
      entry(`${prefix}.ep.total`,   `${short}: ЕП итого`,     cfg.epTotalCell,   { ...base, valueType: 'integer', sourceUnit: 'count', displayUnit: 'count' }),
      entry(`${prefix}.ep.percent`, `${short}: %ЕП`,          cfg.epPercentCell, { ...base, valueType: 'percent', sourceUnit: 'percent', displayUnit: 'percent' }),
    );

    // Побюджетная экономия КП (R/S/T/U)
    if (cfg.economyKpCell) {
      entries.push(
        entry(`${prefix}.economy.kp`, `${short}: экономия КП`, cfg.economyKpCell, { group: 'economy', subgroup: deptId, departmentId: deptId }),
      );
    }
    if (cfg.economyKpFbCell) {
      entries.push(
        entry(`${prefix}.economy.kp.fb`, `${short}: экономия КП ФБ`, cfg.economyKpFbCell, { group: 'economy', subgroup: deptId, departmentId: deptId }),
        entry(`${prefix}.economy.kp.kb`, `${short}: экономия КП КБ`, cfg.economyKpKbCell!, { group: 'economy', subgroup: deptId, departmentId: deptId }),
        entry(`${prefix}.economy.kp.mb`, `${short}: экономия КП МБ`, cfg.economyKpMbCell!, { group: 'economy', subgroup: deptId, departmentId: deptId }),
      );
    }

    // Побюджетная экономия ЕП (R/S/T/U)
    if (cfg.economyEpCell) {
      entries.push(
        entry(`${prefix}.economy.ep`, `${short}: экономия ЕП`, cfg.economyEpCell, { group: 'economy', subgroup: deptId, departmentId: deptId }),
      );
    }
    if (cfg.economyEpFbCell) {
      entries.push(
        entry(`${prefix}.economy.ep.fb`, `${short}: экономия ЕП ФБ`, cfg.economyEpFbCell, { group: 'economy', subgroup: deptId, departmentId: deptId }),
        entry(`${prefix}.economy.ep.kb`, `${short}: экономия ЕП КБ`, cfg.economyEpKbCell!, { group: 'economy', subgroup: deptId, departmentId: deptId }),
        entry(`${prefix}.economy.ep.mb`, `${short}: экономия ЕП МБ`, cfg.economyEpMbCell!, { group: 'economy', subgroup: deptId, departmentId: deptId }),
      );
    }
  }

  return entries;
}

// ────────────────────────────────────────────────────────────────
// 12. Legacy helper functions (обратная совместимость)
// ────────────────────────────────────────────────────────────────

/**
 * Получить адреса для batchGet, консолидированные по строкам.
 * Вместо 700+ индивидуальных ячеек → ~40 строковых диапазонов (D{row}:U{row}).
 * Это предотвращает превышение лимита длины URL Google Sheets API.
 */
export function getAllCellAddresses(): string[] {
  // Group cells by sheet+row, track min/max column
  const rowMap = new Map<string, { sheet: string; row: number; minCol: number; maxCol: number }>();

  for (const e of REPORT_MAP) {
    const match = e.sourceCell.match(/^([A-Z]{1,2})(\d+)$/);
    if (!match) continue;
    const col = COLUMNS[match[1] as ColumnLetter];
    const row = parseInt(match[2], 10);
    if (col === undefined) continue;

    const key = `${e.sourceSheet}!${row}`;
    const existing = rowMap.get(key);
    if (existing) {
      existing.minCol = Math.min(existing.minCol, col);
      existing.maxCol = Math.max(existing.maxCol, col);
    } else {
      rowMap.set(key, { sheet: e.sourceSheet, row, minCol: col, maxCol: col });
    }
  }

  // Convert to range strings
  const colLetters = Object.entries(COLUMNS).reduce<Record<number, string>>(
    (acc, [letter, idx]) => { acc[idx] = letter; return acc; },
    {},
  );

  return [...rowMap.values()].map(({ sheet, row, minCol, maxCol }) => {
    const startLetter = colLetters[minCol];
    const endLetter = colLetters[maxCol];
    if (startLetter === endLetter) {
      return `'${sheet}'!${startLetter}${row}`;
    }
    return `'${sheet}'!${startLetter}${row}:${endLetter}${row}`;
  });
}

/** Получить метрики по группе */
export function getMetricsByGroup(group: string): ReportMapEntry[] {
  return REPORT_MAP.filter(e => e.group === group);
}

/** Получить метрики по департаменту */
export function getMetricsByDepartment(departmentId: string): ReportMapEntry[] {
  return REPORT_MAP.filter(e => e.departmentId === departmentId);
}

/** Получить запись по ключу метрики */
export function getMetricByKey(key: string): ReportMapEntry | undefined {
  return REPORT_MAP.find(e => e.metricKey === key);
}
