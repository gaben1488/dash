/**
 * department-registry.ts — Единый реестр управлений (ГРБС).
 *
 * CANONICAL SOURCE OF TRUTH для:
 * - Идентификаторы (short/long/latinId)
 * - Имена (полные/краткие)
 * - Привязки к листам (sheetName, preferredSheet)
 * - Привязки к строкам СВОД ТД-ПМ (поле svod; строки блока «ВСЕ» — SUMMARY_ROWS
 *   в report-map.ts)
 *
 * Привязки к блокам ШДЮ здесь НЕ живут — их канон shdyu-map.ts
 * (SHDYU_ALL_BLOCK/SHDYU_BLOCKS). Дубликат-копия shdyu удалена 14.08.2026:
 * читателей не было, а вторая копия без стража-теста разъехалась бы молча.
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

// LATIN_TO_CYRILLIC и CYRILLIC_TO_LATIN — производные от DEPARTMENT_REGISTRY
// (single source of truth). Объявлены ПОСЛЕ реестра (см. §3.1), чтобы биекция
// не дублировала id/latinId записей и не могла с ними разойтись.

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
  /** Есть подведомственные (лист "ВСЕ" агрегирует) */
  hasSubordinates: boolean;

  // ── СВОД ТД-ПМ row positions (1-based) ──
  svod: {
    /** КП 1 кв data row */
    kpQ1: number;
    /** КП Year total row */
    kpYear: number;
    /** ЕП 1 кв data row */
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
}

// ────────────────────────────────────────────────────────────
// 3. The Registry (single source of truth)
// ───────────────────────────────────��────────────────────────

export const DEPARTMENT_REGISTRY: readonly DepartmentEntry[] = [
  {
    id: 'УЭР', latinId: 'uer',
    fullName: 'Управление экономического развития',
    shortName: 'УЭР',
    // «ВСЕ» = управление + подвед МКУ «ЦЭР» — тот же периметр, что официальный
    // СВОД (IMPORTRANGE книги УЭР тянет именно «ВСЕ»). Вкладка «УЭР» (только
    // управление) остаётся fallback-кандидатом. Следствие 2026-07-23.
    sheetName: 'ВСЕ', hasSubordinates: true,
    svod: { kpQ1: 42, kpYear: 47, epQ1: 53, epYear: 58, totalCombined: 60, totalCurrent: 61, compShareRow: 63, epShareRow: 64 },
  },
  {
    id: 'УИО', latinId: 'uio',
    fullName: 'Управление имущественных отношений',
    shortName: 'УИО',
    sheetName: 'УИО', hasSubordinates: false,
    svod: { kpQ1: 72, kpYear: 77, epQ1: 83, epYear: 88, totalCombined: 90, totalCurrent: 91, compShareRow: 93, epShareRow: 94 },
  },
  {
    id: 'УАГЗО', latinId: 'uagzo',
    fullName: 'Управление архитектуры, градостроительства и земельных отношений',
    shortName: 'УАГЗО',
    sheetName: 'ВСЕ', hasSubordinates: true,
    svod: { kpQ1: 102, kpYear: 107, epQ1: 113, epYear: 118, totalCombined: 120, totalCurrent: 121, compShareRow: 123, epShareRow: 124 },
  },
  {
    id: 'УФБП', latinId: 'ufbp',
    fullName: 'Управление финансово-бюджетной политики',
    shortName: 'УФБП',
    sheetName: 'УФБП', hasSubordinates: false,
    svod: { kpQ1: 132, kpYear: 137, epQ1: 143, epYear: 148, totalCombined: 150, totalCurrent: 151, compShareRow: 153, epShareRow: 154 },
  },
  {
    id: 'УД', latinId: 'ud',
    fullName: 'Управление делами',
    shortName: 'УД',
    sheetName: 'ВСЕ', hasSubordinates: true,
    svod: { kpQ1: 163, kpYear: 168, epQ1: 175, epYear: 180, totalCombined: 182, totalCurrent: 183, compShareRow: 185, epShareRow: 186 },
  },
  {
    id: 'УДТХ', latinId: 'udtx',
    fullName: 'Управление дорожно-транспортного хозяйства',
    shortName: 'УДТХ',
    sheetName: 'УДТХ', hasSubordinates: false,
    svod: { kpQ1: 195, kpYear: 200, epQ1: 206, epYear: 211, totalCombined: 213, totalCurrent: 214, compShareRow: 216, epShareRow: 217 },
  },
  {
    id: 'УКСиМП', latinId: 'uksimp',
    fullName: 'Управление культуры, спорта и молодёжной политики',
    shortName: 'УКСиМП',
    sheetName: 'ВСЕ', hasSubordinates: true,
    svod: { kpQ1: 225, kpYear: 230, epQ1: 236, epYear: 241, totalCombined: 243, totalCurrent: 244, compShareRow: 246, epShareRow: 247 },
  },
  {
    id: 'УО', latinId: 'uo',
    fullName: 'Управление образования',
    shortName: 'УО',
    sheetName: 'ВСЕ', hasSubordinates: true,
    svod: { kpQ1: 255, kpYear: 260, epQ1: 266, epYear: 271, totalCombined: 273, totalCurrent: 274, compShareRow: 276, epShareRow: 277 },
  },
] as const;

// ─────────────────────────────────��──────────────────────────
// 4. Lookup helpers
// ────────────────────────────────────────────────────────────

// ── 3.1. Производные биекции Latin ↔ Cyrillic (из реестра — single source) ──

/** Биекция Latin → Cyrillic (DepartmentId), производная от DEPARTMENT_REGISTRY. */
export const LATIN_TO_CYRILLIC: Record<LatinDeptId, DepartmentId> = Object.fromEntries(
  DEPARTMENT_REGISTRY.map((d) => [d.latinId, d.id]),
) as Record<LatinDeptId, DepartmentId>;

/** Биекция Cyrillic (DepartmentId) → Latin, производная от DEPARTMENT_REGISTRY. */
export const CYRILLIC_TO_LATIN: Record<DepartmentId, LatinDeptId> = Object.fromEntries(
  DEPARTMENT_REGISTRY.map((d) => [d.id, d.latinId]),
) as Record<DepartmentId, LatinDeptId>;

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

// Дубликаты SVOD_SUMMARY_ROWS и SHDYU_SUMMARY_BLOCK удалены 14.08.2026:
// читателей не было, живой канон — SUMMARY_ROWS (report-map.ts) и
// SHDYU_ALL_BLOCK/SHDYU_BLOCKS (shdyu-map.ts). Копии без стража-теста
// разъехались бы при следующей смене вёрстки книг.
