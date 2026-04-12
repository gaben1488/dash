import { useState } from 'react';
import clsx from 'clsx';
import { ArrowUpDown, ChevronRight } from 'lucide-react';
import { getExecutionTextClass } from '../lib/chart-colors';

interface DeptRow {
  id: string;
  name: string;
  nameShort: string;
  execAmountPct: number | null;
  execCountPct: number | null;
  trustScore: number | null;
  issueCount: number;
  criticalIssueCount: number;
}

type SortKey = 'execCountPct' | 'execAmountPct' | 'trustScore' | 'issueCount';

interface RatingTableProps {
  departments: DeptRow[];
  onDeptClick: (deptId: string) => void;
  onDeptDetail: (deptId: string) => void;
}

/**
 * Sortable rating table of 8 ГРБС.
 * Persona: Наталья (★★★) — рейтинг, Виктор (★★★) — "кто не выполнил?"
 * Columns: Rank, Name, ExecCount%, ExecAmount%, Trust, Issues
 */
export function RatingTable({ departments, onDeptClick, onDeptDetail }: RatingTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('execCountPct');
  const [sortAsc, setSortAsc] = useState(false);

  const sorted = [...departments].sort((a, b) => {
    const va = a[sortKey] ?? -1;
    const vb = b[sortKey] ?? -1;
    return sortAsc ? va - vb : vb - va;
  });

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const SortHeader = ({ label, field, className }: { label: string; field: SortKey; className?: string }) => (
    <th
      className={clsx('px-2 py-2 text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase cursor-pointer hover:text-blue-500 transition select-none', className)}
      onClick={() => toggleSort(field)}
    >
      <div className="flex items-center gap-0.5">
        {label}
        <ArrowUpDown size={10} className={clsx(sortKey === field ? 'text-blue-500' : 'opacity-30')} />
      </div>
    </th>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-zinc-200 dark:border-zinc-700/50">
            <th className="px-2 py-2 text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase w-8">#</th>
            <th className="px-2 py-2 text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase text-left">ГРБС</th>
            <SortHeader label="По кол-ву" field="execCountPct" />
            <SortHeader label="По сумме" field="execAmountPct" />
            <SortHeader label="Доверие" field="trustScore" />
            <SortHeader label="Замечания" field="issueCount" />
            <th className="px-1 py-2 w-6" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((dept, i) => (
            <tr
              key={dept.id}
              className="border-b border-zinc-100 dark:border-zinc-700/30 hover:bg-zinc-50 dark:hover:bg-zinc-700/30 cursor-pointer transition"
              onClick={() => onDeptClick(dept.id)}
            >
              <td className="px-2 py-2 text-center text-zinc-400 tabular-nums">{i + 1}</td>
              <td className="px-2 py-2 font-medium text-zinc-700 dark:text-zinc-200">{dept.nameShort}</td>
              <td className={clsx('px-2 py-2 text-center font-bold tabular-nums', getExecutionTextClass(dept.execCountPct))}>
                {dept.execCountPct != null ? `${dept.execCountPct.toFixed(1)}%` : '—'}
              </td>
              <td className={clsx('px-2 py-2 text-center font-medium tabular-nums', getExecutionTextClass(dept.execAmountPct))}>
                {dept.execAmountPct != null ? `${dept.execAmountPct.toFixed(1)}%` : '—'}
              </td>
              <td className="px-2 py-2 text-center">
                <span className={clsx(
                  'inline-block px-1.5 py-0.5 rounded text-[10px] font-bold',
                  (dept.trustScore ?? 0) >= 80 ? 'bg-emerald-500/10 text-emerald-500' :
                  (dept.trustScore ?? 0) >= 60 ? 'bg-amber-500/10 text-amber-500' :
                  'bg-red-500/10 text-red-500',
                )}>
                  {dept.trustScore ?? '—'}
                </span>
              </td>
              <td className="px-2 py-2 text-center tabular-nums">
                {dept.criticalIssueCount > 0 && (
                  <span className="text-red-500 font-bold mr-1">{dept.criticalIssueCount}</span>
                )}
                <span className="text-zinc-400">{dept.issueCount}</span>
              </td>
              <td className="px-1 py-2">
                <button
                  onClick={(e) => { e.stopPropagation(); onDeptDetail(dept.id); }}
                  className="text-zinc-300 dark:text-zinc-600 hover:text-blue-500 transition"
                  title="Подробнее"
                >
                  <ChevronRight size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
