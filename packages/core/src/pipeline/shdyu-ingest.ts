/**
 * ШДЮ (Monthly Dynamics) sheet parser.
 * Reads monthly execution data from the ШДЮ sheet within СВОД_для_Google spreadsheet.
 *
 * UPDATED 2026-04-13: Rewritten for new ШДЮ format (558×41).
 * - All column indices shifted -1 (YEAR column removed)
 * - New row numbers for all blocks
 * - Month column is TEXT ("Январь") not number
 * - Parses итого rows, ИТОГО ЭА+ЕП, Доля rows
 * - Parses quarterly summary section (cols U-AM)
 */

import {
  SHDYU_BLOCKS, SHDYU_ALL_BLOCK, SHDYU_COLS, SHDYU_QUARTERLY_COLS,
  MONTH_TEXT_MAP,
  type SHDYUBlock, type SHDYUDeptData, type SHDYUMonthlyEntry,
  type SHDYUBlockMetrics, type SHDYUSummaryData, type SHDYUQuarterlyEntry,
} from '@aemr/shared';

function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'string' && v === '-') return 0;
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
 * Extract metrics from a single row using column mapping.
 */
function extractRowMetrics(row: unknown[], cols: typeof SHDYU_COLS | typeof SHDYU_QUARTERLY_COLS): SHDYUBlockMetrics {
  return {
    planCount: num(row[cols.PLAN_COUNT]),
    factCount: num(row[cols.FACT_COUNT]),
    deviation: num(row[cols.DEVIATION]),
    executionPct: num(row[cols.EXECUTION_PCT]),
    planFB: num(row[cols.PLAN_FB]),
    planKB: num(row[cols.PLAN_KB]),
    planMB: num(row[cols.PLAN_MB]),
    planTotal: num(row[cols.PLAN_TOTAL]),
    factFB: num(row[cols.FACT_FB]),
    factKB: num(row[cols.FACT_KB]),
    factMB: num(row[cols.FACT_MB]),
    factTotal: num(row[cols.FACT_TOTAL]),
    deviationAmount: num(row[cols.DEVIATION_AMOUNT]),
    spentPct: num(row[cols.SPENT_PCT]),
    economyFB: num(row[cols.ECONOMY_FB]),
    economyKB: num(row[cols.ECONOMY_KB]),
    economyMB: num(row[cols.ECONOMY_MB]),
    economyTotal: num(row[cols.ECONOMY_TOTAL]),
  };
}

/**
 * Parse a block of 12 rows (one per month) from ШДЮ sheet.
 * Returns all 18 data columns per month.
 */
function parseMonthlyBlock(
  rows: unknown[][],
  startRow: number,
): Record<number, SHDYUBlockMetrics> {
  const result: Record<number, SHDYUBlockMetrics> = {};

  for (let month = 1; month <= 12; month++) {
    const rowIdx = startRow - 1 + (month - 1); // 1-based to 0-based
    if (rowIdx < 0 || rowIdx >= rows.length) {
      result[month] = { ...ZERO_METRICS };
      continue;
    }
    const row = rows[rowIdx];
    if (!row) {
      result[month] = { ...ZERO_METRICS };
      continue;
    }

    // Verify month text matches expected position (optional sanity check)
    const monthText = String(row[SHDYU_COLS.MONTH_TEXT] ?? '').trim();
    const expectedMonth = month;
    const actualMonth = MONTH_TEXT_MAP[monthText];
    if (actualMonth && actualMonth !== expectedMonth) {
      console.warn(
        `[ШДЮ] Month mismatch at row ${rowIdx + 1}: expected month ${expectedMonth}, got "${monthText}" (month ${actualMonth})`
      );
    }

    result[month] = extractRowMetrics(row, SHDYU_COLS);
  }

  return result;
}

/**
 * Parse a single row (итого, ИТОГО ЭА+ЕП, or Доля).
 */
function parseSingleRow(
  rows: unknown[][],
  rowNum: number,
): SHDYUBlockMetrics {
  const rowIdx = rowNum - 1;
  if (rowIdx < 0 || rowIdx >= rows.length) return { ...ZERO_METRICS };
  const row = rows[rowIdx];
  if (!row) return { ...ZERO_METRICS };
  return extractRowMetrics(row, SHDYU_COLS);
}

/**
 * Parse quarterly summary data from the right section (cols U-AM).
 * Quarterly rows are at the same row numbers as monthly data rows.
 * Q1 = row offset 0 (from startRow), Q2 = row offset 3, Q3 = row offset 6, Q4 = row offset 9
 * (Each quarter row is at startRow + (q-1)*3 because data is 12 rows for 12 months)
 *
 * Actually quarterly data occupies different rows — they are at startRow + 0, +1, +2, +3
 * but ONLY Q1 and Q4 (or whichever quarters have data) have values.
 * Let's read from the actual start row; Q labels are in col U.
 */
