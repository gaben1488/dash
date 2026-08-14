// ── Таблица сверки «По управлениям» (год-уровень): бейджи-саммари, таблица,
//    раскрывающаяся диагностика со ссылками на ячейки СВОД ТД-ПМ.
//    Извлечено move-only из pages/Recon.tsx (разрез E11-4). Store не читает.
//
//    07.08.2026 — переплавка под читателя-руководителя:
//    • вердикт строки берётся из ядра (assessment.status), а не из местного
//      словаря: ядро различает «нечего сравнивать» и «лист СВОД не считает»,
//      а местный словарь оба случая звал «нет данных» — и сломанный лист
//      выглядел как обычная пустота;
//    • прочерк в столбце «Источник» заменён словами: «—» читателю ничего
//      не сообщает;
//    • рекомендация перестала ссылаться на порог классификатора и на букву
//      столбца — читателю нужен предмет проверки, а не устройство движка;
//    • строка раскрывается с клавиатуры (заголовок строки стал кнопкой).

import React from 'react';
import clsx from 'clsx';
import { AlertTriangle, ArrowRight, Building2, CheckCircle2, ChevronDown, ChevronUp, Clock, ExternalLink, FileSpreadsheet, Info } from 'lucide-react';
import { SVOD_SPREADSHEET_ID } from '@aemr/shared';
import type { ReconDeptRow } from '../../lib/recon/types';
import { fmtNum, fmtPct, isZero } from '../../lib/recon/format';
import { diagnoseDelta } from '../../lib/recon/diagnose';
import { buildSheetUrl, DEPT_SVOD_CELLS } from '../../lib/recon/sheet-links';
import { RootCauseList } from './RootCauseCard';

