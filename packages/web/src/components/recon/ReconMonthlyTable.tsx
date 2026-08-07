// ── Таблица помесячной сверки (лист «СВОД с месяцами»): загрузка/ошибка/
//    предупреждение, бейджи-саммари, план и факт по месяцам, раскрытие
//    первопричины и бюджетов.
//    Извлечено move-only из pages/Recon.tsx (разрез E11-4). Store не читает —
//    formatMoney и навигация приходят пропсами.
//
//    Единственное осознанное изменение рендера против исходника: статус 'no_calc'
//    получил честный нейтральный стиль + подпись «расчёт не построен»
//    (см. lib/recon/monthly.ts — раньше падал в дефолтный стиль без пометки).
//
//    07.08.2026 — переплавка под читателя-руководителя:
//    • вид больше не может оказаться пустым экраном: нулю строк дано
//      объяснение и действие;
//    • ошибка запроса рассказана по-русски, технический текст ушёл мелким
//      шрифтом в скобки;
//    • «ГРБС» в шапке заменено на «Управление» (в остальных таблицах сверки
//      столбец зовётся так же — расхождение подписей путало);
//    • строка раскрывается с клавиатуры.

import React from 'react';
import clsx from 'clsx';
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, ChevronUp, Clock, FileSpreadsheet, Inbox } from 'lucide-react';
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
import { SkeletonTable } from '../Skeleton';

interface ReconMonthlyTableProps {
  data: ReconMonthlyData | null;
  loading: boolean;
  error: string | null;
  expandedKey: string | null;
  onToggleRow: (key: string | null) => void;
  formatMoney: (n: number) => string;
  /** Переход «Открыть строки за месяц в данных» */
  onOpenMonth: (deptId: string, month: number) => void;
  /**
   * Почему строк нет. Причину знает страница: только ей известно, отсёк ли
   * строки фильтр управлений или их не было в самом листе.
   */
  emptyReason: string;
}

/**
 * Подсказка ячейки. Пустая ячейка — не «пропуск данных», а отсутствие строк
 * за месяц с обеих сторон: без пояснения ноль читается как «посчитали ноль».
 */
function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** Заголовок-утверждение: чем закончилась помесячная сверка. */
function verdictHeadline(counts: ReconMonthlyData['counts'] | undefined): string {
  const ok = counts?.ok ?? 0;
  const warning = counts?.warning ?? 0;
  const high = counts?.high ?? 0;
  const total = ok + warning + high;
  const items = (n: number) => `${n} ${plural(n, 'сравнение', 'сравнения', 'сравнений')}`;
  if (high > 0) return `Расходятся ${items(high)} из ${total}`;
  if (warning > 0) return `За пределы допуска не вышло ни одно сравнение, у ${items(warning)} расхождение в пределах допуска`;
  return `Помесячная сверка чиста: сходятся все ${items(total)}`;
}

function cellTitle(cell: ReconCell | undefined): string | undefined {
  return monthlyCellTitle(cell)
    ?? (cell?.status === 'empty' ? 'За этот месяц строк нет ни в листе, ни в расчёте' : undefined);
}

