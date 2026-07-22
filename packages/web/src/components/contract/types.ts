/**
 * Page Contract — базовый контракт элемента страницы (дуга-3, фундамент A).
 *
 * Принцип (REMAINING-2026-07-15, поправка 16.07): каждый элемент страницы
 * обязан ПО ТИПУ принимать FilterContext (никаких элементов «вне фильтра»),
 * нести бейдж происхождения числа и подписываться только через канон-словарь
 * (productLabel). Эти типы — фундамент страницы «Отчёт» (волна 2) и будущей
 * миграции существующих страниц; к текущим страницам НЕ подключены.
 */
import type { FilterContext } from '../../lib/filter-context';

/** Происхождение числа: расчёт по строкам книг / официал СВОД / смешанное. */
export type ElementSource = 'calc' | 'svod' | 'mixed';

/** Базовый контракт любого элемента страницы. */
export interface PageElementProps {
  /** Контекст фильтров — обязателен по типу, даже если элемент его пока не читает */
  filterCtx: FilterContext;
  /** Происхождение данных элемента (рендерится SourceBadge) */
  source: ElementSource;
}

/**
 * Словарь бейджа источника: подпись + стиль. Подписи и цвета — как у
 * существующего бейджа AnalyticsCard (Analytics.tsx: Расчёт/СВОД/Комби,
 * emerald/blue/sky), чтобы контрактные элементы визуально не расходились
 * со старыми до миграции.
 */
export const SOURCE_META: Readonly<Record<ElementSource, { label: string; className: string }>> = {
  calc: {
    label: 'Расчёт',
    className: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
  },
  svod: {
    label: 'СВОД',
    className: 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
  },
  mixed: {
    label: 'Комби',
    className: 'bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400',
  },
};
