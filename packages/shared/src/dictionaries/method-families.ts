/**
 * method-families.ts — Семейства и группы способов закупки.
 *
 * Источник: rule-book.ts VALID_METHODS, types.ts ProcurementMethod,
 *           UI_LABELS в constants.ts, AEMR_SOURCE_AUDIT.md §3.
 *
 * ВАЖНО (решение владельца §22 п.1 от 30.08.2026): словарь способов РАЗДЕЛЁН
 * ПО ИСТОЧНИКАМ. Книги ГРБС знают ровно два способа (GRBS_BOOK_METHODS ниже),
 * полный набор процедур живёт в книге мониторинга уполномоченного органа и
 * имеет собственный дом — PROCEDURE_FAMILIES в `shared/src/procedure-ref.ts`.
 * Списки ниже (PROCUREMENT_METHODS, METHOD_FAMILY_MAP, METHOD_META) — это ОСЬ
 * АНАЛИТИКИ над обоими источниками, а не словарь допустимого ввода: сужать её
 * до двух значений нельзя, иначе конкурентные процедуры мониторинга выпадут
 * из группировок и фильтров.
 *
 * Основная проблема в данных:
 *   Колонка L книг ГРБС содержит значения «ЕП» и «ЭА».
 *   Но «неверный способ закупки» зафиксирован в 260 строках:
 *     - 90 false positives у УД (парсер сравнивал строкой, а не семейством)
 *     - ~170 реальных ошибок операторов
 *   Семейство EA_GROUP позволяет группировать ЭА/ЭЗК/ЭК/ЭЕП
 *   для сигнала «конкурентные процедуры» без жёсткого point-сравнения.
 */

// ────────────────────────────────────────────────────────────
// 1. Базовые типы
// ────────────────────────────────────────────────────────────

/**
 * Четыре кода способа закупки — ОСЬ АНАЛИТИКИ по обоим источникам сразу
 * (книги ГРБС + книга мониторинга). Не путать со словарём допустимого ввода:
 * что законно в колонке L книги ГРБС, говорит GRBS_BOOK_METHODS ниже.
 */
export const PROCUREMENT_METHODS = ['ЭА', 'ЕП', 'ЭК', 'ЭЗК'] as const;
export type ProcurementMethodCode = typeof PROCUREMENT_METHODS[number];

/**
 * СПОСОБЫ, ЗАКОННЫЕ В КНИГАХ ГРБС (колонка L главного листа).
 *
 * Паспорт (решение владельца §22 п.1 от 30.08.2026,
 * `docs/superpowers/audits/2026-08-30-obmotka-plan.md` §3 п.1):
 *
 * — Что говорит книга. Проверка ввода колонки L в каноне таблиц
 *   (`scripts/etalon-sync/canon.cjs`, goldenValidation) — строгий список
 *   ONE_OF_LIST ['ЕП','ЭА']: третье значение книга при вводе ОТКЛОНЯЕТ.
 * — Что говорят данные. Замер 30.08.2026 по восьми книгам ГРБС: «ЕП» — 3465
 *   строк, «ЭА» — 494, других значений нет ни одного.
 * — Что было до. Продукт держал здесь четыре кода и признавал «ЭК»/«ЭЗК»
 *   валидными в книге ГРБС — то есть молча узаконивал то, что книга не
 *   принимает (противоречие №1 матрицы правил 30.08.2026).
 * — Почему разделение, а не расширение книги. Электронный конкурс и запрос
 *   котировок — настоящие процедуры, но они ведутся уполномоченным органом в
 *   КНИГЕ МОНИТОРИНГА, а не в книгах ГРБС. Их дом — PROCEDURE_FAMILIES
 *   (`shared/src/procedure-ref.ts`: ЭА, ЭЗК, ЭЕП, ЭАС, ЭК), и этого дома
 *   сужение книг ГРБС не касается.
 *
 * Потребитель — правило `method_validation` (rule-book.ts): чужой способ в
 * строке книги ГРБС даёт замечание, а не считается нормой.
 */
export const GRBS_BOOK_METHODS = ['ЕП', 'ЭА'] as const;

/** Способ, законный в колонке L книги ГРБС. */
export type GrbsBookMethod = typeof GRBS_BOOK_METHODS[number];

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
 *   Парсер validate.ts сравнивал L строкой со списком допустимых значений.
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
