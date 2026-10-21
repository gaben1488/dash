import directory from '../../report-engine/src/procurement_engine/department_directory.json';
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
  /** Действующее краткое имя; ключ истории id остаётся стабильным. */
  shortName: string;

  /** Точные исторические адреса книги мониторинга; это не подписи UI. */
  monitoring: { order: number; sheet: string; svodName: string };
  grbs: { id: Exclude<DepartmentId, 'УАГЗО'> | 'УАГиЗО'; order: number; sheetName: string; subordinateCount: number; isAuthorizedBody?: true };
  approvedPrimaryRename?: boolean;
  source: { sourceId: string; providerId: string; sheetId: number; sheet: string;
    role: 'master'; profile: 'master-v1'; access: 'read' };

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

export const DEPARTMENT_REGISTRY: readonly DepartmentEntry[] = directory.departments as DepartmentEntry[];

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

/** Исторические написания; действующие имена и ключи добавляются из реестра. */
const HISTORICAL_DEPARTMENT_ALIASES: Readonly<Record<string, DepartmentId>> = directory.aliases as Record<string, DepartmentId>;

/** Один индекс для всех потребителей. Коллизия справочника — явный отказ, не выбор первой записи. */
function departmentAliasKey(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleUpperCase('ru-RU').replace(/Ё/g, 'Е');
}
const departmentAliases: Record<string, DepartmentId> = Object.create(null);
const departmentAliasIndex = new Map<string, DepartmentId>();
for (const [raw, id] of [
  ...Object.entries(HISTORICAL_DEPARTMENT_ALIASES),
  ...DEPARTMENT_REGISTRY.flatMap(d =>
    [d.id, d.latinId, d.shortName, d.fullName].map(key => [key, d.id])),
]) {
  const key = raw.trim().replace(/\s+/g, ' ');
  const normalizedKey = departmentAliasKey(key);
  const previous = departmentAliasIndex.get(normalizedKey);
  if (previous !== undefined && previous !== id) {
    throw new Error(`Department alias conflict: ${key} (${previous}, ${id})`);
  }
  departmentAliases[key] = id as DepartmentId;
  departmentAliasIndex.set(normalizedKey, id as DepartmentId);
}
export const DEPARTMENT_ALIASES: Readonly<Record<string, DepartmentId>> = Object.freeze(departmentAliases);

/** Get department by either ID format (flexible lookup) */
export function findDept(idOrLatin: string): DepartmentEntry | undefined {
  const id = departmentAliasIndex.get(departmentAliasKey(idOrLatin));
  return id === undefined ? undefined : _byId.get(id);
}

/** All 8 cyrillic IDs */
export const ALL_DEPT_IDS: readonly DepartmentId[] = DEPARTMENT_REGISTRY.map(d => d.id);

/** All 8 latin IDs */
export const ALL_LATIN_IDS: readonly LatinDeptId[] = DEPARTMENT_REGISTRY.map(d => d.latinId);

// Дубликаты SVOD_SUMMARY_ROWS и SHDYU_SUMMARY_BLOCK удалены 14.08.2026:
// читателей не было, живой канон — SUMMARY_ROWS (report-map.ts) и
// SHDYU_ALL_BLOCK/SHDYU_BLOCKS (shdyu-map.ts). Копии без стража-теста
// разъехались бы при следующей смене вёрстки книг.

/** Порядок источника мониторинга; имена берутся только из записей управлений. */
export const MONITORING_DEPARTMENTS = [...DEPARTMENT_REGISTRY]
  .sort((a, b) => a.monitoring.order - b.monitoring.order);
