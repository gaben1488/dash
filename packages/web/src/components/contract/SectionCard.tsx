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
import { perimeterBadge, perimeterHint, type Perimeter } from '../../lib/perimeter';
import type { PageElementProps } from './types';

export interface SectionCardProps extends PageElementProps {
  title: string;
  icon?: LucideIcon;
  /** false → секция всегда развёрнута, без кнопки-тоггла */
  collapsible?: boolean;
  defaultOpen?: boolean;
  /**
   * Паспорт периметра секции (канон п.58): год, период, органы, срез, момент
   * чтения — собранные ИЗ ДАННЫХ карточки, а не унаследованные от шапки.
   * Строит его `lib/report/perimeter`, подпись — единственный на систему
   * `perimeterLabel`/`perimeterBadge`. Без паспорта карточка показывает лишь
   * происхождение числа, и читателю приходится достраивать период самому —
   * ровно та болезнь, ради которой правило (а) и написано.
   */
  perimeter?: Perimeter;
  children: ReactNode;
}

export function SectionCard({ title, icon: Icon, source, collapsible = true, defaultOpen = true, perimeter, children }: SectionCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const header = (
    <>
      {Icon && <Icon size={15} className="text-zinc-400 dark:text-zinc-500 group-hover:text-blue-500 transition-colors" />}
      <div className="flex-1 min-w-0 text-left">
        <h3 className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-200">{title}</h3>
        {perimeter && (
          // Пометки о неподчинении показываются ЗДЕСЬ, а не только в подсказке:
          // всплывающая подсказка с пальца недоступна, и правило (ж) требует
          // назвать неприменимую ось вслух, а не спрятать её в title.
          <p
            className="mt-0.5 text-[10px] leading-snug text-zinc-400 dark:text-zinc-500"
            title={perimeterHint(perimeter)}
          >
            {perimeterBadge(perimeter)}
            {perimeter.notes.length > 0 && (
              <span className="text-amber-600 dark:text-amber-400">
                {' · '}{perimeter.notes.join('; ')}
              </span>
            )}
          </p>
        )}
      </div>
      <SourceBadge source={source} />
    </>
  );
  return (
    <div className="analytics-chart-card group">
      {collapsible ? (
        <button
          onClick={() => setOpen(!open)}
          className="w-full flex items-start gap-2 px-5 py-3 text-left hover:bg-zinc-50/30 dark:hover:bg-zinc-700/10 transition-colors"
        >
          {header}
          {open
            ? <ChevronDown size={14} className="mt-0.5 shrink-0 text-zinc-400" />
            : <ChevronRight size={14} className="mt-0.5 shrink-0 text-zinc-400" />}
        </button>
      ) : (
        <div className="w-full flex items-start gap-2 px-5 py-3">{header}</div>
      )}
      {(open || !collapsible) && <div className="px-5 pb-5">{children}</div>}
    </div>
  );
}
