/**
 * Каноническая карточка-секция Page Contract.
 *
 * Обёртка в стиле AnalyticsCard (Analytics.tsx): заголовок, опциональная
 * иконка, обязательный SourceBadge, сворачивание. Отличие от прототипа —
 * контракт: filterCtx и source обязательны по типу (PageElementProps).
 */
import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react';
import { SourceBadge } from './SourceBadge';
import type { PageElementProps } from './types';

export interface SectionCardProps extends PageElementProps {
  title: string;
  icon?: LucideIcon;
  /** false → секция всегда развёрнута, без кнопки-тоггла */
  collapsible?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function SectionCard({ title, icon: Icon, source, collapsible = true, defaultOpen = true, children }: SectionCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const header = (
    <>
      {Icon && <Icon size={15} className="text-zinc-400 dark:text-zinc-500 group-hover:text-blue-500 transition-colors" />}
      <h3 className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-200 flex-1 text-left">{title}</h3>
      <SourceBadge source={source} />
    </>
  );
  return (
    <div className="analytics-chart-card group">
      {collapsible ? (
        <button
          onClick={() => setOpen(!open)}
          className="w-full flex items-center gap-2 px-5 py-3 text-left hover:bg-zinc-50/30 dark:hover:bg-zinc-700/10 transition-colors"
        >
          {header}
          {open
            ? <ChevronDown size={14} className="text-zinc-400" />
            : <ChevronRight size={14} className="text-zinc-400" />}
        </button>
      ) : (
        <div className="w-full flex items-center gap-2 px-5 py-3">{header}</div>
      )}
      {(open || !collapsible) && <div className="px-5 pb-5">{children}</div>}
    </div>
  );
}
