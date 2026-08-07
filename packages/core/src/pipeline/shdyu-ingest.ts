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
  SHDYU_BLOCKS, SHDYU_ALL_BLOCK, SHDYU_COLS, SHDYU_LEGACY_ALL_BLOCK,
  SHDYU_LEGACY_BLOCKS, SHDYU_LEGACY_COLS, SHDYU_QUARTERLY_COLS,
  type SHDYUBlock, type SHDYUDeptData, type SHDYUMonthlyEntry,
  type SHDYUBlockMetrics, type SHDYUSummaryData, type SHDYUQuarterlyEntry,
  type SHDYUFormulaIssue,
  toNumber,
} from '@aemr/shared';

/**
 * Число листа — канон @aemr/shared (toNumber): пробелы-разряды и запятая
 * десятичная; пусто/'-'/нечисло → 0. Прежний parseFloat не знал ни того,
 * ни другого («1 234,56» → 1, «12,5» → 12) — блок А п.1 пирамиды.
 */
function num(v: unknown): number {
  return toNumber(v) ?? 0;
}

const ZERO_METRICS: SHDYUBlockMetrics = {
  planCount: 0, factCount: 0, deviation: 0, executionPct: 0,
  planFB: 0, planKB: 0, planMB: 0, planTotal: 0,
  factFB: 0, factKB: 0, factMB: 0, factTotal: 0,
  deviationAmount: 0, spentPct: 0,
  economyFB: 0, economyKB: 0, economyMB: 0, economyTotal: 0,
};

type SHDYUMonthlyCols = typeof SHDYU_COLS | typeof SHDYU_LEGACY_COLS;
type SHDYUMetricCols = SHDYUMonthlyCols | typeof SHDYU_QUARTERLY_COLS;

/**
 * Extract metrics from a single row using column mapping.
 */
function extractRowMetrics(row: unknown[], cols: SHDYUMetricCols): SHDYUBlockMetrics {
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
  cols: SHDYUMonthlyCols,
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

    // Month labels are advisory; row position remains the canonical month source.
    result[month] = extractRowMetrics(row, cols);
  }

  return result;
}

/**
 * Parse a single row (итого, ИТОГО ЭА+ЕП, or Доля).
 */
function parseSingleRow(
  rows: unknown[][],
  rowNum: number,
  cols: SHDYUMonthlyCols,
): SHDYUBlockMetrics {
  const rowIdx = rowNum - 1;
  if (rowIdx < 0 || rowIdx >= rows.length) return { ...ZERO_METRICS };
  const row = rows[rowIdx];
  if (!row) return { ...ZERO_METRICS };
  return extractRowMetrics(row, cols);
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
  formulaIssues: SHDYUFormulaIssue[] = [],
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
    ...(formulaIssues.length > 0 ? { formulaIssues } : {}),
  };
}

function extractFormulaSheetRefs(formulaRow: unknown[] | undefined): string[] {
  if (!formulaRow) return [];
  const refs = new Set<string>();
  const quotedSheetRef = /'((?:[^']|'')+)'!/g;

  for (const cell of formulaRow) {
    if (typeof cell !== 'string' || !cell.includes('!')) continue;
    for (const match of cell.matchAll(quotedSheetRef)) {
      refs.add(match[1].replaceAll("''", "'"));
    }
  }

  return [...refs];
}

/**
 * Детект инвертированного фильтра способа в формуле строки.
 * КП-блок (comp) ДОЛЖЕН фильтровать L<>"ЕП" (или ="ЭА"); если он фильтрует ="ЕП" — он
 * тянет ЕП-данные в КП-ячейку (баг источника, как УО R279). Зеркально для ЕП-блока.
 * Консервативно: срабатывает только когда присутствует ЧУЖОЙ предикат и отсутствует свой.
 */
