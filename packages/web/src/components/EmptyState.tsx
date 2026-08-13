// ── Пустое состояние: единственный дом для «здесь ничего нет».
//
//    Правило продукта (PRODUCT.md, «Честная пустота»): пустой экран обязан
//    назвать ПРИЧИНУ, объяснить её и дать следующий шаг. Строка «Нет данных»
//    нарушает все три пункта разом — она не говорит, чего именно нет, отчего
//    так вышло и что теперь делать. Читатель не может отличить «сервер
//    молчит» от «в выбранной неделе действительно ни одной закупки», а это
//    разные новости с разными действиями.
//
//    Поэтому здесь:
//      • заголовок — утверждение о причине («Сервер не назвал ни одной
//        книги»), а не название пустоты;
//      • объяснение — одна фраза о том, отчего так вышло и что это значит;
//      • действие — кнопка, которая причину устраняет или обходит.
//
//    Числа компонент не придумывает и не показывает: пустота остаётся
//    пустотой, правдоподобный ноль вместо неё запрещён.

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, Inbox } from 'lucide-react';
import clsx from 'clsx';

/**
 * Тон пустоты. Это не украшение, а разные новости для читателя:
 *  • `neutral` — так и должно быть: запрос выполнен, показывать просто нечего;
 *  • `problem` — что-то не сработало, число или список потеряны.
 * Разница слышна и без цвета: `problem` объявляется диктором сразу
 * (role="alert"), нейтральная пустота — нет, чтобы не дёргать читателя.
 */
export type EmptyStateTone = 'neutral' | 'problem';

export interface EmptyStateAction {
  /** Подпись кнопки — глагол в повелительном наклонении: «Повторить запрос». */
  label: string;
  onClick?: () => void;
  /** Ссылка вместо обработчика (например, на книгу в Google Таблицах). */
  href?: string;
  /** Внешняя ссылка открывается в новой вкладке. */
  external?: boolean;
}

export interface EmptyStateProps {
  /**
   * Заголовок-причина. Утверждение о том, ЧТО произошло, а не ярлык пустоты.
   * Хорошо: «Список источников не получен». Плохо: «Нет данных».
   */
  title: string;
  /** Объяснение: отчего так вышло и что это значит для читателя. */
  description?: ReactNode;
  /** Главное действие — то, ради которого читатель сюда и смотрит. */
  action?: EmptyStateAction;
  /** Запасной путь, когда главный не сработает. */
  secondaryAction?: EmptyStateAction;
  /**
   * Техническая подробность (текст отказа от сервера или движка Google — он
   * английский). Живёт отдельной мелкой строкой, чтобы не мешаться в
   * объяснении, но и не пропадать: без неё разбор отказа невозможен.
   */
  detail?: string;
  icon?: LucideIcon;
  tone?: EmptyStateTone;
  /** `compact` — пустота внутри карточки или ячейки, `regular` — на весь раздел. */
  size?: 'compact' | 'regular';
  className?: string;
}

function ActionButton({ action, primary }: { action: EmptyStateAction; primary: boolean }) {
  const className = clsx(
    'inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500',
    primary
      ? 'text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800'
      : 'text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/30',
  );

  if (action.href) {
    return (
      <a
        href={action.href}
        className={className}
        {...(action.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        {action.label}
      </a>
    );
  }
  return (
    <button type="button" onClick={action.onClick} className={className}>
      {action.label}
    </button>
  );
}

export function EmptyState({
  title,
  description,
  action,
  secondaryAction,
  detail,
  icon,
  tone = 'neutral',
  size = 'regular',
  className,
}: EmptyStateProps) {
  // Иконка по умолчанию зависит от тона: сломанное и просто пустое не должны
  // выглядеть одинаково даже беглым взглядом.
  const Icon = icon ?? (tone === 'problem' ? AlertTriangle : Inbox);

  return (
    <div
      // Отказ объявляется диктором в момент появления — иначе о потере списка
      // узнают только зрячие читатели. Нейтральная пустота молчит: она часть
      // обычного хода дел, а не событие.
      role={tone === 'problem' ? 'alert' : undefined}
      className={clsx(
        'mx-auto flex max-w-md flex-col items-center text-center',
        size === 'compact' ? 'py-6' : 'py-12',
        className,
      )}
    >
      <Icon
        size={size === 'compact' ? 18 : 22}
        className={clsx('mb-3', tone === 'problem' ? 'text-red-500' : 'text-zinc-400 dark:text-zinc-500')}
        aria-hidden="true"
      />
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">{title}</p>
      {description && (
        <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{description}</p>
      )}
      {detail && (
        <p className="mt-2 break-all text-[10px] leading-relaxed text-zinc-400 dark:text-zinc-500">
          Подробность отказа: {detail}
        </p>
      )}
      {(action || secondaryAction) && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {action && <ActionButton action={action} primary />}
          {secondaryAction && <ActionButton action={secondaryAction} primary={false} />}
        </div>
      )}
    </div>
  );
}
