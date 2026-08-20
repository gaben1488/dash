// ── Число-показатель: единственный дом крупного числа.
//
//    Число на экране — это утверждение, и у утверждения есть обязанности:
//      • подпись — что именно измерено;
//      • скоуп — за какой период и на какой момент прочитано (канон п.58);
//      • честная пустота — когда базы нет, пишется «нет базы», а не «0 %»
//        (запрет DESIGN.md «пустота нулём»);
//      • текстовый дубль визуального (канон 01.08) — направление дельты
//        названо словом, а не только цветом и стрелкой: печать бывает
//        чёрно-белой, а один читатель из двенадцати не различает красный.
//
//    Компонент не считает и не форматирует: он принимает уже готовую
//    строку от форматтеров продукта. Своё форматирование здесь было бы
//    вторым домом правил округления.

import type { ReactNode } from 'react';
import clsx from 'clsx';
import type { DataTone } from './tokens';

export interface StatDelta {
  /** Готовая строка изменения: «+12,4 млн», «−3 закупки». */
  text: string;
  /**
   * Что означает изменение для читателя. Не «вверх/вниз», а «хорошо/плохо»:
   * рост числа нарушений — это `bad`, хотя стрелка та же самая.
   */
  tone: Extract<DataTone, 'good' | 'bad' | 'neutral'>;
  /** Словесный дубль: «больше, чем неделю назад». Обязателен. */
  meaning: string;
}

export interface StatProps {
  /** Подпись: что измерено. «Исполнение плана», а не «Процент». */
  label: ReactNode;
  /**
   * Готовое число строкой. `null` — базы нет; тогда вместо числа встаёт
   * объяснение из `emptyReason`, и это не ошибка, а честный ответ.
   */
  value: string | null;
  /** Единица после числа: «%», «млн ₽», «шт.». */
  unit?: string;
  /** Момент и период чтения: «2026 · год», «на 18.08». */
  scope?: ReactNode;
  /** Отчего числа нет. Причина, а не ярлык: «план на год не проставлен». */
  emptyReason?: string;
  delta?: StatDelta;
  /** Тон самого числа. По умолчанию нейтральный: число не кричит без повода. */
  tone?: DataTone;
  /** Размер: `hero` — главное число экрана, `regular` — плитка в ряду. */
  size?: 'hero' | 'regular';
  /** Пояснение под числом: механизм, а не упрёк. */
  hint?: ReactNode;
  className?: string;
}

const TONE_VAR: Record<DataTone, string> = {
  good: 'var(--data-good)',
  warn: 'var(--data-warn)',
  bad: 'var(--data-bad)',
  info: 'var(--data-info)',
  neutral: 'var(--ink-strong)',
};

export function Stat({
  label,
  value,
  unit,
  scope,
  emptyReason,
  delta,
  tone = 'neutral',
  size = 'regular',
  hint,
  className,
}: StatProps) {
  const empty = value === null;

  return (
    <div className={clsx('ds-stat min-w-0', className)}>
      <div className="ds-text-2xs text-[var(--ink-muted)]">{label}</div>

      {empty ? (
        // Пустота остаётся пустотой. Правдоподобный ноль вместо неё
        // запрещён: читатель не должен отличать «ноль» от «неизвестно»
        // по мелкому шрифту в подвале.
        <p className="mt-1 ds-text-xs text-[var(--ink-faint)]" data-empty>
          {emptyReason ?? 'База не найдена — числа нет'}
        </p>
      ) : (
        <div className="mt-0.5 flex items-baseline gap-1">
          <span
            className={clsx(
              size === 'hero' ? 'ds-text-3xl' : 'ds-text-2xl',
              'font-[var(--weight-strong)] tabular-nums',
            )}
            style={{ color: TONE_VAR[tone] }}
            data-numeric
          >
            {value}
          </span>
          {unit && <span className="ds-text-2xs text-[var(--ink-muted)]">{unit}</span>}
        </div>
      )}

      {scope != null && (
        <div className="mt-0.5 ds-text-3xs text-[var(--ink-faint)]" data-scope>
          {scope}
        </div>
      )}

      {delta && !empty && (
        <div className="mt-1 flex items-baseline gap-1">
          <span
            className="ds-text-2xs tabular-nums"
            style={{ color: TONE_VAR[delta.tone] }}
            data-numeric
          >
            {delta.text}
          </span>
          {/* Словесный дубль цвета — не подпись «для галочки»,
              а единственное, что останется на чёрно-белой печати. */}
          <span className="ds-text-3xs text-[var(--ink-faint)]">{delta.meaning}</span>
        </div>
      )}

      {hint != null && <p className="mt-1 ds-text-3xs ds-prose text-[var(--ink-faint)]">{hint}</p>}
    </div>
  );
}
