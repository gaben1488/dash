/**
 * Ось активности — повторяет фильтр AN4 листа «СВОД с месяцами» (новый ШДЮ).
 *
 * Таблица фильтрует данные по типу деятельности через ячейку AN4:
 *   "*"  → ВСЕ (ТД-ПМ, обе)        "ТД" → Текущая деятельность   "ПМ" → Программное мероприятие
 * Ячейки данных листа считает Apps Script и пишет СТАТИКОЙ под текущий AN4, поэтому
 * прочитать все три среза из листа через API нельзя — их считает CalcEngine из атомов
 * (столбец F dept-листа «ВСЕ»: «Программное мероприятие» / «Текущая деятельность»).
 */

export type ActivityScope = 'all' | 'td' | 'pm' | 'td_pm';

export const ACTIVITY_SCOPES: readonly ActivityScope[] = ['all', 'td', 'pm', 'td_pm'] as const;

/**
 * Значение ячейки-фильтра AN4 листа «СВОД с месяцами» для среза.
 * `td_pm` (ТД с программой в графе D) — CalcEngine-only: у листа нет такого AN4 → null.
 */
export const ACTIVITY_AN4: Record<ActivityScope, string | null> = {
  all: '*',
  td: 'ТД',
  pm: 'ПМ',
  td_pm: null,
};

/** Каноническое значение столбца F (тип деятельности) dept-листа. */
export const ACTIVITY_F_VALUE = {
  td: 'Текущая деятельность',
  pm: 'Программное мероприятие',
} as const;

/**
 * Маркеры «нет программы» в графе программы (столбец D = индекс 3, «Наименование
 * программы»). Внимание: column-map.ts помечает индекс 3 как DESCRIPTION, а PROGRAM_NAME
 * указывает на индекс 4 (подпрограмму) — но программа фактически в индексе 3 (сверено
 * по листу + данным: УЭР/УО ТД-строки D='Х'/'X' = без программы).
 */
const PROGRAM_EMPTY = new Set(['x', 'х', '']);

/** Короткая подпись среза для UI. */
export const ACTIVITY_LABEL: Record<ActivityScope, string> = {
  all: 'ВСЕ',
  td: 'ТД',
  pm: 'ПМ',
  td_pm: 'ТД-ПМ',
};

/**
 * Подходит ли строка под срез активности.
 * @param fValue столбец F (тип деятельности: ТД / ПМ)
 * @param programValue столбец D (графа программы) — нужен только для td_pm
 * «all» — любая строка. Сравнение регистро- и пробело-устойчивое.
 */
export function matchesActivityScope(scope: ActivityScope, fValue: unknown, programValue?: unknown): boolean {
  if (scope === 'all') return true;
  const f = String(fValue ?? '').trim().toLowerCase();
  if (scope === 'pm') return f === ACTIVITY_F_VALUE.pm.toLowerCase();
  if (scope === 'td') return f === ACTIVITY_F_VALUE.td.toLowerCase();
  // td_pm = ТД И в графе программы (D) есть программа (не X/Х/пусто)
  if (f !== ACTIVITY_F_VALUE.td.toLowerCase()) return false;
  return !PROGRAM_EMPTY.has(String(programValue ?? '').trim().toLowerCase());
}

/** Нормализовать произвольную метку (AN4 / F / алиас) в ActivityScope; null если не распознано. */
export function parseActivityScope(raw: unknown): ActivityScope | null {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === '') return null;
  if (v === 'тд-пм' || v === 'тд_пм' || v === 'td_pm') return 'td_pm';
  if (v === '*' || v === 'все' || v === 'all' || v === 'тд+пм') return 'all';
  if (v === 'тд' || v.startsWith('текущ')) return 'td';
  if (v === 'пм' || v.startsWith('программ')) return 'pm';
  return null;
}
