// ── Таблица «Экономия по управлениям» (E11-5): сортируемые колонки,
//    drill-down по ГРБС (бюджеты → структура расходов: само управление +
//    подведы), инлайн-рекомендации (>25% / конфликты), итоговая строка.

import { Fragment } from 'react';
import clsx from 'clsx';
import {
  AlertTriangle, Building2, ChevronRight, ExternalLink,
  CircleDot, Layers, Sparkles, Zap,
} from 'lucide-react';
import { KBTooltip } from '../ui/kb-tooltip';
import { BT, EconomyProgress, MiniSpark, PctBadge, SortChevron, TriBar } from './primitives';
import { ORG_ITSELF } from '../../lib/economy/types';
import type { DeptEconomy, SortDir, SortField, SubEconomy } from '../../lib/economy/types';
import type { EconomyTotals } from '../../lib/economy/dept-economy';

type Fmt = (v: number) => string;

/** Строка бюджета (ФБ/КБ/МБ) внутри развёрнутого ГРБС. */
function BudgetRow({ label, plan, fact, economy, fmt, tk }: {
  label: string; plan: number; fact: number; economy: number;
  fmt: Fmt; tk: 'fb' | 'kb' | 'mb';
}) {
  const t = BT[tk];
  const pct = plan > 0 ? (economy / plan) * 100 : 0;
  return (
    <tr className="text-[10px] border-t border-white/[0.03]">
      <td className="pl-10 pr-2 py-1">
        <span className={clsx('flex items-center gap-1.5 font-medium', t.text)}>
          <span className={clsx('w-1.5 h-1.5 rounded-full', t.dot)} />
          {label}
        </span>
      </td>
      <td className="px-2 py-1 text-right tabular-nums text-zinc-500">{fmt(plan)}</td>
      <td className="px-2 py-1 text-right tabular-nums text-zinc-500">{fmt(fact)}</td>
      <td className="px-2 py-1 text-right tabular-nums text-emerald-400 font-medium">{fmt(economy)}</td>
      <td className="px-2 py-1 text-right"><PctBadge pct={pct} compact /></td>
      <td colSpan={3} />
    </tr>
  );
}

/** Строка подведа внутри развёрнутого ГРБС; клик — переход в DataBrowser. */
function SubRow({ sub, fmt, onNav }: { sub: SubEconomy; fmt: Fmt; onNav?: () => void }) {
  return (
    <tr className="text-[10px] border-t border-white/[0.02] hover:bg-white/[0.02] transition-colors group/sub">
      <td className="pl-10 pr-2 py-1">
        <button
          onClick={onNav}
          className="text-zinc-400 hover:text-blue-400 transition-colors text-left truncate max-w-[180px] flex items-center gap-1.5"
          title={sub.name}
        >
          <CircleDot size={7} className="shrink-0 text-zinc-600" />
          <span className="truncate">{sub.name}</span>
          <ExternalLink size={7} className="shrink-0 opacity-0 group-hover/sub:opacity-60 transition-opacity" />
        </button>
      </td>
      <td className="px-2 py-1 text-right tabular-nums text-zinc-500">{fmt(sub.planTotal)}</td>
      <td className="px-2 py-1 text-right tabular-nums text-zinc-500">{fmt(sub.factTotal)}</td>
      <td className="px-2 py-1 text-right tabular-nums text-emerald-400/80">{fmt(sub.economy)}</td>
      <td className="px-2 py-1 text-right"><PctBadge pct={sub.pct} compact /></td>
      <td className="px-2 py-1">
        <TriBar fb={sub.budget.economyFB} kb={sub.budget.economyKB} mb={sub.budget.economyMB} />
      </td>
      <td colSpan={2} />
    </tr>
  );
}

export interface EconomyDeptTableProps {
  rows: DeptEconomy[];
  totals: EconomyTotals;
  expandedDepts: ReadonlySet<string>;
  onToggleExpand: (dept: string) => void;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (field: SortField) => void;
  /** Квартальные спарклайны по deptKey. */
  deptSparks: Record<string, number[]>;
  formatMoney: Fmt;
  onToggleDepartment: (deptId: string) => void;
  onNavigateToSub: (deptId: string, subName: string) => void;
}

