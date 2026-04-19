/**
 * department-registry.ts — Единый реестр управлений (ГРБС).
 *
 * CANONICAL SOURCE OF TRUTH для:
 * - Идентификаторы (short/long/latinId)
 * - Имена (полные/краткие)
 * - Привязки к листам (sheetName, preferredSheet)
 * - Привязки к строкам СВОД ТД-ПМ (DepartmentRowConfig)
 * - Привязки к блокам ШДЮ (SHDYUBlock)
 *
 * Occam's razor: ВСЕ данные об управлениях — в одном месте.
 * Нет дублей между report-map.ts, shdyu-map.ts, constants.ts, config.ts.
 */

import type { DepartmentId } from './types.js';

// ────────────────────────────────────────────────────────────
// 1. Latin ↔ Cyrillic mapping
// ────────────────────────────────────────────────────────────

/**
 * Латинский идентификатор (legacy, используется в metricKey, grbsId, URL routes).
 * Маппится 1:1 на DepartmentId (кириллический short name).
 */
export type LatinDeptId = 'uer' | 'uio' | 'uagzo' | 'ufbp' | 'ud' | 'udtx' | 'uksimp' | 'uo';

/** Биекция: Latin → Cyrillic (DepartmentId) */
export const LATIN_TO_CYRILLIC: Record<LatinDeptId, DepartmentId> = {
  uer: 'УЭР',
  uio: 'УИО',
  uagzo: 'УАГЗО',
  ufbp: 'УФБП',
  ud: 'УД',
  udtx: 'УДТХ',
  uksimp: 'УКСиМП',
  uo: 'УО',
} as const;

/** Биекция: Cyrillic → Latin */
export const CYRILLIC_TO_LATIN: Record<DepartmentId, LatinDeptId> = {
  'УЭР': 'uer',
  'УИО': 'uio',
  'УАГЗО': 'uagzo',
  'УФБП': 'ufbp',
  'УД': 'ud',
  'УДТХ': 'udtx',
  'УКСиМП': 'uksimp',
  'УО': 'uo',
} as const;

// ────────────────────────────────────────────────────────────
// 2. Unified department entry
// ─────────────────────────────────────────────────────���──────

export interface DepartmentEntry {
  /** Кириллический short ID (primary key, как в types.ts DepartmentId) */
  id: DepartmentId;
  /** Латинский ID (для URL, metricKey, code identifiers) */
  latinId: LatinDeptId;
  /** Полное наименование */
  fullName: string;
  /** Краткое наименование (= id) */
  shortName: DepartmentId;

  // ── Sheet resolution ──
  /** Имя вкладки в рабочей книге управления */
  sheetName: string;
  /** Есть подведомственные (лист "Все" агрегирует) */
  hasSubordinates: boolean;

  // ── СВОД ТД-ПМ row positions (1-based) ──
  svod: {
    /** КП Q1 data row */
    kpQ1: number;
    /** КП Year total row */
    kpYear: number;
    /** ЕП Q1 data row */
    epQ1: number;
    /** ЕП Year total row */
    epYear: number;
    /** ИТОГО 2025+2026 row */
    totalCombined: number;
    /** ИТОГО 2026 row */
    totalCurrent: number;
    /** Доля ЭА row */
    compShareRow: number;
    /** Доля ЕП row */
    epShareRow: number;
  };

  // ── ШДЮ block positions (1-based) ──
  shdyu: {
    /** КП data rows (12 months) */
    compStartRow: number;
    compEndRow: number;
    compTotalRow: number;
    /** ЕП data rows (12 months) */
    epStartRow: number;
    epEndRow: number;
    epTotalRow: number;
    /** Summary rows */
    totalRow: number;
    compShareRow: number;
    epShareRow: number;
  };
}

// ────────────────────────────────────────────────────────────
// 3. The Registry (single source of truth)
// ───────────────────────────────────��────────────────────────

