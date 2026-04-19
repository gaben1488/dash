/**
 * activity-types.ts — Типы деятельности закупок (колонка F в листах ГРБС).
 *
 * Источник: rule-book.ts VALID_TYPES, types.ts ProcurementType,
 *           СВОД ТД-ПМ (структура трёхуровневой шапки).
 *
 * Иерархия:
 *   ПМ   — «Программное мероприятие» (в рамках муниципальной программы)
 *   ТД   — «Текущая деятельность» (вне программ)
 *   ТД-ПМ — «Текущая деятельность в рамках ПМ» (смешанный статус)
 *
 * Название листа СВОД отражает оба: «СВОД ТД-ПМ».
 * В колонке F реальных данных встречаются четыре варианта написания,
 * которые нормализуются к трём аналитическим типам ActivityType.
 *
 * Связь с СВОД:
 *   - ПМ-строки → блоки КП (конкурентные процедуры) + ЕП
 *   - ТД-строки → агрегируются в «Текущая деятельность»
 *   Для exec_count_pct главный KPI: факт / план по типу × бюджет × период.
 */

// ────────────────────────────────────────────────────────────
// 1. Аналитические типы (после нормализации)
// ────────────────────────────────────────────────────────────

/**
 * Три аналитических типа деятельности.
 * Используются во всём pipeline после нормализации колонки F.
 */
export const ACTIVITY_TYPES = ['program', 'current_program', 'current_non_program'] as const;
export type ActivityType = typeof ACTIVITY_TYPES[number];

// ────────────────────────────────────────────────────────────
// 2. Метаданные типов
// ────────────────────────────────────────────────────────────

export interface ActivityTypeMeta {
  type: ActivityType;
  /** Краткая аббревиатура для таблиц и фильтров */
  abbr: 'ПМ' | 'ТД-ПМ' | 'ТД';
  /** Полное русское название */
  label: string;
  /** Описание для KB-tooltip */
  description: string;
  /** Цвет бейджа в UI */
  badgeColor: string;
}

export const ACTIVITY_TYPE_META: Record<ActivityType, ActivityTypeMeta> = {
  program: {
    type: 'program',
    abbr: 'ПМ',
    label: 'Программное мероприятие',
    description:
      'Закупка в рамках муниципальной программы. ' +
      'Финансируется по КБР (программный код), ' +
      'требует соответствия целям программы.',
    badgeColor: 'bg-indigo-100 text-indigo-800',
  },
  current_program: {
    type: 'current_program',
    abbr: 'ТД-ПМ',
    label: 'Текущая деятельность в рамках программного мероприятия',
    description:
      'Смешанный тип: операционная закупка, но привязанная к конкретному ' +
      'мероприятию программы. В СВОД — блок «ТД в рамках ПМ».',
    badgeColor: 'bg-violet-100 text-violet-800',
  },
  current_non_program: {
    type: 'current_non_program',
    abbr: 'ТД',
    label: 'Текущая деятельность вне рамок программного мероприятия',
    description:
      'Операционная закупка вне программных мероприятий. ' +
      'Финансируется по базовому бюджету ГРБС.',
    badgeColor: 'bg-slate-100 text-slate-700',
  },
} as const;

// ────────────────────────────────────────────────────────────
// 3. Сырые значения колонки F → ActivityType
// ────────────────────────────────────────────────────────────

/**
 * Канонические формулировки из rule-book.ts VALID_TYPES плюс все
 * вариации, встречающиеся в данных (с учётом регистра и пробелов).
 *
 * Нормализация вызывается в pipeline/classify.ts перед сигналами.
 */
export const ACTIVITY_TYPE_RAW_MAP: Record<string, ActivityType> = {
  // Программное мероприятие
  'Программное мероприятие': 'program',
  'программное мероприятие': 'program',
  'ПМ': 'program',
  'пм': 'program',

  // Текущая деятельность в рамках ПМ
  'Текущая деятельность в рамках программного мероприятия': 'current_program',
  'Текущая деятельность в рамках ПМ': 'current_program',
  'ТД в рамках ПМ': 'current_program',
  'ТД-ПМ': 'current_program',
  'тд-пм': 'current_program',

  // Текущая деятельность вне ПМ
  'Текущая деятельность': 'current_non_program',
  'Текущая деятельность вне рамок программного мероприятия': 'current_non_program',
  'Текущая деятельность вне ПМ': 'current_non_program',
  'ТД': 'current_non_program',
  'тд': 'current_non_program',

  // Устаревшие / упрощённые
  'текущая': 'current_non_program',
  'Текущая': 'current_non_program',
} as const;

/**
 * Список допустимых значений для строгой проверки (rule-book budget_sum_plan).
 * Совпадает с VALID_TYPES в rule-book.ts — нужно синхронизировать при изменении.
 */
export const VALID_ACTIVITY_TYPES_RAW = [
  'Текущая деятельность',
  'Текущая деятельность в рамках программного мероприятия',
  'Текущая деятельность вне рамок программного мероприятия',
  'Программное мероприятие',
] as const;

export type RawActivityType = typeof VALID_ACTIVITY_TYPES_RAW[number];

// ────────────────────────────────────────────────────────────
// 4. Helpers
// ────────────────────────────────────────────────────────────

/** Нормализует сырое значение колонки F к ActivityType */
export function normalizeActivityType(raw: unknown): ActivityType | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return ACTIVITY_TYPE_RAW_MAP[trimmed];
}

/** Является ли тип деятельности «программным» (ПМ или ТД-ПМ) */
export function isProgramActivity(type: ActivityType): boolean {
  return type === 'program' || type === 'current_program';
}
