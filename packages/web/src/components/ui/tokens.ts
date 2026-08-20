// ── Словарь облика: перечень имён, которые обязана знать обе темы.
//
//    Файл не задаёт красок — краски живут в `index.css`. Здесь только
//    список ролей и их порядок, чтобы:
//      • разметка обращалась к роли через имя, а не к строке `#a1a1aa`;
//      • страж `tokens.test.ts` мог проверить, что каждое имя определено
//        и на светлой теме, и на тёмной (равноправие тем — требование
//        владельца, а не пожелание);
//      • шкала кегля и шкала отступов имели ровно один порядок ступеней,
//        а не три разных представления в трёх файлах.
//
//    Правило добавления: новое имя вписывается сюда И в оба блока
//    `index.css`. Страж падает, если имя есть в одном месте из двух.

/** Поверхности — четыре высоты и всплывающий слой. */
export const SURFACE_TOKENS = [
  '--surface-page',
  '--surface-sunken',
  '--surface-card',
  '--surface-raised',
  '--surface-overlay',
] as const;

/** Линии: мягкая внутри карточки, крепкая по её краю. */
export const LINE_TOKENS = ['--line-soft', '--line-strong'] as const;

/** Чернила — четыре ступени светлоты, от главного к самому тихому. */
export const INK_TOKENS = ['--ink-strong', '--ink', '--ink-muted', '--ink-faint'] as const;

/** Акцент: хром интерфейса. Цветом данных быть не может. */
export const ACCENT_TOKENS = [
  '--accent',
  '--accent-hover',
  '--accent-ink',
  '--accent-soft',
  '--accent-line',
] as const;

/** Цвет данных — единственное место, где интерфейсу разрешён цвет. */
export const DATA_TOKENS = [
  '--data-good',
  '--data-warn',
  '--data-bad',
  '--data-info',
  '--data-neutral',
  '--data-fb',
  '--data-kb',
  '--data-mb',
] as const;

/**
 * Способ определения поставщика. Отдельный перечень, а не часть `DATA_TOKENS`,
 * ровно потому, что смешение — та самая болезнь: способ и бюджет обязаны
 * краситься непересекающимися наборами, иначе синий на соседних графиках
 * значит то федеральный бюджет, то конкурентную закупку.
 */
export const METHOD_TOKENS = ['--method-kp', '--method-ep'] as const;

/** Категориальный ряд: управления, организации, произвольные группы. */
export const CATEGORICAL_TOKENS = [
  '--cat-1',
  '--cat-2',
  '--cat-3',
  '--cat-4',
  '--cat-5',
  '--cat-6',
  '--cat-7',
  '--cat-8',
] as const;

/** Части графика, которые не являются данными: сетка, ось, подсказка. */
export const CHART_TOKENS = [
  '--chart-grid',
  '--chart-axis',
  '--chart-tooltip-bg',
  '--chart-tooltip-line',
  '--chart-reference',
] as const;

/**
 * Имена, у которых тёмная тема обязана иметь собственное значение.
 * Кегль, отступы и длительности в перечень не входят намеренно: они
 * от темы не зависят, и дублировать их в тёмном блоке было бы ложью
 * о том, что там что-то меняется.
 */
export const THEMED_TOKENS = [
  ...SURFACE_TOKENS,
  ...LINE_TOKENS,
  ...INK_TOKENS,
  ...ACCENT_TOKENS,
  ...DATA_TOKENS,
  ...METHOD_TOKENS,
  ...CATEGORICAL_TOKENS,
  ...CHART_TOKENS,
] as const;

/** Ступени кегля по возрастанию — порядок значим, страж его проверяет. */
export const TEXT_SCALE = [
  '--text-3xs',
  '--text-2xs',
  '--text-xs',
  '--text-sm',
  '--text-base',
  '--text-lg',
  '--text-xl',
  '--text-2xl',
  '--text-3xl',
] as const;

/** Ступени отступов по возрастанию. */
export const SPACE_SCALE = [
  '--space-1',
  '--space-2',
  '--space-3',
  '--space-4',
  '--space-5',
  '--space-6',
  '--space-8',
  '--space-10',
  '--space-12',
] as const;

/** Плотность: имена одни, числа разные. */
export const DENSITY_TOKENS = [
  '--row-h',
  '--cell-pad-x',
  '--cell-pad-y',
  '--card-pad',
  '--stack-gap',
] as const;

export type Density = 'compact' | 'comfortable';

/** Ступень кегля без префикса — то, чем пользуется разметка. */
export type TextStep = 'text-3xs' | 'text-2xs' | 'text-xs' | 'text-sm' | 'text-base'
  | 'text-lg' | 'text-xl' | 'text-2xl' | 'text-3xl';

/** Класс ступени кегля: `ds-text-sm`. Единственный способ назвать размер. */
export function textClass(step: TextStep): string {
  return `ds-${step}`;
}

/**
 * Роль цвета данных. Слово, а не краска: страница говорит «плохо»,
 * а какой именно красный на какой теме — знает `index.css`.
 */
export type DataTone = 'good' | 'warn' | 'bad' | 'info' | 'neutral';

/** Значение роли для места, где нужен именно цвет (заливка фигуры графика). */
export function dataVar(tone: DataTone): string {
  return `var(--data-${tone})`;
}

/** Цвет ряда без собственного смысла. Индекс за пределами ряда закольцовывается. */
export function categoricalVar(index: number): string {
  const n = CATEGORICAL_TOKENS.length;
  const safe = ((index % n) + n) % n;
  return `var(--cat-${safe + 1})`;
}
