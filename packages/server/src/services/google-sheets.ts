import { google, type sheets_v4 } from 'googleapis';
import { config } from '../config.js';
import {
  ALL_SHEETS,
  DEPARTMENT_REGISTRY,
  SHDYU_MONTHLY_SHEET_NAME,
} from '@aemr/shared';
import type { WorkbookSnapshot, SheetData, CellValue } from '@aemr/shared';
import { departmentSheetNameCandidates } from './sheet-name-candidates.js';
import { sheetValuesRange } from './sheet-range.js';

// ============================================================
// Google Sheets API Service — AEMR Platform
// ============================================================
//
// ВНИМАНИЕ: модулей google-sheets в server ДВА (исторически), не путать:
//   • services/google-sheets.ts (ЭТОТ) — getSheetData(sheetName) и
//     getSpreadsheetMetadata() читают ТОЛЬКО основную таблицу
//     config.google.spreadsheetId; параметр spreadsheetId здесь НЕ
//     принимается. Для произвольной таблицы — getSheetDataFromSpreadsheet()
//     или getSheetDataWithFormulas() ниже (оба берут spreadsheetId).
//   • src/google-sheets.ts (корневой) — getSheetData(sheetName, spreadsheetId?)
//     и getSpreadsheetMetadata(spreadsheetId?) honor явный spreadsheetId;
//     его импортируют routes/journal.ts и services/snapshot.ts.

let sheetsApi: sheets_v4.Sheets | null = null;

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

let cachedSnapshot: WorkbookSnapshot | null = null;
let cacheTimestamp = 0;

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

export function invalidateCache(): void {
  cachedSnapshot = null;
  cacheTimestamp = 0;
}

export async function fetchWorkbook(): Promise<WorkbookSnapshot> {
  const api = await getSheetsApi();
  const spreadsheetId = config.google.spreadsheetId;

  const sheetNames = ALL_SHEETS as readonly string[];
  const valueRanges = sheetNames.map((s) => sheetValuesRange(s));

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
        if (value === null && (formulaRaw === null || formulaRaw === undefined)) continue;
        if (value === '' && (formulaRaw === undefined || formulaRaw === '')) continue;

        const cellAddr = columnToLetter(c) + (r + 1);
        const cell: CellValue = { v: value };
        if (typeof formulaRaw === 'string' && formulaRaw.startsWith('=')) {
          cell.f = formulaRaw;
        }
        sheetData[cellAddr] = cell;
      }
    }

    sheets[sheetName] = sheetData;
  }

  return { sheets, loadedAt: new Date().toISOString(), spreadsheetId };
}

export async function getSheetData(sheetName: string): Promise<unknown[][]> {
  const api = await getSheetsApi();

  const response = await api.spreadsheets.values.get({
    spreadsheetId: config.google.spreadsheetId,
    range: sheetValuesRange(sheetName),
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
    majorDimension: 'ROWS',
  });

  return (response.data.values as unknown[][]) ?? [];
}

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

export async function getSheetDataFromSpreadsheet(
  spreadsheetId: string,
  sheetName: string,
): Promise<unknown[][]> {
  const api = await getSheetsApi();

  const response = await api.spreadsheets.values.get({
    spreadsheetId,
    range: sheetValuesRange(sheetName),
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
    majorDimension: 'ROWS',
  });

  return (response.data.values as unknown[][]) ?? [];
}

export async function getSheetDataWithFormulas(
  spreadsheetId: string,
  sheetName: string,
): Promise<{ values: unknown[][]; formulas: unknown[][] }> {
  const api = await getSheetsApi();
  const range = sheetValuesRange(sheetName);

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

export interface DeptSheetResult {
  values: unknown[][];
  formulas: unknown[][];
  sheetName: string;
}

export async function fetchDepartmentSpreadsheets(
  deptSpreadsheets: Record<string, string>,
): Promise<{ data: Record<string, DeptSheetResult>; errors: Record<string, string> }> {
  const data: Record<string, DeptSheetResult> = {};
  const errors: Record<string, string> = {};

  const DEPT_SHEET_NAME: Record<string, string> = Object.fromEntries(
    DEPARTMENT_REGISTRY.map(d => [d.shortName, d.sheetName]),
  );

  const entries = Object.entries(deptSpreadsheets);
  const results = await Promise.allSettled(
    entries.map(async ([deptName, ssId]) => {
      const sheetName = DEPT_SHEET_NAME[deptName] ?? deptName;
      const candidates = departmentSheetNameCandidates(sheetName, deptName);
      for (const candidate of candidates) {
        try {
          const result = await getSheetDataWithFormulas(ssId, candidate);
          if (result.values.length > 0) {
            return { deptName, ...result, sheetName: candidate };
          }
        } catch {
          // Try next candidate.
        }
      }
      throw new Error(`No readable sheet found in spreadsheet for ${deptName}; tried: ${candidates.join(', ')}`);
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

export async function fetchSHDYUSheet(
  spreadsheetId: string,
): Promise<{ values: unknown[][]; formulas: unknown[][]; sheetName: string }> {
  const result = await getSheetDataWithFormulas(spreadsheetId, SHDYU_MONTHLY_SHEET_NAME);
  return { ...result, sheetName: SHDYU_MONTHLY_SHEET_NAME };
}

let writeApi: sheets_v4.Sheets | null = null;

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

export async function writeCellValue(
  spreadsheetId: string,
  sheetName: string,
  cell: string,
  value: unknown,
): Promise<{ updatedRange: string; updatedCells: number }> {
  const api = await getWriteApi();
  const range = sheetValuesRange(sheetName, cell);
  const safeValue =
    typeof value === 'string' && /^[=+\-@]/.test(value) ? `'${value}` : value;
  const response = await api.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[safeValue]] },
  });

  return {
    updatedRange: response.data.updatedRange ?? range,
    updatedCells: response.data.updatedCells ?? 0,
  };
}

function columnToLetter(col: number): string {
  let result = '';
  let n = col;
  while (n >= 0) {
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
}
