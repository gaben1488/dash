/**
 * activity.ts — ось вида деятельности «Свода» = глобальная ось фильтра.
 *
 * До правки страница держала собственный набор категорий (`scopeSet`), а в
 * шапке приложения жил свой (`selectedActivities`). Два состояния на один
 * выбор пользователя. Здесь — единственный переводчик между ключами
 * глобального фильтра и категориями сводной сетки.
 *
 * КАНОН п.30 (интервью 14.08.2026): срез «ТД-ПМ» упразднён. Категорий две —
 * ПМ и ТД; строки текущей деятельности с заполненной графой программы входят
 * в ТД целиком. Легаси-ключи глобального фильтра 'current_program' (бывш.
 * ТД-ПМ) и 'current_non_program' оба означают ТД.
 */
import { ACTIVITY_LABEL, type ActivityScope } from '@aemr/shared';
import type { ActivityKey } from '../filter-context';

/** Атомарная категория деятельности, которую умеет резать сводная сетка. */
export type SvodActivityCat = 'pm' | 'td';

/**
 * Ключ глобального фильтра (store.selectedActivities) → категория сетки.
 * Оба ТД-ключа сводятся в 'td' — канон п.30: ТД-ПМ-строки входят в ТД
 * по всем фильтрам, отдельного среза для них нет.
 */
export const ACTIVITY_KEY_TO_CAT: Readonly<Record<ActivityKey, SvodActivityCat>> = {
  program: 'pm',
  current_program: 'td',
  current_non_program: 'td',
};

/** Обратный перевод: категория страницы → ключ глобального фильтра. */
export const CAT_TO_ACTIVITY_KEY: Readonly<Record<SvodActivityCat, ActivityKey>> = {
  pm: 'program',
  td: 'current_non_program',
};

/** Порядок кнопок: программные, затем текущая деятельность целиком. */
export const SVOD_ACTIVITY_CATS: readonly SvodActivityCat[] = ['pm', 'td'];

/** Подсказка к кнопке — объясняет категорию словами, а не сокращением. */
export const ACTIVITY_HINT: Readonly<Record<SvodActivityCat, string>> = {
  pm: 'Программные мероприятия — строки с видом деятельности «Программное мероприятие»',
  td: 'Текущая деятельность целиком — включая строки с заполненной графой программы (канон п.30)',
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

/** «Выбрано всё» — пусто или обе категории (ПМ ∪ ТД = все строки). */
export function isAllCats(cats: ReadonlySet<SvodActivityCat>): boolean {
  return cats.size === 0 || cats.size >= SVOD_ACTIVITY_CATS.length;
}

/**
 * Эквивалентный одиночный срез сетки. Пусто или обе категории = «ВСЕ»;
 * одна категория — она сама (обе категории теперь и есть срезы сетки).
 */
export function effectiveScope(cats: ReadonlySet<SvodActivityCat>): ActivityScope {
  if (isAllCats(cats)) return 'all';
  return [...cats][0];
}

/** Фраза для заголовка: «все виды деятельности» либо «ПМ»/«ТД». */
export function activityPhrase(cats: ReadonlySet<SvodActivityCat>): string {
  if (isAllCats(cats)) return 'все виды деятельности';
  return SVOD_ACTIVITY_CATS.filter((c) => cats.has(c))
    .map((c) => ACTIVITY_LABEL[c])
    .join(' + ');
}