function detectInvertedMethodFilter(
  formulaRow: unknown[] | undefined,
  side: 'comp' | 'ep',
): { expected: string; detected: string } | undefined {
  if (!formulaRow) return undefined;
  let epEquality = false; // ="ЕП" / ,"ЕП"  — предикат ЕП
  let nonEp = false;      // <>"ЕП" / ,"<>ЕП" / ="ЭА" / ,"ЭА" — предикат КП
  for (const cell of formulaRow) {
    if (typeof cell !== 'string') continue;
    if (/=\s*"ЕП"/.test(cell) || /,\s*"ЕП"/.test(cell)) epEquality = true;
    if (/<>\s*"ЕП"/.test(cell) || /,\s*"<>ЕП"/.test(cell) || /=\s*"ЭА"/.test(cell) || /,\s*"ЭА"/.test(cell)) nonEp = true;
  }
  if (side === 'comp' && epEquality && !nonEp) return { expected: '<>"ЕП"', detected: '="ЕП"' };
  if (side === 'ep' && nonEp && !epEquality) return { expected: '="ЕП"', detected: '<>"ЕП"' };
  return undefined;
}

function formulaIssuesForMonthlyBlock(
  formulaData: unknown[][] | undefined,
  block: SHDYUBlock,
  startRow: number,
  side: 'comp' | 'ep',
): Record<number, SHDYUFormulaIssue[]> {
  const result: Record<number, SHDYUFormulaIssue[]> = {};
  if (!formulaData || block.grbsId === 'all') return result;

  const sideLabel = side === 'comp' ? 'КП' : 'ЕП';
  for (let month = 1; month <= 12; month++) {
    const rowNum = startRow + (month - 1);
    const formulaRow = formulaData[rowNum - 1];
    const issues: SHDYUFormulaIssue[] = [];

    // (а) ссылка на чужой лист ГРБС
    const actualSheets = [...new Set(
      extractFormulaSheetRefs(formulaRow).filter((sheetName) => sheetName !== block.grbsShort),
    )];
    if (actualSheets.length > 0) {
      issues.push({
        type: 'sheet_reference_mismatch',
        expectedSheet: block.grbsShort,
        actualSheets,
        row: rowNum,
        month,
        block: side,
        evidence: `ШДЮ row ${rowNum} ${block.grbsShort}/${month}/${sideLabel} references ${actualSheets.join(', ')} instead of ${block.grbsShort}`,
      });
    }

    // (б) инвертированный фильтр способа КП/ЕП
    const inverted = detectInvertedMethodFilter(formulaRow, side);
    if (inverted) {
      issues.push({
        type: 'method_filter_inverted',
        expectedFilter: inverted.expected,
        detectedFilter: inverted.detected,
        row: rowNum,
        month,
        block: side,
        evidence: `ШДЮ row ${rowNum} ${block.grbsShort}/${month}/${sideLabel}: фильтр способа ${inverted.detected} вместо ${inverted.expected} — ячейка тянет противоположную группу КП/ЕП; CalcEngine каноничен`,
      });
    }

    if (issues.length > 0) result[month] = issues;
  }

  return result;
}

/**
 * Parse a single ГРБС block (КП + ЕП + summary + quarterly).
 */
