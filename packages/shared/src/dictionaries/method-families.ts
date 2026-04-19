/**
 * method-families.ts — Семейства и группы способов закупки.
 *
 * Источник: rule-book.ts VALID_METHODS, types.ts ProcurementMethod,
 *           UI_LABELS в constants.ts, AEMR_SOURCE_AUDIT.md §3.
 *
 * Основная проблема в данных:
 *   Колонка L содержит значения «ЭА», «ЕП», «ЭК», «ЭЗК».
 *   VALID_METHODS в rule-book — ['ЭА', 'ЕП', 'ЭК', 'ЭЗК'].
 *   Но «неверный способ закупки» зафиксирован в 260 строках:
 *     - 90 false positives у УД (парсер сравнивал строкой, а не семейством)
 *     - ~170 реальных ошибок операторов
 *   Семейство EA_GROUP позволяет группировать ЭА/ЭЗК/ЭК/ЭЕП
 *   для сигнала «конкурентные процедуры» без жёсткого point-сравнения.
 */

// ────────────────────────────────────────────────────────────
// 1. Базовые типы
// ────────────────────────────────────────────────────────────

/** Четыре канонических кода способа закупки (колонка L) */
export const PROCUREMENT_METHODS = ['ЭА', 'ЕП', 'ЭК', 'ЭЗК'] as const;
export type ProcurementMethodCode = typeof PROCUREMENT_METHODS[number];

/**
 * Семейства способов для аналитических группировок.
 *   EP         — единственный поставщик (ЕП)
 *   COMPETITIVE — все конкурентные (ЭА + ЭК + ЭЗК + ЭЕП)
 *   ALL        — все четыре кода вместе
 */
export type MethodFamily = 'EP' | 'COMPETITIVE' | 'ALL';

// ────────────────────────────────────────────────────────────
// 2. Карта семейств
// ────────────────────────────────────────────────────────────

/**
 * METHOD_FAMILY_MAP — главный справочник для аналитического движка.
 *
 * Использование:
 *   - Сигнал «конкурентная процедура»: METHOD_FAMILY_MAP.COMPETITIVE.includes(row.method)
 *   - Сигнал epRisk: row.method === 'ЕП' && row.planSum > EP_RISK_THRESHOLD
 *   - Фильтры UI: «Все конкурентные» = COMPETITIVE, «ЕП» = EP
 */
export const METHOD_FAMILY_MAP: Record<MethodFamily, readonly ProcurementMethodCode[]> = {
  EP: ['ЕП'],
  COMPETITIVE: ['ЭА', 'ЭК', 'ЭЗК'],
  ALL: ['ЭА', 'ЕП', 'ЭК', 'ЭЗК'],
} as const;

// ────────────────────────────────────────────────────────────
// 3. Метаданные каждого способа (для UI и KB-tooltip)
// ────────────────────────────────────────────────────────────

export interface MethodMeta {
  code: ProcurementMethodCode;
  /** Полное русское название */
  label: string;
  /** Сокращение для compact-таблиц */
  abbr: string;
  /** Семейство */
  family: MethodFamily;
  /**
   * Является конкурентной процедурой.
   * Правило: ЕП — неконкурентная; ЭА/ЭК/ЭЗК — конкурентные.
   */
  isCompetitive: boolean;
  /**
   * Пороговая сумма (в тыс. руб.), выше которой требуется усиленная
   * проверка (сигнал epRisk для ЕП).
   * Для ЕП: 600 тыс. руб. (44-ФЗ ст. 93 ч. 1 п. 4) = 600 тыс. руб.
   */
  thresholdKopUnit?: number;
  /** Ссылка на правовую норму (из legal-refs.ts) */
  primaryLegalRef?: string;
  /** Цвет бейджа в UI (Tailwind-класс bg) */
  badgeColor: string;
}

export const METHOD_META: Record<ProcurementMethodCode, MethodMeta> = {
  'ЭА': {
    code: 'ЭА',
    label: 'Электронный аукцион',
    abbr: 'ЭА',
    family: 'COMPETITIVE',
    isCompetitive: true,
    badgeColor: 'bg-blue-100 text-blue-800',
  },
  'ЕП': {
    code: 'ЕП',
    label: 'Закупка у единственного поставщика',
    abbr: 'ЕП',
    family: 'EP',
    isCompetitive: false,
    thresholdKopUnit: 600,    // 600 тыс. руб. — порог по 44-ФЗ ст. 93 ч. 1 п. 4
    primaryLegalRef: '44_FZ_93_1_4',
    badgeColor: 'bg-amber-100 text-amber-800',
  },
  'ЭК': {
    code: 'ЭК',
    label: 'Электронный конкурс',
    abbr: 'ЭК',
    family: 'COMPETITIVE',
    isCompetitive: true,
    badgeColor: 'bg-violet-100 text-violet-800',
  },
  'ЭЗК': {
    code: 'ЭЗК',
    label: 'Электронный запрос котировок',
    abbr: 'ЭЗК',
    family: 'COMPETITIVE',
    isCompetitive: true,
    badgeColor: 'bg-cyan-100 text-cyan-800',
  },
} as const;

// ────────────────────────────────────────────────────────────
// 4. Алиасы для нормализации сырых значений из колонки L
// ────────────────────────────────────────────────────────────

/**
 * Варианты написания, встречающиеся в данных.
 * Правило: нормализуй в ProcurementMethodCode перед любым сравнением.
 *
 * Проблема «260 строк неверного способа» (AEMR_SOURCE_AUDIT §3):
 *   Парсер validate.ts сравнивал L строкой с VALID_METHODS.
 *   Вариант «ЭА (МЭП)» не совпадал — false positive.
 *   После нормализации через METHOD_ALIAS_MAP таких ситуаций не будет.
 */
export const METHOD_ALIAS_MAP: Record<string, ProcurementMethodCode> = {
  // Канонические
  'ЭА': 'ЭА',
  'ЕП': 'ЕП',
  'ЭК': 'ЭК',
  'ЭЗК': 'ЭЗК',

  // Варианты с уточнением
  'ЭА (МЭП)': 'ЭА',         // малый электронный аукцион (устаревшее название)
  'ЭА МЭП': 'ЭА',
  'ЭА (малый)': 'ЭА',
  'ЭЕП': 'ЕП',               // «электронная закупка у ЕП» — некоторые листы УО
  'ЕП (ст.93)': 'ЕП',
  'Ед. поставщик': 'ЕП',

  // Регистровые варианты
  'эа': 'ЭА',
  'еп': 'ЕП',
  'эк': 'ЭК',
  'эзк': 'ЭЗК',
} as const;

// ────────────────────────────────────────────────────────────
// 5. Helpers
// ────────────────────────────────────────────────────────────

/** Нормализует сырое значение колонки L к ProcurementMethodCode или undefined */
export function normalizeMethod(raw: unknown): ProcurementMethodCode | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return METHOD_ALIAS_MAP[trimmed] as ProcurementMethodCode | undefined;
}

/** Проверяет принадлежность метода к семейству */
export function isMethodInFamily(code: ProcurementMethodCode, family: MethodFamily): boolean {
  return METHOD_FAMILY_MAP[family].includes(code);
}

/** Является ли строка конкурентной процедурой */
export function isCompetitive(code: ProcurementMethodCode): boolean {
  return METHOD_META[code].isCompetitive;
}
