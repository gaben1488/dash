import type { WorkbookSnapshot, SheetData, CellValue, RawCellValue, ReportMapEntry } from '@aemr/shared';
import { ALL_SHEETS, COLUMNS } from '@aemr/shared';
import type { ColumnLetter } from '@aemr/shared';

// ============================================================
// Ingest — converts raw Google Sheets API responses into a
// WorkbookSnapshot with cell-addressed SheetData.
// ============================================================

/**
 * Raw response shape from Google Sheets API `spreadsheets.get`
 * with `includeGridData: true` or from `spreadsheets.values.batchGet`.
 */
export interface SheetsAPIGridResponse {
  spreadsheetId: string;
  sheets?: Array<{
    properties?: { title?: string; sheetId?: number };
    data?: Array<{
      startRow?: number;
      startColumn?: number;
      rowData?: Array<{
        values?: Array<{
          effectiveValue?: { numberValue?: number; stringValue?: string; boolValue?: boolean; formulaValue?: string };
          formattedValue?: string;
          userEnteredValue?: { formulaValue?: string; numberValue?: number; stringValue?: string; boolValue?: boolean };
        }>;
      }>;
    }>;
  }>;
}

/**
 * Raw response shape from `spreadsheets.values.batchGet`
 * with valueRenderOption = UNFORMATTED_VALUE or FORMATTED_VALUE.
 */
export interface SheetsAPIBatchGetResponse {
  spreadsheetId: string;
  valueRanges?: Array<{
    range: string;
    values?: unknown[][];
  }>;
}

/**
 * Combined raw data that the server layer can pass in.
 * Exactly one of `gridResponse` or `batchGetResponse` should be set.
 */
export interface RawSheetsData {
  gridResponse?: SheetsAPIGridResponse;
  batchGetResponse?: SheetsAPIBatchGetResponse;
  /** Optional parallel read with formulas (valueRenderOption=FORMULA) */
  formulaResponse?: SheetsAPIBatchGetResponse;
  spreadsheetId: string;
}

// ────────────────────────────────────────────────────────────
// Column helpers
// ────────────────────────────────────────────────────────────

/** Converts 0-based column index to letter(s): 0→A, 25→Z, 26→AA */
function colIndexToLetter(idx: number): string {
  if (idx < 26) return String.fromCharCode(65 + idx);
  return String.fromCharCode(65 + Math.floor(idx / 26) - 1) + String.fromCharCode(65 + (idx % 26));
}

/** Parses a range like "'СВОД ТД-ПМ'!A1:AG300" into sheet name and bounds */
function parseRange(range: string): { sheet: string; startRow: number; startCol: number } | null {
  const match = range.match(/^'?([^'!]+)'?!([A-Z]{1,2})(\d+)/);
  if (!match) return null;
  const sheet = match[1];
  const colStr = match[2];
  const row = parseInt(match[3], 10);
  let col = 0;
  for (let i = 0; i < colStr.length; i++) {
    col = col * 26 + (colStr.charCodeAt(i) - 64);
  }
  col -= 1; // 0-based
  return { sheet, startRow: row, startCol: col };
}

// ────────────────────────────────────────────────────────────
// Main entry point
// ────────────────────────────────────────────────────────────

/**
 * Ingests raw Google Sheets API data into a WorkbookSnapshot.
 *
 * Handles two modes:
 * 1. Grid data (from `spreadsheets.get` with `includeGridData`)
 * 2. BatchGet values (from `spreadsheets.values.batchGet`)
 *
 * The result is a WorkbookSnapshot where each sheet's data is keyed
 * by cell address (e.g. "D14") and contains { v, f? }.
 */
export function ingestWorkbook(raw: RawSheetsData): WorkbookSnapshot {
  const sheets: Record<string, SheetData> = {};
  const now = new Date().toISOString();

  if (raw.gridResponse?.sheets) {
    ingestGridData(raw.gridResponse, sheets);
  }

  if (raw.batchGetResponse?.valueRanges) {
    ingestBatchGetData(raw.batchGetResponse, sheets);
  }

  // Merge formula data if available
  if (raw.formulaResponse?.valueRanges) {
    mergeFormulas(raw.formulaResponse, sheets);
  }

  return {
    sheets,
    loadedAt: now,
    spreadsheetId: raw.spreadsheetId,
  };
}