function parseGRBSBlock(
  sheetData: unknown[][],
  formulaData: unknown[][] | undefined,
  block: SHDYUBlock,
  cols: SHDYUMonthlyCols,
  includeQuarterly: boolean,
): SHDYUDeptData {
  // Monthly КП and ЕП data (12 rows each)
  const compData = parseMonthlyBlock(sheetData, block.compStartRow, cols);
  const epData = parseMonthlyBlock(sheetData, block.epStartRow, cols);
  const compFormulaIssues = formulaIssuesForMonthlyBlock(formulaData, block, block.compStartRow, 'comp');
  const epFormulaIssues = formulaIssuesForMonthlyBlock(formulaData, block, block.epStartRow, 'ep');

  const months: Record<number, SHDYUMonthlyEntry> = {};
  for (let m = 1; m <= 12; m++) {
    months[m] = buildMonthlyEntry(m, compData[m], epData[m], [
      ...(compFormulaIssues[m] ?? []),
      ...(epFormulaIssues[m] ?? []),
    ]);
  }

  // Итого rows (КП and ЕП yearly totals)
  const compTotal = parseSingleRow(sheetData, block.compTotalRow, cols);
  const epTotal = parseSingleRow(sheetData, block.epTotalRow, cols);

  // Summary rows: ИТОГО ЭА+ЕП, Доля ЭА, Доля ЕП
  const summary: SHDYUSummaryData = {
    total: parseSingleRow(sheetData, block.totalRow, cols),
    compSharePct: parseSingleRow(sheetData, block.compShareRow, cols),
    epSharePct: parseSingleRow(sheetData, block.epShareRow, cols),
  };

  // «Расч. экономия» района — мини-таблица поверх строки «Доля ЕП»:
  // L — итого, M — ФБ, O — МБ; ячейку КБ (N) занимает формула доли, лист
  // теряет краевой бюджет — kb честно null, а не ноль (см. тип).
  if (block.grbsId === 'all') {
    const epShareRowRaw = sheetData[block.epShareRow - 1] ?? [];
    const total = num(epShareRowRaw[11]); // L
    if (total !== 0) {
      summary.calcEconomy = {
        total,
        fb: num(epShareRowRaw[12]),  // M
        kb: null,
        mb: num(epShareRowRaw[14]),  // O
        row: block.epShareRow,
      };
    }
  }

  // Квартальный ярус (колонки U–AM) — ДВУМЯ диапазонами, по способу.
  // Метки Q1–Q4 стоят и в КП-секции, и в ЕП-секции; один сплошной проход
  // compStartRow..epEndRow складывал всё в общий словарь по метке, и ЕП
  // затирал КП (аудит 30.07: район отдавал итог ЕП вместо КП+ЕП).
  const quarterly = includeQuarterly
    ? {
      comp: parseQuarterlyData(sheetData, block.compStartRow, block.compEndRow),
      ep: parseQuarterlyData(sheetData, block.epStartRow, block.epEndRow),
    }
    : undefined;

  return {
    grbsId: block.grbsId,
    months,
    compTotal,
    epTotal,
    summary,
    quarterly,
  };
}

function isYearCell(value: unknown): boolean {
  return typeof value === 'number' && value >= 2000 && value <= 2100;
}

function detectSHDYUFormat(sheetData: unknown[][]): 'legacy' | 'current' {
  const firstLegacyDataRow = sheetData[3];
  if (firstLegacyDataRow && isYearCell(firstLegacyDataRow[SHDYU_LEGACY_COLS.YEAR])) {
    return 'legacy';
  }
  return 'current';
}

/**
 * Parse the entire ШДЮ sheet and return per-ГРБС monthly data.
 * Includes the "ALL" block for cross-validation.
 */
export function parseSHDYUSheet(
  sheetData: unknown[][],
  formulaData?: unknown[][],
): Record<string, SHDYUDeptData> {
  const result: Record<string, SHDYUDeptData> = {};
  const format = detectSHDYUFormat(sheetData);
  const allBlock = format === 'legacy' ? SHDYU_LEGACY_ALL_BLOCK : SHDYU_ALL_BLOCK;
  const blocks = format === 'legacy' ? SHDYU_LEGACY_BLOCKS : SHDYU_BLOCKS;
  const cols = format === 'legacy' ? SHDYU_LEGACY_COLS : SHDYU_COLS;

  // Parse ALL block + individual department blocks
  const allBlocks = [allBlock, ...blocks];

  for (const block of allBlocks) {
    result[block.grbsId] = parseGRBSBlock(
      sheetData,
      formulaData,
      block,
      cols,
      format === 'current',
    );
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
