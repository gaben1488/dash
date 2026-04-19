/**
 * ШДЮ (Ежемесячная динамика) — Sheet within СВОД_для_Google spreadsheet.
 * Contains monthly execution data per ГРБС.
 *
 * UPDATED 2026-04-13: New ШДЮ format (558 rows × 41 cols A-AO).
 * Key changes from old format:
 *   - Column C (year) removed → all indices shifted -1
 *   - Each block now: 4 hdr + 12 data + 1 итого (КП), 4 hdr + 12 data + 1 итого (ЕП),
 *     then 1 blank + ИТОГО ЭА+ЕП + Доля ЭА + Доля ЕП
 *   - NEW: Quarterly summary section (cols U-AM)
 *   - NEW: Filter controls (col AN = ТД/ПМ/*, col AO = year)
 *   - Month column B = text ("Январь"..."Декабрь"), NOT number
 */

export interface SHDYUBlock {
  grbsId: string;
  grbsShort: string;
  /** First data row of КП section (12 months, 1-based) */
  compStartRow: number;
  /** Last data row of КП section */
  compEndRow: number;
  /** КП итого row */
  compTotalRow: number;
  /** First data row of ЕП section (12 months, 1-based) */
  epStartRow: number;
  /** Last data row of ЕП section */
  epEndRow: number;
  /** ЕП итого row */
  epTotalRow: number;
  /** ИТОГО ЭА+ЕП row (combined total) */
  totalRow: number;
  /** Доля ЭА row */
  compShareRow: number;
  /** Доля ЕП row */
  epShareRow: number;
}

/** "ALL" summary block — aggregates all 8 departments */
export const SHDYU_ALL_BLOCK: SHDYUBlock = {
  grbsId: 'all',
  grbsShort: 'ВСЕ',
  compStartRow: 5,
  compEndRow: 16,
  compTotalRow: 17,
  epStartRow: 22,
  epEndRow: 33,
  epTotalRow: 34,
  totalRow: 36,
  compShareRow: 37,
  epShareRow: 38,
};

/** Individual department blocks (verified against XLSX 2026-04-13) */
export const SHDYU_BLOCKS: SHDYUBlock[] = [
  {
    grbsId: 'uer', grbsShort: 'УЭР',
    compStartRow: 45, compEndRow: 56, compTotalRow: 57,
    epStartRow: 62, epEndRow: 73, epTotalRow: 74,
    totalRow: 76, compShareRow: 77, epShareRow: 78,
  },
  {
    grbsId: 'uio', grbsShort: 'УИО',
    compStartRow: 85, compEndRow: 96, compTotalRow: 97,
    epStartRow: 102, epEndRow: 113, epTotalRow: 114,
    totalRow: 116, compShareRow: 117, epShareRow: 118,
  },
  {
    grbsId: 'uagzo', grbsShort: 'УАГЗО',
    compStartRow: 125, compEndRow: 136, compTotalRow: 137,
    epStartRow: 142, epEndRow: 153, epTotalRow: 154,
    totalRow: 156, compShareRow: 157, epShareRow: 158,
  },
  {
    grbsId: 'ufbp', grbsShort: 'УФБП',
    compStartRow: 165, compEndRow: 176, compTotalRow: 177,
    epStartRow: 182, epEndRow: 193, epTotalRow: 194,
    totalRow: 196, compShareRow: 197, epShareRow: 198,
  },
  {
    grbsId: 'ud', grbsShort: 'УД',
    compStartRow: 205, compEndRow: 216, compTotalRow: 217,
    epStartRow: 222, epEndRow: 233, epTotalRow: 234,
    totalRow: 236, compShareRow: 237, epShareRow: 238,
  },
  {
    grbsId: 'udtx', grbsShort: 'УДТХ',
    compStartRow: 245, compEndRow: 256, compTotalRow: 257,
    epStartRow: 262, epEndRow: 273, epTotalRow: 274,
    totalRow: 276, compShareRow: 277, epShareRow: 278,
  },
  {
    grbsId: 'uksimp', grbsShort: 'УКСиМП',
    compStartRow: 285, compEndRow: 296, compTotalRow: 297,
    epStartRow: 302, epEndRow: 313, epTotalRow: 314,
    totalRow: 316, compShareRow: 317, epShareRow: 318,
  },
  {
    grbsId: 'uo', grbsShort: 'УО',
    compStartRow: 325, compEndRow: 336, compTotalRow: 337,
    epStartRow: 342, epEndRow: 353, epTotalRow: 354,
    totalRow: 356, compShareRow: 357, epShareRow: 358,
  },
];

/**
 * Column layout within ШДЮ LEFT section (monthly, cols A-T, 0-based):
 *
 * IMPORTANT: Column C (Year) from old format was REMOVED.
 * All data columns shifted LEFT by 1 compared to old format.
 *
 * A=0: ГРБС name (only in first row) or "Итого {ГРБС}" in total row
 * B=1: Month text ("Январь"..."Декабрь") or year ("2026") in total row
 * C=2: Plan count (план кол-во, ед)
 * D=3: Fact count (факт кол-во, ед)
 * E=4: Deviation count (откл, ед)
 * F=5: Execution % (выполн. %)
 * G=6: Plan FB (тыс руб)
 * H=7: Plan KB
 * I=8: Plan MB
 * J=9: Plan TOTAL (=G+H+I)
 * K=10: Fact FB
 * L=11: Fact KB
 * M=12: Fact MB
 * N=13: Fact TOTAL (=K+L+M)
 * O=14: Deviation amount (=N-J)
 * P=15: Spent % (=IF(J=0,"-",N/J))
 * Q=16: Economy FB
 * R=17: Economy KB
 * S=18: Economy MB
 * T=19: Economy TOTAL (=Q+R+S)
 */