/** Цвет и значок вердикта. Подпись приходит из ядра — здесь её нет намеренно. */
const KIND_CONFIG = {
  ok:      { summary: 'совпадает',        bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-400', icon: CheckCircle2 },
  neutral: { summary: 'нечего сравнивать', bg: 'bg-zinc-100 dark:bg-zinc-800',        text: 'text-zinc-500 dark:text-zinc-400',       icon: Info },
  warning: { summary: 'несопоставимо',    bg: 'bg-amber-50 dark:bg-amber-950/30',     text: 'text-amber-700 dark:text-amber-400',     icon: Clock },
  high:    { summary: 'расходится',       bg: 'bg-red-50 dark:bg-red-950/30',         text: 'text-red-700 dark:text-red-400',         icon: AlertTriangle },
} as const;

interface ReconDeptTableProps {
  rows: ReconDeptRow[];
  counts: { ok: number; neutral: number; warning: number; high: number };
  expandedDept: string | null;
  onToggleDept: (dept: string | null) => void;
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/**
 * Заголовок-утверждение: что именно показала сверка. Витринное название
 * («Сверка по управлениям») читателю не сообщает ничего — вывод сообщает.
 */
function verdictHeadline(
  counts: { ok: number; neutral: number; warning: number; high: number },
  /**
   * Все ли разницы РОВНО нулевые. Канон п.64: слово «чиста» разрешено только
   * при нуле. Разница в пределах допуска — это «сошлось в пределах допуска»,
   * и она обязана оставаться разбираемой: сотрудница увидела «Сверка чиста:
   * сходятся все 8» рядом с жёлтым −181,9 и справедливо перестала верить
   * вкладке (жалоба 14.08.2026).
   */
  allZero: boolean,
): string {
  const total = counts.ok + counts.neutral + counts.warning + counts.high;
  const units = (n: number) => `${n} ${plural(n, 'управление', 'управления', 'управлений')}`;
  if (counts.high > 0) return `Расходятся ${units(counts.high)} из ${total}`;
  if (counts.warning > 0) return `Явных расхождений нет, но ${units(counts.warning)} несопоставимы`;
  if (counts.ok > 0) {
    return allZero
      ? `Сверка чиста: сходятся все ${units(counts.ok)}`
      : `Сверх допуска не вышло ни одно управление; у части разница ненулевая — раскройте строку`;
  }
  return 'Сравнивать не с чем ни по одному управлению';
}

export function ReconDeptTable({ rows, counts, expandedDept, onToggleDept }: ReconDeptTableProps) {
  return (
    <>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
          {verdictHeadline(counts, rows.every((r) => isZero(r.planDelta) && isZero(r.factDelta) && isZero(r.ecoDelta)))}
        </h3>

        {/* Summary badges */}
        <div className="flex flex-wrap gap-3 text-xs">
          {counts.ok > 0 && (
            <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 font-medium">
              <CheckCircle2 size={13} aria-hidden="true" /> {counts.ok} {KIND_CONFIG.ok.summary}
            </span>
          )}
          {counts.warning > 0 && (
            <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 font-medium">
              <Clock size={13} aria-hidden="true" /> {counts.warning} {KIND_CONFIG.warning.summary}
            </span>
          )}
          {counts.high > 0 && (
            <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 font-medium">
              <AlertTriangle size={13} aria-hidden="true" /> {counts.high} {KIND_CONFIG.high.summary}
            </span>
          )}
          {counts.neutral > 0 && (
            <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 font-medium">
              <Info size={13} aria-hidden="true" /> {counts.neutral} {KIND_CONFIG.neutral.summary}
            </span>
          )}
        </div>
      </div>

      {/* Department reconciliation table */}
      <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Годовая сверка по управлениям: официальные числа листа СВОД против пересчёта по строкам</caption>
            <thead>
              <tr className="bg-zinc-50 dark:bg-zinc-900/50 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                <th scope="col" className="px-5 py-3">Управление</th>
                <th scope="col" className="px-4 py-3 text-right" title="План года по листу СВОД ТД-ПМ, тыс. ₽">План, официально</th>
                <th scope="col" className="px-4 py-3 text-right" title="План года по пересчёту строк, тыс. ₽">План, пересчёт</th>
                <th scope="col" className="px-4 py-3 text-right">Расхождение по плану</th>
                <th scope="col" className="px-4 py-3 text-right" title="Факт года по листу СВОД ТД-ПМ, тыс. ₽">Факт, официально</th>
                <th scope="col" className="px-4 py-3 text-right" title="Факт года по пересчёту строк, тыс. ₽">Факт, пересчёт</th>
                <th scope="col" className="px-4 py-3 text-right">Расхождение по факту</th>
                <th scope="col" className="px-4 py-3 text-center" title="Чья сторона вероятнее ошиблась">Кто вероятнее ошибся</th>
                <th scope="col" className="px-4 py-3 text-center">Вердикт</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
              {rows.map((row) => {
                const cfg = KIND_CONFIG[row.assessment.kind];
                const Icon = cfg.icon;
                const isExpanded = expandedDept === row.department;
                const panelId = `recon-dept-${String(row.department).replace(/[^\w-]/g, '_')}`;

                return (
                  <React.Fragment key={row.department}>
                    <tr
                      className={clsx(
                        'transition',
                        row.assessment.kind === 'high' && 'bg-red-50/30 dark:bg-red-950/20',
                        row.assessment.kind === 'warning' && 'bg-amber-50/20 dark:bg-amber-950/15',
                        isExpanded ? 'bg-blue-50/30 dark:bg-blue-950/20' : 'hover:bg-zinc-50 dark:hover:bg-zinc-700/30',
                      )}
                    >
                      <th scope="row" className="px-5 py-3 text-left font-normal">
                        <button
                          onClick={() => onToggleDept(isExpanded ? null : row.department)}
                          aria-expanded={isExpanded}
                          aria-controls={panelId}
                          className="flex items-center gap-2 text-left rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
                        >
                          <Building2 size={14} className="text-zinc-400" aria-hidden="true" />
                          <span className="font-semibold text-zinc-700 dark:text-zinc-200">{row.department}</span>
                          {isExpanded
                            ? <ChevronUp size={12} className="text-zinc-400" aria-hidden="true" />
                            : <ChevronDown size={12} className="text-zinc-400" aria-hidden="true" />}
                        </button>
                      </th>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-300">{fmtNum(row.fullPlanOfficial)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-300">{fmtNum(row.fullPlanCalculated)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <span className={clsx(
                          'font-medium',
                          isZero(row.planDelta) ? 'text-zinc-400 dark:text-zinc-500'
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
                          isZero(row.factDelta) ? 'text-zinc-400 dark:text-zinc-500'
                            : row.assessment.kind === 'high' ? 'text-red-600 dark:text-red-400'
                            : 'text-amber-600 dark:text-amber-400',
                        )}>
                          {isZero(row.factDelta) ? '0' : fmtNum(row.factDelta)}
                          {!isZero(row.factDeltaPct) && <span className="text-[10px] ml-1">({fmtPct(row.factDeltaPct)})</span>}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {/* Прочерк ядра означает «расхождения нет» — говорим это словами */}
                        <span className={clsx(
                          'text-[11px] font-medium',
                          row.assessment.source === 'svod_error' ? 'text-red-500 dark:text-red-400'
                            : row.assessment.source === 'calc_error' ? 'text-amber-600 dark:text-amber-400'
                            : row.assessment.source === 'methodology' ? 'text-blue-500 dark:text-blue-400'
                            : 'text-zinc-400 dark:text-zinc-500',
                        )}>
                          {/* Канон п.64: «разбирать нечего» разрешено только при
                              НУЛЕВОЙ разнице. Ненулевая, пусть и в пределах
                              допуска, обязана предлагать разбор — иначе продукт
                              просит поверить ему на слово (жалоба 14.08). */}
                          {row.assessment.source === 'none' || !row.assessment.sourceLabel || row.assessment.sourceLabel === '—'
                            ? (isZero(row.planDelta) && isZero(row.factDelta) && isZero(row.ecoDelta)
                                ? 'разбирать нечего'
                                : 'причина не установлена — раскрыть строку')
                            : row.assessment.sourceLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', cfg.bg, cfg.text)}>
                          <Icon size={12} aria-hidden="true" /> {row.assessment.status}
                        </span>
                      </td>
                    </tr>

                    {/* Expanded detail */}
                    {isExpanded && (() => {
                      const diag = diagnoseDelta(row);
                      const cells = DEPT_SVOD_CELLS[row.department];
                      return (
                      <tr className="bg-zinc-50/80 dark:bg-zinc-900/40">
                        <td colSpan={9} className="px-5 py-4" id={panelId}>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
                            {/* Diagnosis */}
                            <div className="space-y-2">
                              <div className="font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                                <AlertTriangle size={13} className={diag.severity === 'error' ? 'text-red-500' : diag.severity === 'warn' ? 'text-amber-500' : 'text-emerald-500'} aria-hidden="true" />
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
                                <FileSpreadsheet size={13} className="text-blue-500" aria-hidden="true" /> Официальные ячейки листа СВОД
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
                                            aria-label={`Открыть ячейку ${cell} листа СВОД в Google Sheets`}
                                            title={`Открыть ячейку ${cell} в Google Sheets`}
                                            className="p-0.5 rounded hover:bg-blue-200 dark:hover:bg-blue-800 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
                                            onClick={() => window.open(buildSheetUrl(SVOD_SPREADSHEET_ID, cell as string), '_blank')}
                                          >
                                            <ExternalLink size={9} className="text-blue-500" aria-hidden="true" />
                                          </button>
                                        </span>
                                      </div>
                                    ))}
                                  </>
                                ) : (
                                  <span className="text-blue-700 dark:text-blue-400 text-[10px]">
                                    Это управление не привязано к строкам листа СВОД ТД-ПМ: открыть официальную ячейку нечем.
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Economy comparison */}
                            <div className="space-y-2">
                              <div className="font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                                <Info size={13} className="text-indigo-500" aria-hidden="true" /> Экономия за год
                              </div>
                              <div className="bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 rounded-lg p-3">
                                <div className="flex justify-between text-[10px]">
                                  <span className="text-indigo-600 dark:text-indigo-400">Официально:</span>
                                  <strong className="text-indigo-800 dark:text-indigo-300 tabular-nums">{fmtNum(row.ecoTotalOfficial)}</strong>
                                </div>
                                <div className="flex justify-between mt-1 text-[10px]">
                                  <span className="text-indigo-600 dark:text-indigo-400">Пересчёт:</span>
                                  <strong className="text-indigo-800 dark:text-indigo-300 tabular-nums">{fmtNum(row.ecoTotalCalculated)}</strong>
                                </div>
                                <div className="flex justify-between mt-1 pt-1 border-t border-indigo-200 dark:border-indigo-700 text-[10px]">
                                  <span className="text-indigo-600 dark:text-indigo-400">Расхождение:</span>
                                  <strong className={clsx('tabular-nums', isZero(row.ecoDelta) ? 'text-indigo-400' : 'text-indigo-800 dark:text-indigo-300')}>
                                    {fmtNum(row.ecoDelta)}
                                  </strong>
                                </div>
                              </div>
                            </div>

                            {/* Recommendation */}
                            <div className="space-y-2">
                              <div className="font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                                <ArrowRight size={13} className="text-violet-500" aria-hidden="true" /> Что делать
                              </div>
                              <div className="bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 rounded-lg p-3 text-[10px] text-violet-700 dark:text-violet-400 leading-relaxed">
                                {row.assessment.kind === 'ok'
                                  ? 'Числа сходятся. Дополнительных действий не требуется.'
                                  : row.assessment.kind === 'warning'
                                  ? 'Проверьте состав строк: часть закупок могла не опознаться по способу или попасть в соседний период. Обычная причина — незаполненный способ закупки и сроки без года.'
                                  : row.assessment.kind === 'high'
                                  ? `Разбирайте по порядку: откройте официальную ячейку${cells ? ` ${cells.planTotal}` : ''} и проверьте, тот ли диапазон строк она суммирует; затем проверьте сами строки — заполнен ли способ закупки, проставлены ли сроки, нет ли задвоенных строк.`
                                  : 'Сравнивать не с чем: одна из сторон пуста. Проверьте, что прочитаны обе книги — и лист СВОД, и лист управления.'}
                              </div>
                            </div>
                          </div>

                          {/* Первопричины: путь до строки-виновницы (требование
                              владельца 07.08). Догадка «проверьте формулы»
                              выше — эвристика; здесь адреса строк. */}
                          <div className="mt-4 space-y-2">
                            <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                              <AlertTriangle size={13} className="text-amber-500" aria-hidden="true" />
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
