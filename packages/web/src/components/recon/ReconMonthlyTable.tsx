// ── Таблица помесячной сверки (лист «СВОД с месяцами»): загрузка/ошибка/warning,
//    бейджи-саммари, КП/ЕП план/факт по месяцам, раскрытие root-cause и бюджетов.
//    Извлечено move-only из pages/Recon.tsx (разрез E11-4). Store не читает —
//    formatMoney и навигация приходят пропсами.
//
//    Единственное осознанное изменение рендера против исходника: статус 'no_calc'
//    получил честный нейтральный стиль + title «расчёт не построен»
//    (см. lib/recon/monthly.ts — раньше падал в дефолтный стиль без пометки).

import React from 'react';
import clsx from 'clsx';
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, ChevronUp, Clock, FileSpreadsheet } from 'lucide-react';
import type { ReconCell, ReconMonthlyData, ReconMonthlyRow } from '../../lib/recon/types';
import { fmtNum } from '../../lib/recon/format';
import {
  collectBudgetDiscrepancies,
  confidenceLabel,
  MONTH_NAMES_SHORT,
  monthlyCellClass,
  monthlyCellTitle,
  monthlyDeltaClass,
} from '../../lib/recon/monthly';

interface ReconMonthlyTableProps {
  data: ReconMonthlyData | null;
  loading: boolean;
  error: string | null;
  expandedKey: string | null;
  onToggleRow: (key: string | null) => void;
  formatMoney: (n: number) => string;
  /** Переход «Открыть строки за месяц в данных» */
  onOpenMonth: (deptId: string, month: number) => void;
}