export const DEPARTMENT_REGISTRY: readonly DepartmentEntry[] = [
  {
    id: 'УЭР', latinId: 'uer',
    fullName: 'Управление экономического развития',
    shortName: 'УЭР',
    sheetName: 'УЭР', hasSubordinates: false,
    svod: { kpQ1: 42, kpYear: 47, epQ1: 53, epYear: 58, totalCombined: 60, totalCurrent: 61, compShareRow: 63, epShareRow: 64 },
    shdyu: { compStartRow: 45, compEndRow: 56, compTotalRow: 57, epStartRow: 62, epEndRow: 73, epTotalRow: 74, totalRow: 76, compShareRow: 77, epShareRow: 78 },
  },
  {
    id: 'УИО', latinId: 'uio',
    fullName: 'Управление имущественных отношений',
    shortName: 'УИО',
    sheetName: 'УИО', hasSubordinates: false,
    svod: { kpQ1: 72, kpYear: 77, epQ1: 83, epYear: 88, totalCombined: 90, totalCurrent: 91, compShareRow: 93, epShareRow: 94 },
    shdyu: { compStartRow: 85, compEndRow: 96, compTotalRow: 97, epStartRow: 102, epEndRow: 113, epTotalRow: 114, totalRow: 116, compShareRow: 117, epShareRow: 118 },
  },
  {
    id: 'УАГЗО', latinId: 'uagzo',
    fullName: 'Управление архитектуры, градостроительства и земельных отношений',
    shortName: 'УАГЗО',
    sheetName: 'УАГЗО', hasSubordinates: false,
    svod: { kpQ1: 102, kpYear: 107, epQ1: 113, epYear: 118, totalCombined: 120, totalCurrent: 121, compShareRow: 123, epShareRow: 124 },
    shdyu: { compStartRow: 125, compEndRow: 136, compTotalRow: 137, epStartRow: 142, epEndRow: 153, epTotalRow: 154, totalRow: 156, compShareRow: 157, epShareRow: 158 },
  },
  {
    id: 'УФБП', latinId: 'ufbp',
    fullName: 'Управление финансово-бюджетной политики',
    shortName: 'УФБП',
    sheetName: 'УФБП', hasSubordinates: false,
    svod: { kpQ1: 132, kpYear: 137, epQ1: 143, epYear: 148, totalCombined: 150, totalCurrent: 151, compShareRow: 153, epShareRow: 154 },
    shdyu: { compStartRow: 165, compEndRow: 176, compTotalRow: 177, epStartRow: 182, epEndRow: 193, epTotalRow: 194, totalRow: 196, compShareRow: 197, epShareRow: 198 },
  },
  {
    id: 'УД', latinId: 'ud',
    fullName: 'Управление делами',
    shortName: 'УД',
    sheetName: 'Все', hasSubordinates: true,
    svod: { kpQ1: 163, kpYear: 168, epQ1: 175, epYear: 180, totalCombined: 182, totalCurrent: 183, compShareRow: 185, epShareRow: 186 },
    shdyu: { compStartRow: 205, compEndRow: 216, compTotalRow: 217, epStartRow: 222, epEndRow: 233, epTotalRow: 234, totalRow: 236, compShareRow: 237, epShareRow: 238 },
  },
  {
    id: 'УДТХ', latinId: 'udtx',
    fullName: 'Управление дорожно-транспортного хозяйства',
    shortName: 'УДТХ',
    sheetName: 'УДТХ', hasSubordinates: false,
    svod: { kpQ1: 195, kpYear: 200, epQ1: 206, epYear: 211, totalCombined: 213, totalCurrent: 214, compShareRow: 216, epShareRow: 217 },
    shdyu: { compStartRow: 245, compEndRow: 256, compTotalRow: 257, epStartRow: 262, epEndRow: 273, epTotalRow: 274, totalRow: 276, compShareRow: 277, epShareRow: 278 },
  },
  {
    id: 'УКСиМП', latinId: 'uksimp',
    fullName: 'Управление капитального строительства и молодёжной политики',
    shortName: 'УКСиМП',
    sheetName: 'Все', hasSubordinates: true,
    svod: { kpQ1: 225, kpYear: 230, epQ1: 236, epYear: 241, totalCombined: 243, totalCurrent: 244, compShareRow: 246, epShareRow: 247 },
    shdyu: { compStartRow: 285, compEndRow: 296, compTotalRow: 297, epStartRow: 302, epEndRow: 313, epTotalRow: 314, totalRow: 316, compShareRow: 317, epShareRow: 318 },
  },
  {
    id: 'УО', latinId: 'uo',
    fullName: 'Управление образования',
    shortName: 'УО',
    sheetName: 'Все', hasSubordinates: true,
    svod: { kpQ1: 255, kpYear: 260, epQ1: 266, epYear: 271, totalCombined: 273, totalCurrent: 274, compShareRow: 276, epShareRow: 277 },
    shdyu: { compStartRow: 325, compEndRow: 336, compTotalRow: 337, epStartRow: 342, epEndRow: 353, epTotalRow: 354, totalRow: 356, compShareRow: 357, epShareRow: 358 },
  },
] as const;

