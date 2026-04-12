/**
 * ШДЮ (Ежемесячная динамика) — Sheet within СВОД_для_Google spreadsheet.
 * Contains monthly execution data per ГРБС.
 *
 * Mapping derived from procurement_report.gs MONTHLY_BLOCK_MAP_.
 * Each ГРБС has two blocks: competitive procedures (comp) and sole supplier (ep).
 * Each block spans ~12 rows (one per month), columns contain plan/fact counts and amounts.
 */

export interface SHDYUBlock {
  grbsId: string;
  grbsShort: string;
  compStartRow: number;
  compEndRow: number;
  epStartRow: number;
  epEndRow: number;
}

/** Row ranges for each ГРБС in the ШДЮ sheet (1-based row numbers).
 * Each ГРБС has: 3 header rows + 12 data rows + 1 Итого row for КП,
 * then 3 header rows + 12 data rows + 1 Итого row for ЕП,
 * then 1 blank row. Start/End refer to the 12 DATA rows only. */
/** "ALL" block (rows 4-31) for cross-validation: totals across all departments */
export const SHDYU_ALL_BLOCK: SHDYUBlock = {
  grbsId: 'all', grbsShort: 'ВСЕ', compStartRow: 4, compEndRow: 15, epStartRow: 20, epEndRow: 31,
};

export const SHDYU_BLOCKS: SHDYUBlock[] = [
  { grbsId: 'uer',    grbsShort: 'УЭР',    compStartRow: 37,  compEndRow: 48,  epStartRow: 53,  epEndRow: 64 },
  { grbsId: 'uio',    grbsShort: 'УИО',    compStartRow: 70,  compEndRow: 81,  epStartRow: 86,  epEndRow: 97 },
  { grbsId: 'uagzo',  grbsShort: 'УАГЗО',  compStartRow: 103, compEndRow: 114, epStartRow: 119, epEndRow: 130 },
  { grbsId: 'ufbp',   grbsShort: 'УФБП',   compStartRow: 136, compEndRow: 147, epStartRow: 152, epEndRow: 163 },
  { grbsId: 'ud',     grbsShort: 'УД',     compStartRow: 169, compEndRow: 180, epStartRow: 185, epEndRow: 196 },
  { grbsId: 'udtx',   grbsShort: 'УДТХ',   compStartRow: 202, compEndRow: 213, epStartRow: 218, epEndRow: 229 },
  { grbsId: 'uksimp', grbsShort: 'УКСиМП', compStartRow: 235, compEndRow: 246, epStartRow: 251, epEndRow: 262 },
  { grbsId: 'uo',     grbsShort: 'УО',     compStartRow: 268, compEndRow: 279, epStartRow: 281, epEndRow: 292 },
];

/**
 * Column layout within ШДЮ blocks (0-based):
 * A=0: ГРБС name (only in first row of block)
 * B=1: Month number (1-12)
 * C=2: Year (2026)
 * D=3: Plan count (план кол-во, ед)
 * E=4: Fact count (факт кол-во, ед)
 * F=5: Deviation (ед)
 * G=6: Execution % (выполнено %)
 * H=7: Plan FB
 * I=8: Plan KB
 * J=9: Plan MB
 * K=10: Plan total amount (план итого)
 * L=11: Fact FB
 * M=12: Fact KB
 * N=13: Fact MB
 * O=14: Fact total amount (факт итого)
 * P=15: Deviation (сумма)
 * Q=16: Spent % (потрачено %)
 * R-U=17-20: Economy FB/KB/MB/Total
 */
export const SHDYU_COLS = {
  GRBS_NAME: 0,
  MONTH_NUM: 1,
  YEAR: 2,
  PLAN_COUNT: 3,
  FACT_COUNT: 4,
  DEVIATION: 5,
  EXECUTION_PCT: 6,
  PLAN_FB: 7,
  PLAN_KB: 8,
  PLAN_MB: 9,
  PLAN_TOTAL: 10,
  FACT_FB: 11,
  FACT_KB: 12,
  FACT_MB: 13,
  FACT_TOTAL: 14,
  DEVIATION_AMOUNT: 15,
  SPENT_PCT: 16,
  ECONOMY_FB: 17,
  ECONOMY_KB: 18,
  ECONOMY_MB: 19,
  ECONOMY_TOTAL: 20,
} as const;

/** Per-block (KP or EP) monthly metrics — all 18 data columns from ШДЮ */
export interface SHDYUBlockMetrics {
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

export interface SHDYUMonthlyEntry {
  month: number;  // 1-12
  comp: SHDYUBlockMetrics;
  ep: SHDYUBlockMetrics;
  // Legacy convenience accessors (comp + ep totals)
  compPlanCount: number;
  compFactCount: number;
  compPlanTotal: number;
  compFactTotal: number;
  epPlanCount: number;
  epFactCount: number;
  epPlanTotal: number;
  epFactTotal: number;
}

export interface SHDYUDeptData {
  grbsId: string;
  months: Record<number, SHDYUMonthlyEntry>;
}

export const SHDYU_SHEET_NAME = 'ШДЮ';
