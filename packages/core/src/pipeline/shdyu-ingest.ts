/**
 * ШДЮ (Monthly Dynamics) sheet parser.
 * Reads monthly execution data from the ШДЮ sheet within СВОД_для_Google spreadsheet.
 * Parses all 18 data columns (D-U) per row.
 */

import {
  SHDYU_BLOCKS, SHDYU_ALL_BLOCK, SHDYU_COLS,
  type SHDYUDeptData, type SHDYUMonthlyEntry, type SHDYUBlockMetrics,
} from '@aemr/shared';

function num(v: unknown): number {
  if (v == null) return 0;
  const n = parseFloat(String(v));
  return Number.isNaN(n) ? 0 : n;
}

const ZERO_METRICS: SHDYUBlockMetrics = {
  planCount: 0, factCount: 0, deviation: 0, executionPct: 0,
  planFB: 0, planKB: 0, planMB: 0, planTotal: 0,
  factFB: 0, factKB: 0, factMB: 0, factTotal: 0,
  deviationAmount: 0, spentPct: 0,
  economyFB: 0, economyKB: 0, economyMB: 0, economyTotal: 0,
};

/**
 * Parse a block of 12 rows (one per month) from ШДЮ sheet.
 * Returns all 18 data columns per month.
 */
function parseBlock(
  rows: unknown[][],
  startRow: number,
): Record<number, SHDYUBlockMetrics> {
  const result: Record<number, SHDYUBlockMetrics> = {};

  for (let month = 1; month <= 12; month++) {
    const rowIdx = startRow - 1 + (month - 1);
    if (rowIdx < 0 || rowIdx >= rows.length) {
      result[month] = { ...ZERO_METRICS };
      continue;
    }
    const row = rows[rowIdx];
    if (!row) {
      result[month] = { ...ZERO_METRICS };
      continue;
    }
    const C = SHDYU_COLS;
    result[month] = {
      planCount: num(row[C.PLAN_COUNT]),
      factCount: num(row[C.FACT_COUNT]),
      deviation: num(row[C.DEVIATION]),
      executionPct: num(row[C.EXECUTION_PCT]),
      planFB: num(row[C.PLAN_FB]),
      planKB: num(row[C.PLAN_KB]),
      planMB: num(row[C.PLAN_MB]),
      planTotal: num(row[C.PLAN_TOTAL]),
      factFB: num(row[C.FACT_FB]),
      factKB: num(row[C.FACT_KB]),
      factMB: num(row[C.FACT_MB]),
      factTotal: num(row[C.FACT_TOTAL]),
      deviationAmount: num(row[C.DEVIATION_AMOUNT]),
      spentPct: num(row[C.SPENT_PCT]),
      economyFB: num(row[C.ECONOMY_FB]),
      economyKB: num(row[C.ECONOMY_KB]),
      economyMB: num(row[C.ECONOMY_MB]),
      economyTotal: num(row[C.ECONOMY_TOTAL]),
    };
  }

  return result;
}

function buildMonthlyEntry(
  month: number,
  comp: SHDYUBlockMetrics,
  ep: SHDYUBlockMetrics,
): SHDYUMonthlyEntry {
  return {
    month,
    comp,
    ep,
    // Legacy convenience fields
    compPlanCount: comp.planCount,
    compFactCount: comp.factCount,
    compPlanTotal: comp.planTotal,
    compFactTotal: comp.factTotal,
    epPlanCount: ep.planCount,
    epFactCount: ep.factCount,
    epPlanTotal: ep.planTotal,
    epFactTotal: ep.factTotal,
  };
}

/**
 * Parse the entire ШДЮ sheet and return per-ГРБС monthly data.
 * Includes the "ALL" block for cross-validation.
 */
export function parseSHDYUSheet(sheetData: unknown[][]): Record<string, SHDYUDeptData> {
  const result: Record<string, SHDYUDeptData> = {};

  // Parse ALL block + individual department blocks
  const allBlocks = [SHDYU_ALL_BLOCK, ...SHDYU_BLOCKS];

  for (const block of allBlocks) {
    const compData = parseBlock(sheetData, block.compStartRow);
    const epData = parseBlock(sheetData, block.epStartRow);

    const months: Record<number, SHDYUMonthlyEntry> = {};
    for (let m = 1; m <= 12; m++) {
      months[m] = buildMonthlyEntry(m, compData[m], epData[m]);
    }

    result[block.grbsId] = {
      grbsId: block.grbsId,
      months,
    };
  }

  return result;
}
