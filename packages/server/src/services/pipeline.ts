import { runPipeline, type PipelineInput } from '@aemr/core';
import {
  REPORT_MAP,
  getAllCellAddresses,
  getActiveRules,
  ALL_SHEETS,
  SVOD_SHEET_NAME,
  DEPARTMENT_SHEETS,
  DEPARTMENT_IDS,
  DEPARTMENT_ROWS,
  DEPARTMENT_SHORT_NAMES,
  buildDepartmentMetrics,
  buildSummaryMetrics,
} from '@aemr/shared';
import type {
  DataSnapshot,
  DashboardPayload,
  WorkbookSnapshot,
  DepartmentId as TypesDepartmentId,
  DepartmentMetrics as TypesDepartmentMetrics,
  ControlIssue,
  TrustScore,
  ProcurementRow,
  BudgetBreakdown,
  PeriodMetrics,
  CompetitiveMetrics,
  SoleSupplierMetrics,
  Issue,
  NormalizedMetric,
} from '@aemr/shared';
import type {
  ReportMapDepartmentId,
  RawSheetData,
  ReportMapDepartmentMetrics,
  RowMetrics,
  SummaryMetrics,
} from '@aemr/shared';
import {
  getSnapshot as getWorkbookSnapshot,
  batchGetCells,
  batchGetFormulas,
  getSheetData,
  invalidateCache as invalidateSheetCache,
} from './google-sheets.js';
import { createDemoSnapshot } from './demo-data.js';
import { config } from '../config.js';

// ============================================================
// Pipeline Service — Orchestrates data processing
// ============================================================

let cachedPayload: DashboardPayload | null = null;
let payloadTimestamp = 0;

/**
 * Returns the full DashboardPayload, using cache when possible.
 * This is the main entry point for all dashboard data.
 */
export async function refreshDashboard(force = false): Promise<DashboardPayload> {
  const now = Date.now();
  const ttl = config.cache.ttlSeconds * 1000;

  if (!force && cachedPayload && (now - payloadTimestamp) < ttl) {
    return cachedPayload;
  }

  const payload = await buildDashboardPayload();
  cachedPayload = payload;
  payloadTimestamp = now;

  return payload;
}

/** Force invalidation of all caches */
export function invalidateAll(): void {
  invalidateSheetCache();
  cachedPayload = null;
  payloadTimestamp = 0;
}

/**
 * Builds the full DashboardPayload:
 * 1. Fetch workbook snapshot from Google Sheets
 * 2. Run the data pipeline (ingest -> normalize -> classify -> validate -> delta -> trust)
 * 3. Aggregate department metrics from SVOD sheet
 * 4. Extract row-level data from department sheets
 * 5. Produce trust score and issues
 */