export const SHDYU_COLS = {
  GRBS_NAME: 0,
  MONTH_TEXT: 1,    // Was MONTH_NUM in old format; now TEXT ("Январь")
  PLAN_COUNT: 2,    // Was 3, shifted -1
  FACT_COUNT: 3,    // Was 4, shifted -1
  DEVIATION: 4,     // Was 5, shifted -1
  EXECUTION_PCT: 5, // Was 6, shifted -1
  PLAN_FB: 6,       // Was 7, shifted -1
  PLAN_KB: 7,       // Was 8, shifted -1
  PLAN_MB: 8,       // Was 9, shifted -1
  PLAN_TOTAL: 9,    // Was 10, shifted -1
  FACT_FB: 10,      // Was 11, shifted -1
  FACT_KB: 11,      // Was 12, shifted -1
  FACT_MB: 12,      // Was 13, shifted -1
  FACT_TOTAL: 13,   // Was 14, shifted -1
  DEVIATION_AMOUNT: 14, // Was 15, shifted -1
  SPENT_PCT: 15,    // Was 16, shifted -1
  ECONOMY_FB: 16,   // Was 17, shifted -1
  ECONOMY_KB: 17,   // Was 18, shifted -1
  ECONOMY_MB: 18,   // Was 19, shifted -1
  ECONOMY_TOTAL: 19, // Was 20, shifted -1
} as const;

/**
 * Column layout within ШДЮ RIGHT section (quarterly, cols U-AM, 0-based):
 * NEW in redesigned ШДЮ. 4 rows per block (Q1-Q4), aggregating 3 months each.
 *
 * U=20: Quarter label ("Q1"/"Q2"/"Q3"/"Q4")
 * V=21: Plan count (= SUM of 3 monthly plan counts)
 * W=22: Fact count
 * X=23: Deviation count
 * Y=24: Execution %
 * Z=25: Plan FB
 * AA=26: Plan KB
 * AB=27: Plan MB
 * AC=28: Plan TOTAL
 * AD=29: Fact FB
 * AE=30: Fact KB
 * AF=31: Fact MB
 * AG=32: Fact TOTAL
 * AH=33: Deviation amount (=AG-AC)
 * AI=34: Spent % (=IF(AC=0,"-",AG/AC))
 * AJ=35: Economy FB
 * AK=36: Economy KB
 * AL=37: Economy MB
 * AM=38: Economy TOTAL
 */
export const SHDYU_QUARTERLY_COLS = {
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

/**
 * Filter controls (cols AN-AO)
 * AN(39) = activity filter: "*" (all) | "ТД" | "ПМ"
 * AO(40) = year: 2026
 */
export const SHDYU_FILTER_COLS = {
  ACTIVITY_FILTER: 39,  // AN
  YEAR: 40,             // AO
} as const;

/** Month text → month number mapping (Russian) */
export const MONTH_TEXT_MAP: Record<string, number> = {
  'Январь': 1, 'Февраль': 2, 'Март': 3,
  'Апрель': 4, 'Май': 5, 'Июнь': 6,
  'Июль': 7, 'Август': 8, 'Сентябрь': 9,
  'Октябрь': 10, 'Ноябрь': 11, 'Декабрь': 12,
};

/** Quarter → month ranges */
export const QUARTER_MONTHS: Record<string, [number, number, number]> = {
  Q1: [1, 2, 3],
  Q2: [4, 5, 6],
  Q3: [7, 8, 9],
  Q4: [10, 11, 12],
};

/** Per-block (KP or EP) monthly metrics — 18 data columns from ШДЮ */
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

/** Quarterly aggregated metrics (same shape as BlockMetrics) */
export type SHDYUQuarterlyMetrics = SHDYUBlockMetrics;

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

/** Summary row data (ИТОГО ЭА+ЕП, Доля ЭА, Доля ЕП) */
export interface SHDYUSummaryData {
  /** ИТОГО ЭА+ЕП combined totals */
  total: SHDYUBlockMetrics;
  /** Доля ЭА (competitive share, 0-1) */
  compSharePct: SHDYUBlockMetrics;
  /** Доля ЕП (sole supplier share, 0-1) — KEY metric for 44-ФЗ */
  epSharePct: SHDYUBlockMetrics;
}

/** Quarterly entry per quarter (Q1-Q4) */
export interface SHDYUQuarterlyEntry {
  quarter: string;  // "Q1"-"Q4"
  metrics: SHDYUQuarterlyMetrics;
}

export interface SHDYUDeptData {
  grbsId: string;
  months: Record<number, SHDYUMonthlyEntry>;
  /** Итого КП (yearly total for competitive) */
  compTotal?: SHDYUBlockMetrics;
  /** Итого ЕП (yearly total for sole supplier) */
  epTotal?: SHDYUBlockMetrics;
  /** Summary rows: ИТОГО ЭА+ЕП, Доля ЭА, Доля ЕП */
  summary?: SHDYUSummaryData;
  /** Quarterly aggregated data (NEW) */
  quarterly?: Record<string, SHDYUQuarterlyEntry>;
}

export const SHDYU_SHEET_NAME = 'ШДЮ';
