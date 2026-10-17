/**
 * Чтение сырых строк отдела для /api/rows/* (E11-2, rethink 2026-07-22).
 * Используется GET /api/rows/:deptId, /rows/:deptId/:rowIndex, /rows/subordinates,
 * /rows/subjects, /rows/scatter.
 *
 * Cache-first — две ступени, каждая с ранним выходом:
 *   1. Кэш отдела (deptSheetCache, наполняется fetchDepartmentSpreadsheets на старте)
 *   2. Собственная книга управления (живой API-вызов readDeptSheet)
 * Зеркало СВОДа не доказывает свежесть и не подменяет недоступный master.
 *
 * Ошибки не логируются и не превращаются в HTTP-ответ здесь — роут сам решает
 * (503 для основных роутов, skip-отдела для сводных), поэтому наружу отдаётся
 * дискриминированный результат с честной причиной отказа.
 */
import { readDeptSheet } from './google-sheets.js';
import { getDeptSheetValues } from './snapshot.js';
import { DEPARTMENT_SPREADSHEETS } from '../config.js';

export type DeptRowsResult =
  | { ok: true; values: unknown[][] }
  /** Живое чтение книги управления упало (сеть/квоты) — err для лога роута. */
  | { ok: false; reason: 'read-error'; error: unknown }
  /** Кэша нет и spreadsheetId основной книги не сконфигурирован. */
  | { ok: false; reason: 'no-source' };

/** sheetName сохраняется в контракте отдела; адрес master берётся по nameShort. */
export async function readDeptRows(dept: { nameShort: string; sheetName: string }): Promise<DeptRowsResult> {
  // Ступень 1 — кэш отдела.
  const cached = getDeptSheetValues()[dept.nameShort];
  if (cached && cached.length > 0) return { ok: true, values: cached };

  // Ступень 2 — собственная книга управления (живое чтение).
  const spreadsheetId = DEPARTMENT_SPREADSHEETS[dept.nameShort];
  if (!spreadsheetId) return { ok: false, reason: 'no-source' };
  try {
    // Канон: readDeptSheet (кандидаты «ВСЕ»/«Все»/имя + честные 429/403), не наивные 2 кандидата.
    return { ok: true, values: (await readDeptSheet(dept.nameShort, spreadsheetId)).values };
  } catch (err) {
    return { ok: false, reason: 'read-error', error: err };
  }
}
