/**
 * Ось активности — повторяет фильтр AN4 листа «СВОД с месяцами».
 *
 * Таблица фильтрует данные по типу деятельности через ячейку AN4:
 *   "*"  → ВСЕ (ТД+ПМ)   "ТД" → Текущая деятельность   "ПМ" → Программное мероприятие
 *
 * РЕШЕНИЕ-КАНОН п.30 (интервью 14.08.2026): срез «ТД-ПМ» УПРАЗДНЁН.
 * Остаются только ТД и ПМ; строки текущей деятельности с заполненной графой
 * программы (D) — обычная ТД по всем фильтрам, вкладкам и метрикам системы.
 * Заполненная графа программы у ТД — норма, а не ошибка заполнения, поэтому
 * снят и производный срез «ТД чистая» (он выделял ТД без программы и тем
 * самым выкидывал ТД-ПМ-строки из «ТД», что канону противоречит).
 */

export type ActivityScope = 'all' | 'td' | 'pm';

/** Порядок — порядок кнопок в UI: ВСЕ / ПМ / ТД. Ровно три среза (канон п.30). */
export const ACTIVITY_SCOPES: readonly ActivityScope[] = ['all', 'pm', 'td'] as const;

export const ACTIVITY_AN4: Record<ActivityScope, string | null> = {
  all: '*',
  td: 'ТД',
  pm: 'ПМ',
};

export const ACTIVITY_F_VALUE = {
  td: 'Текущая деятельность',
  pm: 'Программное мероприятие',
} as const;

export const ACTIVITY_LABEL: Record<ActivityScope, string> = {
  all: 'ВСЕ',
  td: 'ТД',
  pm: 'ПМ',
};

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
 *
 * @param fValue столбец F (тип деятельности: ТД / ПМ)
 * @param _programValue столбец D (графа программы). С канона п.30 (14.08.2026)
 *   НЕ участвует в срезе: заполненная программа у ТД — норма, строка остаётся
 *   ТД. Параметр сохранён, чтобы не ломать существующие вызовы.
 */
export function matchesActivityScope(scope: ActivityScope, fValue: unknown, _programValue?: unknown): boolean {
  if (scope === 'all') return true;
  return activityKind(fValue) === scope;
}

/**
 * Категория строки для разрезов по виду деятельности (ключи движка/Issues).
 *
 * ЕДИНСТВЕННЫЙ дом классификации строки: до 06.08 у движка и валидатора
 * были свои копии с расходящимися дефектами — extractor молча зачислял
 * строки без F в 'program' (Д16), а валидатор читал подпрограмму (E)
 * вместо графы программы (D).
 *
 * КАНОН п.30 (14.08.2026): графа программы (D) больше НЕ раскалывает ТД —
 * любая строка с «текущая» в F классифицируется как ТД целиком. Значение
 * 'current_program' с этого дня НЕ ВЫДАЁТСЯ (оставлено в типе только ради
 * старых снимков, где оно уже записано в атомах/issues); вся текущая
 * деятельность идёт ключом 'current_non_program' (= «ТД»).
 *
 * null = вид деятельности не распознан (F пуст или мусор) — честная
 * пустота; вызывающий сам решает, как её показать («unknown»-группа,
 * отсутствие поля), но НЕ зачисляет строку в программные.
 *
 * @param _programValue сохранён для совместимости вызовов; игнорируется.
 */
export function classifyActivity(
  fValue: unknown,
  _programValue?: unknown,
): 'program' | 'current_program' | 'current_non_program' | null {
  const kind = activityKind(fValue);
  if (kind === 'pm') return 'program';
  if (kind === 'td') return 'current_non_program';
  return null;
}

/**
 * Нормализовать произвольную метку (AN4 / F / алиас) в ActivityScope; null если не распознано.
 *
 * Легаси-метки упразднённых срезов («ТД-ПМ», «ТД чистая», 'current_program')
 * сводятся в 'td' — канон п.30: строки ТД-ПМ полностью входят в ТД, поэтому
 * старые ссылки/снимки со срезом ТД-ПМ обязаны раскрываться как ТД, а не
 * падать в null или, хуже, в «ВСЕ».
 */
export function parseActivityScope(raw: unknown): ActivityScope | null {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === '') return null;
  if (v === 'тд-пм' || v === 'тд_пм' || v === 'td_pm' || v === 'current_program') return 'td';
  if (v === 'тд чистая' || v === 'td_clean' || v === 'тд без программы' || v === 'current_non_program') return 'td';
  if (v === '*' || v === 'все' || v === 'all' || v === 'тд+пм') return 'all';
  if (v === 'тд' || v === 'td' || v === 'current' || v.startsWith('текущ')) return 'td';
  if (v === 'пм' || v === 'pm' || v === 'program' || v.startsWith('программ')) return 'pm';
  return null;
}
