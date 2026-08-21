// ── Карточка: единственный дом поверхности.
//
//    До этого поверхность собиралась на месте — `bg-white dark:bg-zinc-900
//    border border-zinc-200 dark:border-transparent rounded-xl p-4` и десяток
//    её вариаций по страницам. Разъезжалось всё: у одной карточки скругление
//    12, у соседней 8; у одной граница zinc-200, у другой zinc-100; в тёмной
//    теме половина карточек оказывалась светлее фона, половина темнее.
//
//    Здесь карточка знает про роли (`--surface-card`, `--line-strong`,
//    `--card-pad`), поэтому обе темы правятся в одном месте, а плотность
//    переключается снаружи без единой правки разметки.
//
//    Запрет из DESIGN.md: карточка в карточке. Вложенная поверхность даёт
//    третью границу подряд и съедает ширину; внутренний блок разделяется
//    линией (`CardDivider`), а не второй рамкой. Запрет — не комментарий:
//    вложенная карточка автоматически рисуется плоской.

import { createContext, useContext, type ReactNode } from 'react';
import clsx from 'clsx';

const InsideCard = createContext(false);

export interface CardProps {
  children: ReactNode;
  /**
   * `raised` — карточка, на которую смотрят (главный блок экрана);
   * `flat` — блок внутри уже существующей поверхности, без тени;
   * `sunken` — утопленная подложка для перечня внутри карточки.
   */
  tone?: 'raised' | 'flat' | 'sunken';
  /** Убрать внутренний отступ: таблица прижимается к краю карточки. */
  bare?: boolean;
  className?: string;
  /** Подпись для диктора, когда карточка — самостоятельный раздел. */
  'aria-label'?: string;
}

export function Card({ children, tone = 'raised', bare = false, className, ...rest }: CardProps) {
  const nested = useContext(InsideCard);
  // Вложенная карточка теряет тень и рамку сама — не полагаясь на то,
  // что автор страницы вспомнит про запрет.
  const effective = nested && tone === 'raised' ? 'flat' : tone;

  return (
    <InsideCard.Provider value={true}>
      <div
        {...rest}
        className={clsx(
          'rounded-[var(--radius-card)] border',
          effective === 'sunken'
            ? 'bg-[var(--surface-sunken)] border-[var(--line-soft)]'
            : 'bg-[var(--surface-card)] border-[var(--line-strong)]',
          effective === 'raised' && 'shadow-[var(--elevation-1)]',
          !bare && 'p-[var(--card-pad)]',
          className,
        )}
      >
        {children}
      </div>
    </InsideCard.Provider>
  );
}

export interface CardHeaderProps {
  /** Заголовок — о чём этот блок. Существительное, не глагол. */
  title: ReactNode;
  /**
   * Скоуп числа: «2026 · год», «1 кв», «на 18.08». Канон п.58 — у каждого
   * числа есть момент чтения, и он стоит рядом с числом, а не в подвале.
   */
  scope?: ReactNode;
  /** Одна фраза о том, что здесь показано и откуда взято. */
  note?: ReactNode;
  /** Управление справа: переключатель, ссылка на источник. */
  actions?: ReactNode;
  className?: string;
}

export function CardHeader({ title, scope, note, actions, className }: CardHeaderProps) {
  return (
    <div className={clsx('mb-[var(--space-3)] flex items-start justify-between gap-[var(--space-3)]', className)}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-[var(--space-2)] gap-y-1">
          <h3 className="ds-text-sm font-[var(--weight-strong)] text-[var(--ink-strong)]">{title}</h3>
          {scope != null && (
            <span className="ds-text-3xs text-[var(--ink-faint)]" data-scope>
              {scope}
            </span>
          )}
        </div>
        {note != null && <p className="ds-text-2xs ds-prose mt-1 text-[var(--ink-muted)]">{note}</p>}
      </div>
      {actions != null && <div className="flex shrink-0 items-center gap-[var(--space-1)]">{actions}</div>}
    </div>
  );
}

/** Разделитель вместо второй рамки: карточка в карточке запрещена. */
export function CardDivider({ className }: { className?: string }) {
  return <hr className={clsx('my-[var(--space-3)] border-0 border-t border-[var(--line-soft)]', className)} />;
}

export function CardFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={clsx(
        'mt-[var(--space-3)] border-t border-[var(--line-soft)] pt-[var(--space-2)] ds-text-3xs text-[var(--ink-faint)]',
        className,
      )}
    >
      {children}
    </div>
  );
}