// ─────────────────────────────────��──────────────────────────
// 4. Lookup helpers
// ────────────────────────────────────────────────────────────

/** Map by cyrillic ID (primary) */
const _byId = new Map<DepartmentId, DepartmentEntry>(
  DEPARTMENT_REGISTRY.map(d => [d.id, d]),
);

/** Map by latin ID (legacy) */
const _byLatinId = new Map<LatinDeptId, DepartmentEntry>(
  DEPARTMENT_REGISTRY.map(d => [d.latinId, d]),
);

/** Get department by cyrillic ID */
export function getDept(id: DepartmentId): DepartmentEntry {
  const d = _byId.get(id);
  if (!d) throw new Error(`Unknown department: ${id}`);
  return d;
}

/** Get department by latin ID */
export function getDeptByLatin(latinId: LatinDeptId): DepartmentEntry {
  const d = _byLatinId.get(latinId);
  if (!d) throw new Error(`Unknown department latin ID: ${latinId}`);
  return d;
}

/** Get department by either ID format (flexible lookup) */
export function findDept(idOrLatin: string): DepartmentEntry | undefined {
  return _byId.get(idOrLatin as DepartmentId) ?? _byLatinId.get(idOrLatin as LatinDeptId);
}

/** All 8 cyrillic IDs */
export const ALL_DEPT_IDS: readonly DepartmentId[] = DEPARTMENT_REGISTRY.map(d => d.id);

/** All 8 latin IDs */
export const ALL_LATIN_IDS: readonly LatinDeptId[] = DEPARTMENT_REGISTRY.map(d => d.latinId);

// ────────────────────────────────────────────────────────────
// 5. СВОД ТД-ПМ Summary block positions
// ────────────────────────────────────────���───────────────────

/** Row positions for the "ВСЕ" (summary) block in СВОД ТД-ПМ */
export const SVOD_SUMMARY_ROWS = {
  kpQ1: 9,
  kpYear: 14,
  epQ1: 21,
  epYear: 26,
  totalCombined: 28,
  totalCurrent: 29,
  compShareRow: 31,
  epShareRow: 32,
} as const;

// ────────────────────────────────────────────────────────────
// 6. ШДЮ Summary (ВСЕ) block
// ────────────────────────────────────────────────────────────

/** ШДЮ "ВСЕ" block — aggregates all departments */
export const SHDYU_SUMMARY_BLOCK = {
  compStartRow: 5, compEndRow: 16, compTotalRow: 17,
  epStartRow: 22, epEndRow: 33, epTotalRow: 34,
  totalRow: 36, compShareRow: 37, epShareRow: 38,
} as const;
