// ── Таблица сверки «По показателям»: бейджи-саммари, таблица показателей
//    со ссылкой на ячейку СВОД и раскрывающимся разбором.
//    Извлечено move-only из pages/Recon.tsx (разрез E11-4). Store не читает.
//
//    07.08.2026 — переплавка под читателя-руководителя:
//    • «Δ абс.» / «Δ %» названы словами: греческая буква в шапке отчёта
//      требует легенды, которой на экране нет;
//    • отсутствующее официальное число больше не рисуется нулём. Строка
//      таблицы несёт только числа, поэтому пустоту берём из исходной сверки
//      (officialValue = null) и говорим «нет в СВОД» — иначе экран утверждал
//      бы, что книга посчитала ноль, чего она не делала;
//    • раскрытие строки доступно с клавиатуры: заголовок строки стал кнопкой.

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
  /** Отфильтрованные по периоду дельты — для поиска sourceCell показателя */
  deltas: ReconMetricDelta[];
  counts: { ok: number; warning: number; critical: number };
  expandedMetric: string | null;
  onToggleMetric: (metric: string | null) => void;
}

/** Значение стороны сверки: число либо честная пометка «этой стороны нет». */
function SideValue({ value, missingNote }: { value: number | null | undefined; missingNote: string }) {
  if (value == null) {
    return <span className="text-zinc-400 dark:text-zinc-500 font-normal">{missingNote}</span>;
  }
  return <>{fmtNum(value)}</>;
}

/**
 * Название показателя. Справочник подписей полон не всегда, и тогда наверх
 * приезжает внутренний ключ — на экране ему не место: читателя он не
 * опознаёт, а строку опознаёт адрес ячейки в соседнем столбце.
 */
