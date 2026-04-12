import { google, type sheets_v4 } from 'googleapis';
import { config } from './config.js';

let sheetsApi: sheets_v4.Sheets | null = null;

/**
 * Инициализирует Google Sheets API клиент
 */
async function getSheetsApi(): Promise<sheets_v4.Sheets> {
  if (sheetsApi) return sheetsApi;

  if (config.google.serviceAccountEmail && config.google.privateKey) {
    // Service Account auth
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: config.google.serviceAccountEmail,
        private_key: config.google.privateKey,
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    sheetsApi = google.sheets({ version: 'v4', auth });
  } else if (config.google.apiKey) {
    // API Key auth (for public sheets)
    sheetsApi = google.sheets({ version: 'v4', auth: config.google.apiKey });
  } else {
    // Application Default Credentials
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    sheetsApi = google.sheets({ version: 'v4', auth });
  }

  return sheetsApi;
}

/**
 * Читает конкретные ячейки через batchGet.
 * Используем UNFORMATTED_VALUE для чисел и FORMATTED_STRING для дат.
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
 * Читает формулы для диагностики
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
 * Читает весь лист (для построчного пересчёта)
 */
export async function getSheetData(
  sheetName: string,
  spreadsheetId?: string,
): Promise<unknown[][]> {
  const api = await getSheetsApi();

  const response = await api.spreadsheets.values.get({
    spreadsheetId: spreadsheetId ?? config.google.spreadsheetId,
    range: `'${sheetName}'`,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
    majorDimension: 'ROWS',
  });

  return (response.data.values as unknown[][]) ?? [];
}

/**
 * Получает метаданные таблицы (список листов)
 */
export async function getSpreadsheetMetadata(spreadsheetId?: string): Promise<{
  title: string;
  sheets: Array<{ name: string; rowCount: number; colCount: number }>;
}> {
  const api = await getSheetsApi();

  const response = await api.spreadsheets.get({
    spreadsheetId: spreadsheetId ?? config.google.spreadsheetId,
    fields: 'properties.title,sheets.properties',
  });

  return {
    title: response.data.properties?.title ?? 'Unknown',
    sheets: (response.data.sheets ?? []).map(s => ({
      name: s.properties?.title ?? 'Unknown',
      rowCount: s.properties?.gridProperties?.rowCount ?? 0,
      colCount: s.properties?.gridProperties?.columnCount ?? 0,
    })),
  };
}
