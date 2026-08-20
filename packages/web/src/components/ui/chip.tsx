// ── Чип: короткая метка и переключатель фильтра.
//
//    По продукту жили три семейства одного и того же: `.badge-*` из
//    `index.css`, `.filter-chip*` там же и компонент `ui/badge.tsx`. Три
//    набора скруглений, три набора отступов, три поведения при наведении.
//
//    Здесь одна вещь с двумя ролями:
//      • метка (`as="span"`) — просто говорит слово;
//      • переключатель (`onClick`) — становится настоящей кнопкой с
//        `aria-pressed`, потому что нажатый фильтр обязан быть слышен
//        диктору, а не только виден по заливке.
//
//    Цвет чипа — роль данных, не украшение. Тон `accent` оставлен хрому
//    (выбранный фильтр), тона данных — состояниям записи.

import type { ReactNode } from 'react';
import clsx from 'clsx';
import type { DataTone } from './tokens';

export type ChipTone = DataTone | 'accent';

export interface ChipProps {
  children: ReactNode;
  tone?: ChipTone;
  /** Нажат ли переключатель. Для метки не имеет смысла. */
  pressed?: boolean;
  onClick?: () => void;
  /** Подпись для диктора, если текст чипа — сокращение («ЕП», «ФБ»). */
  title?: string;
  className?: string;
}

const TONE_STYLE: Record<ChipTone, { bg: string; fg: string; line: string }> = {
  accent: { bg: 'var(--accent-soft)', fg: 'var(--accent)', line: 'var(--accent-line)' },
  good: { bg: 'color-mix(in srgb, var(--data-good) 14%, transparent)', fg: 'var(--data-good)', line: 'color-mix(in srgb, var(--data-good) 38%, transparent)' },
  warn: { bg: 'color-mix(in srgb, var(--data-warn) 14%, transparent)', fg: 'var(--data-warn)', line: 'color-mix(in srgb, var(--data-warn) 38%, transparent)' },
  bad: { bg: 'color-mix(in srgb, var(--data-bad) 14%, transparent)', fg: 'var(--data-bad)', line: 'color-mix(in srgb, var(--data-bad) 38%, transparent)' },
  info: { bg: 'color-mix(in srgb, var(--data-info) 14%, transparent)', fg: 'var(--data-info)', line: 'color-mix(in srgb, var(--data-info) 38%, transparent)' },
  neutral: { bg: 'var(--surface-raised)', fg: 'var(--ink-muted)', line: 'var(--line-soft)' },
};

const BASE =
  'ds-chip inline-flex items-center gap-1 rounded-[var(--radius-pill)] border px-2 py-0.5 ds-text-2xs whitespace-nowrap';

export function Chip({ children, tone = 'neutral', pressed, onClick, title, className }: ChipProps) {
  const style = TONE_STYLE[tone];
  const visual = {
    backgroundColor: style.bg,
    color: style.fg,
    borderColor: style.line,
  };

  if (!onClick) {
    return (
      <span className={clsx(BASE, className)} style={visual} title={title}>
        {children}
      </span>
    );
  }

  // Нажатое состояние объявляется через aria-pressed, а не только заливкой:
  // фильтр, выбранный цветом, для диктора не существует.
  const chosen = pressed === true;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={chosen}
      title={title}
      className={clsx(
        BASE,
        'transition-colors [transition-duration:var(--dur-fast)] [transition-timing-function:var(--ease-standard)]',
        'hover:brightness-[1.06] active:brightness-[0.96]',
        className,
      )}
      style={
        chosen
          ? { backgroundColor: 'var(--accent)', color: 'var(--accent-ink)', borderColor: 'var(--accent)' }
          : visual
      }
    >
      {children}
    </button>
  );
}
