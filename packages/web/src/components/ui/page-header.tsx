// ── Шапка вкладки: единственный дом заголовка первого уровня.
//
//    Аудит 18.08 показал две вещи. Первая: заголовок первого уровня стоял
//    ровно на четырёх вкладках из шестнадцати — на остальных читатель,
//    работающий с диктором, попадал в раздел без имени и не мог понять,
//    куда именно он попал. Вторая: там, где заголовок был, он был набран
//    вручную одинаковой строкой классов, скопированной из файла в файл, —
//    четыре независимых копии одного решения.
//
//    Здесь шапка одна и несёт три обязательные части:
//      • имя вкладки (h1) — единственный первый уровень на экране;
//      • одна фраза о том, на какой вопрос вкладка отвечает: не пересказ
//        содержимого, а объяснение механизма (тон продукта — объяснение,
//        не упрёк);
//      • скоуп и управление справа: период, режим, ссылка на источник.

import type { ReactNode } from 'react';
import clsx from 'clsx';

export interface PageHeaderProps {
  /** Имя вкладки ровно так, как оно написано в полосе навигации. */
  title: string;
  /** На какой вопрос отвечает вкладка. Одна-две фразы, не больше. */
  lead?: ReactNode;
  /** Период, момент чтения, режим — то, что относится ко всей вкладке. */
  scope?: ReactNode;
  /** Управление справа: переключатели, ссылка на книгу-источник. */
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, lead, scope, actions, className }: PageHeaderProps) {
  return (
    <header className={clsx('flex flex-wrap items-start justify-between gap-[var(--space-3)]', className)}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-[var(--space-2)] gap-y-1">
          <h1 className="ds-text-xl font-[var(--weight-strong)] text-[var(--ink-strong)]">{title}</h1>
          {scope != null && (
            <span className="ds-text-2xs text-[var(--ink-faint)]" data-scope>
              {scope}
            </span>
          )}
        </div>
        {lead != null && <p className="ds-text-sm ds-prose mt-1 text-[var(--ink-muted)]">{lead}</p>}
      </div>
      {actions != null && (
        <div className="flex shrink-0 flex-wrap items-center gap-[var(--space-2)]">{actions}</div>
      )}
    </header>
  );
}
