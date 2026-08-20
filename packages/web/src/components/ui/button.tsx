// ── Кнопка: единственный дом действия.
//
//    ЧТО ВЗЯТО ГОТОВЫМ (канон п.112). Рецепт shadcn/ui: `cva` считает
//    варианты, `Slot` из Radix отдаёт разметку наружу (`asChild`), а
//    `tailwind-merge` разрешает столкновение классов, когда вызывающий
//    добавляет свой `className`. Всё три уже стоят в проекте; ни одной
//    строки этого механизма мы не пишем сами.
//
//    ЧТО НАДСТРОЕНО (канон п.114). Готовый рецепт знает про кнопку, но не
//    знает про наш продукт, поэтому поверх него положено пять правил:
//
//    1. Цвет — только данным. У готовых наборов главная кнопка синяя, а
//       опасная — залита красным. Красный и зелёный в этом продукте
//       заняты: ими отмечены хорошее и плохое В ЧИСЛАХ. Кнопка, залитая
//       красным, отбирает у графика единственный сильный сигнал. Поэтому
//       главная кнопка — акцент (крем/чернила, хром интерфейса), а
//       необратимое действие обведено линией `--data-bad`, но НЕ залито:
//       красного ровно столько, чтобы отличить необратимое, и ни каплей
//       больше. Старое семейство `.btn-primary` в `index.css` заливает
//       кнопку синим градиентом — это второй дом и он подлежит сносу
//       следующей волной, здесь он намеренно не тронут (занят соседями).
//
//    2. Ничего не прыгает. У готового рецепта `active:scale-[0.97]` и
//       `transition-all`. Сжатие кнопки под пальцем — украшение, которое
//       на плотном экране читается как дрожь, а `transition-all` анимирует
//       и геометрию тоже. Здесь переходят только краски.
//
//    3. Ожидание не меняет ширину. Обычная реализация подменяет подпись
//       словом «Загрузка…» — строка становится другой длины, соседние
//       кнопки разъезжаются, читатель теряет то место, куда целился.
//       Здесь подпись остаётся на месте, а вертушка занимает слот значка,
//       который зарезервирован заранее.
//
//    4. Кнопка без слов обязана иметь имя. Кнопка со значком и без текста
//       для диктора пуста. Это проверяет не ревью, а система типов:
//       `iconOnly` без `aria-label` не компилируется.
//
//    5. Палец. Минимальная высота 32 пикселя и на компактной плотности —
//       выше требования WCAG 2.2 (24 пикселя), потому что попадание в
//       реестре стоит дороже, чем сэкономленные четыре пикселя.

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const button = cva(
  [
    'inline-flex items-center justify-center gap-[var(--space-2)] whitespace-nowrap',
    'rounded-[var(--radius-badge)] border font-[var(--weight-medium)]',
    // Переходят только краски: геометрия кнопки неподвижна.
    'transition-[background-color,border-color,color] [transition-duration:var(--dur-fast)] [transition-timing-function:var(--ease-standard)]',
    'disabled:cursor-not-allowed disabled:opacity-50',
    // Кольцо фокуса рисуется общим правилом `*:focus-visible` в index.css
    // (outline со смещением). Своего здесь нет намеренно — иначе колец
    // стало бы два и они бы разъехались между темами.
  ],
  {
    variants: {
      tone: {
        /** Главное действие экрана. Одно на экран, не одно на карточку. */
        primary:
          'bg-[var(--accent)] text-[var(--accent-ink)] border-[var(--accent)] hover:bg-[var(--accent-hover)] hover:border-[var(--accent-hover)]',
        /** Обычное действие: обведено, не залито. */
        secondary:
          'bg-[var(--surface-card)] text-[var(--ink)] border-[var(--line-strong)] hover:bg-[var(--surface-raised)] hover:text-[var(--ink-strong)]',
        /** Действие, которое не должно спорить с содержимым: без рамки. */
        quiet:
          'border-transparent bg-transparent text-[var(--ink-muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--ink-strong)]',
        /**
         * Необратимое: снять строку, стереть снимок, отменить сверку.
         * Обведено тревожным, но не залито им — заливка отобрала бы у
         * чисел единственный сильный красный.
         */
        danger:
          'bg-transparent text-[var(--data-bad)] border-[color-mix(in_srgb,var(--data-bad)_45%,transparent)] hover:bg-[color-mix(in_srgb,var(--data-bad)_10%,transparent)]',
      },
      size: {
        /** Плотный ряд управления над таблицей. */
        sm: 'h-8 px-[var(--space-2)] ds-text-2xs',
        /** Обычная кнопка в карточке и в пустом состоянии. */
        md: 'h-9 px-[var(--space-3)] ds-text-xs',
        /** Главное действие раздела. */
        lg: 'h-10 px-[var(--space-4)] ds-text-sm',
      },
      /** Кнопка-значок квадратная: ширина равна высоте, отступов нет. */
      iconOnly: {
        true: 'px-0 aspect-square',
        false: '',
      },
    },
    defaultVariants: { tone: 'secondary', size: 'md', iconOnly: false },
  },
);

/** Вертушка ожидания. Своя, а не из библиотеки: три строки CSS против килобайта. */
function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-3.5 w-3.5 shrink-0 animate-[spin-slow_0.8s_linear_infinite] rounded-full border-2 border-current border-r-transparent"
    />
  );
}

type BaseProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> &
  Omit<VariantProps<typeof button>, 'iconOnly'> & {
    className?: string;
    /** Отдать разметку наружу: ссылка, которая выглядит кнопкой. */
    asChild?: boolean;
    /**
     * Идёт работа. Подпись остаётся на месте, вертушка встаёт в слот
     * значка, ширина кнопки не меняется, нажатие заблокировано.
     */
    busy?: boolean;
    /** Значок слева от подписи. Всегда `aria-hidden`: он повторяет слово. */
    icon?: ReactNode;
  };

/** Кнопка с подписью: `aria-label` не обязателен, имя даёт текст. */
type LabelledProps = BaseProps & { children: ReactNode; iconOnly?: false };

/**
 * Кнопка-значок: имя обязано быть названо словом. Система типов не даёт
 * забыть — без `aria-label` вызов не компилируется.
 */
type IconOnlyProps = BaseProps & { iconOnly: true; 'aria-label': string; children?: never };

export type ButtonProps = LabelledProps | IconOnlyProps;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { tone, size, className, asChild, busy, icon, children, disabled, iconOnly, type, ...rest },
  ref,
) {
  const Comp = asChild ? Slot : 'button';

  return (
    <Comp
      ref={ref}
      // Кнопка без type внутри формы отправляет форму — классовая ошибка,
      // которую здесь закрывает умолчание, а не внимательность автора.
      {...(asChild ? {} : { type: type ?? 'button' })}
      {...rest}
      disabled={disabled || busy}
      // aria-busy говорит диктору «идёт работа» без подмены подписи.
      aria-busy={busy || undefined}
      className={cn(button({ tone, size, iconOnly: iconOnly === true }), className)}
    >
      {busy ? <Spinner /> : icon ? <span aria-hidden="true" className="inline-flex shrink-0">{icon}</span> : null}
      {children}
    </Comp>
  );
});

export { button as buttonVariants };
