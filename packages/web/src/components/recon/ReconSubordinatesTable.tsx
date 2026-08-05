// ── Вкладка «По подведам»: подведы, сгруппированные по управлениям, с итогами.
//    Извлечено move-only из pages/Recon.tsx (разрез E11-4). Store не читает —
//    formatMoney и навигация приходят пропсами.
//
//    05.08.2026 — колонки приведены к канону. Было: «План (кол-во)» показывал
//    число строк выборки, «Факт (кол-во)» — сумму строк по способам (КП+ЕП),
//    отчего исполнение выходило около 100 % всегда. Стало: план и факт в
//    штуках берутся из квартальной базы движка (год = сумма четырёх
//    кварталов), исполнение показывается отдельно по количеству и по сумме,
//    а при отсутствии базы стоит прочерк, а не выдуманное число.

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

/** Бейдж процента с порогами. null — базы для расчёта нет, показываем прочерк. */
function PctBadge({ value, bold = false, title }: { value: number | null; bold?: boolean; title?: string }) {
  if (value == null) {
    return (
      <span className="text-zinc-300 dark:text-zinc-600" title={title ?? 'Нет базы для расчёта за выбранный период'}>
        —
      </span>
    );
  }
  return (
    <span
      className={clsx(
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs',
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

/** Число или прочерк, когда базы нет. */
function NumCell({ value, bold = false }: { value: number | null; bold?: boolean }) {
  const cls = clsx(
    'px-4 py-2.5 text-right tabular-nums',
    bold ? 'font-semibold text-zinc-700 dark:text-zinc-200' : 'text-zinc-600 dark:text-zinc-300',
  );
  return <td className={cls}>{value == null ? <span className="text-zinc-300 dark:text-zinc-600">—</span> : fmtNum(value)}</td>;
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
          <thead>
            <tr className="bg-zinc-50 dark:bg-zinc-900/50 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
              <th className="px-5 py-3">Управление</th>
              <th className="px-4 py-3">Подведомственная</th>
              <th className="px-4 py-3 text-right" title="Строк подведомственной в выборке">Строк</th>
              <th className="px-4 py-3 text-right" title="Плановых позиций за период; год — сумма четырёх плановых кварталов">План, поз.</th>
              <th className="px-4 py-3 text-right" title="Позиций с датой заключения (канон движка)">Заключено, поз.</th>
              <th className="px-4 py-3 text-right" title="Заключено ÷ план, по количеству позиций">Исполнение, кол-во</th>
              <th className="px-4 py-3 text-right">План, тыс.</th>
              <th className="px-4 py-3 text-right">Факт, тыс.</th>
              <th className="px-4 py-3 text-right" title="Факт ÷ план, по суммам">Исполнение, сумма</th>
              <th className="px-4 py-3 text-right">Экономия</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
            {depts.map((dept: ReconDeptNode) => {
              const subs: ReconSubordinate[] = dept.subordinates ?? [];
              if (subs.length === 0) return null;

              const totals = aggregateDeptSubordinates(subs);
              const deptName = dept.department?.nameShort ?? dept.department?.name ?? dept.department?.id ?? '?';
              const deptKey = dept.department?.id ?? deptName;

              return (
                <React.Fragment key={deptKey}>
                  {/* Шапка управления */}
                  <tr className="bg-zinc-100/70 dark:bg-zinc-900/50">
                    <td colSpan={COLS} className="px-5 py-2.5">
                      <div className="flex items-center gap-2">
                        <Building2 size={14} className="text-blue-500" />
                        <span className="font-semibold text-zinc-700 dark:text-zinc-200 text-xs">{deptName}</span>
                        <span className="text-[10px] text-zinc-400 dark:text-zinc-500">({subs.length} подведов)</span>
                      </div>
                    </td>
                  </tr>

                  {/* Строки подведомственных */}
                  {subs.map((sub: ReconSubordinate, idx: number) => {
                    const counts = subordinateCounts(sub);
                    const execCountPct = subordinateExecCountPct(sub);
                    const execAmountPct = subordinateExecutionPct(sub);
                    return (
                      <tr
                        key={`${deptKey}-${sub.name}-${idx}`}
                        className="hover:bg-zinc-50 dark:hover:bg-zinc-700/30 transition cursor-pointer"
                        onClick={() => onOpenSubordinate(deptKey, sub.name)}
                      >
                        <td className="px-5 py-2.5"></td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <Users size={12} className="text-zinc-400" />
                            <span className="text-zinc-700 dark:text-zinc-200 text-xs">{subordinateLabel(sub.name)}</span>
                          </div>
                        </td>
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
                    <td className="px-4 py-2.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">Итого {deptName}</td>
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
