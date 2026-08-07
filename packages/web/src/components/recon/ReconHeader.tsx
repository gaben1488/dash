// ── Шапка страницы «Сверка»: заголовок, выгрузка таблицы, переключатель видов.
//    Извлечено move-only из pages/Recon.tsx (разрез E11-4). Store не читает —
//    данные и колбэки приходят пропсами.
//
//    07.08.2026: подписи вычищены от внутреннего языка. Было «CSV» латиницей
//    (имя формата вместо действия) и «По метрикам»/«По подведам» — жаргон
//    разработчика и канцелярское сокращение. Формат файла остался в подсказке:
//    он важен тому, кто будет открывать файл, но кнопка называет действие.

import React from 'react';
import clsx from 'clsx';
import { Building2, Clock, Download, FileSpreadsheet, GitCompare, Users } from 'lucide-react';

export type ReconView = 'departments' | 'metrics' | 'monthly' | 'subordinates';

interface ReconHeaderProps {
  view: ReconView;
  onViewChange: (view: ReconView) => void;
  csvUrl: string;
}

const VIEW_BUTTONS: Array<{ view: ReconView; icon: typeof Building2; label: string; hint: string }> = [
  { view: 'departments', icon: Building2, label: 'По управлениям', hint: 'Годовые итоги плана и факта каждого управления' },
  { view: 'metrics', icon: FileSpreadsheet, label: 'По показателям', hint: 'Каждое официальное число листа СВОД против своего пересчёта' },
  { view: 'monthly', icon: Clock, label: 'Помесячно', hint: 'Сравнение по листу «СВОД с месяцами»' },
  { view: 'subordinates', icon: Users, label: 'По подведомственным', hint: 'План, факт и экономия каждой подведомственной организации' },
];

export function ReconHeader({ view, onViewChange, csvUrl }: ReconHeaderProps) {
  return (
    <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <GitCompare className="text-blue-500" size={22} />
          <div>
            {/* Заголовок казённый: латинское «vs» в русском документе недопустимо (канон §3 плана запуска). */}
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Сверка: СВОД против расчёта</h2>
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              Официальные числа листа СВОД ТД-ПМ сравниваются с независимым пересчётом по строкам
              листов управлений. Расхождение до 1 % считается совпадением.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <a
            href={csvUrl}
            download
            title="Скачать таблицу сверки файлом с разделителями (CSV) — открывается в Excel"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-600 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          >
            <Download size={13} aria-hidden="true" />
            Выгрузить таблицу
          </a>
          {/* Переключатель видов */}
          <div className="flex items-center bg-zinc-100 dark:bg-zinc-700/50 rounded-lg p-0.5" role="group" aria-label="Вид сверки">
            {VIEW_BUTTONS.map(({ view: v, icon: Icon, label, hint }) => (
              <button
                key={v}
                onClick={() => onViewChange(v)}
                aria-pressed={view === v}
                title={hint}
                className={clsx(
                  'px-3 py-1.5 rounded-md text-xs font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-500',
                  view === v
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200',
                )}
              >
                <Icon size={12} className="inline mr-1" aria-hidden="true" />{label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