async function buildDashboardPayload(): Promise<DashboardPayload> {
  // ── Step 1: Fetch workbook snapshot ──
  let snapshot: WorkbookSnapshot;
  try {
    snapshot = await getWorkbookSnapshot(true);
  } catch (err) {
    console.warn('Google Sheets unavailable, using demo data:', (err as Error).message);
    return buildDemoPayload();
  }

  // ── Step 2: Run the full pipeline for DataSnapshot ──
  let dataSnapshot: DataSnapshot;
  try {
    const cellAddresses = getAllCellAddresses();
    const [batchValues, batchFormulasData] = await Promise.all([
      batchGetCells(cellAddresses),
      batchGetFormulas(cellAddresses),
    ]);

    const batchGetData = batchValues.map((v, i) => ({
      range: v.range,
      values: v.values,
      formulas: batchFormulasData[i]?.formulas,
    }));

    const sheetRows: Record<string, unknown[][]> = {};
    const allSheetNames = ALL_SHEETS as readonly string[];
    await Promise.all(
      allSheetNames.map(async (sheetName) => {
        try {
          sheetRows[sheetName] = await getSheetData(sheetName);
        } catch (error) {
          console.warn(`Failed to read sheet "${sheetName}":`, error);
        }
      }),
    );

    const pipelineInput: PipelineInput = {
      batchGetData,
      sheetRows,
      reportMap: REPORT_MAP,
      rules: getActiveRules(),
      spreadsheetId: config.google.spreadsheetId,
    };

    dataSnapshot = runPipeline(pipelineInput);
  } catch (err) {
    console.warn('Pipeline failed, using demo data:', (err as Error).message);
    return buildDemoPayload();
  }

  // ── Step 3: Extract SVOD metrics using report-map helpers ──
  const svodSheetData = snapshot.sheets[SVOD_SHEET_NAME];
  const svodArray = sheetDataTo2DArray(svodSheetData ?? {});

  const summaryMetrics = buildSummaryMetrics(svodArray);
  const summary = rowMetricsToTypedDepartment('СВОД' as TypesDepartmentId, summaryMetrics);

  const departments: TypesDepartmentMetrics[] = [];
  for (const deptId of DEPARTMENT_IDS) {
    const deptMetrics = buildDepartmentMetrics(svodArray, deptId);
    const shortName = DEPARTMENT_SHORT_NAMES[deptId] as TypesDepartmentId;
    departments.push(reportMapDeptToTyped(shortName, deptMetrics));
  }

  // ── Step 4: Extract row-level data from department sheets ──
  const rows: Record<TypesDepartmentId, ProcurementRow[]> = {} as Record<TypesDepartmentId, ProcurementRow[]>;
  for (const deptSheet of DEPARTMENT_SHEETS) {
    const sheetData = snapshot.sheets[deptSheet];
    if (sheetData) {
      rows[deptSheet] = extractProcurementRows(sheetData, deptSheet);
    } else {
      rows[deptSheet] = [];
    }
  }

  // ── Step 5: Map pipeline issues to ControlIssue[] ──
  const controlIssues = mapToControlIssues(dataSnapshot.issues);

  // ── Step 6: Assemble the payload ──
  return {
    snapshot,
    summary,
    departments,
    issues: controlIssues,
    trust: dataSnapshot.trust,
    rows,
  };
}

// ────────────────────────────────────────────────────────────
// Helper: build demo payload when Sheets is unavailable
// ────────────────────────────────────────────────────────────

function buildDemoPayload(): DashboardPayload {
  const demoSnapshot = createDemoSnapshot();
  const now = new Date().toISOString();

  const emptyBudget: BudgetBreakdown = { fb: 0, kb: 0, mb: 0, total: 0 };
  const emptyPeriod: PeriodMetrics = {
    planned: 0, fact: 0, deviation: 0, executionPct: 0,
    planSum: { ...emptyBudget }, factSum: { ...emptyBudget },
  };
  const emptySummary: TypesDepartmentMetrics = {
    id: 'УЭР' as TypesDepartmentId,
    competitive: { q1: { ...emptyPeriod }, year: { ...emptyPeriod }, economy: null },
    soleSupplier: { q1: { ...emptyPeriod }, year: { ...emptyPeriod }, economy: null, epSharePct: 0 },
  };

  const departments: TypesDepartmentMetrics[] = DEPARTMENT_SHEETS.map((id) => ({
    ...emptySummary,
    id,
  }));

  const rows: Record<TypesDepartmentId, ProcurementRow[]> = {} as Record<TypesDepartmentId, ProcurementRow[]>;
  for (const d of DEPARTMENT_SHEETS) {
    rows[d] = [];
  }

  return {
    snapshot: {
      sheets: {},
      loadedAt: now,
      spreadsheetId: config.google.spreadsheetId,
    },
    summary: emptySummary,
    departments,
    issues: mapToControlIssues(demoSnapshot.issues),
    trust: demoSnapshot.trust,
    rows,
  };
}

// ────────────────────────────────────────────────────────────
// Converters
// ────────────────────────────────────────────────────────────