function metricTitle(row: MetricReconRow): string {
  return row.metricLabel && row.metricLabel !== row.metric ? row.metricLabel : 'Показатель без названия в справочнике';
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** Заголовок-утверждение: чем закончилась сверка показателей. */
function verdictHeadline(
  counts: { ok: number; warning: number; critical: number },
  /** Канон п.64: «чиста» — только при нулевой разнице (см. ReconDeptTable). */
  allZero: boolean,
): string {
  const total = counts.ok + counts.warning + counts.critical;
  const items = (n: number) => `${n} ${plural(n, 'показатель', 'показателя', 'показателей')}`;
  if (counts.critical > 0) return `Расходятся ${items(counts.critical)} из ${total}`;
  if (counts.warning > 0) return `За пределы допуска не вышел ни один показатель, у ${items(counts.warning)} расхождение в пределах допуска`;
  return allZero
    ? `Сверка чиста: сходятся все ${items(total)}`
    : `Сверх допуска не вышел ни один показатель; у части разница ненулевая — раскройте строку`;
}

export function ReconMetricTable({ rows, deltas, counts, expandedMetric, onToggleMetric }: ReconMetricTableProps) {
  return (
    <>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
          {/* null-разница означает «сравнивать не с чем» — она не мешает
              слову «чиста», в отличие от ненулевого числа. */}
          {verdictHeadline(counts, deltas.every((d) => d.delta == null || isZero(d.delta)))}
        </h3>

        {/* Summary badges */}
        <div className="flex flex-wrap gap-3 text-xs">
          <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 font-medium">
            <CheckCircle2 size={13} aria-hidden="true" /> {counts.ok} совпадает
          </span>
          <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 font-medium">
            <Clock size={13} aria-hidden="true" /> {counts.warning} в пределах допуска
          </span>
          <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 font-medium">
            <AlertTriangle size={13} aria-hidden="true" /> {counts.critical} расходится
          </span>
        </div>
      </div>

      {/* Metric table */}
      <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Сверка отдельных показателей: официальное число листа СВОД против пересчёта по строкам</caption>
            <thead>
              <tr className="bg-zinc-50 dark:bg-zinc-900/50 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                <th scope="col" className="px-5 py-3">Показатель</th>
                <th scope="col" className="px-4 py-3 text-right" title="Число, посчитанное самой книгой на листе СВОД ТД-ПМ">Официально</th>
                <th scope="col" className="px-4 py-3 text-right" title="Независимый пересчёт по строкам листов управлений">Пересчёт</th>
                <th scope="col" className="px-4 py-3 text-right">Расхождение</th>
                <th scope="col" className="px-4 py-3 text-right">Расхождение, %</th>
                <th scope="col" className="px-4 py-3 text-center">Оценка</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
              {rows.map((row) => {
                const cfg = METRIC_ASSESS_CONFIG[row.assessment];
                const Icon = cfg.icon;
                const isExpanded = expandedMetric === row.metric;
                const delta = deltas.find((d) => d.metricKey === row.metric);
                const title = metricTitle(row);
                const officialValue = delta ? delta.officialValue : row.official;
                const calculatedValue = delta ? delta.calculatedValue : row.calculated;
                const bothSidesKnown = officialValue != null && calculatedValue != null;
                const panelId = `recon-metric-${row.metric.replace(/[^\w-]/g, '_')}`;

                return (
                  <React.Fragment key={row.metric}>
                    <tr
                      className={clsx(
                        'transition',
                        row.assessment === 'critical' && 'bg-red-50/30 dark:bg-red-950/20',
                        row.assessment === 'warning' && 'bg-amber-50/20 dark:bg-amber-950/15',
                        isExpanded ? 'bg-blue-50/30 dark:bg-blue-950/20' : 'hover:bg-zinc-50 dark:hover:bg-zinc-700/30',
                      )}
                    >
                      <th scope="row" className="px-5 py-3 text-left font-normal">
                        <button
                          onClick={() => onToggleMetric(isExpanded ? null : row.metric)}
                          aria-expanded={isExpanded}
                          aria-controls={panelId}
                          className="flex items-center gap-2 text-left rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
                        >
                          <span className="font-medium text-zinc-700 dark:text-zinc-200">{title}</span>
                          {isExpanded
                            ? <ChevronUp size={12} className="text-zinc-400" aria-hidden="true" />
                            : <ChevronDown size={12} className="text-zinc-400" aria-hidden="true" />}
                        </button>
                      </th>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                        <span className="inline-flex items-center gap-1">
                          <SideValue value={officialValue} missingNote="нет в СВОД" />
                          {delta?.sourceCell && (
                              <button
                                title={`Открыть ячейку ${delta.sourceCell} в Google Sheets`}
                                aria-label={`Открыть ячейку ${delta.sourceCell} листа СВОД в Google Sheets`}
                                className="p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
                                onClick={() => window.open(buildSheetUrl(SVOD_SPREADSHEET_ID, delta.sourceCell), '_blank', 'noopener,noreferrer')}
                              >
                                <ExternalLink size={11} className="text-blue-500" aria-hidden="true" />
                              </button>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                        <SideValue value={calculatedValue} missingNote="не пересчитан" />
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {bothSidesKnown ? (
                          <span className={clsx(
                            'font-medium',
                            isZero(row.deltaAbs) ? 'text-zinc-400 dark:text-zinc-500' : row.assessment === 'critical' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'
                          )}>
                            {isZero(row.deltaAbs) ? '0' : fmtNum(row.deltaAbs)}
                          </span>
                        ) : (
                          <span className="text-zinc-400 dark:text-zinc-500" title="Сравнивать не с чем: одна из сторон отсутствует">не сравнивалось</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {bothSidesKnown && delta?.deltaPercent != null ? (
                          <span className={clsx(
                            'font-medium',
                            isZero(row.deltaPct) ? 'text-zinc-400 dark:text-zinc-500' : row.deltaPct > 5 ? 'text-red-600 dark:text-red-400' : row.deltaPct > 1 ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-500 dark:text-zinc-400'
                          )}>
                            {fmtPct(row.deltaPct)}
                          </span>
                        ) : (
                          <span className="text-zinc-400 dark:text-zinc-500" title="Доля не считается: официальное число отсутствует или равно нулю">доли нет</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', cfg.bg, cfg.text)}>
                          <Icon size={12} aria-hidden="true" /> {cfg.label}
                        </span>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-zinc-50/80 dark:bg-zinc-900/40">
                        <td colSpan={6} className="px-5 py-4" id={panelId}>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                            <div className="space-y-2">
                              <div className="font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                                <FileSpreadsheet size={13} className="text-blue-500" aria-hidden="true" /> Официальное число
                              </div>
                              <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-3">
                                <div className="text-blue-800 dark:text-blue-300 font-mono text-[11px] flex items-center gap-1.5">
                                  {delta?.sourceCell ? `Ячейка ${delta.sourceCell}` : (
                                    <span className="font-sans text-blue-600 dark:text-blue-400">Адрес ячейки в снимке не сохранён</span>
                                  )}
                                  {delta?.sourceCell && (
                                    <button
                                      title="Открыть в Google Sheets"
                                      aria-label={`Открыть ячейку ${delta.sourceCell} листа СВОД в Google Sheets`}
                                      className="p-0.5 rounded hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
                                      onClick={() => window.open(buildSheetUrl(SVOD_SPREADSHEET_ID, delta.sourceCell), '_blank', 'noopener,noreferrer')}
                                    >
                                      <ExternalLink size={11} className="text-blue-500" aria-hidden="true" />
                                    </button>
                                  )}
                                </div>
                                <div className="text-blue-600 dark:text-blue-400 mt-1">
                                  Значение: <strong><SideValue value={officialValue} missingNote="в листе отсутствует" /></strong>
                                </div>
                              </div>
                            </div>
                            <div className="space-y-2">
                              <div className="font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                                <Info size={13} className="text-indigo-500" aria-hidden="true" /> Наш пересчёт
                              </div>
                              <div className="bg-indigo-50 dark:bg-indigo-950/30 rounded-lg p-3">
                                <div className="text-indigo-600 dark:text-indigo-400 mt-1">
                                  Результат: <strong><SideValue value={calculatedValue} missingNote="не построен" /></strong>
                                </div>
                                <div className="text-indigo-500 mt-0.5 text-[10px]">
                                  Считается заново, строка за строкой, по листу управления — формулы книги не используются
                                </div>
                              </div>
                            </div>
                            <div className="space-y-2">
                              <div className="font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                                {row.assessment === 'critical'
                                  ? <AlertTriangle size={13} className="text-red-500" aria-hidden="true" />
                                  : <CheckCircle2 size={13} className="text-emerald-500" aria-hidden="true" />}
                                Что делать
                              </div>
                              {/* Обводки нет (канон п.129): плитку отделяет заливка,
                                  а тяжесть названа значком и словами выше. */}
                              <div className={clsx(
                                'rounded-lg p-3 text-[11px] leading-relaxed',
                                row.assessment === 'critical' ? 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400' :
                                row.assessment === 'warning' ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400' :
                                'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400'
                              )}>
                                {!bothSidesKnown
                                  ? 'Сравнить нельзя: одной из сторон нет. Если отсутствует официальное число — проверьте, заполнена ли строка в листе СВОД; если нет пересчёта — строки управления за этот срез не прочитаны.'
                                  : row.assessment === 'ok'
                                  ? 'Числа сходятся. Дополнительных действий не требуется.'
                                  : row.assessment === 'warning'
                                  ? `Расхождение ${fmtPct(row.deltaPct)} — в пределах допуска, но не ноль. Проверьте при следующем обновлении данных.`
                                  : `Расхождение ${fmtPct(row.deltaPct)} — за пределами допуска. Откройте ячейку в книге и проверьте, тот ли диапазон строк она суммирует; затем проверьте сами строки: способ закупки и даты.`}
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