// ────────────────────────────────────────────────────────────
// Grid data ingestion (includeGridData mode)
// ────────────────────────────────────────────────────────────

function ingestGridData(
  response: SheetsAPIGridResponse,
  sheets: Record<string, SheetData>,
): void {
  for (const sheet of response.sheets ?? []) {
    const title = sheet.properties?.title;
    if (!title) continue;

    const sheetData: SheetData = {};

    for (const gridData of sheet.data ?? []) {
      const startRow = gridData.startRow ?? 0;
      const startCol = gridData.startColumn ?? 0;

      for (let ri = 0; ri < (gridData.rowData?.length ?? 0); ri++) {
        const rowData = gridData.rowData![ri];
        const rowNum = startRow + ri + 1; // 1-based

        for (let ci = 0; ci < (rowData.values?.length ?? 0); ci++) {
          const cellData = rowData.values![ci];
          const colIdx = startCol + ci;
          const colLetter = colIndexToLetter(colIdx);
          const address = `${colLetter}${rowNum}`;

          const ev = cellData.effectiveValue;
          const uev = cellData.userEnteredValue;

          let v: unknown = null;
          if (ev) {
            if (ev.numberValue !== undefined) v = ev.numberValue;
            else if (ev.stringValue !== undefined) v = ev.stringValue;
            else if (ev.boolValue !== undefined) v = ev.boolValue;
          } else if (cellData.formattedValue) {
            v = cellData.formattedValue;
          }

          const formula = uev?.formulaValue ?? undefined;

          if (v !== null || formula) {
            sheetData[address] = { v, f: formula };
          }
        }
      }
    }

    sheets[title] = sheetData;
  }
}

// ────────────────────────────────────────────────────────────
// BatchGet data ingestion (values.batchGet mode)
// ────────────────────────────────────────────────────────────

function ingestBatchGetData(
  response: SheetsAPIBatchGetResponse,
  sheets: Record<string, SheetData>,
): void {
  for (const vr of response.valueRanges ?? []) {
    const parsed = parseRange(vr.range);
    if (!parsed) continue;

    const { sheet, startRow, startCol } = parsed;
    if (!sheets[sheet]) sheets[sheet] = {};
    const sheetData = sheets[sheet];

    for (let ri = 0; ri < (vr.values?.length ?? 0); ri++) {
      const row = vr.values![ri];
      const rowNum = startRow + ri; // already 1-based from range

      for (let ci = 0; ci < row.length; ci++) {
        const colIdx = startCol + ci;
        const colLetter = colIndexToLetter(colIdx);
        const address = `${colLetter}${rowNum}`;
        const raw = row[ci];

        if (raw !== null && raw !== undefined && raw !== '') {
          const existing = sheetData[address];
          sheetData[address] = {
            v: raw,
            f: existing?.f,
          };
        }
      }
    }
  }
}

// ────────────────────────────────────────────────────────────
// Merge formulas from a separate FORMULA read
// ────────────────────────────────────────────────────────────

function mergeFormulas(
  response: SheetsAPIBatchGetResponse,
  sheets: Record<string, SheetData>,
): void {
  for (const vr of response.valueRanges ?? []) {
    const parsed = parseRange(vr.range);
    if (!parsed) continue;

    const { sheet, startRow, startCol } = parsed;
    if (!sheets[sheet]) continue;
    const sheetData = sheets[sheet];

    for (let ri = 0; ri < (vr.values?.length ?? 0); ri++) {
      const row = vr.values![ri];
      const rowNum = startRow + ri;

      for (let ci = 0; ci < row.length; ci++) {
        const colIdx = startCol + ci;
        const colLetter = colIndexToLetter(colIdx);
        const address = `${colLetter}${rowNum}`;
        const val = row[ci];

        if (typeof val === 'string' && val.startsWith('=')) {
          const existing = sheetData[address];
          if (existing) {
            existing.f = val;
          } else {
            sheetData[address] = { v: null, f: val };
          }
        }
      }
    }
  }
}

// ────────────────────────────────────────────────────────────
// Utility: get cell value from SheetData
// ────────────────────────────────────────────────────────────

