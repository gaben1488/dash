// ── Плоский список подведов (E11-5): все подведомственные организации
//    отфильтрованных ГРБС по экономии убыв., максимум 60 строк на экране.
//    Клик по строке — переход в DataBrowser с фильтром по подведу.

import { ExternalLink } from 'lucide-react';
import { PctBadge, TriBar } from './primitives';
import type { SubordinateFlat } from '../../lib/economy/types';

/** Лимит строк на экране — дальше пользователя ведём в drill-down по ГРБС. */
const MAX_ROWS = 60;

export interface EconomySubTableProps {
  subs: SubordinateFlat[];
  formatMoney: (v: number) => string;
  onNavigateToSub: (deptId: string, subName: string) => void;
}

export function EconomySubTable({ subs, formatMoney, onNavigateToSub }: EconomySubTableProps) {
  return (
    <table className="w-full">
      <thead>
        <tr className="border-b border-white/[0.06]">
          <th className="px-2 py-1.5 text-left text-[9px] font-bold uppercase tracking-widest text-zinc-500">Организация</th>
          <th className="px-2 py-1.5 text-left text-[9px] font-bold uppercase tracking-widest text-zinc-500">ГРБС</th>
          <th className="px-2 py-1.5 text-right text-[9px] font-bold uppercase tracking-widest text-zinc-500">Лимит</th>
          <th className="px-2 py-1.5 text-right text-[9px] font-bold uppercase tracking-widest text-zinc-500">Факт</th>
          <th className="px-2 py-1.5 text-right text-[9px] font-bold uppercase tracking-widest text-zinc-500">Экономия</th>
          <th className="px-2 py-1.5 text-right text-[9px] font-bold uppercase tracking-widest text-zinc-500">%</th>
          <th className="px-2 py-1.5 text-center text-[9px] font-bold uppercase tracking-widest text-zinc-500 w-16">Бюджет</th>
        </tr>
      </thead>
      <tbody>
        {subs.slice(0, MAX_ROWS).map((sub, i) => (
          <tr
            key={`${sub.deptId}-${sub.name}-${i}`}
            className="border-b border-white/[0.02] hover:bg-white/[0.02] transition-colors cursor-pointer group/subrow"
            onClick={() => onNavigateToSub(sub.deptId, sub.name)}
          >
            <td className="px-2 py-1.5 text-[10px] text-zinc-300 truncate max-w-[200px]" title={sub.name}>
              <div className="flex items-center gap-1">
                <span className="truncate">{sub.name}</span>
                <ExternalLink size={8} className="shrink-0 opacity-0 group-hover/subrow:opacity-40 transition-opacity" />
              </div>
            </td>
            <td className="px-2 py-1.5">
              <span className="text-[9px] font-bold text-zinc-500 bg-white/[0.04] px-1.5 py-0.5 rounded">
                {sub.deptName}
              </span>
            </td>
            <td className="px-2 py-1.5 text-right text-[10px] tabular-nums text-zinc-500">{formatMoney(sub.planTotal)}</td>
            <td className="px-2 py-1.5 text-right text-[10px] tabular-nums text-zinc-500">{formatMoney(sub.factTotal)}</td>
            <td className="px-2 py-1.5 text-right text-[10px] tabular-nums font-bold text-emerald-400">{formatMoney(sub.economy)}</td>
            <td className="px-2 py-1.5 text-right"><PctBadge pct={sub.pct} compact /></td>
            <td className="px-2 py-1.5 w-16">
              <TriBar fb={sub.budget.economyFB} kb={sub.budget.economyKB} mb={sub.budget.economyMB} />
            </td>
          </tr>
        ))}
        {subs.length > MAX_ROWS && (
          <tr>
            <td colSpan={7} className="px-2 py-2 text-center text-[10px] text-zinc-600">
              Показано {MAX_ROWS} из {subs.length}. Выберите ГРБС для детализации.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
