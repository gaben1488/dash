/**
 * Ось активности — повторяет фильтр AN4 листа «СВОД с месяцами».
 *
 * Таблица фильтрует данные по типу деятельности через ячейку AN4:
 *   "*"  → ВСЕ (ТД+ПМ)   "ТД" → Текущая деятельность   "ПМ" → Программное мероприятие
 *
 * `td_pm` — дополнительный срез CalcEngine: текущая деятельность, у которой в
 * столбце D указана реальная программа. У листа «СВОД с месяцами» нет отдельного
 * значения AN4 для этого среза, поэтому он считается только по атомарным строкам.
 */

export type ActivityScope = 'all' | 'td' | 'pm' | 'td_pm' | 'td_clean';

/**
 * Порядок — порядок кнопок в UI: сначала целые срезы (ВСЕ/ПМ/ТД),
 * затем состав ТД (чистая / с программой). td = td_clean + td_pm по построению.
 */
export const ACTIVITY_SCOPES: readonly ActivityScope[] = ['all', 'pm', 'td', 'td_clean', 'td_pm'] as const;

export const ACTIVITY_AN4: Record<ActivityScope, string | null> = {
  all: '*',
  td: 'ТД',
  pm: 'ПМ',
  td_pm: null,
  td_clean: null,
};

export const ACTIVITY_F_VALUE = {
  td: 'Текущая деятельность',
  pm: 'Программное мероприятие',
} as const;

const PROGRAM_EMPTY = new Set(['x', 'х', '']);

export const ACTIVITY_LABEL: Record<ActivityScope, string> = {
  all: 'ВСЕ',
  td: 'ТД (вся)',
  pm: 'ПМ',
  td_pm: 'ТД-ПМ',
  td_clean: 'ТД чистая',
};

function hasProgramMarker(programValue: unknown): boolean {
  return !PROGRAM_EMPTY.has(String(programValue ?? '').trim().toLowerCase());
}

/**
 * Тип деятельности из столбца F.
 *
 * Важно: проверяем «текущая» раньше «программное мероприятие», потому что длинные
 * формулировки вроде «Текущая деятельность в рамках программного мероприятия»
 * содержат оба фрагмента. Такая строка остаётся ТД, а не ПМ.
 */
function activityKind(fValue: unknown): 'pm' | 'td' | null {
  const f = String(fValue ?? '').trim().toLowerCase();
  if (f.includes('текущ')) return 'td';
  if (f.includes('программное мероприятие')) return 'pm';
  return null;
}

/**
 * Подходит ли строка под срез активности.
 * @param fValue столбец F (тип деятельности: ТД / ПМ)
 * @param programValue столбец D (графа программы) — нужен для td_pm
 */
export function matchesActivityScope(scope: ActivityScope, fValue: unknown, programValue?: unknown): boolean {
  if (scope === 'all') return true;
  const kind = activityKind(fValue);
  if (scope === 'pm') return kind === 'pm';
  if (scope === 'td') return kind === 'td';
  if (scope === 'td_clean') return kind === 'td' && !hasProgramMarker(programValue);
  return kind === 'td' && hasProgramMarker(programValue);
}

/**
 * Категория строки для разрезов по виду деятельности (ключи движка/Issues).
 *
 * ЕДИНСТВЕННЫЙ дом классификации строки: до 06.08 у движка и валидатора
 * были свои копии с расходящимися дефектами — extractor молча зачислял
 * строки без F в 'program' (Д16), а валидатор читал подпрограмму (E)
 * вместо графы программы (D): 91 живая ТД-строка носила неверный
 * activityType. Логика — та же, что у matchesActivityScope (activityKind +
 * hasProgramMarker), поэтому разрез и срез не могут разойтись.
 *
 * null = вид деятельности не распознан (F пуст или мусор) — честная
 * пустота; вызывающий сам решает, как её показать («unknown»-группа,
 * отсутствие поля), но НЕ зачисляет строку в программные.
 */
export function classifyActivity(
  fValue: unknown,
  programValue?: unknown,
): 'program' | 'current_program' | 'current_non_program' | null {
  const kind = activityKind(fValue);
  if (kind === 'pm') return 'program';
  if (kind === 'td') return hasProgramMarker(programValue) ? 'current_program' : 'current_non_program';
  return null;
}

/** Нормализовать произвольную метку (AN4 / F / алиас) в ActivityScope; null если не распознано. */
export function parseActivityScope(raw: unknown): ActivityScope | null {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === '') return null;
  if (v === 'тд-пм' || v === 'тд_пм' || v === 'td_pm' || v === 'current_program') return 'td_pm';
  if (v === 'тд чистая' || v === 'td_clean' || v === 'тд без программы') return 'td_clean';
  if (v === '*' || v === 'все' || v === 'all' || v === 'тд+пм') return 'all';
  if (v === 'тд' || v === 'td' || v === 'current' || v.startsWith('текущ')) return 'td';
  if (v === 'пм' || v === 'pm' || v === 'program' || v.startsWith('программ')) return 'pm';
  return null;
}