/** Read a cell value from a SheetData by address like "D14" */
export function getCellValue(sheetData: SheetData, address: string): unknown {
  return sheetData[address]?.v ?? null;
}

/** Read a numeric cell value, returning null if not a number */
export function getCellNumber(sheetData: SheetData, address: string): number | null {
  const v = getCellValue(sheetData, address);
  if (typeof v === 'number' && !isNaN(v)) return v;
  if (typeof v === 'string') {
    const cleaned = v.replace(/\s/g, '').replace(/,/g, '.');
    const n = parseFloat(cleaned);
    if (!isNaN(n)) return n;
  }
  return null;
}

/** Check if a cell contains a formula */
export function hasFormula(sheetData: SheetData, address: string): boolean {
  const cell = sheetData[address];
  return !!cell?.f;
}

// ────────────────────────────────────────────────────────────
// Pipeline-facing functions (used by orchestrator.ts)
// ────────────────────────────────────────────────────────────

export interface IngestError {
  cell: string;
  error: string;
}

/**
 * Парсит batchGet ответ через reportMap, возвращает Map<key, RawCellValue>
 * для каждой метрики из карты.
 */
export function ingestBatchGetResponse(
  batchGetData: Array<{ range: string; values: unknown[][]; formulas?: unknown[][] }>,
  reportMap: ReportMapEntry[],
): { cells: Map<string, RawCellValue>; sheets: string[]; errors: IngestError[]; readAt: string; durationMs: number } {
  const start = Date.now();
  const now = new Date().toISOString();
  const cells = new Map<string, RawCellValue>();
  const errors: IngestError[] = [];
  const sheetsSet = new Set<string>();

  // Build a lookup: "SheetName!CellAddr" → reportMap entry
  const cellLookup = new Map<string, ReportMapEntry>();
  for (const entry of reportMap) {
    const key = `${entry.sourceSheet}!${entry.sourceCell}`;
    cellLookup.set(key, entry);
  }

  for (const rangeData of batchGetData) {
    const parsed = parseRange(rangeData.range);
    if (!parsed) continue;

    sheetsSet.add(parsed.sheet);

    for (let ri = 0; ri < (rangeData.values?.length ?? 0); ri++) {
      const row = rangeData.values[ri];
      const rowNum = parsed.startRow + ri;

      for (let ci = 0; ci < row.length; ci++) {
        const colIdx = parsed.startCol + ci;
        const colLetter = colIndexToLetter(colIdx);
        const address = `${colLetter}${rowNum}`;
        const fullKey = `${parsed.sheet}!${address}`;
        const rawValue = row[ci];

        // Extract formula if available
        let formula: string | null = null;
        if (rangeData.formulas && rangeData.formulas[ri] && rangeData.formulas[ri][ci]) {
          const f = rangeData.formulas[ri][ci];
          if (typeof f === 'string' && f.startsWith('=')) formula = f;
        }

        try {
          const rawCell: RawCellValue = {
            sheet: parsed.sheet,
            cell: address,
            rawValue,
            formattedValue: rawValue != null ? String(rawValue) : null,
            formula,
            valueType: rawValue == null ? 'null' : typeof rawValue,
            readAt: now,
          };
          cells.set(fullKey, rawCell);
        } catch (err) {
          errors.push({ cell: fullKey, error: String(err) });
        }
      }
    }
  }

  return {
    cells,
    sheets: Array.from(sheetsSet),
    errors,
    readAt: now,
    durationMs: Date.now() - start,
  };
}

/**
 * Конвертирует сырые строки листа в формат для классификатора.
 * [[val0, val1, ...], ...] → [{ rowIndex, cells: { A: val0, B: val1, ... } }]
 */
export function ingestSheetRows(
  sheetName: string,
  rows: unknown[][],
): Array<{ rowIndex: number; cells: Record<string, unknown> }> {
  return rows.map((row, ri) => {
    const cells: Record<string, unknown> = {};
    for (let ci = 0; ci < row.length; ci++) {
      const col = colIndexToLetter(ci);
      cells[col] = row[ci];
    }
    return { rowIndex: ri + 1, cells };
  });
}
