// ── Таблица сверки «По метрикам»: бейджи-саммари, таблица метрик с deep-link
//    на ячейку СВОД и раскрывающейся рекомендацией.
//    Извлечено move-only из pages/Recon.tsx (разрез E11-4). Store не читает.

import React from 'react';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Clock, ExternalLink, FileSpreadsheet, Info } from 'lucide-react';
import { SVOD_SPREADSHEET_ID } from '@aemr/shared';
import type { MetricAssessment, MetricReconRow, ReconMetricDelta } from '../../lib/recon/types';
import { fmtNum, fmtPct, isZero } from '../../lib/recon/format';
import { buildSheetUrl } from '../../lib/recon/sheet-links';

const METRIC_ASSESS_CONFIG: Record<MetricAssessment, { label: string; bg: string; text: string; icon: typeof CheckCircle2 }> = {
  ok:       { label: 'Совпадает',    bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-400', icon: CheckCircle2 },
  warning:  { label: 'Допустимо',    bg: 'bg-amber-50 dark:bg-amber-950/30',     text: 'text-amber-700 dark:text-amber-400',     icon: Clock },
  critical: { label: 'Расхождение',  bg: 'bg-red-50 dark:bg-red-950/30',         text: 'text-red-700 dark:text-red-400',         icon: AlertTriangle },
};

interface ReconMetricTableProps {
  rows: MetricReconRow[];
  /** Отфильтрованные по периоду дельты — для поиска sourceCell метрики */
  deltas: ReconMetricDelta[];
  counts: { ok: number; warning: number; critical: number };
  expandedMetric: string | null;
  onToggleMetric: (metric: string | null) => void;
}

export function ReconMetricTable({ rows, deltas, counts, expandedMetric, onToggleMetric }: ReconMetricTableProps) {
  return (
    <>
      {/* Summary badges */}
      <div className="flex gap-3 text-xs">
        <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 font-medium">
          <CheckCircle2 size={13} /> {counts.ok} совпадает
        </span>
        <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 font-medium">
          <Clock size={13} /> {counts.warning} допустимо
        </span>
        <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 font-medium">
          <AlertTriangle size={13} /> {counts.critical} расхождение
        </span>
      </div>

      {/* Metric table */}
      <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-50 dark:bg-zinc-900/50 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                <th className="px-5 py-3">Метрика</th>
                <th className="px-4 py-3 text-right">СВОД (офиц.)</th>
                <th className="px-4 py-3 text-right">Расчёт</th>
                <th className="px-4 py-3 text-right">Δ абс.</th>
                <th className="px-4 py-3 text-right">Δ %</th>
                <th className="px-4 py-3 text-center">Оценка</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
              {rows.map((row) => {
                const cfg = METRIC_ASSESS_CONFIG[row.assessment];
                const Icon = cfg.icon;
                const isExpanded = expandedMetric === row.metric;
                const delta = deltas.find((d) => d.metricKey === row.metric);
                return (
                  <React.Fragment key={row.metric}>
                    <tr
                      className={clsx(
                        'transition cursor-pointer',
                        row.assessment === 'critical' && 'bg-red-50/30 dark:bg-red-950/20',
                        row.assessment === 'warning' && 'bg-amber-50/20 dark:bg-amber-950/15',
                        isExpanded ? 'bg-blue-50/30 dark:bg-blue-950/20' : 'hover:bg-zinc-50 dark:hover:bg-zinc-700/30',
                      )}
                      onClick={() => onToggleMetric(isExpanded ? null : row.metric)}
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="font-medium text-zinc-700 dark:text-zinc-200">{row.metricLabel}</div>
                          {isExpanded ? <ChevronUp size={12} className="text-zinc-400" /> : <ChevronDown size={12} className="text-zinc-400" />}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                        <span className="inline-flex items-center gap-1">
                          {fmtNum(row.official)}
                          {delta?.sourceCell && (
                              <button
                                title={`Открыть ${delta.sourceCell} в Google Sheets`}
                                className="p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  window.open(buildSheetUrl(SVOD_SPREADSHEET_ID, delta.sourceCell), '_blank');
                                }}
                              >
                                <ExternalLink size={11} className="text-blue-500" />
                              </button>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-300">{fmtNum(row.calculated)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <span className={clsx(
                          'font-medium',
                          isZero(row.deltaAbs) ? 'text-zinc-300 dark:text-zinc-600' : row.assessment === 'critical' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'
                        )}>
                          {isZero(row.deltaAbs) ? '0' : fmtNum(row.deltaAbs)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <span className={clsx(
                          'font-medium',
                          isZero(row.deltaPct) ? 'text-zinc-300 dark:text-zinc-600' : row.deltaPct > 5 ? 'text-red-600 dark:text-red-400' : row.deltaPct > 1 ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-400 dark:text-zinc-500'
                        )}>
                          {fmtPct(row.deltaPct)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', cfg.bg, cfg.text)}>
                          <Icon size={12} /> {cfg.label}
                        </span>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-zinc-50/80 dark:bg-zinc-900/40">
                        <td colSpan={6} className="px-5 py-4">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                            <div className="space-y-2">
                              <div className="font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                                <FileSpreadsheet size={13} className="text-blue-500" /> Ячейка СВОД
                              </div>
                              <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                                <div className="text-blue-800 dark:text-blue-300 font-mono text-[11px] flex items-center gap-1.5">
                                  {delta?.sourceCell ?? '—'}
                                  {delta?.sourceCell && (
                                    <button
                                      title="Открыть в Google Sheets"
                                      className="p-0.5 rounded hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        window.open(buildSheetUrl(SVOD_SPREADSHEET_ID, delta.sourceCell), '_blank');
                                      }}
                                    >
                                      <ExternalLink size={11} className="text-blue-500" />
                                    </button>
                                  )}
                                </div>
                                <div className="text-blue-600 dark:text-blue-400 mt-1">
                                  Значение: <strong>{fmtNum(row.official)}</strong>
                                </div>
                              </div>
                            </div>
                            <div className="space-y-2">
                              <div className="font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                                <Info size={13} className="text-indigo-500" /> Пересчёт
                              </div>
                              <div className="bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 rounded-lg p-3">
                                <div className="text-indigo-600 dark:text-indigo-400 mt-1">
                                  Результат: <strong>{fmtNum(row.calculated)}</strong>
                                </div>
                                <div className="text-indigo-500 mt-0.5 text-[10px]">
                                  Агрегация по строкам листа управления
                                </div>
                              </div>
                            </div>
                            <div className="space-y-2">
                              <div className="font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                                {row.assessment === 'critical' ? <AlertTriangle size={13} className="text-red-500" /> : <CheckCircle2 size={13} className="text-emerald-500" />}
                                Рекомендация
                              </div>
                              <div className={clsx(
                                'rounded-lg p-3 border text-[11px]',
                                row.assessment === 'critical' ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400' :
                                row.assessment === 'warning' ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400' :
                                'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400'
                              )}>
                                {row.assessment === 'ok'
                                  ? 'Значения совпадают. Дополнительных действий не требуется.'
                                  : row.assessment === 'warning'
                                  ? `Допустимое расхождение (${fmtPct(row.deltaPct)}). Проверьте при следующем обновлении данных.`
                                  : `Критическое расхождение (${fmtPct(row.deltaPct)}). Проверьте формулу СВОД.`}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
