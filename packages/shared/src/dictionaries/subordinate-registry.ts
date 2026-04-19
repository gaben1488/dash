/**
 * subordinate-registry.ts — Реестр подведомственных учреждений АЕМР.
 *
 * Источник: СВОД-25-26/ГРБС, 75 строк (72 реальных + 3 пустых).
 * Дата снимка: 18.04.2026 (AEMR_SOURCE_AUDIT.md §2).
 *
 * Структура иерархии:
 *   УО      — 41 учреждение: 18 детсадов, 14 школ, 3 доп. образования, МКУ УО, МКУ ЦБОиМТО
 *   УКСиМП  — 21 учреждение: культура/спорт, муз./худ. школы
 *   УАГиЗО  — 2 (МКУ «Елизовское РУС» + само управление, фактически не закупает)
 *   УИО     — 1 (сам МКУ УИО)
 *   УФБП    — 1 (собственный реестр)
 *   УД      — 2 (МКУ «ЕДДС» + само УД как _org_itself)
 *   УЭР     — 2 (МКУ «ЦЭР» + само УЭР)
 *   УДТХ    — 2 (УДТХ + МКУ ДЭ, полностью «бесподведное» в смысле листов ШДЮ)
 *
 * TODO: заполнить полный список (72 учреждения) из СВОД-25-26/ГРБС.
 *       Сейчас — 3 примера на каждый ГРБС для демонстрации структуры.
 *       ИНН, КПП, ОКАТО — заполнить при получении реестра от АЕМР.
 */

import type { GrbsId } from './grbs-registry.js';

// ────────────────────────────────────────────────────────────
// 1. Интерфейс записи подведа
// ────────────────────────────────────────────────────────────

export interface SubordinateEntry {
  /** Уникальный ID подведомственного учреждения (slug для URL и metricKey) */
  id: string;
  /** Каноническое полное наименование (из СВОД-25-26/ГРБС) */
  canonicalName: string;
  /** Отображаемое имя в UI (сокращённое, но однозначное) */
  displayName: string;
  /** Очень короткое обозначение для таблиц и легенд */
  shortName: string;
  /** ГРБС, которому подчинено учреждение */
  grbsId: GrbsId;
  /** ИНН (TODO: заполнить из реестра АЕМР) */
  inn?: string;
  /** КПП (TODO: заполнить из реестра АЕМР) */
  kpp?: string;
  /** Код ОКАТО (TODO: заполнить из реестра АЕМР) */
  okato?: string;
  /**
   * Признак «само управление как строка данных».
   * Когда колонка C листа пуста — строка принадлежит самому ГРБС.
   * В этом случае subordinateId = '_org_itself'.
   */
  isOrgItself?: true;
  /**
   * Имя листа в dept-файле ГРБС (если отдельный лист).
   * Undefined означает, что данные агрегированы в листе «Все» или «ВСЕ».
   */
  sheetName?: string;
  /** Тип учреждения для группировки в UI */
  orgType: 'mkу' | 'school' | 'kindergarten' | 'additional_education' | 'culture' | 'sport' | 'other' | 'org_itself';
}

// ────────────────────────────────────────────────────────────
// 2. Реестр учреждений
//    FILL FROM SOURCE: packages/shared/src/dictionaries/subordinate-registry.ts
//    Источник: СВОД-25-26/ГРБС (лист «ГРБС», 75 строк)
// ────────────────────────────────────────────────────────────

