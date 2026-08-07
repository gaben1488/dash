/**
 * activity.ts — ось вида деятельности «Свода» = глобальная ось фильтра.
 *
 * До правки страница держала собственный набор категорий (`scopeSet`), а в
 * шапке приложения жил свой (`selectedActivities`). Два состояния на один
 * выбор пользователя: выбранное на «Пульте» «ТД-ПМ» в «Своде» молча
 * превращалось в «ВСЕ». Здесь — единственный переводчик между ключами
 * глобального фильтра и категориями сводной сетки.
 *
 * Категории не пересекаются и покрывают всё: ПМ ∪ ТД чистая ∪ ТД-ПМ = все
 * строки. Поэтому «выбраны все три» тождественно «не выбрано ничего».
 */
import { ACTIVITY_LABEL, type ActivityScope } from '@aemr/shared';
import type { ActivityKey } from '../filter-context';

/** Атомарная категория деятельности, которую умеет резать сводная сетка. */
export type SvodActivityCat = 'pm' | 'td_clean' | 'td_pm';

/** Ключ глобального фильтра (store.selectedActivities) → категория сетки. */
export const ACTIVITY_KEY_TO_CAT: Readonly<Record<ActivityKey, SvodActivityCat>> = {
  program: 'pm',
  current_program: 'td_pm',
  current_non_program: 'td_clean',
};

/** Обратный перевод: категория страницы → ключ глобального фильтра. */
export const CAT_TO_ACTIVITY_KEY: Readonly<Record<SvodActivityCat, ActivityKey>> = {
  pm: 'program',
  td_pm: 'current_program',
  td_clean: 'current_non_program',
};

/** Порядок кнопок: сперва программные, затем состав текущей деятельности. */
export const SVOD_ACTIVITY_CATS: readonly SvodActivityCat[] = ['pm', 'td_clean', 'td_pm'];

/** Подсказка к кнопке — объясняет категорию словами, а не сокращением. */
export const ACTIVITY_HINT: Readonly<Record<SvodActivityCat, string>> = {
  pm: 'Программные мероприятия — строки с видом деятельности «Программное мероприятие»',
  td_clean: 'Текущая деятельность без заполненной графы программы',
  td_pm: 'Текущая деятельность с заполненной графой программы — возможна ошибка заполнения',
};

/** Ключи глобального фильтра → категории сетки (чужое молча отбрасывается). */
export function catsFromActivities(selected: Iterable<string>): Set<SvodActivityCat> {
  const out = new Set<SvodActivityCat>();
  for (const key of selected) {
    const cat = ACTIVITY_KEY_TO_CAT[key as ActivityKey];
    if (cat) out.add(cat);
  }
  return out;
}

/**
 * Эквивалентный одиночный срез сетки. Пусто или все три категории = «ВСЕ»;
 * «ТД чистая + ТД-ПМ» = вся текущая деятельность.
 *
 * Прочие пары (например ПМ + ТД-ПМ) одной ячейкой сетки не выражаются: их
 * складывает `sliceUnified` по самим категориям, а этот ключ он тогда не
 * читает. Возвращаемое для них 'all' — безопасное значение по умолчанию,
 * а не утверждение, что срез равен всем строкам.
 */
export function effectiveScope(cats: ReadonlySet<SvodActivityCat>): ActivityScope {
  if (cats.size === 0 || cats.size === 3) return 'all';
  if (cats.size === 1) return [...cats][0];
  return cats.has('td_clean') && cats.has('td_pm') ? 'td' : 'all';
}

/** Фраза для заголовка: «все виды деятельности» либо «ПМ + ТД-ПМ». */
export function activityPhrase(cats: ReadonlySet<SvodActivityCat>): string {
  if (cats.size === 0 || cats.size === 3) return 'все виды деятельности';
  return SVOD_ACTIVITY_CATS.filter((c) => cats.has(c))
    .map((c) => ACTIVITY_LABEL[c])
    .join(' + ');
}
