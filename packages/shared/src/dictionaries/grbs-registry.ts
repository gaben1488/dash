/**
 * grbs-registry.ts — Канонический реестр ГРБС (Главных распорядителей бюджетных средств).
 *
 * Источник истины: AEMR_SOURCE_AUDIT.md §2, СВОД-25-26/ГРБС (75 строк).
 * Восемь канонических ГРБС Елизовского муниципального округа
 * Камчатского края (АЕМР КК).
 *
 * Назначение:
 *   - Нормализация написаний из разных источников (СВОД, dept-файлы, AE-колонка)
 *   - Справочник полных/кратких наименований для KB-tooltip и UI
 *   - Маппинг alias-строк к каноническому ID (включая опечатки и двойные пробелы)
 *   - Флаг hasSubordinates для разветвлённой иерархии подведов
 *
 * ВАЖНО: Алиасы и действующие названия определены в department-registry.ts.
 * department-registry.ts содержит row-positions СВОД/ШДЮ и остаётся отдельным.
 */

import type { DepartmentId } from '../types.js';
import { DEPARTMENT_ALIASES, DEPARTMENT_REGISTRY, findDept, getDept, type DepartmentEntry } from '../department-registry.js';

// ────────────────────────────────────────────────────────────
// 1. Канонические идентификаторы
// ────────────────────────────────────────────────────────────

/**
 * Восемь канонических ГРБС АЕМР.
 * Используются как первичный ключ во всей системе.
 * Форма — кириллический краткий аббревиатур из официальных документов.
 *
 * Особенность: «УАГиЗО» — каноническое написание из реестра СВОД-25-26/ГРБС.
 * В dept-таблицах фигурирует «УАГЗО» (без «и»); алиас-карта покрывает оба варианта.
 */
export const GRBS_CANONICAL: readonly GrbsId[] = DEPARTMENT_REGISTRY.slice()
  .sort((a, b) => a.grbs.order - b.grbs.order).map(d => d.grbs.id);

export type GrbsId = DepartmentEntry['grbs']['id'];

// ────────────────────────────────────────────────────────────
// 2. Полные наименования и метаданные
// ────────────────────────────────────────────────────────────

export interface GrbsEntry {
  /** Канонический кириллический ID (первичный ключ) */
  id: GrbsId;
  /** Полное официальное наименование */
  fullName: string;
  /** Краткое наименование (= id для большинства) */
  shortName: string;
  /**
   * Имя листа в СВОД_ДЛЯ_GOOGLE (для кросс-чека зеркал).
   * У УАГЗО — «УАГЗО» (без «и»), как в реальном файле.
   */
  svodSheetName: string;
  /**
   * Есть ли подведомственные учреждения (отдельные листы в dept-файле).
   * У УО — 43 учреждения (+3 категории), УКСиМП — 20 (+1 категория), УД/УЭР/УАГЗО — по 1.
   */
  hasSubordinates: boolean;
  /** Число подведомственных учреждений (из СВОД-25-26/ГРБС) */
  subordinateCount: number;
  /** URL dept-файла в Google Sheets (берётся из СВОД/Settings) */
  deptFileUrl?: string;
  /** Роль: «уполномоченный орган» — УФБП управляет флагами AD (колонка 29) */
  isAuthorizedBody?: true;
}

export const GRBS_REGISTRY: readonly GrbsEntry[] = DEPARTMENT_REGISTRY.slice().sort((a, b) => a.grbs.order - b.grbs.order).map(d => ({
  id: d.grbs.id, fullName: d.fullName, shortName: d.shortName,
  svodSheetName: d.grbs.sheetName, hasSubordinates: d.hasSubordinates,
  subordinateCount: d.grbs.subordinateCount,
  ...(d.grbs.isAuthorizedBody ? { isAuthorizedBody: true as const } : {}),
}));

// ────────────────────────────────────────────────────────────
// 3. Alias-карта: все варианты написания → канонический GrbsId
// ────────────────────────────────────────────────────────────

