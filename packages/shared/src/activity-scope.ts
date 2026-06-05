/**
 * Ось активности — повторяет фильтр AN4 листа «СВОД с месяцами» (новый ШДЮ).
 *
 * Таблица фильтрует данные по типу деятельности через ячейку AN4:
 *   "*"  → ВСЕ (ТД-ПМ, обе)        "ТД" → Текущая деятельность   "ПМ" → Программное мероприятие
 * Ячейки данных листа считает Apps Script и пишет СТАТИКОЙ под текущий AN4, поэтому
 * прочитать все три среза из листа через API нельзя — их считает CalcEngine из атомов
 * (столбец F dept-листа «ВСЕ»: «Программное мероприятие» / «Текущая деятельность»).
 */

export type ActivityScope = 'all' | 'td' | 'pm';

export const ACTIVITY_SCOPES: readonly ActivityScope[] = ['all', 'td', 'pm'] as const;

/** Значение ячейки-фильтра AN4 листа ШДЮ для каждого среза. */
export const ACTIVITY_AN4: Record<ActivityScope, string> = {
  all: '*',
  td: 'ТД',
  pm: 'ПМ',
};

/** Каноническое значение столбца F (тип деятельности) dept-листа для среза (кроме «all»). */
export const ACTIVITY_F_VALUE: Record<Exclude<ActivityScope, 'all'>, string> = {
  td: 'Текущая деятельность',
  pm: 'Программное мероприятие',
};

/** Короткая подпись среза для UI. */
export const ACTIVITY_LABEL: Record<ActivityScope, string> = {
  all: 'ТД-ПМ',
  td: 'ТД',
  pm: 'ПМ',
};

/**
 * Подходит ли строка (значение столбца F) под срез активности.
 * «all» — любая строка. Сравнение регистро- и пробело-устойчивое.
 */
export function matchesActivityScope(scope: ActivityScope, fValue: unknown): boolean {
  if (scope === 'all') return true;
  const v = String(fValue ?? '').trim().toLowerCase();
  if (!v) return false;
  return v === ACTIVITY_F_VALUE[scope].toLowerCase();
}

/** Нормализовать произвольную метку (AN4 / F / алиас) в ActivityScope; null если не распознано. */
export function parseActivityScope(raw: unknown): ActivityScope | null {
  const v = String(raw ?? '').trim().toLowerCase();
  if (!v || v === '*' || v === 'все' || v === 'тд-пм' || v === 'all') return v === '' ? null : 'all';
  if (v === 'тд' || v.startsWith('текущ')) return 'td';
  if (v === 'пм' || v.startsWith('программ')) return 'pm';
  return null;
}
