import { google, type sheets_v4 } from 'googleapis';
import { config } from '../config.js';
import {
  ALL_SHEETS,
  SVOD_SHEET_NAME,
  DEPARTMENT_SHEETS,
  DEPARTMENT_REGISTRY,
} from '@aemr/shared';
import type { WorkbookSnapshot, SheetData, CellValue } from '@aemr/shared';

// ============================================================
// Google Sheets API Service — AEMR Platform
// ============================================================

let sheetsApi: sheets_v4.Sheets | null = null;

/**
 * Initializes and returns the Google Sheets API client.
 * Supports three auth modes: Service Account, API Key, ADC.
 */
async function getSheetsApi(): Promise<sheets_v4.Sheets> {
  if (sheetsApi) return sheetsApi;

  if (config.google.serviceAccountEmail && config.google.privateKey) {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: config.google.serviceAccountEmail,
        private_key: config.google.privateKey,
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    sheetsApi = google.sheets({ version: 'v4', auth });
  } else if (config.google.apiKey) {
    sheetsApi = google.sheets({ version: 'v4', auth: config.google.apiKey });
  } else {
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    sheetsApi = google.sheets({ version: 'v4', auth });
  }

  return sheetsApi;
}

// ────────────────────────────────────────────────────────────
// Cache layer
// ────────────────────────────────────────────────────────────

let cachedSnapshot: WorkbookSnapshot | null = null;
let cacheTimestamp = 0;

/**
 * Returns the cached workbook snapshot if still valid, otherwise fetches fresh.
 */
export async function getSnapshot(force = false): Promise<WorkbookSnapshot> {
  const now = Date.now();
  const ttl = config.cache.ttlSeconds * 1000;

  if (!force && cachedSnapshot && (now - cacheTimestamp) < ttl) {
    return cachedSnapshot;
  }

  const snapshot = await fetchWorkbook();
  cachedSnapshot = snapshot;
  cacheTimestamp = now;

  return snapshot;
}

/** Invalidate the in-memory cache */
export function invalidateCache(): void {
  cachedSnapshot = null;
  cacheTimestamp = 0;
}

// ────────────────────────────────────────────────────────────
// Workbook fetching
// ────────────────────────────────────────────────────────────

/**
 * Fetches ALL sheets from the spreadsheet and returns a WorkbookSnapshot.
 *
 * For each sheet we do two reads:
 * - UNFORMATTED_VALUE: actual values (numbers as numbers)
 * - FORMULA: to detect which cells contain formulas
 *
 * The result is a map of sheet name -> Record<cellAddress, CellValue>.
 */
export async function fetchWorkbook(): Promise<WorkbookSnapshot> {
  const api = await getSheetsApi();
  const spreadsheetId = config.google.spreadsheetId;

  // Build ranges for all sheets
  const sheetNames = ALL_SHEETS as readonly string[];
  const valueRanges = sheetNames.map((s) => `'${s}'`);

  // Fetch values (UNFORMATTED_VALUE for accurate numbers)
  const [valuesResponse, formulasResponse] = await Promise.all([
    api.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: valueRanges,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING',
      majorDimension: 'ROWS',
    }),
    api.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: valueRanges,
      valueRenderOption: 'FORMULA',
      majorDimension: 'ROWS',
    }),
  ]);

  const valRanges = valuesResponse.data.valueRanges ?? [];
  const fmtRanges = formulasResponse.data.valueRanges ?? [];

  const sheets: Record<string, SheetData> = {};

  for (let si = 0; si < sheetNames.length; si++) {
    const sheetName = sheetNames[si];
    const valRows = (valRanges[si]?.values as unknown[][] | undefined) ?? [];
    const fmtRows = (fmtRanges[si]?.values as unknown[][] | undefined) ?? [];

    const sheetData: SheetData = {};
    const maxRows = Math.max(valRows.length, fmtRows.length);

    for (let r = 0; r < maxRows; r++) {
      const valRow = valRows[r] ?? [];
      const fmtRow = fmtRows[r] ?? [];
      const maxCols = Math.max(valRow.length, fmtRow.length);

      for (let c = 0; c < maxCols; c++) {
        const value = valRow[c] ?? null;
        const formulaRaw = fmtRow[c];

        // Skip completely empty cells
        if (value === null && (formulaRaw === null || formulaRaw === undefined)) continue;
        if (value === '' && (formulaRaw === undefined || formulaRaw === '')) continue;

        const cellAddr = columnToLetter(c) + (r + 1);
        const cell: CellValue = { v: value };

        // If the formula render returns a string starting with '=', it's a formula
        if (typeof formulaRaw === 'string' && formulaRaw.startsWith('=')) {
          cell.f = formulaRaw;
        }

        sheetData[cellAddr] = cell;
      }
    }

    sheets[sheetName] = sheetData;
  }

  return {
    sheets,
    loadedAt: new Date().toISOString(),
    spreadsheetId,
  };
}

