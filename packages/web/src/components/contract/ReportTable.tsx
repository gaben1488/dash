/**
 * ReportTable — каноническая таблица Page Contract.
 *
 * Обязательный source (бейдж происхождения рендерится в шапке таблицы),
 * колонки приходят готовыми подписями от маппера (канон-словарь — на стороне
 * вызывающего через productLabel). Стиль — таблицы Аналитики (text-[11px],
 * uppercase-шапка), горизонтальный скролл на узких экранах.
 */
import type { ReactNode } from 'react';
import { SourceBadge } from './SourceBadge';
import type { PageElementProps } from './types';

export interface ReportTableColumn {
  key: string;
  label: string;
  align?: 'left' | 'right';
}

export interface ReportTableProps extends PageElementProps {
  columns: readonly ReportTableColumn[];
  /** Строки: ключ колонки → готовая ячейка (текст или контрактный элемент) */
  rows: ReadonlyArray<Readonly<Record<string, ReactNode>>>;
  /** Подпись-скоуп над таблицей («Способы · Q1», «Сверка со СВОД») */
  caption?: string;
}

export function ReportTable({ columns, rows, caption, source }: ReportTableProps) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        {caption && (
          <span className="text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{caption}</span>
        )}
        <SourceBadge source={source} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-[10px] uppercase text-zinc-400 border-b border-zinc-100 dark:border-zinc-700/50">
              {columns.map((c) => (
                <th key={c.key} className={`py-1.5 pr-3 font-medium ${c.align === 'right' ? 'text-right' : ''}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-zinc-50 dark:border-zinc-800/50">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`py-1.5 pr-3 text-zinc-600 dark:text-zinc-300 ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}
                  >
                    {row[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
