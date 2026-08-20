// ── Шторка снизу: подробность строки на узком экране.
//
//    ЧТО ВЗЯТО ГОТОВЫМ (канон п.112). `@radix-ui/react-dialog`, который в
//    проекте уже стоит. Он даёт всё тяжёлое и незаметное: ловушку фокуса
//    внутри шторки, возврат фокуса на то место, откуда её открыли,
//    закрытие по Esc, `aria-modal` и скрытие остального содержимого от
//    диктора, блокировку прокрутки страницы под шторкой без скачка
//    вёрстки от исчезнувшей полосы прокрутки.
//
//    ПОЧЕМУ НЕ `vaul` — готовая шторка, которую в этом месте берут все.
//    Автор объявил проект несопровождаемым: в описании репозитория
//    дословно «This repo is unmaintained», последняя правка 03.10.2025,
//    выпуска нет двадцать месяцев, открытых вопросов около 160. В
//    продукте государственного заказчика мёртвая зависимость — это не
//    экономия времени, а отложенный отказ. Причина названа здесь, как
//    требует п.112: готовое не подошло по живости, поэтому взят слой
//    ниже (диалог Radix) и надстроен движением по вертикали.
//
//    ЧТО НАДСТРОЕНО (канон п.114) поверх диалога:
//
//    1. ДВИЖЕНИЕ ПО ВЕРТИКАЛИ. Диалог Radix появляется по центру; шторка
//       выезжает снизу, потому что на телефоне низ экрана — единственное
//       место, куда дотягивается большой палец.
//    2. СМАХИВАНИЕ ВНИЗ. Шторка без смахивания на телефоне читается как
//       сломанная: читатель тянет её вниз, ничего не происходит, и он
//       ищет крестик. Здесь потяг за ручку двигает шторку, а отпускание
//       ниже трети высоты закрывает её.
//    3. ВЫСОТА ОГРАНИЧЕНА. Не больше девяти десятых экрана: под шторкой
//       обязана остаться видимая полоса того, из чего её открыли, —
//       иначе читатель теряет место, к которому относится подробность.
//    4. ЗАГОЛОВОК ОБЯЗАТЕЛЕН. Шторка без имени для диктора — это
//       «диалог», и по нему нельзя понять, о какой строке речь. Поле
//       `title` не необязательное.
//
//    Уважение к системной настройке «уменьшить движение» приходит общим
//    правилом `index.css`: там длительность переходов и проявлений
//    сводится к одной миллисекунде, и шторка просто появляется на месте.

import { useCallback, useRef, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import clsx from 'clsx';

/** Ниже этого смещения шторка возвращается на место, выше — закрывается. */
const DISMISS_AFTER_PX = 96;

export interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Имя шторки. Обязательно: диктор читает его первым. */
  title: string;
  /** Одна фраза о том, что внутри. Уезжает диктору как описание. */
  description?: string;
  children: ReactNode;
  /** Управление в подвале шторки: главное действие и отмена. */
  footer?: ReactNode;
  className?: string;
}

export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: DrawerProps) {
  const [dragY, setDragY] = useState(0);
  const startY = useRef<number | null>(null);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    startY.current = event.clientY;
    // Захват указателя: палец может уйти за пределы ручки, и без захвата
    // движение оборвётся на середине.
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (startY.current === null) return;
    // Вверх шторка не тянется: она уже наверху своего хода, и резиновое
    // растяжение вверх выглядело бы как сбой отрисовки.
    setDragY(Math.max(0, event.clientY - startY.current));
  }, []);

  const onPointerUp = useCallback(() => {
    if (startY.current === null) return;
    const travelled = dragY;
    startY.current = null;
    setDragY(0);
    if (travelled > DISMISS_AFTER_PX) onOpenChange(false);
  }, [dragY, onOpenChange]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={clsx(
            'fixed inset-0 z-50 bg-black/40',
            'data-[state=open]:animate-[fadeIn_var(--dur-base)_var(--ease-out)]',
          )}
        />
        <Dialog.Content
          // Описание у шторки необязательно намеренно: у списка полей
          // описывать нечего сверх заголовка. Radix в этом случае
          // предупреждает о забытой связи `aria-describedby` — здесь она
          // не забыта, а не нужна, поэтому снимается явно. Когда описание
          // есть, свойство НЕ передаётся вовсе, иначе оно перебило бы
          // связь, которую Radix проставляет сам.
          {...(description ? {} : { 'aria-describedby': undefined })}
          className={clsx(
            'fixed inset-x-0 bottom-0 z-50 flex max-h-[90vh] flex-col',
            'rounded-t-[var(--radius-modal)] border-t border-[var(--line-strong)]',
            'bg-[var(--surface-overlay)] shadow-[var(--elevation-3)]',
            'data-[state=open]:animate-[sheetIn_var(--dur-base)_var(--ease-out)]',
            className,
          )}
          style={{
            // Пока палец держит шторку, движение идёт мгновенно за ним;
            // после отпускания она возвращается на место с обычной
            // длительностью. Переход объявлен только на смещение —
            // `transition-all` анимировал бы и высоту тоже.
            transform: dragY ? `translateY(${dragY}px)` : undefined,
            transition: startY.current === null ? 'transform var(--dur-fast) var(--ease-out)' : 'none',
          }}
        >
          {/* Ручка. Она же — область потяга: тянуть за весь заголовок
              нельзя, иначе не выделить текст внутри шторки. */}
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className="flex shrink-0 cursor-grab touch-none justify-center py-[var(--space-2)] active:cursor-grabbing"
          >
            <span aria-hidden="true" className="h-1 w-10 rounded-full bg-[var(--line-strong)]" />
          </div>

          <div className="flex shrink-0 items-start justify-between gap-[var(--space-3)] px-[var(--space-4)] pb-[var(--space-2)]">
            <div className="min-w-0">
              <Dialog.Title className="ds-text-sm font-[var(--weight-strong)] text-[var(--ink-strong)]">
                {title}
              </Dialog.Title>
              {description && (
                <Dialog.Description className="ds-text-2xs ds-prose mt-1 text-[var(--ink-muted)]">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close
              aria-label="Закрыть"
              className={clsx(
                'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-badge)]',
                'text-[var(--ink-muted)] transition-colors [transition-duration:var(--dur-fast)]',
                'hover:bg-[var(--surface-raised)] hover:text-[var(--ink-strong)]',
              )}
            >
              <X size={16} aria-hidden="true" />
            </Dialog.Close>
          </div>

          {/* Содержимое прокручивается внутри шторки, а не тянет за собой
              страницу под ней. */}
          <div className="min-h-0 flex-1 overflow-y-auto px-[var(--space-4)] pb-[var(--space-4)]">
            {children}
          </div>

          {footer && (
            <div className="shrink-0 border-t border-[var(--line-soft)] px-[var(--space-4)] py-[var(--space-3)]">
              {footer}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
