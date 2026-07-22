/**
 * Чтение сырых строк отдела для /api/rows/* (E11-2, rethink 2026-07-22).
 * Используется GET /api/rows/:deptId, /rows/:deptId/:rowIndex, /rows/subordinates,
 * /rows/subjects, /rows/scatter.
 *
 * Каскад cache-first — три именованные ступени, каждая с ранним выходом:
 *   1. Кэш отдела (deptSheetCache, наполняется fetchDepartmentSpreadsheets на старте)
 *   2. Зеркальный лист сводной книги СВОД (DEPRECATED, D1 — legacy-фолбэк)
 *   3. Собственная книга управления (последний рубеж, живой API-вызов readDeptSheet)
 *
 * Ошибки не логируются и не превращаются в HTTP-ответ здесь — роут сам решает
 * (503 для основных роутов, skip-отдела для сводных), поэтому наружу отдаётся
 * дискриминированный результат с честной причиной отказа.
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
  // Ступень 1 — кэш отдела.
  const cached = getDeptSheetValues()[dept.nameShort];
  if (cached && cached.length > 0) return { ok: true, values: cached };

  // Ступень 2 — зеркальный лист СВОД (DEPRECATED, D1). Пустой лист или ошибка
  // чтения — не приговор: молча падаем на ступень 3.
  try {
    const mirror = await getSheetData(dept.sheetName);
    if (mirror.length > 0) return { ok: true, values: mirror };
  } catch {
    // зеркало недоступно — пробуем собственную книгу управления
  }

  // Ступень 3 — собственная книга управления (живое чтение).
  const spreadsheetId = DEPARTMENT_SPREADSHEETS[dept.nameShort];
  if (!spreadsheetId) return { ok: false, reason: 'no-source' };
  try {
    // Канон: readDeptSheet (кандидаты «ВСЕ»/«Все»/имя + честные 429/403), не наивные 2 кандидата.
    return { ok: true, values: (await readDeptSheet(dept.nameShort, spreadsheetId)).values };
  } catch (err) {
    return { ok: false, reason: 'read-error', error: err };
  }
}
