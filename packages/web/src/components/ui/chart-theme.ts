// ── Облик графика: сетка, ось, подсказка и палитра одним домом.
//
//    Ключевое наблюдение, ради которого файл и появился: SVG принимает
//    переменную CSS прямо в атрибуте заливки — `fill="var(--data-good)"`
//    работает. Значит, графику не нужно знать про тему вовсе: он называет
//    роль, а `.dark` подменяет значение. До этого по страницам стояло
//    больше сотни выражений вида `isDark ? '#34d399' : '#10b981'` — сто
//    независимых мест, где тёмная тема могла разъехаться со светлой, и
//    ровно столько же лишних перерисовок при переключении темы.
//
//    Что здесь НЕ живёт: пороги (они в `lib/chart-colors.ts`, взяты из базы
//    знаний) и форматирование чисел (форматтеры продукта). Здесь только
//    облик.

import { CATEGORICAL_TOKENS, type DataTone } from './tokens';

/** Заливка по роли данных. Строка годится и для SVG, и для CSS. */
export function toneFill(tone: DataTone): string {
  return `var(--data-${tone})`;
}

/** Заливка ряда без собственного смысла: управление, организация. */
export function seriesFill(index: number): string {
  const n = CATEGORICAL_TOKENS.length;
  const safe = ((index % n) + n) % n;
  return `var(--cat-${safe + 1})`;
}

/** Готовый ряд заливок для перечня категорий. */
export function seriesPalette(count: number): string[] {
  return Array.from({ length: count }, (_, i) => seriesFill(i));
}

/**
 * Сетка. Горизонтальные линии оставлены, вертикальные убраны: по вертикали
 * значение читают от подписи, а не от линии, и вторая решётка только
 * загущает поле (правило data-ink — убирать краску, не несущую сведений).
 */
export const gridProps = {
  stroke: 'var(--chart-grid)',
  strokeDasharray: '2 4',
  vertical: false,
} as const;

/** Ось: линия тише подписи, засечек нет — их работу делает сетка. */
export const axisProps = {
  stroke: 'var(--chart-axis)',
  tickLine: false,
  axisLine: false,
  tick: { fill: 'var(--ink-muted)', fontSize: 11 },
} as const;

/** Подсказка: поверхность всплывающего слоя, а не белый прямоугольник. */
export const tooltipProps = {
  contentStyle: {
    background: 'var(--chart-tooltip-bg)',
    border: '1px solid var(--chart-tooltip-line)',
    borderRadius: 'var(--radius-card)',
    fontSize: 12,
    color: 'var(--ink)',
    boxShadow: 'var(--elevation-2)',
  },
  labelStyle: { color: 'var(--ink-strong)', fontSize: 11 },
  itemStyle: { color: 'var(--ink)' },
  cursor: { fill: 'var(--surface-raised)' },
} as const;

/** Опорная линия (план, порог, среднее) — пунктир, не сплошная. */
export const referenceLineProps = {
  stroke: 'var(--chart-reference)',
  strokeDasharray: '4 4',
  strokeWidth: 1,
} as const;

/**
 * Текстовый дубль визуального (канон 01.08): у каждого ряда графика обязана
 * быть словесная подпись, потому что цвет исчезает при чёрно-белой печати и
 * не существует для дальтоника. Функция собирает строку-легенду, которую
 * ставят под графиком рядом с самим графиком.
 */
export function legendLine(items: readonly { label: string; value: string }[]): string {
  return items.map((i) => `${i.label} — ${i.value}`).join(' · ');
}
