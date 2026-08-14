// ── FigureView — как число выглядит на экране ───────────────────────────────
//
//    Три слоя, всегда вместе (канон п.58 реестра интервью 14.08):
//      • само значение — напечатанное `formatFigure`, единственным способом
//        печати в продукте;
//      • микроподпись периметра под ним — «2026 · весь год · все управления ·
//        на сейчас», собранная `perimeterLabel` из ДАННЫХ карточки, а не
//        унаследованная от бейджа шапки;
//      • провенанс по наведению — чем посчитано и, когда адрес известен
//        достоверно, лист с ячейкой.
//
//    Подсказка сделана нативным `title`, а не всплывающим окном: плитки Пульта
//    сами являются кнопками и уже обёрнуты подсказкой базы знаний — вложенное
//    всплывающее окно внутри кнопки перехватывало бы у неё фокус и клик.

import { formatFigure, provenanceText, type Figure } from '../lib/figure';
import { perimeterLabel, type Perimeter } from '../lib/perimeter';
import { cn } from '@/lib/utils';

/**
 * Микроподпись периметра. Отдельный экспорт нужен блокам, чей показатель —
 * не число с единицей (например, двоичный вердикт доверия): подпись периметра
 * обязана быть у них тоже, иначе правило «каждая карточка объявляет свой
 * периметр» держится не везде.
 */
export function PerimeterCaption({
  perimeter,
  className,
}: {
  perimeter: Perimeter;
  className?: string;
}) {
  const label = perimeterLabel(perimeter);
  return (
    <p
      className={cn(
        'text-[10px] leading-tight text-zinc-400 dark:text-zinc-500 mt-1',
        // Периметр — самая длинная подпись плитки; перенос по словам не даёт
        // ей выдавить вёрстку в горизонтальную прокрутку.
        'break-words',
        perimeter.note && 'text-amber-600 dark:text-amber-500',
        className,
      )}
      title={`Периметр: ${label}`}
    >
      {label}
    </p>
  );
}

export interface FigureViewProps {
  figure: Figure;
  /** Оформление самого числа; периметр и подсказка не настраиваются. */
  valueClassName?: string;
  className?: string;
  /**
   * Показывать ли микроподпись периметра. Выключается только там, где периметр
   * уже напечатан рядом одним блоком на несколько чисел — иначе одна и та же
   * фраза повторяется под каждой цифрой и перестаёт читаться.
   */
  showPerimeter?: boolean;
  /** Знаков после запятой, если единичного умолчания недостаточно. */
  decimals?: number;
}

export function FigureView({
  figure: f,
  valueClassName,
  className,
  showPerimeter = true,
  decimals,
}: FigureViewProps) {
  const text = formatFigure(f, decimals == null ? undefined : { decimals });
  const isEmpty = f.value === null;
  const provenance = provenanceText(f.provenance);
  // Подсказка по наведению держит оба ответа сразу: чем посчитано и за что.
  // Порознь они бесполезны — «движок» без периметра не объясняет число.
  const hint = `${provenance}\nПериметр: ${perimeterLabel(f.perimeter)}`;

  return (
    <div className={className}>
      <span
        title={hint}
        // Диктору читается то же самое, что видит мышь: подсказка не имеет
        // права быть единственным носителем происхождения числа.
        aria-label={`${text}. ${provenance}`}
        className={cn(
          'tabular-nums',
          // Причина пустоты — не число: она печатается спокойным весом, иначе
          // фраза «нет плана» кричит с плитки громче настоящих значений.
          isEmpty
            ? 'text-sm font-semibold text-zinc-400 dark:text-zinc-500 leading-snug'
            : 'text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50',
          valueClassName,
        )}
      >
        {text}
      </span>
      {showPerimeter && <PerimeterCaption perimeter={f.perimeter} />}
    </div>
  );
}