/**
 * Reads a single sheet as a 2D array (for row-level analysis).
 * Returns raw rows for pipeline usage.
 */
export async function getSheetData(sheetName: string): Promise<unknown[][]> {
  const api = await getSheetsApi();

  const response = await api.spreadsheets.values.get({
    spreadsheetId: config.google.spreadsheetId,
    range: `'${sheetName}'`,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
    majorDimension: 'ROWS',
  });

  return (response.data.values as unknown[][]) ?? [];
}

/**
 * Reads specific cells via batchGet (used by pipeline).
 */
export async function batchGetCells(
  ranges: string[],
): Promise<Array<{ range: string; values: unknown[][] }>> {
  const api = await getSheetsApi();

  const response = await api.spreadsheets.values.batchGet({
    spreadsheetId: config.google.spreadsheetId,
    ranges,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
    majorDimension: 'ROWS',
  });

  return (response.data.valueRanges ?? []).map((vr, i) => ({
    range: vr.range ?? ranges[i],
    values: (vr.values as unknown[][]) ?? [[]],
  }));
}

/**
 * Reads formulas for diagnostics.
 */
export async function batchGetFormulas(
  ranges: string[],
): Promise<Array<{ range: string; formulas: unknown[][] }>> {
  const api = await getSheetsApi();

  const response = await api.spreadsheets.values.batchGet({
    spreadsheetId: config.google.spreadsheetId,
    ranges,
    valueRenderOption: 'FORMULA',
    majorDimension: 'ROWS',
  });

  return (response.data.valueRanges ?? []).map((vr, i) => ({
    range: vr.range ?? ranges[i],
    formulas: (vr.values as unknown[][]) ?? [[]],
  }));
}

/**
 * Gets spreadsheet metadata (list of sheets).
 */
export async function getSpreadsheetMetadata(): Promise<{
  title: string;
  sheets: Array<{ name: string; rowCount: number; colCount: number }>;
}> {
  const api = await getSheetsApi();

  const response = await api.spreadsheets.get({
    spreadsheetId: config.google.spreadsheetId,
    fields: 'properties.title,sheets.properties',
  });

  return {
    title: response.data.properties?.title ?? 'Unknown',
    sheets: (response.data.sheets ?? []).map((s) => ({
      name: s.properties?.title ?? 'Unknown',
      rowCount: s.properties?.gridProperties?.rowCount ?? 0,
      colCount: s.properties?.gridProperties?.columnCount ?? 0,
    })),
  };
}

/**
 * Reads a single sheet from an EXTERNAL spreadsheet (by ID) as a 2D array.
 * Used for loading department-specific spreadsheets.
 */
export async function getSheetDataFromSpreadsheet(
  spreadsheetId: string,
  sheetName: string,
): Promise<unknown[][]> {
  const api = await getSheetsApi();

  const response = await api.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName}'`,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
    majorDimension: 'ROWS',
  });

  return (response.data.values as unknown[][]) ?? [];
}

/**
 * Reads a single sheet from an EXTERNAL spreadsheet WITH both values AND formulas.
 * Returns { values, formulas } where formulas[r][c] starts with '=' if it's a formula cell.
 *
 * BUG-2 FIX: Department sheets must include formula info for:
 * - SIG-INT-003 (broken formula detection)
 * - Field profiling (input vs formula vs protected columns)
 * - Trust scoring (formula integrity component)
 */
export async function getSheetDataWithFormulas(
  spreadsheetId: string,
  sheetName: string,
): Promise<{ values: unknown[][]; formulas: unknown[][] }> {
  const api = await getSheetsApi();
  const range = `'${sheetName}'`;

  const [valResp, fmlResp] = await Promise.all([
    api.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING',
      majorDimension: 'ROWS',
    }),
    api.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: 'FORMULA',
      majorDimension: 'ROWS',
    }),
  ]);

  return {
    values: (valResp.data.values as unknown[][]) ?? [],
    formulas: (fmlResp.data.values as unknown[][]) ?? [],
  };
}

/** Result of department spreadsheet fetch — includes both values and formulas */
export interface DeptSheetResult {
  values: unknown[][];
  formulas: unknown[][];
  sheetName: string;
}

