/**
 * sheet-classifier.ts — SSOT для распознавания листов источника.
 *
 * CANONICAL: единственное место, где строковое имя листа превращается в смысл
 * (свод / месячный-свод-ШДЮ / лист управления / агрегат подведов / неизвестно).
 * Все консьюмеры (validate / reconcile / orchestrator / ingest / snapshot) обязаны
 * идти через classifySheet() — НИКАКИХ литералов 'СВОД ТД-ПМ' / 'СВОД с месяцами'
 * вне этого файла (Occam: одно имя — один распознаватель).
 *
 * Корень багов ШДЮ/УКСиМП/УАГЗО: scope валидации решался строковым
 * `name === 'СВОД ТД-ПМ'`, из-за чего лист ШДЮ «СВОД с месяцами» (иная раскладка)
 * прогонялся department-правилами и валидация ложно падала.
 */

import { findDept, type LatinDeptId } from './department-registry.js';
import { SVOD_SHEET_NAME } from './constants.js';
import { SHDYU_SHEET_NAME_CANDIDATES } from './shdyu-map.js';
import type { DepartmentId } from './types.js';

// Имена месячного свода (ШДЮ) — КАНОН в shdyu-map.ts: SHDYU_SHEET_NAME_CANDIDATES
// = ['СВОД с месяцами', 'ШДЮ', 'ШДЮ старый']. Здесь не дублируем (Occam/SSOT).

/** Лист-агрегат подведомственных в книгах управлений. */
export const SUBORDINATES_AGG_SHEET = 'ВСЕ';

export type SheetKind =
  | 'svod'              // СВОД ТД-ПМ — годовой свод
  | 'shdyu_monthly'     // СВОД с месяцами / ШДЮ — месячная динамика (иная раскладка)
  | 'department'        // лист конкретного ГРБС (резолвится в grbsId)
  | 'subordinates_agg'  // лист «ВСЕ» в книге управления (ГРБС из имени не выводится)
  | 'unknown';

export interface SheetClassification {
  kind: SheetKind;
  /** Канонический кириллический ГРБС-id, когда выводим из имени листа. */
  grbsId?: DepartmentId;
  /** Латинский id (legacy: metricKey, grbsId, URL). */
  latinId?: LatinDeptId;
}

/**
 * Распознать лист по имени. Единственный источник истины о смысле имени листа.
 */
export function classifySheet(rawName: string): SheetClassification {
  const name = (rawName ?? '').trim();
  if (!name) return { kind: 'unknown' };
  if (name === SVOD_SHEET_NAME) return { kind: 'svod' };
  if ((SHDYU_SHEET_NAME_CANDIDATES as readonly string[]).includes(name)) return { kind: 'shdyu_monthly' };
  if (name.toLocaleUpperCase('ru-RU') === SUBORDINATES_AGG_SHEET) return { kind: 'subordinates_agg' };
  const dept = findDept(name); // принимает кириллический short ('УЭР') и латинский ('uer')
  if (dept) return { kind: 'department', grbsId: dept.id, latinId: dept.latinId };
  return { kind: 'unknown' };
}

/**
 * Свод-семейство (своя раскладка свода): СВОД ТД-ПМ или месячный ШДЮ.
 * НЕ листы управлений. Используется там, где раньше стоял `name === 'СВОД ТД-ПМ'`.
 */
export function isSvodFamily(name: string): boolean {
  const k = classifySheet(name).kind;
  return k === 'svod' || k === 'shdyu_monthly';
}

/** Лист данных управления (включая агрегат «ВСЕ»), на который идут department-правила. */
export function isDepartmentSheet(name: string): boolean {
  const k = classifySheet(name).kind;
  return k === 'department' || k === 'subordinates_agg';
}
