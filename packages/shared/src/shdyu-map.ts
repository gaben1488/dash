/**
 * СВОД с месяцами — канонический лист помесячной сверки в книге СВОД_для_Google.
 *
 * Формат нового листа: 558 строк × 41 столбец (A:AO).
 *
 * Важные признаки структуры:
 *   - год не хранится в отдельной колонке C;
 *   - месяц находится в колонке B текстом: «Январь» ... «Декабрь»;
 *   - левая секция A:T содержит помесячные КП и ЕП;
 *   - правая секция U:AM содержит квартальную свёртку;
 *   - AN — фильтр активности: "*" | "ТД" | "ПМ";
 *   - AO — год.
 *
 * Старые листы «ШДЮ» и «ШДЮ старый» не являются источниками данных и не должны
 * использоваться как fallback. Runtime читает только SVOD_MONTHLY_SHEET_NAME.
 */

export const SVOD_MONTHLY_SHEET_NAME = 'СВОД с месяцами';
export const SVOD_MONTHLY_SHEET_CANDIDATES = [SVOD_MONTHLY_SHEET_NAME] as const;

/**
 * Backward-compatible aliases. Оставлены только чтобы не ломать публичные импорты;
 * значения указывают строго на новый лист и не включают legacy fallback.
 */
export const SHDYU_MONTHLY_SHEET_NAME = SVOD_MONTHLY_SHEET_NAME;
export const SHDYU_SHEET_NAME = SVOD_MONTHLY_SHEET_NAME;
export const SHDYU_SHEET_NAME_CANDIDATES = SVOD_MONTHLY_SHEET_CANDIDATES;

export interface SvodMonthlyBlock {
  grbsId: string;
  grbsShort: string;
  compStartRow: number;
  compEndRow: number;
  compTotalRow: number;
  epStartRow: number;
  epEndRow: number;
  epTotalRow: number;
  totalRow: number;
  compShareRow: number;
  epShareRow: number;
}

export type SHDYUBlock = SvodMonthlyBlock;

export const SVOD_MONTHLY_ALL_BLOCK: SvodMonthlyBlock = {
  grbsId: 'all', grbsShort: 'ВСЕ',
  compStartRow: 5, compEndRow: 16, compTotalRow: 17,
  epStartRow: 22, epEndRow: 33, epTotalRow: 34,
  totalRow: 36, compShareRow: 37, epShareRow: 38,
};

export const SVOD_MONTHLY_BLOCKS: SvodMonthlyBlock[] = [
  { grbsId: 'uer', grbsShort: 'УЭР', compStartRow: 45, compEndRow: 56, compTotalRow: 57, epStartRow: 62, epEndRow: 73, epTotalRow: 74, totalRow: 76, compShareRow: 77, epShareRow: 78 },
  { grbsId: 'uio', grbsShort: 'УИО', compStartRow: 85, compEndRow: 96, compTotalRow: 97, epStartRow: 102, epEndRow: 113, epTotalRow: 114, totalRow: 116, compShareRow: 117, epShareRow: 118 },
  { grbsId: 'uagzo', grbsShort: 'УАГЗО', compStartRow: 125, compEndRow: 136, compTotalRow: 137, epStartRow: 142, epEndRow: 153, epTotalRow: 154, totalRow: 156, compShareRow: 157, epShareRow: 158 },
  { grbsId: 'ufbp', grbsShort: 'УФБП', compStartRow: 165, compEndRow: 176, compTotalRow: 177, epStartRow: 182, epEndRow: 193, epTotalRow: 194, totalRow: 196, compShareRow: 197, epShareRow: 198 },
  { grbsId: 'ud', grbsShort: 'УД', compStartRow: 205, compEndRow: 216, compTotalRow: 217, epStartRow: 222, epEndRow: 233, epTotalRow: 234, totalRow: 236, compShareRow: 237, epShareRow: 238 },
  { grbsId: 'udtx', grbsShort: 'УДТХ', compStartRow: 245, compEndRow: 256, compTotalRow: 257, epStartRow: 262, epEndRow: 273, epTotalRow: 274, totalRow: 276, compShareRow: 277, epShareRow: 278 },
  { grbsId: 'uksimp', grbsShort: 'УКСиМП', compStartRow: 285, compEndRow: 296, compTotalRow: 297, epStartRow: 302, epEndRow: 313, epTotalRow: 314, totalRow: 316, compShareRow: 317, epShareRow: 318 },
  { grbsId: 'uo', grbsShort: 'УО', compStartRow: 325, compEndRow: 336, compTotalRow: 337, epStartRow: 342, epEndRow: 353, epTotalRow: 354, totalRow: 356, compShareRow: 357, epShareRow: 358 },
];

export const SHDYU_ALL_BLOCK = SVOD_MONTHLY_ALL_BLOCK;
export const SHDYU_BLOCKS = SVOD_MONTHLY_BLOCKS;