export function ReconMonthlyTable({ data, loading, error, expandedKey, onToggleRow, formatMoney, onOpenMonth, emptyReason }: ReconMonthlyTableProps) {
  const rows = data?.rows ?? [];
  const showEmpty = !loading && !error && data !== null && rows.length === 0;

  return (
    <>
      {loading && (
        <div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">Читаем лист «СВОД с месяцами» и сверяем его с расчётом по строкам…</p>
          <SkeletonTable rows={6} />
        </div>
      )}

      {error && !loading && (
        <div className="bg-white dark:bg-zinc-800/60 rounded-xl border border-red-200 dark:border-red-800 p-8 text-center">
          <AlertTriangle className="mx-auto text-red-500 mb-2" size={28} aria-hidden="true" />
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">Помесячная сверка не загрузилась: сервер не ответил</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-lg mx-auto">
            Это сбой запроса, а не отсутствие листа «СВОД с месяцами». Переключитесь на другой вид
            и вернитесь — запрос повторится; если повторяется — сервер приложения недоступен.
          </p>
          <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-3 font-mono break-words max-w-lg mx-auto">({error})</p>
        </div>
      )}

      {data?.warning && (
        <div className="bg-amber-50 dark:bg-amber-950/30 rounded-xl border border-amber-200 dark:border-amber-800 p-5 text-center">
          <AlertTriangle className="mx-auto text-amber-500 mb-2" size={28} aria-hidden="true" />
          <p className="text-sm text-amber-700 dark:text-amber-400">{data.warning}</p>
        </div>
      )}

      {showEmpty && !data?.warning && (
        <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-700/50 p-10 text-center">
          <Inbox className="mx-auto text-zinc-300 dark:text-zinc-600 mb-3" size={32} aria-hidden="true" />
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">Помесячной сверки показывать нечего</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-lg mx-auto">{emptyReason}</p>
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{verdictHeadline(data?.counts)}</h3>
            <div className="flex flex-wrap gap-3 text-xs">
              <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 font-medium">
                <CheckCircle2 size={13} aria-hidden="true" /> {data?.counts?.ok ?? 0} совпадает
              </span>
              <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 font-medium">
                <Clock size={13} aria-hidden="true" /> {data?.counts?.warning ?? 0} в пределах допуска
              </span>
              <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 font-medium">
                <AlertTriangle size={13} aria-hidden="true" /> {data?.counts?.high ?? 0} расходится
              </span>
            </div>
          </div>
          <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <caption className="sr-only">
                  Помесячная сверка: официальные числа листа «СВОД с месяцами» против пересчёта по строкам
                </caption>
                <thead>
                  <tr className="bg-zinc-50 dark:bg-zinc-900/50 text-left font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                    <th scope="col" className="px-3 py-2.5">Управление</th>
                    <th scope="col" className="px-3 py-2.5 text-center">Месяц</th>
                    <th scope="col" className="px-3 py-2.5 text-right" colSpan={2} title="Конкурентные процедуры — план">КП план</th>
                    <th scope="col" className="px-3 py-2.5 text-right" colSpan={2} title="Конкурентные процедуры — факт">КП факт</th>
                    <th scope="col" className="px-3 py-2.5 text-right" colSpan={2} title="Закупки у единственного поставщика — план">ЕП план</th>
                    <th scope="col" className="px-3 py-2.5 text-right" colSpan={2} title="Закупки у единственного поставщика — факт">ЕП факт</th>
                  </tr>
                  <tr className="bg-zinc-50/50 dark:bg-zinc-900/30 text-[10px] text-zinc-400 dark:text-zinc-500">
                    <th></th>
                    <th></th>
                    <th scope="col" className="px-2 py-1 text-right">Официально</th>
                    <th scope="col" className="px-2 py-1 text-right">Пересчёт</th>
                    <th scope="col" className="px-2 py-1 text-right">Официально</th>
                    <th scope="col" className="px-2 py-1 text-right">Пересчёт</th>
                    <th scope="col" className="px-2 py-1 text-right">Официально</th>
                    <th scope="col" className="px-2 py-1 text-right">Пересчёт</th>
                    <th scope="col" className="px-2 py-1 text-right">Официально</th>
                    <th scope="col" className="px-2 py-1 text-right">Пересчёт</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
                  {rows.map((r: ReconMonthlyRow, i: number) => {
                    const rowKey = `${r.deptId}-${r.month}`;
                    const isOpen = expandedKey === rowKey;
                    const panelId = `recon-monthly-${rowKey.replace(/[^\w-]/g, '_')}`;
                    const rc = r.rootCause;
                    const moneyRow = (label: string, cell: ReconCell | undefined) => (
                      <div key={label} className="flex items-center justify-between gap-2 text-[10px]">
                        <span className="text-zinc-500 dark:text-zinc-400 whitespace-nowrap">{label}</span>
                        <span className="flex items-center gap-1.5 tabular-nums" title={cellTitle(cell)}>
                          <span className="text-zinc-400 dark:text-zinc-500">{formatMoney(cell?.shdyu ?? 0)}</span>
                          <ArrowRight size={9} className="text-zinc-300 dark:text-zinc-600 shrink-0" aria-hidden="true" />
                          <span className="text-zinc-600 dark:text-zinc-300">{formatMoney(cell?.calc ?? 0)}</span>
                          <span className={monthlyDeltaClass(cell)}>расхождение {fmtNum(cell?.delta ?? 0)}</span>
                        </span>
                      </div>
                    );
                    return (
                      <React.Fragment key={`${rowKey}-${i}`}>
                      <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-700/30">
                        <th scope="row" className="px-3 py-2 text-left font-medium text-zinc-700 dark:text-zinc-200">
                          <button
                            onClick={() => onToggleRow(isOpen ? null : rowKey)}
                            aria-expanded={isOpen}
                            aria-controls={panelId}
                            className="flex items-center gap-1.5 text-left rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
                          >
                            {isOpen
                              ? <ChevronUp size={12} className="text-zinc-400 shrink-0" aria-hidden="true" />
                              : <ChevronDown size={12} className="text-zinc-400 shrink-0" aria-hidden="true" />}
                            {r.deptName}
                            {rc && <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', rc.severity === 'critical' ? 'bg-red-500' : 'bg-amber-500')} title={rc.label} />}
                          </button>
                        </th>
                        <td className="px-3 py-2 text-center text-zinc-500">{MONTH_NAMES_SHORT[r.month]}</td>
                        <td className={monthlyCellClass(r.compPlan)} title={cellTitle(r.compPlan)}>{fmtNum(r.compPlan?.shdyu ?? 0)}</td>
                        <td className={monthlyCellClass(r.compPlan)} title={cellTitle(r.compPlan)}>{fmtNum(r.compPlan?.calc ?? 0)}</td>
                        <td className={monthlyCellClass(r.compFact)} title={cellTitle(r.compFact)}>{fmtNum(r.compFact?.shdyu ?? 0)}</td>
                        <td className={monthlyCellClass(r.compFact)} title={cellTitle(r.compFact)}>{fmtNum(r.compFact?.calc ?? 0)}</td>
                        <td className={monthlyCellClass(r.epPlan)} title={cellTitle(r.epPlan)}>{fmtNum(r.epPlan?.shdyu ?? 0)}</td>
                        <td className={monthlyCellClass(r.epPlan)} title={cellTitle(r.epPlan)}>{fmtNum(r.epPlan?.calc ?? 0)}</td>
                        <td className={monthlyCellClass(r.epFact)} title={cellTitle(r.epFact)}>{fmtNum(r.epFact?.shdyu ?? 0)}</td>
                        <td className={monthlyCellClass(r.epFact)} title={cellTitle(r.epFact)}>{fmtNum(r.epFact?.calc ?? 0)}</td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-zinc-50/80 dark:bg-zinc-900/40">
                          <td colSpan={10} className="px-5 py-4" id={panelId}>
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
                              <div className="space-y-2">
                                <div className="font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                                  <AlertTriangle size={13} className={rc ? (rc.severity === 'critical' ? 'text-red-500' : 'text-amber-500') : 'text-zinc-400'} aria-hidden="true" />
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
                                  <div className="rounded-lg p-3 border bg-zinc-50 dark:bg-zinc-800/40 border-zinc-200 dark:border-zinc-700 text-[10px] text-zinc-500 dark:text-zinc-400">
                                    Существенных расхождений за этот месяц нет — либо расхождение есть,
                                    но под известные причины оно не подошло: разбирайте по строкам.
                                  </div>
                                )}
                                {r.warnings && r.warnings.length > 0 && (
                                  <ul className="space-y-1">
                                    {r.warnings.map((w: string, wi: number) => (
                                      <li key={wi} className="flex items-start gap-1.5 text-[10px] text-amber-700 dark:text-amber-400">
                                        <AlertTriangle size={10} className="mt-0.5 shrink-0" aria-hidden="true" /> {w}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                                <button
                                  className="inline-flex items-center gap-1 text-[10px] text-blue-600 dark:text-blue-400 hover:underline rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
                                  onClick={() => onOpenMonth(r.deptId, r.month)}
                                >
                                  <ArrowRight size={11} aria-hidden="true" /> Открыть строки за {MONTH_NAMES_SHORT[r.month]} в данных
                                </button>
                              </div>

                              <div className="space-y-2">
                                <div className="font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                                  <FileSpreadsheet size={13} className="text-blue-500" aria-hidden="true" /> Суммы, тыс. ₽: официально → пересчёт и расхождение
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
                                    <div className="text-[10px] text-emerald-600 dark:text-emerald-400 px-1">
                                      Разбивка по федеральному, краевому и муниципальному бюджетам сходится.
                                    </div>
                                  ) : (
                                    <div className="bg-white dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 space-y-1.5">
                                      <div className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400">
                                        Расходится по бюджетам (федеральный, краевой, муниципальный)
                                      </div>
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
