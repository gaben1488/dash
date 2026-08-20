// ── Переключатель режима: один из нескольких, все видны сразу.
//
//    ЧТО ВЗЯТО ГОТОВЫМ (канон п.112). Самое готовое из всего, что есть, —
//    это сама платформа: группа `input[type=radio]` внутри `fieldset` с
//    `legend`. Браузер бесплатно даёт то, ради чего библиотеки пишут по
//    двести строк: переход стрелками внутри группы, выход табуляцией сразу
//    за группу, объявление диктором «переключатель, 2 из 3», работу без
//    JavaScript и правильное поведение в режиме высокой контрастности.
//    Готовые наборы (Radix ToggleGroup, react-aria) в этом месте дали бы
//    ровно то же самое ценой ещё одной зависимости — поэтому не взяты, и
//    причина названа здесь, как требует п.112.
//
//    ЧТО НАДСТРОЕНО (канон п.114). Радиогруппа знает про выбор, но не знает
//    про наш продукт:
//
//    1. У режима есть последствие, и его надо назвать. Переключая «рубли /
//       тысячи», читатель меняет не оформление, а ЕДИНИЦУ, в которой он
//       потом прочтёт все числа на экране; ошибка здесь стоит трёх
//       порядков. Поэтому у варианта есть `hint` — фраза о том, что
//       изменится, и она уезжает в `title` и в описание для диктора.
//    2. Ширина не пляшет. Выбранный вариант в готовых наборах обычно
//       становится жирным — и вся полоса дёргается на пиксель при каждом
//       переключении. Здесь вес не меняется: выбранное держится заливкой
//       акцента, а не жиром.
//    3. Выбор слышен, а не только виден: состояние несёт сам `checked`
//       радиокнопки, заливка — только его отражение.

import { useId, type ReactNode } from 'react';
import clsx from 'clsx';

export interface SegmentedOption<V extends string> {
  value: V;
  /** Подпись на кнопке. Короткая: «Рубли», «Тысячи». */
  label: ReactNode;
  /**
   * Что изменится, если выбрать. Не пересказ подписи, а последствие:
   * «все суммы на вкладке читаются в рублях». Обязателен — режим без
   * названного последствия читатель выбирает наугад.
   */
  hint: string;
  /** Вариант недоступен — например, шкала, которой в источнике нет. */
  disabled?: boolean;
}

export interface SegmentedProps<V extends string> {
  /** Что переключаем. Видимая подпись группы либо только для диктора. */
  legend: string;
  /** Спрятать подпись группы визуально, оставив её диктору. */
  legendHidden?: boolean;
  options: readonly SegmentedOption<V>[];
  value: V;
  onChange: (next: V) => void;
  className?: string;
}

export function Segmented<V extends string>({
  legend,
  legendHidden = true,
  options,
  value,
  onChange,
  className,
}: SegmentedProps<V>) {
  const name = useId();

  return (
    <fieldset className={clsx('min-w-0', className)}>
      <legend
        className={clsx(
          legendHidden ? 'sr-only' : 'mb-1 ds-text-3xs text-[var(--ink-muted)]',
        )}
      >
        {legend}
      </legend>
      <div
        className={clsx(
          'inline-flex items-center gap-0.5 rounded-[var(--radius-badge)] p-0.5',
          'border border-[var(--line-strong)] bg-[var(--surface-sunken)]',
        )}
      >
        {options.map((option) => {
          const chosen = option.value === value;
          const optionId = `${name}-${option.value}`;
          return (
            <label
              key={option.value}
              htmlFor={optionId}
              title={option.hint}
              className={clsx(
                'relative inline-flex cursor-pointer select-none items-center justify-center',
                // Высота держится токеном строки, а не числом: в просторном
                // режиме переключатель растёт вместе со всем остальным.
                'h-7 rounded-[calc(var(--radius-badge)-1px)] px-[var(--space-3)] ds-text-2xs',
                'transition-colors [transition-duration:var(--dur-fast)] [transition-timing-function:var(--ease-standard)]',
                option.disabled && 'cursor-not-allowed opacity-40',
                chosen
                  ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                  : 'text-[var(--ink-muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--ink-strong)]',
              )}
            >
              {/* Радиокнопка настоящая, а не нарисованная: перемещение
                  стрелками, объявление диктором и работа в режиме высокой
                  контрастности достаются даром. Спрятана она `sr-only`, а
                  не `display:none` — скрытая через display радиокнопка
                  выпадает из порядка обхода и перестаёт существовать. */}
              <input
                id={optionId}
                type="radio"
                name={name}
                value={option.value}
                checked={chosen}
                disabled={option.disabled}
                onChange={() => onChange(option.value)}
                className="sr-only"
                aria-describedby={`${optionId}-hint`}
              />
              {option.label}
              <span id={`${optionId}-hint`} className="sr-only">
                {option.hint}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