export const SVOD_MONTHLY_COLS = {
  GRBS_NAME: 0,
  MONTH_TEXT: 1,
  PLAN_COUNT: 2,
  FACT_COUNT: 3,
  DEVIATION: 4,
  EXECUTION_PCT: 5,
  PLAN_FB: 6,
  PLAN_KB: 7,
  PLAN_MB: 8,
  PLAN_TOTAL: 9,
  FACT_FB: 10,
  FACT_KB: 11,
  FACT_MB: 12,
  FACT_TOTAL: 13,
  DEVIATION_AMOUNT: 14,
  SPENT_PCT: 15,
  ECONOMY_FB: 16,
  ECONOMY_KB: 17,
  ECONOMY_MB: 18,
  ECONOMY_TOTAL: 19,
} as const;

export const SHDYU_COLS = SVOD_MONTHLY_COLS;

export const SVOD_MONTHLY_QUARTERLY_COLS = {
  QUARTER_LABEL: 20,
  PLAN_COUNT: 21,
  FACT_COUNT: 22,
  DEVIATION: 23,
  EXECUTION_PCT: 24,
  PLAN_FB: 25,
  PLAN_KB: 26,
  PLAN_MB: 27,
  PLAN_TOTAL: 28,
  FACT_FB: 29,
  FACT_KB: 30,
  FACT_MB: 31,
  FACT_TOTAL: 32,
  DEVIATION_AMOUNT: 33,
  SPENT_PCT: 34,
  ECONOMY_FB: 35,
  ECONOMY_KB: 36,
  ECONOMY_MB: 37,
  ECONOMY_TOTAL: 38,
} as const;

export const SHDYU_QUARTERLY_COLS = SVOD_MONTHLY_QUARTERLY_COLS;

export const SVOD_MONTHLY_FILTER_COLS = { ACTIVITY_FILTER: 39, YEAR: 40 } as const;
export const SHDYU_FILTER_COLS = SVOD_MONTHLY_FILTER_COLS;

export const SHDYU_LEGACY_ALL_BLOCK = SVOD_MONTHLY_ALL_BLOCK;
export const SHDYU_LEGACY_BLOCKS = SVOD_MONTHLY_BLOCKS;
export const SHDYU_LEGACY_COLS = { ...SVOD_MONTHLY_COLS, YEAR: 2 } as const;

export const MONTH_TEXT_MAP: Record<string, number> = {
  'Январь': 1, 'Февраль': 2, 'Март': 3,
  'Апрель': 4, 'Май': 5, 'Июнь': 6,
  'Июль': 7, 'Август': 8, 'Сентябрь': 9,
  'Октябрь': 10, 'Ноябрь': 11, 'Декабрь': 12,
};

export const QUARTER_MONTHS: Record<string, [number, number, number]> = {
  Q1: [1, 2, 3], Q2: [4, 5, 6], Q3: [7, 8, 9], Q4: [10, 11, 12],
};

export interface SvodMonthlyBlockMetrics {
  planCount: number;
  factCount: number;
  deviation: number;
  executionPct: number;
  planFB: number;
  planKB: number;
  planMB: number;
  planTotal: number;
  factFB: number;
  factKB: number;
  factMB: number;
  factTotal: number;
  deviationAmount: number;
  spentPct: number;
  economyFB: number;
  economyKB: number;
  economyMB: number;
  economyTotal: number;
}

export type SHDYUBlockMetrics = SvodMonthlyBlockMetrics;
export type SvodMonthlyQuarterlyMetrics = SvodMonthlyBlockMetrics;
export type SHDYUQuarterlyMetrics = SvodMonthlyQuarterlyMetrics;

export interface SvodMonthlyFormulaIssue {
  type: 'sheet_reference_mismatch' | 'method_filter_inverted';
  expectedSheet?: string;
  actualSheets?: string[];
  expectedFilter?: string;
  detectedFilter?: string;
  row: number;
  month: number;
  block: 'comp' | 'ep';
  evidence: string;
}

export type SHDYUFormulaIssue = SvodMonthlyFormulaIssue;

export interface SvodMonthlyEntry {
  month: number;
  comp: SvodMonthlyBlockMetrics;
  ep: SvodMonthlyBlockMetrics;
  compPlanCount: number;
  compFactCount: number;
  compPlanTotal: number;
  compFactTotal: number;
  epPlanCount: number;
  epFactCount: number;
  epPlanTotal: number;
  epFactTotal: number;
  formulaIssues?: SvodMonthlyFormulaIssue[];
}

export type SHDYUMonthlyEntry = SvodMonthlyEntry;

export interface SvodMonthlySummaryData {
  total: SvodMonthlyBlockMetrics;
  compSharePct: SvodMonthlyBlockMetrics;
  epSharePct: SvodMonthlyBlockMetrics;
}

export type SHDYUSummaryData = SvodMonthlySummaryData;

export interface SvodMonthlyQuarterlyEntry {
  quarter: string;
  metrics: SvodMonthlyQuarterlyMetrics;
}

export type SHDYUQuarterlyEntry = SvodMonthlyQuarterlyEntry;

export interface SvodMonthlyDeptData {
  grbsId: string;
  months: Record<number, SvodMonthlyEntry>;
  compTotal?: SvodMonthlyBlockMetrics;
  epTotal?: SvodMonthlyBlockMetrics;
  summary?: SvodMonthlySummaryData;
  quarterly?: Record<string, SvodMonthlyQuarterlyEntry>;
}

export type SHDYUDeptData = SvodMonthlyDeptData;
