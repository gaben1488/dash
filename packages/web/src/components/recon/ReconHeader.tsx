// ── Шапка страницы «Сверка»: заголовок, CSV-экспорт, переключатель видов.
//    Извлечено move-only из pages/Recon.tsx (разрез E11-4). Store не читает —
//    данные и колбэки приходят пропсами.

import React from 'react';
import clsx from 'clsx';
import { Building2, Clock, Download, FileSpreadsheet, GitCompare, Users } from 'lucide-react';

export type ReconView = 'departments' | 'metrics' | 'monthly' | 'subordinates';

interface ReconHeaderProps {
  view: ReconView;
  onViewChange: (view: ReconView) => void;
  csvUrl: string;
}

const VIEW_BUTTONS: Array<{ view: ReconView; icon: typeof Building2; label: string }> = [
  { view: 'departments', icon: Building2, label: 'По управлениям' },
  { view: 'metrics', icon: FileSpreadsheet, label: 'По метрикам' },
  { view: 'monthly', icon: Clock, label: 'Помесячно (СВОД с месяцами)' },
  { view: 'subordinates', icon: Users, label: 'По подведам' },
];

export function ReconHeader({ view, onViewChange, csvUrl }: ReconHeaderProps) {
  return (
    <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <GitCompare className="text-blue-500" size={22} />
          <div>
            {/* Заголовок казённый: латинское «vs» в русском документе недопустимо (канон §3 плана запуска). */}
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Сверка: СВОД против расчёта</h2>
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              Сравнение официальных ячеек СВОД ТД-ПМ с построчным пересчётом по листам управлений.
              Допуск: 1%. Источник: Google Sheets API.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <a
            href={csvUrl}
            download
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-600 transition"
          >
            <Download size={13} />
            CSV
          </a>
          {/* View toggle */}
          <div className="flex items-center bg-zinc-100 dark:bg-zinc-700/50 rounded-lg p-0.5">
            {VIEW_BUTTONS.map(({ view: v, icon: Icon, label }) => (
              <button
                key={v}
                onClick={() => onViewChange(v)}
                className={clsx(
                  'px-3 py-1.5 rounded-md text-xs font-medium transition',
                  view === v
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700',
                )}
              >
                <Icon size={12} className="inline mr-1" />{label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
