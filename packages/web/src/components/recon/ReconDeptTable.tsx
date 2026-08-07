// ── Таблица сверки «По управлениям» (год-уровень): бейджи-саммари, таблица,
//    раскрывающаяся диагностика с deep-link на ячейки СВОД ТД-ПМ.
//    Извлечено move-only из pages/Recon.tsx (разрез E11-4). Store не читает.

import React from 'react';
import clsx from 'clsx';
import { AlertTriangle, ArrowRight, Building2, CheckCircle2, ChevronDown, ChevronUp, Clock, ExternalLink, FileSpreadsheet, Info } from 'lucide-react';
import { SVOD_SPREADSHEET_ID } from '@aemr/shared';
import type { ReconDeptRow } from '../../lib/recon/types';
import { fmtNum, fmtPct, isZero } from '../../lib/recon/format';
import { diagnoseDelta } from '../../lib/recon/diagnose';
import { buildSheetUrl, DEPT_SVOD_CELLS } from '../../lib/recon/sheet-links';
import { RootCauseList } from './RootCauseCard';

const KIND_CONFIG = {
  ok:      { label: 'Совпадает',         bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-400', icon: CheckCircle2 },
  neutral: { label: 'Нет данных',        bg: 'bg-zinc-100 dark:bg-zinc-800',       text: 'text-zinc-500 dark:text-zinc-400',     icon: Info },
  warning: { label: 'Несопоставимо',     bg: 'bg-amber-50 dark:bg-amber-950/30',     text: 'text-amber-700 dark:text-amber-400',     icon: Clock },
  high:    { label: 'Расхождение',       bg: 'bg-red-50 dark:bg-red-950/30',         text: 'text-red-700 dark:text-red-400',         icon: AlertTriangle },
} as const;

interface ReconDeptTableProps {
  rows: ReconDeptRow[];
  counts: { ok: number; neutral: number; warning: number; high: number };
  expandedDept: string | null;
  onToggleDept: (dept: string | null) => void;
}

export function ReconDeptTable({ rows, counts, expandedDept, onToggleDept }: ReconDeptTableProps) {
  return (
    <>
      {/* Summary badges */}
      <div className="flex gap-3 text-xs">
        {counts.ok > 0 && (
          <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 font-medium">
            <CheckCircle2 size={13} /> {counts.ok} совпадает
          </span>
        )}
        {counts.warning > 0 && (
          <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 font-medium">
            <Clock size={13} /> {counts.warning} несопоставимо
          </span>
        )}
        {counts.high > 0 && (
          <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 font-medium">
            <AlertTriangle size={13} /> {counts.high} расхождение
          </span>
        )}
        {counts.neutral > 0 && (
          <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 font-medium">
            <Info size={13} /> {counts.neutral} нет данных
          </span>
        )}
      </div>

      {/* Department reconciliation table */}
      <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-50 dark:bg-zinc-900/50 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                <th className="px-5 py-3">Управление</th>
                <th className="px-4 py-3 text-right">СВОД план</th>
                <th className="px-4 py-3 text-right">Расчёт план</th>
                <th className="px-4 py-3 text-right">Δ план</th>
                <th className="px-4 py-3 text-right">СВОД факт</th>
                <th className="px-4 py-3 text-right">Расчёт факт</th>
                <th className="px-4 py-3 text-right">Δ факт</th>
                <th className="px-4 py-3 text-center">Источник</th>
                <th className="px-4 py-3 text-center">Оценка</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
              {rows.map((row) => {
                const cfg = KIND_CONFIG[row.assessment.kind];
                const Icon = cfg.icon;
                const isExpanded = expandedDept === row.department;

                return (
                  <React.Fragment key={row.department}>
                    <tr
                      className={clsx(
                        'transition cursor-pointer',
                        row.assessment.kind === 'high' && 'bg-red-50/30 dark:bg-red-950/20',
                        row.assessment.kind === 'warning' && 'bg-amber-50/20 dark:bg-amber-950/15',
                        isExpanded ? 'bg-blue-50/30 dark:bg-blue-950/20' : 'hover:bg-zinc-50 dark:hover:bg-zinc-700/30',
                      )}
                      onClick={() => onToggleDept(isExpanded ? null : row.department)}
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <Building2 size={14} className="text-zinc-400" />
                          <span className="font-semibold text-zinc-700 dark:text-zinc-200">{row.department}</span>
                          {isExpanded ? <ChevronUp size={12} className="text-zinc-400" /> : <ChevronDown size={12} className="text-zinc-400" />}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-300">{fmtNum(row.fullPlanOfficial)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-300">{fmtNum(row.fullPlanCalculated)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <span className={clsx(
                          'font-medium',
                          isZero(row.planDelta) ? 'text-zinc-300 dark:text-zinc-600'
                            : row.assessment.kind === 'high' ? 'text-red-600 dark:text-red-400'
                            : 'text-amber-600 dark:text-amber-400',
                        )}>
                          {isZero(row.planDelta) ? '0' : fmtNum(row.planDelta)}
                          {!isZero(row.planDeltaPct) && <span className="text-[10px] ml-1">({fmtPct(row.planDeltaPct)})</span>}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-300">{fmtNum(row.fullFactOfficial)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-300">{fmtNum(row.fullFactCalculated)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <span className={clsx(
                          'font-medium',
                          isZero(row.factDelta) ? 'text-zinc-300 dark:text-zinc-600'
                            : row.assessment.kind === 'high' ? 'text-red-600 dark:text-red-400'
                            : 'text-amber-600 dark:text-amber-400',
                        )}>
                          {isZero(row.factDelta) ? '0' : fmtNum(row.factDelta)}
                          {!isZero(row.factDeltaPct) && <span className="text-[10px] ml-1">({fmtPct(row.factDeltaPct)})</span>}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={clsx(
                          'text-[11px] font-medium',
                          row.assessment.source === 'svod_error' ? 'text-red-500 dark:text-red-400'
                            : row.assessment.source === 'calc_error' ? 'text-amber-600 dark:text-amber-400'
                            : row.assessment.source === 'methodology' ? 'text-blue-500 dark:text-blue-400'
                            : 'text-zinc-400 dark:text-zinc-500',
                        )}>
                          {row.assessment.sourceLabel ?? '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', cfg.bg, cfg.text)}>
                          <Icon size={12} /> {cfg.label}
                        </span>
                      </td>
                    </tr>

                    {/* Expanded detail */}
                    {isExpanded && (() => {
                      const diag = diagnoseDelta(row);
                      const cells = DEPT_SVOD_CELLS[row.department];
                      return (
                      <tr className="bg-zinc-50/80 dark:bg-zinc-900/40">
                        <td colSpan={9} className="px-5 py-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
                            {/* Diagnosis */}
                            <div className="space-y-2">
                              <div className="font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                                <AlertTriangle size={13} className={diag.severity === 'error' ? 'text-red-500' : diag.severity === 'warn' ? 'text-amber-500' : 'text-emerald-500'} />
                                Источник расхождения
                              </div>
                              <div className={clsx(
                                'rounded-lg p-3 border',
                                diag.severity === 'error' ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800'
                                : diag.severity === 'warn' ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800'
                                : 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800',
                              )}>
                                <div className={clsx('font-bold text-[11px]',
                                  diag.severity === 'error' ? 'text-red-700 dark:text-red-400'
                                  : diag.severity === 'warn' ? 'text-amber-700 dark:text-amber-400'
                                  : 'text-emerald-700 dark:text-emerald-400',
                                )}>{diag.source}</div>
                                <div className="text-[10px] mt-1 text-zinc-600 dark:text-zinc-400 leading-relaxed">{diag.detail}</div>
                              </div>
                            </div>

                            {/* SVOD Cell References */}
                            <div className="space-y-2">
                              <div className="font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                                <FileSpreadsheet size={13} className="text-blue-500" /> Ячейки СВОД ТД-ПМ
                              </div>
                              <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3 space-y-1">
                                {cells ? (
                                  <>
                                    {[
                                      ['План, тыс. ₽', cells.planTotal, fmtNum(row.fullPlanOfficial)],
                                      ['Факт, тыс. ₽', cells.factTotal, fmtNum(row.fullFactOfficial)],
                                      ['Экономия, тыс. ₽', cells.economy, fmtNum(row.ecoTotalOfficial)],
                                    ].map(([label, cell, val]) => (
                                      <div key={cell as string} className="flex items-center justify-between text-[10px]">
                                        <span className="text-blue-600 dark:text-blue-400">{label}</span>
                                        <span className="flex items-center gap-1">
                                          <code className="text-blue-800 dark:text-blue-300 font-mono">{cell}</code>
                                          <span className="text-zinc-500">= {val}</span>
                                          <button
                                            className="p-0.5 rounded hover:bg-blue-200 dark:hover:bg-blue-800 transition"
                                            onClick={(e) => { e.stopPropagation(); window.open(buildSheetUrl(SVOD_SPREADSHEET_ID, cell as string), '_blank'); }}
                                          >
                                            <ExternalLink size={9} className="text-blue-500" />
                                          </button>
                                        </span>
                                      </div>
                                    ))}
                                  </>
                                ) : <span className="text-blue-400 text-[10px]">Нет маппинга ячеек</span>}
                              </div>
                            </div>

                            {/* Economy comparison */}
                            <div className="space-y-2">
                              <div className="font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                                <Info size={13} className="text-indigo-500" /> Экономия ИТОГО
                              </div>
                              <div className="bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 rounded-lg p-3">
                                <div className="flex justify-between text-[10px]">
                                  <span className="text-indigo-600 dark:text-indigo-400">СВОД:</span>
                                  <strong className="text-indigo-800 dark:text-indigo-300">{fmtNum(row.ecoTotalOfficial)}</strong>
                                </div>
                                <div className="flex justify-between mt-1 text-[10px]">
                                  <span className="text-indigo-600 dark:text-indigo-400">Расчёт:</span>
                                  <strong className="text-indigo-800 dark:text-indigo-300">{fmtNum(row.ecoTotalCalculated)}</strong>
                                </div>
                                <div className="flex justify-between mt-1 pt-1 border-t border-indigo-200 dark:border-indigo-700 text-[10px]">
                                  <span className="text-indigo-600 dark:text-indigo-400">Δ:</span>
                                  <strong className={row.ecoDelta === 0 ? 'text-indigo-300' : 'text-indigo-800 dark:text-indigo-300'}>
                                    {fmtNum(row.ecoDelta)}
                                  </strong>
                                </div>
                              </div>
                            </div>

                            {/* Recommendation */}
                            <div className="space-y-2">
                              <div className="font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                                <ArrowRight size={13} className="text-violet-500" /> Рекомендация
                              </div>
                              <div className="bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 rounded-lg p-3 text-[10px] text-violet-700 dark:text-violet-400 leading-relaxed">
                                {row.assessment.kind === 'ok'
                                  ? 'Данные согласованы. Дополнительных действий не требуется.'
                                  : row.assessment.kind === 'warning'
                                  ? 'Проверьте состав строк: возможно часть строк не прошла классификацию (порог score >= 3) или период не совпадает.'
                                  : row.assessment.kind === 'high'
                                  ? `Критическое расхождение. Проверьте: (1) формулы ${cells?.planCount ?? 'СВОД'} ссылаются на правильные диапазоны, (2) колонка L (метод) заполнена корректно, (3) нет дубликатов строк.`
                                  : 'Нет данных для сравнения — проверьте что оба источника загружены.'}
                              </div>
                            </div>
                          </div>

                          {/* Первопричины: путь до строки-виновницы (требование
                              владельца 07.08). Догадка «проверьте формулы»
                              выше — эвристика; здесь адреса строк. */}
                          <div className="mt-4 space-y-2">
                            <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                              <AlertTriangle size={13} className="text-amber-500" />
                              Первопричины расхождения
                            </div>
                            {row.rootCauses && row.rootCauses.length > 0 ? (
                              <RootCauseList groups={row.rootCauses} />
                            ) : (
                              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                                {row.assessment.kind === 'ok'
                                  ? 'Расхождения нет — объяснять нечего.'
                                  : 'Строки-атомы этого снимка недоступны: доказательство до строки не построено. ' +
                                    'Оно появится после следующего обновления данных.'}
                              </p>
                            )}
                          </div>
                        </td>
                      </tr>
                      );
                    })()}
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
