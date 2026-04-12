import { useEffect, useCallback } from 'react';
import { useStore } from '../store';
import { X, CheckCircle2, Clock, XCircle, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';

const SIGNAL_COLORS: Record<string, { bg: string; text: string }> = {
  signed: { bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-400' },
  overdue: { bg: 'bg-red-50 dark:bg-red-950/30', text: 'text-red-700 dark:text-red-400' },
  epRisk: { bg: 'bg-orange-50 dark:bg-orange-950/30', text: 'text-orange-700 dark:text-orange-400' },
  planning: { bg: 'bg-blue-50 dark:bg-blue-950/30', text: 'text-blue-700 dark:text-blue-400' },
  highEconomy: { bg: 'bg-red-50 dark:bg-red-950/30', text: 'text-red-700 dark:text-red-400' },
  economyFlag: { bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-400' },
  dataQuality: { bg: 'bg-zinc-100 dark:bg-zinc-700/50', text: 'text-zinc-600 dark:text-zinc-400' },
  canceled: { bg: 'bg-zinc-100 dark:bg-zinc-700/50', text: 'text-zinc-500 dark:text-zinc-400' },
  earlyClosure: { bg: 'bg-amber-50 dark:bg-amber-950/30', text: 'text-amber-700 dark:text-amber-400' },
  factExceedsPlan: { bg: 'bg-red-50 dark:bg-red-950/30', text: 'text-red-700 dark:text-red-400' },
  stalledContract: { bg: 'bg-orange-50 dark:bg-orange-950/30', text: 'text-orange-700 dark:text-orange-400' },
  budgetMismatch: { bg: 'bg-purple-50 dark:bg-purple-950/30', text: 'text-purple-700 dark:text-purple-400' },
};

const SIGNAL_LABELS: Record<string, string> = {
  signed: 'Подписан',
  overdue: 'Просрочен',
  epRisk: 'ЕП-риск',
  planning: 'Планирование',
  highEconomy: 'Высокая экономия',
  economyFlag: 'Экономия',
  dataQuality: 'Качество',
  canceled: 'Отменён',
  earlyClosure: 'Раннее закрытие',
  factExceedsPlan: 'Факт > план',
  stalledContract: 'Подвисший',
  budgetMismatch: 'Расхождение бюджета',
};

interface RowDetailCardProps {
  row: {
    id: number | string;
    subject?: string;
    dept?: string;
    type?: string;
    method?: string;
    planSum?: number;
    factSum?: number;
    economy?: number;
    status?: string;
    signals?: string[];
    [key: string]: unknown;
  };
  onClose: () => void;
}

export function RowDetailCard({ row, onClose }: RowDetailCardProps) {
  const formatMoney = useStore(s => s.formatMoney);
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const planSum = row.planSum ?? 0;
  const factSum = row.factSum ?? 0;
  const economy = row.economy ?? 0;
  const economyPct = planSum > 0 ? ((economy / planSum) * 100) : 0;
  const executionPct = planSum > 0 ? Math.min((factSum / planSum) * 100, 100) : 0;
  const signals = row.signals ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-800 rounded-xl shadow-2xl max-w-lg w-full mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 dark:border-zinc-700/50">
          <div className="min-w-0">
            <div className="text-xs text-zinc-400 dark:text-zinc-500 mb-0.5">
              Строка #{row.id}
            </div>
            <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 truncate max-w-sm">
              {row.subject ?? 'Без предмета'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700 transition text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 flex-shrink-0 ml-3"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {/* Section: Идентификация */}
          <div>
            <h3 className="text-[10px] uppercase tracking-wider font-semibold text-zinc-400 dark:text-zinc-500 mb-2">
              Идентификация
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[10px] text-zinc-400 dark:text-zinc-500">Управление</div>
                <div className="text-sm font-medium text-zinc-700 dark:text-zinc-200">{row.dept ?? '—'}</div>
              </div>
              <div>
                <div className="text-[10px] text-zinc-400 dark:text-zinc-500">Способ</div>
                <div>
                  <span className={clsx(
                    'inline-block px-1.5 py-0.5 rounded text-[10px] font-bold',
                    row.method === 'ЕП'
                      ? 'bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400'
                      : 'bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400',
                  )}>
                    {row.method ?? '—'}
                  </span>
                </div>
              </div>
              <div>
                <div className="text-[10px] text-zinc-400 dark:text-zinc-500">Вид деятельности</div>
                <div className="text-sm font-medium text-zinc-700 dark:text-zinc-200">{row.type ?? '—'}</div>
              </div>
              <div>
                <div className="text-[10px] text-zinc-400 dark:text-zinc-500">Статус</div>
                <div>
                  {row.status ? (
                    <span className={clsx(
                      'inline-flex items-center gap-1 text-xs font-medium',
                      row.status === 'Подписан' && 'text-emerald-600 dark:text-emerald-400',
                      row.status === 'Отменён' && 'text-zinc-400 dark:text-zinc-500',
                      row.status === 'Планирование' && 'text-blue-600 dark:text-blue-400',
                      row.status === 'Исполнение' && 'text-amber-600 dark:text-amber-400',
                    )}>
                      {row.status === 'Подписан' && <CheckCircle2 size={13} />}
                      {row.status === 'Отменён' && <XCircle size={13} />}
                      {row.status === 'Планирование' && <Clock size={13} />}
                      {row.status}
                    </span>
                  ) : (
                    <span className="text-xs text-zinc-300 dark:text-zinc-600">Не указан</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Section: Бюджет */}
          <div>
            <h3 className="text-[10px] uppercase tracking-wider font-semibold text-zinc-400 dark:text-zinc-500 mb-2">
              Бюджет
            </h3>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div>
                <div className="text-[10px] text-zinc-400 dark:text-zinc-500">План, тыс.</div>
                <div className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 tabular-nums">
                  {formatMoney(planSum)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-zinc-400 dark:text-zinc-500">Факт</div>
                <div className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 tabular-nums">
                  {factSum > 0 ? formatMoney(factSum) : '—'}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-zinc-400 dark:text-zinc-500">Экономия</div>
                <div className="text-sm font-semibold tabular-nums">
                  {economy > 0 ? (
                    <span className="text-emerald-600 dark:text-emerald-400">
                      {formatMoney(economy)} <span className="text-[10px] font-normal">({economyPct.toFixed(1)}%)</span>
                    </span>
                  ) : (
                    <span className="text-zinc-300 dark:text-zinc-600">—</span>
                  )}
                </div>
              </div>
            </div>
            {/* Progress bar */}
            <div className="relative h-2 bg-zinc-100 dark:bg-zinc-700/50 rounded-full overflow-hidden">
              <div
                className={clsx(
                  'absolute inset-y-0 left-0 rounded-full transition-all',
                  executionPct >= 80 ? 'bg-emerald-500' : executionPct >= 50 ? 'bg-amber-500' : 'bg-red-500',
                )}
                style={{ width: `${executionPct}%` }}
              />
            </div>
            <div className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1">
              Исполнение: {executionPct.toFixed(1)}%
            </div>
          </div>

          {/* Section: Сигналы */}
          {signals.length > 0 && (
            <div>
              <h3 className="text-[10px] uppercase tracking-wider font-semibold text-zinc-400 dark:text-zinc-500 mb-2">
                Сигналы
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {signals.map((sig: string) => (
                  <span
                    key={sig}
                    className={clsx(
                      'px-2 py-1 rounded-lg text-xs font-medium',
                      SIGNAL_COLORS[sig]?.bg ?? 'bg-zinc-100 dark:bg-zinc-700/50',
                      SIGNAL_COLORS[sig]?.text ?? 'text-zinc-600 dark:text-zinc-400',
                    )}
                  >
                    {sig === 'epRisk' && <AlertTriangle size={11} className="inline mr-1 -mt-0.5" />}
                    {sig === 'overdue' && <Clock size={11} className="inline mr-1 -mt-0.5" />}
                    {sig === 'factExceedsPlan' && <AlertTriangle size={11} className="inline mr-1 -mt-0.5" />}
                    {SIGNAL_LABELS[sig] ?? sig}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