/**
 * Fetches row data from all department-specific spreadsheets in parallel.
 * Each department has its own Google Sheets spreadsheet ID (from config).
 *
 * BUG-2 FIX: Now reads BOTH values AND formulas for each department sheet.
 * Sheet names are derived from DEPARTMENT_REGISTRY (единый реестр управлений).
 *
 * Returns map: departmentName → { values, formulas, sheetName }.
 */
export async function fetchDepartmentSpreadsheets(
  deptSpreadsheets: Record<string, string>,
): Promise<{ data: Record<string, DeptSheetResult>; errors: Record<string, string> }> {
  const data: Record<string, DeptSheetResult> = {};
  const errors: Record<string, string> = {};

  // Canonical sheet name from department-registry (single source of truth).
  const DEPT_SHEET_NAME: Record<string, string> = Object.fromEntries(
    DEPARTMENT_REGISTRY.map(d => [d.shortName, d.sheetName]),
  );

  const entries = Object.entries(deptSpreadsheets);
  const results = await Promise.allSettled(
    entries.map(async ([deptName, ssId]) => {
      // Use canonical sheet name from registry, fallback to dept name
      const sheetName = DEPT_SHEET_NAME[deptName] ?? deptName;
      try {
        const result = await getSheetDataWithFormulas(ssId, sheetName);
        if (result.values.length > 0) {
          return { deptName, ...result, sheetName };
        }
      } catch {
        // Fallback: try 'Все' if dept-specific sheet failed, or vice versa
        const fallback = sheetName === 'Все' ? deptName : 'Все';
        try {
          const result = await getSheetDataWithFormulas(ssId, fallback);
          if (result.values.length > 0) {
            return { deptName, ...result, sheetName: fallback };
          }
        } catch {
          // Both failed
        }
      }
      throw new Error(`No readable sheet found in spreadsheet for ${deptName}`);
    }),
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      const { deptName, values, formulas, sheetName } = result.value;
      data[deptName] = { values, formulas, sheetName };
    } else {
      const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
      const match = msg.match(/for (.+)$/);
      if (match) errors[match[1]] = msg;
    }
  }

  return { data, errors };
}

/**
 * Fetch ШДЮ (monthly dynamics) sheet from СВОД_для_Google spreadsheet.
 * BUG-2 FIX: Now reads both values AND formulas.
 */
export async function fetchSHDYUSheet(
  spreadsheetId: string,
): Promise<{ values: unknown[][]; formulas: unknown[][] }> {
  try {
    return await getSheetDataWithFormulas(spreadsheetId, 'ШДЮ');
  } catch (error) {
    console.warn('Не удалось прочитать лист ШДЮ:', error);
    return { values: [], formulas: [] };
  }
}

// ────────────────────────────────────────────────────────────
// Write Support
// ────────────────────────────────────────────────────────────

let writeApi: sheets_v4.Sheets | null = null;

/**
 * Get a write-capable Sheets API client.
 * Uses full 'spreadsheets' scope instead of 'spreadsheets.readonly'.
 * Only works with service account credentials.
 */
async function getWriteApi(): Promise<sheets_v4.Sheets> {
  if (writeApi) return writeApi;

  if (config.google.serviceAccountEmail && config.google.privateKey) {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: config.google.serviceAccountEmail,
        private_key: config.google.privateKey,
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    writeApi = google.sheets({ version: 'v4', auth });
  } else {
    throw new Error('Запись в Google Sheets требует авторизации через Service Account');
  }

  return writeApi;
}

/**
 * Write a single cell value to a Google Spreadsheet.
 * @param spreadsheetId — target spreadsheet
 * @param sheetName — sheet/tab name
 * @param cell — cell address like "G5"
 * @param value — value to write
 */
export async function writeCellValue(
  spreadsheetId: string,
  sheetName: string,
  cell: string,
  value: unknown,
): Promise<{ updatedRange: string; updatedCells: number }> {
  const api = await getWriteApi();
  const range = `'${sheetName}'!${cell}`;
  const response = await api.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[value]],
    },
  });
  return {
    updatedRange: response.data.updatedRange ?? range,
    updatedCells: response.data.updatedCells ?? 0,
  };
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

/** Converts a 0-based column index to A, B, ... Z, AA, AB, etc. */
function columnToLetter(col: number): string {
  let letter = '';
  let c = col;
  while (c >= 0) {
    letter = String.fromCharCode((c % 26) + 65) + letter;
    c = Math.floor(c / 26) - 1;
  }
  return letter;
}
