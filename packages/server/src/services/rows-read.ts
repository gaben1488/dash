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
import { getDeptLoadMeta, getDeptSheetValues } from './snapshot.js';
import { DEPARTMENT_SPREADSHEETS } from '../config.js';
import { DEPT_HEADER_ROWS } from '@aemr/shared';
import { hasVerifiedPrimaryRows } from './cached-primary-source.js';

export type DeptRowsResult =
  | { ok: true; values: unknown[][] }
  /** Живое чтение книги управления упало (сеть/квоты) — err для лога роута. */
  | { ok: false; reason: 'read-error'; error: unknown }
  /** Кэша нет и spreadsheetId основной книги не сконфигурирован. */
  | { ok: false; reason: 'no-source' };

/** sheetName сохраняется в контракте отдела; адрес master берётся по nameShort. */
export async function readDeptRows(dept: { nameShort: string; sheetName: string }): Promise<DeptRowsResult> {
  // Ступень 1 — только кэш с доказанным успешным чтением этой книги.
  // Старые строки могут сохраниться после частичного отказа refresh; глобальное
  // filledAt не подтверждает загрузку конкретной книги (см. dept-rows.ts).
  const cached = getDeptSheetValues()[dept.nameShort];
  const meta = getDeptLoadMeta()[dept.nameShort];
  if (hasVerifiedPrimaryRows(cached, meta)) {
    return { ok: true, values: cached };
  }

  // Ступень 2 — собственная книга управления (живое чтение).
  const spreadsheetId = DEPARTMENT_SPREADSHEETS[dept.nameShort];
  if (!spreadsheetId) return { ok: false, reason: 'no-source' };
  try {
    // Канон: readDeptSheet (кандидаты «ВСЕ»/«Все»/имя + честные 429/403), не наивные 2 кандидата.
    const { values } = await readDeptSheet(dept.nameShort, spreadsheetId);
    if (values.length < DEPT_HEADER_ROWS) throw new Error('MASTER_READ_INCOMPLETE');
    return { ok: true, values };
  } catch (err) {
    return { ok: false, reason: 'read-error', error: err };
  }
}
