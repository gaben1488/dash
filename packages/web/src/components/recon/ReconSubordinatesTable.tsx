// ── Вкладка «По подведам»: подведы, сгруппированные по управлениям, с итогами.
//    Извлечено move-only из pages/Recon.tsx (разрез E11-4). Store не читает —
//    formatMoney и навигация приходят пропсами.

import React from 'react';
import clsx from 'clsx';
import { Building2, Users } from 'lucide-react';
import { subordinateLabel } from '../../lib/subordinate-label';
import type { ReconDeptNode, ReconSubordinate } from '../../lib/recon/types';
import { fmtNum, fmtPct } from '../../lib/recon/format';
import { aggregateDeptSubordinates, subordinateExecutionPct } from '../../lib/recon/subordinates';

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
              <th className="px-4 py-3 text-right">План (кол-во)</th>
              <th className="px-4 py-3 text-right">Факт (кол-во)</th>
              <th className="px-4 py-3 text-right">Исполнение %</th>
              <th className="px-4 py-3 text-right">План (тыс.)</th>
              <th className="px-4 py-3 text-right">Факт (тыс.)</th>
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
                  {/* Department header */}
                  <tr className="bg-zinc-100/70 dark:bg-zinc-900/50">
                    <td colSpan={8} className="px-5 py-2.5">
                      <div className="flex items-center gap-2">
                        <Building2 size={14} className="text-blue-500" />
                        <span className="font-semibold text-zinc-700 dark:text-zinc-200 text-xs">{deptName}</span>
                        <span className="text-[10px] text-zinc-400 dark:text-zinc-500">({subs.length} подведов)</span>
                      </div>
                    </td>
                  </tr>

                  {/* Subordinate rows */}
                  {subs.map((sub: ReconSubordinate, idx: number) => {
                    const execPct = subordinateExecutionPct(sub);
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
                        <td className="px-4 py-2.5 text-right tabular-nums text-zinc-600 dark:text-zinc-300">{fmtNum(sub.rowCount ?? 0)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-zinc-600 dark:text-zinc-300">{fmtNum((sub.competitiveCount ?? 0) + (sub.epCount ?? 0))}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          <span className={clsx(
                            'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                            execPct >= 80 ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400'
                              : execPct >= 50 ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400'
                              : 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400',
                          )}>
                            {fmtPct(execPct)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-zinc-600 dark:text-zinc-300">{formatMoney(sub.planTotal ?? 0)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-zinc-600 dark:text-zinc-300">{formatMoney(sub.factTotal ?? 0)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-zinc-600 dark:text-zinc-300">{formatMoney(sub.economyTotal ?? 0)}</td>
                      </tr>
                    );
                  })}

                  {/* Department subtotal */}
                  <tr className="bg-zinc-50/80 dark:bg-zinc-800/80 border-t border-zinc-200 dark:border-zinc-600">
                    <td className="px-5 py-2.5"></td>
                    <td className="px-4 py-2.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">Итого {deptName}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-zinc-700 dark:text-zinc-200">{fmtNum(totals.planCount)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-zinc-700 dark:text-zinc-200">{fmtNum(totals.factCount)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      <span className={clsx(
                        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold',
                        totals.execPct >= 80 ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400'
                          : totals.execPct >= 50 ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400'
                          : 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400',
                      )}>
                        {fmtPct(totals.execPct)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-zinc-700 dark:text-zinc-200">{formatMoney(totals.planTotal)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-zinc-700 dark:text-zinc-200">{formatMoney(totals.factTotal)}</td>
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