/** Convert SheetData (cell map) to a 2D array for report-map helpers */
function sheetDataTo2DArray(sheetData: Record<string, { v: unknown; f?: string } | undefined>): unknown[][] {
  let maxRow = 0;
  let maxCol = 0;
  const entries: Array<{ row: number; col: number; value: unknown }> = [];

  for (const [addr, cell] of Object.entries(sheetData)) {
    if (!cell) continue;
    const parsed = parseCellAddress(addr);
    if (!parsed) continue;
    entries.push({ row: parsed.row - 1, col: parsed.col, value: cell.v });
    if (parsed.row - 1 > maxRow) maxRow = parsed.row - 1;
    if (parsed.col > maxCol) maxCol = parsed.col;
  }

  const result: unknown[][] = [];
  for (let r = 0; r <= maxRow; r++) {
    result[r] = new Array(maxCol + 1).fill(null);
  }
  for (const e of entries) {
    result[e.row][e.col] = e.value;
  }

  return result;
}

/** Parse "D14" -> { row: 14, col: 3 } */
function parseCellAddress(addr: string): { row: number; col: number } | null {
  const match = addr.match(/^([A-Z]{1,2})(\d+)$/);
  if (!match) return null;
  const letters = match[1];
  const row = parseInt(match[2], 10);
  let col = 0;
  for (let i = 0; i < letters.length; i++) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  col -= 1; // 0-based
  return { row, col };
}

/** Convert RowMetrics to PeriodMetrics */
function rowMetricsToPeriod(rm: RowMetrics): PeriodMetrics {
  return {
    planned: rm.planCount ?? 0,
    fact: rm.factCount ?? 0,
    deviation: rm.deviation ?? 0,
    executionPct: rm.executionPercent ?? 0,
    planSum: {
      fb: rm.fbPlan ?? 0,
      kb: rm.kbPlan ?? 0,
      mb: rm.mbPlan ?? 0,
      total: rm.totalPlan ?? 0,
    },
    factSum: {
      fb: rm.fbFact ?? 0,
      kb: rm.kbFact ?? 0,
      mb: rm.mbFact ?? 0,
      total: rm.totalFact ?? 0,
    },
  };
}

/** Convert SummaryMetrics to DepartmentMetrics (for SVOD summary row) */
function rowMetricsToTypedDepartment(
  id: TypesDepartmentId,
  sm: SummaryMetrics,
): TypesDepartmentMetrics {
  return {
    id,
    competitive: {
      q1: rowMetricsToPeriod(sm.kpQ1),
      year: rowMetricsToPeriod(sm.kpYear),
      economy: null,
    },
    soleSupplier: {
      q1: rowMetricsToPeriod(sm.epQ1),
      year: rowMetricsToPeriod(sm.epYear),
      economy: null,
      epSharePct: 0,
    },
  };
}

/** Convert ReportMapDepartmentMetrics to typed DepartmentMetrics */
function reportMapDeptToTyped(
  id: TypesDepartmentId,
  dm: ReportMapDepartmentMetrics,
): TypesDepartmentMetrics {
  return {
    id,
    competitive: {
      q1: rowMetricsToPeriod(dm.kpQ1),
      year: rowMetricsToPeriod(dm.kpYear),
      economy: dm.economyKp,
    },
    soleSupplier: {
      q1: rowMetricsToPeriod(dm.epQ1),
      year: rowMetricsToPeriod(dm.epYear),
      economy: dm.economyEp,
      epSharePct: dm.epPercent ?? 0,
    },
  };
}

