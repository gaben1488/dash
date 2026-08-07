// ── Вкладка «По подведомственным»: организации, сгруппированные по управлениям,
//    с итогами.
//    Извлечено move-only из pages/Recon.tsx (разрез E11-4). Store не читает —
//    formatMoney и навигация приходят пропсами.
//
//    05.08.2026 — колонки приведены к канону. Было: «План (кол-во)» показывал
//    число строк выборки, «Факт (кол-во)» — сумму строк по способам (КП+ЕП),
//    отчего исполнение выходило около 100 % всегда. Стало: план и факт в
//    штуках берутся из квартальной базы движка (год = сумма четырёх
//    кварталов), исполнение показывается отдельно по количеству и по сумме,
//    а при отсутствии базы стоит прочерк, а не выдуманное число.
//
//    07.08.2026 — переплавка под читателя-руководителя: подписи столбцов
//    объясняются словами читателя, а не устройством движка; переход к строкам
//    организации доступен с клавиатуры; денежные столбцы названы с единицей.

import React from 'react';
import clsx from 'clsx';
import { Building2, Users } from 'lucide-react';
import { subordinateLabel } from '../../lib/subordinate-label';
import type { ReconDeptNode, ReconSubordinate } from '../../lib/recon/types';
import { fmtNum, fmtPct } from '../../lib/recon/format';
import {
  aggregateDeptSubordinates,
  subordinateCounts,
  subordinateExecCountPct,
  subordinateExecutionPct,
} from '../../lib/recon/subordinates';

const COLS = 10;

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** Бейдж процента с порогами. null — базы для расчёта нет, показываем прочерк. */
function PctBadge({ value, bold = false, title }: { value: number | null; bold?: boolean; title?: string }) {
  if (value == null) {
    return (
      <span className="text-zinc-400 dark:text-zinc-500 text-xs" title={title ?? 'Плана за выбранный период нет — доля не считается'}>
        нет плана
      </span>
    );
  }
  return (
    <span
      className={clsx(
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs tabular-nums',
        bold ? 'font-semibold' : 'font-medium',
        value >= 80
          ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400'
          : value >= 50
            ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400'
            : 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400',
      )}
    >
      {fmtPct(value)}
    </span>
  );
}

/** Число или честная пометка, когда считать не из чего. */
function NumCell({ value, bold = false }: { value: number | null; bold?: boolean }) {
  const cls = clsx(
    'px-4 py-2.5 text-right tabular-nums',
    bold ? 'font-semibold text-zinc-700 dark:text-zinc-200' : 'text-zinc-600 dark:text-zinc-300',
  );
  return (
    <td className={cls}>
      {value == null
        ? <span className="text-zinc-400 dark:text-zinc-500 font-normal" title="Квартальной базы за выбранный период в снимке нет">нет данных</span>
        : fmtNum(value)}
    </td>
  );
}

interface ReconSubordinatesTableProps {
  depts: ReconDeptNode[];
  formatMoney: (n: number) => string;
  /** Переход к строкам подведа на странице данных.
   *  DEPRECATED (целевая модель): передаёт сырой sub.name (вкл. sentinel '_org_itself');
   *  по filter-system-target-2026-07-16 §3.1 подвед должен ехать стабильным UnitId
   *  из SUBORDINATE_REGISTRY — заменить при переходе на FilterContext. */
  onOpenSubordinate: (deptKey: string, subordinateName: string) => void;
}