export const SUBORDINATE_REGISTRY: SubordinateEntry[] = [

  // ── УО: Управление образования (41 учреждение + _org_itself) ─────────────

  {
    id: 'uo_org_itself',
    canonicalName: 'Управление образования АЕМР',
    displayName: 'УО (орг.)',
    shortName: 'УО',
    grbsId: 'УО',
    isOrgItself: true,
    orgType: 'org_itself',
  },
  {
    id: 'uo_mku_uo',
    canonicalName: 'МКУ «Управление образования АЕМР»',
    displayName: 'МКУ УО',
    shortName: 'МКУ УО',
    grbsId: 'УО',
    sheetName: 'МКУ УО',
    orgType: 'mkу',
    // TODO: inn, kpp, okato из реестра АЕМР
  },
  {
    id: 'uo_mku_cboimto',
    canonicalName: 'МКУ «Централизованная бухгалтерия и материально-техническое обеспечение»',
    displayName: 'МКУ ЦБОиМТО',
    shortName: 'ЦБОиМТО',
    grbsId: 'УО',
    orgType: 'mkу',
    // TODO: заполнить из СВОД-25-26/ГРБС строка ~15
  },
  // TODO: 38 школ и детских садов УО — fill from СВОД-25-26/ГРБС

  // ── УКСиМП: Управление капитального строительства и молодёжной политики ─

  {
    id: 'uksimp_org_itself',
    canonicalName: 'Управление капитального строительства и молодёжной политики АЕМР',
    displayName: 'УКСиМП (орг.)',
    shortName: 'УКСиМП',
    grbsId: 'УКСиМП',
    isOrgItself: true,
    orgType: 'org_itself',
  },
  {
    id: 'uksimp_mku_kult_1',
    canonicalName: 'МКУ «Культурный центр Елизово»',
    displayName: 'КЦ Елизово',
    shortName: 'КЦЕ',
    grbsId: 'УКСиМП',
    orgType: 'culture',
    // TODO: fill from СВОД-25-26/ГРБС, строки 45–65
  },
  {
    id: 'uksimp_mku_sport_1',
    canonicalName: 'МКУ «Спортивная школа»',
    displayName: 'Спортшкола',
    shortName: 'СШ',
    grbsId: 'УКСиМП',
    orgType: 'sport',
    // TODO: fill from СВОД-25-26/ГРБС
  },
  // TODO: 18 учреждений культуры/спорта/молодёжной политики УКСиМП

  // ── УАГиЗО: Управление архитектуры, градостроительства и земельных отношений

  {
    id: 'uagizo_org_itself',
    canonicalName: 'Управление архитектуры, градостроительства и земельных отношений АЕМР',
    displayName: 'УАГиЗО (орг.)',
    shortName: 'УАГиЗО',
    grbsId: 'УАГиЗО',
    isOrgItself: true,
    orgType: 'org_itself',
  },
  {
    id: 'uagizo_mku_elrус',
    canonicalName: 'МКУ «Елизовское районное управление строительства»',
    displayName: 'МКУ Елизовское РУС',
    shortName: 'Елизово РУС',
    grbsId: 'УАГиЗО',
    sheetName: 'ПОДВЕД_МКУ "Елизовское РУС"',
    orgType: 'mkу',
    // TODO: fill ИНН/КПП из реестра
  },

  // ── УИО: Управление имущественных отношений ──────────────────────────────

  {
    id: 'uio_org_itself',
    canonicalName: 'МКУ «Управление имущественных отношений АЕМР»',
    displayName: 'МКУ УИО',
    shortName: 'УИО',
    grbsId: 'УИО',
    isOrgItself: true,
    sheetName: 'УИО',
    orgType: 'org_itself',
  },

  // ── УФБП: Управление финансово-бюджетной политики ────────────────────────

  {
    id: 'ufbp_org_itself',
    canonicalName: 'Управление финансово-бюджетной политики АЕМР',
    displayName: 'УФБП',
    shortName: 'УФБП',
    grbsId: 'УФБП',
    isOrgItself: true,
    sheetName: 'УФБП',
    orgType: 'org_itself',
  },

  // ── УД: Управление делами ─────────────────────────────────────────────────

  {
    id: 'ud_org_itself',
    canonicalName: 'Управление делами Администрации АЕМР',
    displayName: 'УД (орг.)',
    shortName: 'УД',
    grbsId: 'УД',
    isOrgItself: true,
    orgType: 'org_itself',
  },
  {
    id: 'ud_mku_edds',
    canonicalName: 'МКУ «Единая дежурно-диспетчерская служба»',
    displayName: 'МКУ ЕДДС',
    shortName: 'ЕДДС',
    grbsId: 'УД',
    sheetName: 'МКУ "ЕДДС"',
    orgType: 'mkу',
    // TODO: fill ИНН/КПП из реестра
  },

  // ── УЭР: Управление экономического развития ──────────────────────────────

  {
    id: 'uer_org_itself',
    canonicalName: 'Управление экономического развития АЕМР',
    displayName: 'УЭР (орг.)',
    shortName: 'УЭР',
    grbsId: 'УЭР',
    isOrgItself: true,
    orgType: 'org_itself',
  },
  {
    id: 'uer_mku_tser',
    canonicalName: 'МКУ «Центр экономического развития»',
    displayName: 'МКУ ЦЭР',
    shortName: 'МКУ ЦЭР',
    grbsId: 'УЭР',
    sheetName: 'МКУ "ЦЭР"',
    orgType: 'mkу',
    // TODO: fill ИНН/КПП из реестра
  },

  // ── УДТХ: Управление дорожно-транспортного хозяйства ─────────────────────

  {
    id: 'udtx_org_itself',
    canonicalName: 'Управление дорожно-транспортного хозяйства АЕМР',
    displayName: 'УДТХ',
    shortName: 'УДТХ',
    grbsId: 'УДТХ',
    isOrgItself: true,
    sheetName: 'УДТХ',
    orgType: 'org_itself',
  },
  // TODO: проверить наличие МКУ ДЭ из реестра (AEMR_SOURCE_AUDIT §2 упоминает 2 строки)
];

// ────────────────────────────────────────────────────────────
// 3. Lookup helpers
// ────────────────────────────────────────────────────────────

const _byId = new Map<string, SubordinateEntry>(
  SUBORDINATE_REGISTRY.map(s => [s.id, s]),
);

const _byGrbs = new Map<GrbsId, SubordinateEntry[]>();
for (const s of SUBORDINATE_REGISTRY) {
  const arr = _byGrbs.get(s.grbsId) ?? [];
  arr.push(s);
  _byGrbs.set(s.grbsId, arr);
}

/** Получить запись подведа по slug-ID */
export function getSubordinate(id: string): SubordinateEntry | undefined {
  return _byId.get(id);
}

/** Получить все подведы одного ГРБС */
export function getSubordinatesByGrbs(grbsId: GrbsId): SubordinateEntry[] {
  return _byGrbs.get(grbsId) ?? [];
}

/**
 * Специальный sentinel для строк, где колонка C пуста.
 * В таких строках закупает само управление, а не подвед.
 */
export const ORG_ITSELF_SENTINEL = '_org_itself' as const;