/** Extract procurement rows from a department sheet */
function extractProcurementRows(
  sheetData: Record<string, { v: unknown; f?: string } | undefined>,
  deptId: string,
): ProcurementRow[] {
  const array2D = sheetDataTo2DArray(sheetData);
  const rows: ProcurementRow[] = [];

  for (let r = 0; r < array2D.length; r++) {
    const row = array2D[r];
    if (!row) continue;

    // Skip header/empty rows: check if there's meaningful data
    // Columns: A=0 (N), B=1 (ReestrovyNomer), C=2 (Description), ...
    const id = row[1] != null ? String(row[1]) : null;
    const description = row[2] != null ? String(row[2]) : null;

    // Skip if completely empty
    if (!id && !description && row[7] == null && row[10] == null) continue;

    const toNum = (v: unknown): number => {
      if (v == null || v === '') return 0;
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    const planAmounts: BudgetBreakdown = {
      fb: toNum(row[7]),   // H
      kb: toNum(row[8]),   // I
      mb: toNum(row[9]),   // J
      total: toNum(row[10]), // K
    };

    const factAmounts: BudgetBreakdown = {
      fb: toNum(row[21]),  // V
      kb: toNum(row[22]),  // W
      mb: toNum(row[23]),  // X
      total: toNum(row[24]), // Y
    };

    // Detect formulas for this row
    const hasFormula: Record<string, boolean> = {};
    for (const [addr, cell] of Object.entries(sheetData)) {
      if (!cell?.f) continue;
      const parsed = parseCellAddress(addr);
      if (parsed && parsed.row === r + 1) {
        hasFormula[addr] = true;
      }
    }

    rows.push({
      rowIndex: r + 1, // 1-based
      id,
      description,
      type: parseType(row[5]),
      method: parseMethod(row[11]),
      planAmounts,
      factAmounts,
      planDate: row[13] != null ? String(row[13]) : null,   // N
      factDate: row[16] != null ? String(row[16]) : null,   // Q
      status: row[20] != null ? String(row[20]) : null,     // U
      comment: row[30] != null ? String(row[30]) : null,    // AE (GRBS comment)
      hasFormula,
    });
  }

  return rows;
}

function parseMethod(v: unknown): 'ЭА' | 'ЕП' | 'ЭК' | 'ЭЗК' | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s === 'ЭА' || s === 'ЕП' || s === 'ЭК' || s === 'ЭЗК') return s;
  return null;
}

function parseType(v: unknown): 'Текущая деятельность' | 'Программное мероприятие' | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s === 'Текущая деятельность' || s === 'Программное мероприятие') return s;
  return null;
}

/** Map pipeline Issue[] to ControlIssue[] for the dashboard */
function mapToControlIssues(issues: Issue[]): ControlIssue[] {
  return issues.map((issue, idx) => ({
    id: issue.id,
    ruleId: issue.category ?? 'unknown',
    severity: mapSeverity(issue.severity),
    origin: (issue.origin === 'spreadsheet_rule' || issue.origin === 'bi_heuristic')
      ? issue.origin
      : 'bi_heuristic',
    department: (issue.departmentId
      ? mapDeptIdToShortName(issue.departmentId)
      : 'СВОД') as TypesDepartmentId | 'СВОД',
    sheet: issue.sheet ?? '',
    cell: issue.cell ?? '',
    row: issue.row ?? 0,
    message: issue.description,
    expected: null,
    actual: null,
  }));
}

function mapSeverity(s: string): 'error' | 'warning' | 'info' {
  if (s === 'critical' || s === 'error') return 'error';
  if (s === 'significant' || s === 'warning') return 'warning';
  return 'info';
}

function mapDeptIdToShortName(deptId: string): string {
  const map: Record<string, string> = {
    uer: 'УЭР', uio: 'УИО', uagzo: 'УАГЗО', ufbp: 'УФБП',
    ud: 'УД', udtx: 'УДТХ', uksimp: 'УКСиМП', uo: 'УО',
  };
  return map[deptId] ?? deptId;
}

// ────────────────────────────────────────────────────────────
// Legacy exports for backward compatibility
// ────────────────────────────────────────────────────────────

/** Get DataSnapshot directly (for routes that need pipeline output) */
export async function getDataSnapshot(force = false): Promise<DataSnapshot> {
  try {
    const cellAddresses = getAllCellAddresses();
    const [batchValues, batchFormulasData] = await Promise.all([
      batchGetCells(cellAddresses),
      batchGetFormulas(cellAddresses),
    ]);

    const batchGetData = batchValues.map((v, i) => ({
      range: v.range,
      values: v.values,
      formulas: batchFormulasData[i]?.formulas,
    }));

    const sheetRows: Record<string, unknown[][]> = {};
    const allSheetNames = ALL_SHEETS as readonly string[];
    await Promise.all(
      allSheetNames.map(async (sheetName) => {
        try {
          sheetRows[sheetName] = await getSheetData(sheetName);
        } catch { /* skip */ }
      }),
    );

    return runPipeline({
      batchGetData,
      sheetRows,
      reportMap: REPORT_MAP,
      rules: getActiveRules(),
      spreadsheetId: config.google.spreadsheetId,
    });
  } catch {
    return createDemoSnapshot();
  }
}