export function ReconSubordinatesTable({ depts, formatMoney, onOpenSubordinate }: ReconSubordinatesTableProps) {
  return (
    <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">План, факт и экономия подведомственных организаций, сгруппированные по управлениям</caption>
          <thead>
            <tr className="bg-zinc-50 dark:bg-zinc-900/50 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
              <th scope="col" className="px-5 py-3">Управление</th>
              <th scope="col" className="px-4 py-3">Подведомственная организация</th>
              <th scope="col" className="px-4 py-3 text-right" title="Сколько строк организации попало в выборку">Строк</th>
              <th scope="col" className="px-4 py-3 text-right" title="Сколько закупок запланировано за период; за год — сумма четырёх кварталов">План, позиций</th>
              <th scope="col" className="px-4 py-3 text-right" title="Сколько закупок имеют проставленную дату заключения">Заключено, позиций</th>
              <th scope="col" className="px-4 py-3 text-right" title="Заключено, делённое на план, по количеству позиций">Исполнение по количеству</th>
              <th scope="col" className="px-4 py-3 text-right">План, тыс. ₽</th>
              <th scope="col" className="px-4 py-3 text-right">Факт, тыс. ₽</th>
              <th scope="col" className="px-4 py-3 text-right" title="Факт, делённый на план, по суммам">Исполнение по сумме</th>
              <th scope="col" className="px-4 py-3 text-right" title="Снижение цены по итогам процедур">Экономия, тыс. ₽</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
            {depts.map((dept: ReconDeptNode) => {
              const subs: ReconSubordinate[] = dept.subordinates ?? [];
              if (subs.length === 0) return null;

              const totals = aggregateDeptSubordinates(subs);
              const deptName = dept.department?.nameShort ?? dept.department?.name ?? dept.department?.id ?? 'Управление без названия';
              const deptKey = dept.department?.id ?? deptName;

              return (
                <React.Fragment key={deptKey}>
                  {/* Шапка управления */}
                  <tr className="bg-zinc-100/70 dark:bg-zinc-900/50">
                    <th scope="colgroup" colSpan={COLS} className="px-5 py-2.5 text-left">
                      <span className="flex items-center gap-2">
                        <Building2 size={14} className="text-blue-500" aria-hidden="true" />
                        <span className="font-semibold text-zinc-700 dark:text-zinc-200 text-xs">{deptName}</span>
                        <span className="text-[10px] font-normal text-zinc-500 dark:text-zinc-400">
                          {subs.length} {plural(subs.length, 'подведомственная организация', 'подведомственные организации', 'подведомственных организаций')}
                        </span>
                      </span>
                    </th>
                  </tr>

                  {/* Строки подведомственных */}
                  {subs.map((sub: ReconSubordinate, idx: number) => {
                    const counts = subordinateCounts(sub);
                    const execCountPct = subordinateExecCountPct(sub);
                    const execAmountPct = subordinateExecutionPct(sub);
                    const subName = subordinateLabel(sub.name);
                    return (
                      <tr
                        key={`${deptKey}-${sub.name}-${idx}`}
                        className="hover:bg-zinc-50 dark:hover:bg-zinc-700/30 transition"
                      >
                        <td className="px-5 py-2.5"></td>
                        <th scope="row" className="px-4 py-2.5 text-left font-normal">
                          {/* Кнопка, а не клик по строке: переход к строкам организации
                              обязан работать с клавиатуры. */}
                          <button
                            onClick={() => onOpenSubordinate(deptKey, sub.name)}
                            aria-label={`Открыть строки организации «${subName}» на странице данных`}
                            className="flex items-center gap-2 text-left rounded hover:text-blue-600 dark:hover:text-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
                          >
                            <Users size={12} className="text-zinc-400" aria-hidden="true" />
                            <span className="text-zinc-700 dark:text-zinc-200 text-xs">{subName}</span>
                          </button>
                        </th>
                        <NumCell value={sub.rowCount ?? 0} />
                        <NumCell value={counts?.planCount ?? null} />
                        <NumCell value={counts?.factCount ?? null} />
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          <PctBadge value={execCountPct} />
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-zinc-600 dark:text-zinc-300">{formatMoney(sub.planTotal ?? 0)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-zinc-600 dark:text-zinc-300">{formatMoney(sub.factTotal ?? 0)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          <PctBadge value={execAmountPct} />
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-zinc-600 dark:text-zinc-300">{formatMoney(sub.economyTotal ?? 0)}</td>
                      </tr>
                    );
                  })}

                  {/* Итого по управлению */}
                  <tr className="bg-zinc-50/80 dark:bg-zinc-800/80 border-t border-zinc-200 dark:border-zinc-600">
                    <td className="px-5 py-2.5"></td>
                    <th scope="row" className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400">Итого {deptName}</th>
                    <NumCell value={totals.rowCount} bold />
                    <NumCell value={totals.planCount} bold />
                    <NumCell value={totals.factCount} bold />
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      <PctBadge value={totals.execCountPct} bold />
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-zinc-700 dark:text-zinc-200">{formatMoney(totals.planTotal)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-zinc-700 dark:text-zinc-200">{formatMoney(totals.factTotal)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      <PctBadge value={totals.execAmountPct} bold />
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-zinc-700 dark:text-zinc-200">{formatMoney(totals.economy)}</td>
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
