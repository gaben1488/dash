/**
 * Чтение сырых строк отдела для /api/rows/* (E11-2).
 * Извлечено move-only из routes/rows.ts (каскад чтения, ~стр. 91–123 и дубли
 * в /rows/:deptId/:rowIndex, /rows/subordinates, /rows/subjects, /rows/scatter).
 *
 * Каскад cache-first:
 * 1. Кэш отдела (deptSheetCache, наполняется fetchDepartmentSpreadsheets на старте)
 * 2. Лист сводной книги СВОД (legacy fallback, getSheetData)
 * 3. Собственная книга управления (последний рубеж, живой API-вызов readDeptSheet)
 *
 * Ошибки не логируются и не превращаются в HTTP-ответ здесь — роут сам решает
 * (503 для основных роутов, skip-отдела для сводных), поэтому наружу отдаётся
 * дискриминированный результат.
 */
import { getSheetData, readDeptSheet } from './google-sheets.js';
import { getDeptSheetValues } from './snapshot.js';
import { DEPARTMENT_SPREADSHEETS } from '../config.js';

export type DeptRowsResult =
  | { ok: true; values: unknown[][] }
  /** Живое чтение книги управления упало (сеть/квоты) — err для лога роута. */
  | { ok: false; reason: 'read-error'; error: unknown }
  /** Кэша нет, СВОД пуст и spreadsheetId для отдела не сконфигурирован. */
  | { ok: false; reason: 'no-source' };

/** Отделу достаточно nameShort (ключ кэша/реестра книг) и sheetName (лист СВОД). */
export async function readDeptRows(dept: { nameShort: string; sheetName: string }): Promise<DeptRowsResult> {
  const cached = getDeptSheetValues()[dept.nameShort];
  if (cached && cached.length > 0) {
    return { ok: true, values: cached };
  }

  let rawRows: unknown[][];
  let loaded = false;
  try {
    rawRows = await getSheetData(dept.sheetName);
    loaded = rawRows.length > 0;
  } catch {
    rawRows = [];
  }
  if (loaded) return { ok: true, values: rawRows };

  const ssId = DEPARTMENT_SPREADSHEETS[dept.nameShort];
  if (!ssId) return { ok: false, reason: 'no-source' };
  try {
    // Канон: readDeptSheet (кандидаты «ВСЕ»/«Все»/имя + честные 429/403), не наивные 2 кандидата.
    return { ok: true, values: (await readDeptSheet(dept.nameShort, ssId)).values };
  } catch (err) {
    return { ok: false, reason: 'read-error', error: err };
  }
}