export function EconomyDeptTable({
  rows, totals, expandedDepts, onToggleExpand,
  sortField, sortDir, onSort, deptSparks,
  formatMoney, onToggleDepartment, onNavigateToSub,
}: EconomyDeptTableProps) {
  const TH = ({ label, field, metric, align = 'right', w }: {
    label: string; field: SortField; metric?: string; align?: 'left' | 'right' | 'center'; w?: string;
  }) => (
    <th
      className={clsx(
        'px-2 py-1.5 text-[9px] font-bold uppercase tracking-widest cursor-pointer select-none whitespace-nowrap',
        'text-zinc-500 hover:text-zinc-300 transition-colors',
        align === 'left' ? 'text-left' : align === 'center' ? 'text-center' : 'text-right',
        w,
      )}
      onClick={() => onSort(field)}
    >
      {metric ? (
        <KBTooltip metric={metric} side="top" showIcon>
          <span className="inline-flex items-center gap-0.5">
            {label}<SortChevron field={field} active={sortField} dir={sortDir} />
          </span>
        </KBTooltip>
      ) : (
        <span className="inline-flex items-center gap-0.5">
          {label}<SortChevron field={field} active={sortField} dir={sortDir} />
        </span>
      )}
    </th>
  );

  return (
    <table className="w-full">
      <thead>
        <tr className="border-b border-white/[0.06]">
          <TH label="Управление" field="dept" align="left" w="w-[180px]" />
          <TH label="Лимит" field="limit" metric="plan_total" />
          <TH label="Факт" field="price" metric="fact_total" />
          <TH label="Экономия" field="economy" metric="total_economy" />
          <TH label="%" field="pct" metric="avg_reduction_pct" />
          <th className="px-2 py-1.5 text-[9px] font-bold uppercase tracking-widest text-zinc-500 text-center w-20">
            <KBTooltip metric="total_economy" side="top">
              <span>ФБ/КБ/МБ</span>
            </KBTooltip>
          </th>
          {/* Подпись — из словаря продукта: буква колонки листа наружу не выходит (канон §6.3). */}
          <TH label="Конфликты" field="conflicts" metric="economy_conflicts" align="center" />
          <TH label="Орг." field="subCount" align="center" />
        </tr>
      </thead>
      <tbody>
        {rows.map((d) => {
          const isExp = expandedDepts.has(d.dept);
          const b = d.budget;
          const spark = deptSparks[d.dept];
          const orgItself = d.subordinates.find(s => s.name === ORG_ITSELF);
          const realSubs = d.subordinates.filter(s => s.name !== ORG_ITSELF);
          return (
            <Fragment key={d.dept}>
              <tr
                className={clsx(
                  'transition-all duration-150 cursor-pointer group/row border-b',
                  isExp
                    ? 'bg-blue-500/[0.04] border-blue-500/10'
                    : 'border-white/[0.03] hover:bg-white/[0.02]',
                )}
                onClick={() => onToggleExpand(d.dept)}
              >
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <ChevronRight
                      size={11}
                      className={clsx(
                        'text-zinc-600 transition-transform duration-200 shrink-0',
                        isExp && 'rotate-90 text-blue-400',
                      )}
                    />
                    <button
                      onClick={(e) => { e.stopPropagation(); onToggleDepartment(d.deptId); }}
                      className="text-[11px] font-bold text-zinc-300 hover:text-blue-400 transition-colors truncate max-w-[140px]"
                      title={d.dept}
                    >
                      {d.dept}
                    </button>
                    {d.highEconomy && (
                      <span className="inline-flex items-center gap-0.5 px-1 py-px rounded bg-red-500/10 text-[8px] font-black text-red-400 tracking-wider">
                        <Zap size={7} />&gt;25%
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-2 py-1.5 text-right text-[11px] tabular-nums text-zinc-400">{formatMoney(d.limit)}</td>
                <td className="px-2 py-1.5 text-right text-[11px] tabular-nums text-zinc-400">{formatMoney(d.price)}</td>
                <td className="px-2 py-1.5 text-right">
                  <div className="space-y-0.5">
                    <div className="flex items-center justify-end gap-1.5">
                      <MiniSpark data={spark} color={d.economy >= 0 ? '#10b981' : '#ef4444'} />
                      <span className="text-[11px] font-bold tabular-nums text-emerald-400">{formatMoney(d.economy)}</span>
                    </div>
                    <EconomyProgress limit={d.limit} fact={d.price} className="w-full" />
                  </div>
                </td>
                <td className="px-2 py-1.5 text-right"><PctBadge pct={d.pct} /></td>
                <td className="px-2 py-1.5 w-20">
                  <TriBar fb={b.economyFB} kb={b.economyKB} mb={b.economyMB} />
                </td>
                <td className="px-2 py-1.5 text-center">
                  {d.conflicts > 0 ? (
                    <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-400">
                      <AlertTriangle size={9} />{d.conflicts}
                    </span>
                  ) : (
                    <span className="text-[10px] text-emerald-500/60">--</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-center">
                  {d.realSubCount > 0 ? (
                    <span className={clsx(
                      'text-[10px] tabular-nums font-semibold',
                      isExp ? 'text-blue-400' : 'text-zinc-500',
                    )}>
                      {d.realSubCount}
                    </span>
                  ) : (
                    <span className="text-zinc-700">--</span>
                  )}
                </td>
              </tr>

              {isExp && (
                <>
                  <BudgetRow label="ФБ (федеральный)" plan={b.planFB} fact={b.factFB} economy={b.economyFB} fmt={formatMoney} tk="fb" />
                  <BudgetRow label="КБ (краевой)" plan={b.planKB} fact={b.factKB} economy={b.economyKB} fmt={formatMoney} tk="kb" />
                  <BudgetRow label="МБ (муниципальный)" plan={b.planMB} fact={b.factMB} economy={b.economyMB} fmt={formatMoney} tk="mb" />

                  {d.subordinates.length > 0 && (
                    <>
                      <tr className="border-t border-white/[0.03]">
                        <td colSpan={8} className="pl-8 pr-4 pt-1.5 pb-0.5">
                          <span className="text-[9px] font-black text-zinc-600 uppercase tracking-[0.15em] flex items-center gap-1.5">
                            <Building2 size={8} />
                            Структура расходов
                          </span>
                        </td>
                      </tr>

                      {/* Само управление — реальные данные ORG_ITSELF (колонка C) */}
                      {orgItself && (
                        <tr className="text-[10px] border-t border-white/[0.02] bg-blue-500/[0.03]">
                          <td className="pl-10 pr-2 py-1">
                            <span className="flex items-center gap-1.5 font-semibold text-blue-300">
                              <Building2 size={7} className="shrink-0" />
                              {d.dept} (само)
                            </span>
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums text-zinc-400">{formatMoney(orgItself.planTotal)}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-zinc-400">{formatMoney(orgItself.factTotal)}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-emerald-400 font-medium">{formatMoney(orgItself.economy)}</td>
                          <td className="px-2 py-1 text-right"><PctBadge pct={orgItself.pct} compact /></td>
                          <td className="px-2 py-1">
                            <TriBar fb={orgItself.budget.economyFB} kb={orgItself.budget.economyKB} mb={orgItself.budget.economyMB} />
                          </td>
                          <td colSpan={2} />
                        </tr>
                      )}

                      {realSubs.length > 0 && (
                        <>
                          <tr className="border-t border-white/[0.03]">
                            <td colSpan={8} className="pl-8 pr-4 py-1">
                              <span className="text-[9px] font-black text-zinc-600 uppercase tracking-[0.15em] flex items-center gap-1.5">
                                <Layers size={8} />
                                Подведомственные ({realSubs.length})
                                <span className="ml-auto text-[8px] font-medium normal-case tracking-normal text-zinc-700">
                                  клик = DataBrowser
                                </span>
                              </span>
                            </td>
                          </tr>
                          {realSubs.map(sub => (
                            <SubRow
                              key={sub.name}
                              sub={sub}
                              fmt={formatMoney}
                              onNav={() => onNavigateToSub(d.deptId, sub.name)}
                            />
                          ))}
                        </>
                      )}
                    </>
                  )}

                  {(d.highEconomy || d.conflicts > 0) && (
                    <tr className="border-t border-amber-500/10">
                      <td colSpan={8} className="px-8 py-1.5">
                        <div className="flex items-start gap-2 text-[10px]">
                          <Sparkles size={10} className="text-amber-400 mt-0.5 shrink-0" />
                          <div className="text-amber-300/80 space-y-0.5">
                            {d.highEconomy && (
                              <p>Экономия {d.pct.toFixed(1)}% -- запросить обоснование НМЦК (ст.22) и проверить антидемпинг (ст.37, 44-ФЗ).</p>
                            )}
                            {d.conflicts > 0 && (
                              <p>{d.conflicts} расхождени{d.conflicts === 1 ? 'е' : d.conflicts < 5 ? 'я' : 'й'} УФБП/ГРБС -- направить запрос финансовому органу.</p>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              )}
            </Fragment>
          );
        })}
      </tbody>

      <tfoot>
        <tr className="border-t border-white/[0.08] bg-white/[0.02]">
          <td className="px-2 py-2 text-[11px] font-black text-zinc-300 uppercase tracking-wider">Итого</td>
          <td className="px-2 py-2 text-right text-[11px] tabular-nums font-bold text-zinc-300">{formatMoney(totals.plan)}</td>
          <td className="px-2 py-2 text-right text-[11px] tabular-nums font-bold text-zinc-300">{formatMoney(totals.fact)}</td>
          <td className="px-2 py-2 text-right text-[11px] tabular-nums font-black text-emerald-400">{formatMoney(totals.economy)}</td>
          <td className="px-2 py-2 text-right"><PctBadge pct={totals.plan > 0 ? (totals.economy / totals.plan) * 100 : 0} /></td>
          <td className="px-2 py-2">
            <TriBar fb={totals.fbEco} kb={totals.kbEco} mb={totals.mbEco} h="h-1.5" />
          </td>
          <td className="px-2 py-2 text-center text-[10px] font-bold text-amber-400">{totals.conflicts || '--'}</td>
          <td className="px-2 py-2 text-center text-[10px] tabular-nums text-zinc-400">{totals.subCount}</td>
        </tr>
      </tfoot>
    </table>
  );
}