/**
 * Нормализует произвольную строку из источников (СВОД, dept-файлы, AE-колонка)
 * к каноническому GrbsId.
 *
 * Покрывает:
 *   - Варианты с суффиксом «АЕМР» (написано в старых листах)
 *   - Двойной пробел «УО  АЕМР» (21 строка в данных на 18.04.2026)
 *   - Опечатку «УФБР» вместо «УФБП» (встречается в AE УАГЗО)
 *   - Историческое сокращение «УТХиРКИ» (книга СВОД-25-26)
 *   - Полное написание «Управление делами»
 *   - Оба варианта УАГЗО/УАГиЗО
 */
/** Совместимый GrbsId-проектор общего словаря; отдельного набора алиасов нет. */
export const GRBS_ALIAS_MAP: Readonly<Record<string, GrbsId>> = Object.fromEntries(
  Object.entries(DEPARTMENT_ALIASES).map(([alias, id]) =>
    [alias, getDept(id).grbs.id]),
);

// ────────────────────────────────────────────────────────────
// 4. Lookup helpers
// ────────────────────────────────────────────────────────────

const _byId = new Map<GrbsId, GrbsEntry>(
  GRBS_REGISTRY.map(g => [g.id, g]),
);

/** Получить запись реестра по каноническому ID. Бросает при отсутствии. */
export function getGrbs(id: GrbsId): GrbsEntry {
  const g = _byId.get(id);
  if (!g) throw new Error(`Неизвестный ГРБС: ${id}`);
  return g;
}

/**
 * Нормализовать произвольную строку к GrbsId через alias-карту.
 * Если совпадений нет — возвращает undefined.
 * Нечёткий поиск (Levenshtein) не используется намеренно: ложные срабатывания
 * хуже пропуска. При расширении корпуса дополняйте DEPARTMENT_ALIASES в department-registry.ts.
 */
export function resolveGrbsAlias(raw: string): GrbsId | undefined {
  const department = findDept(raw);
  return department ? DEPARTMENT_ID_TO_GRBS_ID[department.id] : undefined;
}

/** Все канонические ID в порядке реестра */
export const ALL_GRBS_IDS: readonly GrbsId[] = GRBS_REGISTRY.map(g => g.id);

/** ГРБС с подведомственными учреждениями */
export const GRBS_WITH_SUBORDINATES: readonly GrbsId[] = GRBS_REGISTRY
  .filter(g => g.hasSubordinates)
  .map(g => g.id);

// ────────────────────────────────────────────────────────────
// 5. Мост DepartmentId (types.ts/данные) ↔ GrbsId (этот реестр)
// ────────────────────────────────────────────────────────────

/**
 * `DepartmentId` (types.ts, форма данных/листов) использует «УАГЗО»,
 * а канонический `GrbsId` здесь — «УАГиЗО» (реестр СВОД-25-26/ГРБС).
 * Семь из восьми ID совпадают строкой; расходится только УАГЗО ↔ УАГиЗО.
 * Эти две карты — единственная биекция между кириллическими формами;
 * Record-тип гарантирует на этапе компиляции покрытие всех восьми.
 */
export const DEPARTMENT_ID_TO_GRBS_ID = Object.fromEntries(
  DEPARTMENT_REGISTRY.map(d => [d.id, d.grbs.id]),
) as Record<DepartmentId, GrbsId>;

/** Обратная биекция GrbsId → DepartmentId (форма данных/листов). */
export const GRBS_ID_TO_DEPARTMENT_ID = Object.fromEntries(
  DEPARTMENT_REGISTRY.map(d => [d.grbs.id, d.id]),
) as Record<GrbsId, DepartmentId>;

/**
 * Привести любую форму идентификатора ГРБС к каноническому GrbsId.
 * Порядок: прямой GrbsId → мост DepartmentId («УАГЗО») → alias-карта
 * (суффиксы «АЕМР», двойной пробел, опечатки). undefined — если форма
 * не распознана (без нечёткого поиска: ложное срабатывание хуже пропуска).
 */
export function toGrbsId(raw: string): GrbsId | undefined {
  if ((GRBS_CANONICAL as readonly string[]).includes(raw)) return raw as GrbsId;
  const viaDept = (DEPARTMENT_ID_TO_GRBS_ID as Record<string, GrbsId>)[raw];
  if (viaDept) return viaDept;
  return resolveGrbsAlias(raw);
}