function parseQuarterlyData(
  rows: unknown[][],
  startRow: number,
  endRow: number,
): Record<string, SHDYUQuarterlyEntry> {
  const result: Record<string, SHDYUQuarterlyEntry> = {};

  for (let r = startRow; r <= endRow; r++) {
    const rowIdx = r - 1;
    if (rowIdx < 0 || rowIdx >= rows.length) continue;
    const row = rows[rowIdx];
    if (!row) continue;

    const quarterLabel = String(row[SHDYU_QUARTERLY_COLS.QUARTER_LABEL] ?? '').trim();
    if (!quarterLabel || !quarterLabel.startsWith('Q')) continue;

    result[quarterLabel] = {
      quarter: quarterLabel,
      metrics: extractRowMetrics(row, SHDYU_QUARTERLY_COLS),
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
 * Parse a single ГРБС block (КП + ЕП + summary + quarterly).
 */
function parseGRBSBlock(
  sheetData: unknown[][],
  block: SHDYUBlock,
): SHDYUDeptData {
  // Monthly КП and ЕП data (12 rows each)
  const compData = parseMonthlyBlock(sheetData, block.compStartRow);
  const epData = parseMonthlyBlock(sheetData, block.epStartRow);

  const months: Record<number, SHDYUMonthlyEntry> = {};
  for (let m = 1; m <= 12; m++) {
    months[m] = buildMonthlyEntry(m, compData[m], epData[m]);
  }

  // Итого rows (КП and ЕП yearly totals)
  const compTotal = parseSingleRow(sheetData, block.compTotalRow);
  const epTotal = parseSingleRow(sheetData, block.epTotalRow);

  // Summary rows: ИТОГО ЭА+ЕП, Доля ЭА, Доля ЕП
  const summary: SHDYUSummaryData = {
    total: parseSingleRow(sheetData, block.totalRow),
    compSharePct: parseSingleRow(sheetData, block.compShareRow),
    epSharePct: parseSingleRow(sheetData, block.epShareRow),
  };

  // Quarterly data (from right section, cols U-AM)
  // Quarterly rows occupy the same data rows as monthly — scan from compStartRow to epEndRow
  const quarterly = parseQuarterlyData(
    sheetData,
    block.compStartRow,
    block.epEndRow,
  );

  return {
    grbsId: block.grbsId,
    months,
    compTotal,
    epTotal,
    summary,
    quarterly,
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
    result[block.grbsId] = parseGRBSBlock(sheetData, block);
  }

  return result;
}

/**
 * Cross-validate: ALL block totals should equal SUM of individual dept blocks.
 * Returns list of mismatches.
 */
export function validateSHDYUConsistency(
  data: Record<string, SHDYUDeptData>,
): string[] {
  const errors: string[] = [];
  const allData = data['all'];
  if (!allData) {
    errors.push('Missing ALL block in ШДЮ data');
    return errors;
  }

  const deptIds = SHDYU_BLOCKS.map(b => b.grbsId);

  for (let m = 1; m <= 12; m++) {
    const allEntry = allData.months[m];
    if (!allEntry) continue;

    // Sum across departments
    let compPlanSum = 0, compFactSum = 0, epPlanSum = 0, epFactSum = 0;
    for (const deptId of deptIds) {
      const dept = data[deptId];
      if (!dept?.months[m]) continue;
      compPlanSum += dept.months[m].comp.planCount;
      compFactSum += dept.months[m].comp.factCount;
      epPlanSum += dept.months[m].ep.planCount;
      epFactSum += dept.months[m].ep.factCount;
    }

    if (Math.abs(allEntry.comp.planCount - compPlanSum) > 0.01) {
      errors.push(`Month ${m} КП planCount: ALL=${allEntry.comp.planCount} vs SUM=${compPlanSum}`);
    }
    if (Math.abs(allEntry.comp.factCount - compFactSum) > 0.01) {
      errors.push(`Month ${m} КП factCount: ALL=${allEntry.comp.factCount} vs SUM=${compFactSum}`);
    }
    if (Math.abs(allEntry.ep.planCount - epPlanSum) > 0.01) {
      errors.push(`Month ${m} ЕП planCount: ALL=${allEntry.ep.planCount} vs SUM=${epPlanSum}`);
    }
    if (Math.abs(allEntry.ep.factCount - epFactSum) > 0.01) {
      errors.push(`Month ${m} ЕП factCount: ALL=${allEntry.ep.factCount} vs SUM=${epFactSum}`);
    }
  }

  return errors;
}