export function ReconMonthlyTable({ data, loading, error, expandedKey, onToggleRow, formatMoney, onOpenMonth }: ReconMonthlyTableProps) {
  return (
    <>
      {loading && (
        <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 p-8 text-center">
          <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-xs text-zinc-500">Загрузка помесячных данных (СВОД с месяцами)...</p>
        </div>
      )}
      {error && !loading && (
        <div className="bg-white dark:bg-zinc-800/60 rounded-xl border border-red-200 dark:border-red-800 p-5 text-center">
          <AlertTriangle className="mx-auto text-red-500 mb-2" size={28} />
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          <p className="text-[11px] text-zinc-400 mt-1">Сбой запроса к API, а не отсутствие данных СВОД с месяцами.</p>
        </div>
      )}
      {data?.warning && (
        <div className="bg-amber-50 dark:bg-amber-950/30 rounded-xl border border-amber-200 dark:border-amber-800 p-5 text-center">
          <AlertTriangle className="mx-auto text-amber-500 mb-2" size={28} />
          <p className="text-sm text-amber-700 dark:text-amber-400">{data.warning}</p>
        </div>
      )}
      {(data?.rows?.length ?? 0) > 0 && (
        <>
          <div className="flex gap-3 text-xs">
            <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 font-medium">
              <CheckCircle2 size={13} /> {data?.counts?.ok ?? 0} совпадает
            </span>
            <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 font-medium">
              <Clock size={13} /> {data?.counts?.warning ?? 0} допустимо
            </span>
            <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 font-medium">
              <AlertTriangle size={13} /> {data?.counts?.high ?? 0} расхождение
            </span>
          </div>
          <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-zinc-50 dark:bg-zinc-900/50 text-left font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                    <th className="px-3 py-2.5">ГРБС</th>
                    <th className="px-3 py-2.5 text-center">Месяц</th>
                    <th className="px-3 py-2.5 text-right" colSpan={2}>КП план</th>
                    <th className="px-3 py-2.5 text-right" colSpan={2}>КП факт</th>
                    <th className="px-3 py-2.5 text-right" colSpan={2}>ЕП план</th>
                    <th className="px-3 py-2.5 text-right" colSpan={2}>ЕП факт</th>
                  </tr>
                  <tr className="bg-zinc-50/50 dark:bg-zinc-900/30 text-[10px] text-zinc-400 dark:text-zinc-500">
                    <th></th>
                    <th></th>
                    <th className="px-2 py-1 text-right">СВОД</th>
                    <th className="px-2 py-1 text-right">Расчёт</th>
                    <th className="px-2 py-1 text-right">СВОД</th>
                    <th className="px-2 py-1 text-right">Расчёт</th>
                    <th className="px-2 py-1 text-right">СВОД</th>
                    <th className="px-2 py-1 text-right">Расчёт</th>
                    <th className="px-2 py-1 text-right">СВОД</th>
                    <th className="px-2 py-1 text-right">Расчёт</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
                  {(data?.rows ?? []).map((r: ReconMonthlyRow, i: number) => {
                    const rowKey = `${r.deptId}-${r.month}`;
                    const isOpen = expandedKey === rowKey;
                    const rc = r.rootCause;
                    const moneyRow = (label: string, cell: ReconCell | undefined) => (
                      <div key={label} className="flex items-center justify-between gap-2 text-[10px]">
                        <span className="text-zinc-500 dark:text-zinc-400 whitespace-nowrap">{label}</span>
                        <span className="flex items-center gap-1.5 tabular-nums" title={monthlyCellTitle(cell)}>
                          <span className="text-zinc-400 dark:text-zinc-500">{formatMoney(cell?.shdyu ?? 0)}</span>
                          <ArrowRight size={9} className="text-zinc-300 dark:text-zinc-600 shrink-0" />
                          <span className="text-zinc-600 dark:text-zinc-300">{formatMoney(cell?.calc ?? 0)}</span>
                          <span className={monthlyDeltaClass(cell)}>Δ {fmtNum(cell?.delta ?? 0)}</span>
                        </span>
                      </div>
                    );
                    return (
                      <React.Fragment key={`${rowKey}-${i}`}>
                      <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-700/30 cursor-pointer" onClick={() => onToggleRow(isOpen ? null : rowKey)}>
                        <td className="px-3 py-2 font-medium text-zinc-700 dark:text-zinc-200">
                          <span className="flex items-center gap-1.5">
                            {isOpen ? <ChevronUp size={12} className="text-zinc-400 shrink-0" /> : <ChevronDown size={12} className="text-zinc-400 shrink-0" />}
                            {r.deptName}
                            {rc && <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', rc.severity === 'critical' ? 'bg-red-500' : 'bg-amber-500')} title={rc.label} />}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center text-zinc-500">{MONTH_NAMES_SHORT[r.month]}</td>
                        <td className={monthlyCellClass(r.compPlan)} title={monthlyCellTitle(r.compPlan)}>{fmtNum(r.compPlan?.shdyu ?? 0)}</td>
                        <td className={monthlyCellClass(r.compPlan)} title={monthlyCellTitle(r.compPlan)}>{fmtNum(r.compPlan?.calc ?? 0)}</td>
                        <td className={monthlyCellClass(r.compFact)} title={monthlyCellTitle(r.compFact)}>{fmtNum(r.compFact?.shdyu ?? 0)}</td>
                        <td className={monthlyCellClass(r.compFact)} title={monthlyCellTitle(r.compFact)}>{fmtNum(r.compFact?.calc ?? 0)}</td>
                        <td className={monthlyCellClass(r.epPlan)} title={monthlyCellTitle(r.epPlan)}>{fmtNum(r.epPlan?.shdyu ?? 0)}</td>
                        <td className={monthlyCellClass(r.epPlan)} title={monthlyCellTitle(r.epPlan)}>{fmtNum(r.epPlan?.calc ?? 0)}</td>
                        <td className={monthlyCellClass(r.epFact)} title={monthlyCellTitle(r.epFact)}>{fmtNum(r.epFact?.shdyu ?? 0)}</td>
                        <td className={monthlyCellClass(r.epFact)} title={monthlyCellTitle(r.epFact)}>{fmtNum(r.epFact?.calc ?? 0)}</td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-zinc-50/80 dark:bg-zinc-900/40">
                          <td colSpan={10} className="px-5 py-4">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
                              <div className="space-y-2">
                                <div className="font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                                  <AlertTriangle size={13} className={rc ? (rc.severity === 'critical' ? 'text-red-500' : 'text-amber-500') : 'text-zinc-400'} />
                                  Причина расхождения с листом «СВОД с месяцами»
                                </div>
                                {rc ? (
                                  <div className={clsx('rounded-lg p-3 border',
                                    rc.severity === 'critical' ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800' : 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800')}>
                                    <div className="flex items-start justify-between gap-2">
                                      <span className={clsx('font-bold text-[11px]', rc.severity === 'critical' ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-400')}>{rc.label}</span>
                                      <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-white/60 dark:bg-black/20 text-zinc-500 dark:text-zinc-400 whitespace-nowrap">{confidenceLabel(rc.confidence)} достоверность</span>
                                    </div>
                                    <div className="text-[10px] mt-1 text-zinc-600 dark:text-zinc-400 leading-relaxed">{rc.evidence}</div>
                                    {rc.suggestedAction && (
                                      <div className="text-[10px] mt-2 font-medium text-zinc-700 dark:text-zinc-300 leading-relaxed">{rc.suggestedAction}</div>
                                    )}
                                  </div>
                                ) : (
                                  <div className="rounded-lg p-3 border bg-zinc-50 dark:bg-zinc-800/40 border-zinc-200 dark:border-zinc-700 text-[10px] text-zinc-400 dark:text-zinc-500">Существенных расхождений нет или причина не классифицирована.</div>
                                )}
                                {r.warnings && r.warnings.length > 0 && (
                                  <ul className="space-y-1">
                                    {r.warnings.map((w: string, wi: number) => (
                                      <li key={wi} className="flex items-start gap-1.5 text-[10px] text-amber-700 dark:text-amber-400">
                                        <AlertTriangle size={10} className="mt-0.5 shrink-0" /> {w}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                                <button
                                  className="inline-flex items-center gap-1 text-[10px] text-blue-600 dark:text-blue-400 hover:underline"
                                  onClick={(e) => { e.stopPropagation(); onOpenMonth(r.deptId, r.month); }}
                                >
                                  <ArrowRight size={11} /> Открыть строки за {MONTH_NAMES_SHORT[r.month]} в данных
                                </button>
                              </div>

                              <div className="space-y-2">
                                <div className="font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                                  <FileSpreadsheet size={13} className="text-blue-500" /> Суммы, тыс. ₽ — СВОД с месяцами → Расчёт, Δ
                                </div>
                                <div className="bg-white dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 space-y-1.5">
                                  {moneyRow('КП план', r.compPlanTotal)}
                                  {moneyRow('КП факт', r.compFactTotal)}
                                  {moneyRow('ЕП план', r.epPlanTotal)}
                                  {moneyRow('ЕП факт', r.epFactTotal)}
                                </div>
                                {(() => {
                                  if (!r.compBudget && !r.epBudget) return null;
                                  const budgetRows = collectBudgetDiscrepancies(r.compBudget, r.epBudget);
                                  return budgetRows.length === 0 ? (
                                    <div className="text-[10px] text-emerald-600 dark:text-emerald-400 px-1">Бюджетная разбивка (ФБ/КБ/МБ) сходится.</div>
                                  ) : (
                                    <div className="bg-white dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 space-y-1.5">
                                      <div className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400">Расхождения по бюджетам (ФБ/КБ/МБ)</div>
                                      {budgetRows.map(([lab, c]) => moneyRow(lab, c))}
                                    </div>
                                  );
                                })()}
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
      )}
    </>
  );
}
