import { useState, useMemo, useCallback, Fragment } from 'react';
import { useStore } from '../store';
import { useFilteredData } from '../hooks/useFilteredData';
import { Coins, AlertTriangle, TrendingDown, Users, ChevronDown, ChevronUp, Info, Inbox, Download, BarChart3 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from 'recharts';
import { FilterBreadcrumb } from '../components/FilterBreadcrumb';
import clsx from 'clsx';

interface BudgetBreakdown {
  planFB: number; planKB: number; planMB: number;
  factFB: number; factKB: number; factMB: number;
  economyFB: number; economyKB: number; economyMB: number;
}

interface SubEconomy {
  name: string;
  planTotal: number;
  factTotal: number;
  economy: number;
  pct: number;
}

interface DeptEconomy {
  dept: string;
  limit: number;
  price: number;
  economy: number;
  economyOfficial: number | null;
  pct: number;
  highEconomy: boolean;
  conflicts: number;
  budget: BudgetBreakdown;
  subordinates: SubEconomy[];
}

export function EconomyPage() {
  const { formatMoney, selectedDepartments, selectedSubordinates, procurementFilter, activityFilter, navigateTo, period, activeMonths } = useStore();
  const fd = useFilteredData();
  const [methodOpen, setMethodOpen] = useState(false);
  const [expandedDepts, setExpandedDepts] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((dept: string) => {
    setExpandedDepts(prev => {
      const next = new Set(prev);
      next.has(dept) ? next.delete(dept) : next.add(dept);
      return next;
    });
  }, []);

  const deptEconomy: DeptEconomy[] = useMemo(() => {
    const summaries = fd.depts;
    if (!summaries || !Array.isArray(summaries) || summaries.length === 0) return [];

    // Determine period key from activeMonths or period filter
    const periodKey = activeMonths.size > 0
      ? (() => {
          const qMap: Record<string, number[]> = { q1: [1,2,3], q2: [4,5,6], q3: [7,8,9], q4: [10,11,12] };
          const covered = Object.entries(qMap).filter(([, ms]) => ms.some(m => activeMonths.has(m))).map(([q]) => q);
          return covered.length === 1 ? covered[0] : 'year';
        })()
      : (period !== 'year' ? period : 'year');

    return summaries.map((s: any) => {
      // Use quarter-specific data if available
      const q = s.quarters?.[periodKey];
      const limit = q?.planTotal ?? s.planTotal ?? 0;
      const price = q?.factTotal ?? s.factTotal ?? 0;
      const eco = q?.economyTotal ?? s.economyTotal;
      const economy = eco != null ? eco : (limit - price);
      const pct = limit > 0 ? (economy / limit) * 100 : 0;
      // Per-budget breakdown from quarter/year data
      const planFB = q?.planFB ?? 0;
      const planKB = q?.planKB ?? 0;
      const planMB = q?.planMB ?? 0;
      const factFB = q?.factFB ?? 0;
      const factKB = q?.factKB ?? 0;
      const factMB = q?.factMB ?? 0;
      const economyFB = q?.economyFB ?? (planFB - factFB);
      const economyKB = q?.economyKB ?? (planKB - factKB);
      const economyMB = q?.economyMB ?? (planMB - factMB);

      // Subordinate economy breakdown
      const subs: SubEconomy[] = (s.subordinates ?? [])
        .filter((sub: any) => (sub.economyTotal ?? 0) !== 0 || (sub.planTotal ?? 0) > 0)
        .map((sub: any) => {
          const sp = sub.planTotal ?? 0;
          const sf = sub.factTotal ?? 0;
          const se = sub.economyTotal ?? (sp - sf);
          return { name: sub.name, planTotal: sp, factTotal: sf, economy: se, pct: sp > 0 ? (se / sp) * 100 : 0 };
        })
        .sort((a: SubEconomy, b: SubEconomy) => b.economy - a.economy);

      return {
        dept: s.department?.nameShort ?? s.department?.id ?? '?',
        limit,
        price,
        economy,
        economyOfficial: s.economyTotal ?? null,
        pct,
        highEconomy: pct > 25,
        conflicts: s.economyConflicts ?? s.signalCounts?.economyConflict ?? 0,
        budget: { planFB, planKB, planMB, factFB, factKB, factMB, economyFB, economyKB, economyMB },
        subordinates: subs,
      };
    });
  }, [fd.depts, period, activeMonths]);

  if (deptEconomy.length === 0) {
    return (
      <div className="space-y-6">
        <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 p-12 text-center">
          <Inbox className="mx-auto text-zinc-300 dark:text-zinc-600 mb-4" size={48} />
          <h2 className="text-lg font-semibold text-zinc-600 dark:text-zinc-300 mb-2">Нет данных по экономии</h2>
          <p className="text-sm text-zinc-400 dark:text-zinc-500 max-w-md mx-auto">
            Данные об экономии появятся после загрузки информации из Google Sheets.
          </p>
        </div>
      </div>
    );
  }

  const totalEconomy = deptEconomy.reduce((s, d) => s + d.economy, 0);
  const avgPct = deptEconomy.reduce((s, d) => s + d.pct, 0) / deptEconomy.length;
  const totalHighEconomy = deptEconomy.filter(d => d.highEconomy).length;
  const totalConflicts = deptEconomy.reduce((s, d) => s + d.conflicts, 0);

  const downloadCSV = useCallback(() => {
    const headers = [
      'Управление', 'Лимит итого', 'Факт итого', 'Экономия (расчёт)', 'Экономия (СВОД)', '% экономии',
      'Лимит ФБ', 'Факт ФБ', 'Экономия ФБ', 'Лимит КБ', 'Факт КБ', 'Экономия КБ',
      'Лимит МБ', 'Факт МБ', 'Экономия МБ', 'Высокая экономия', 'Флаг экономии',
    ];
    const csvRows = deptEconomy.map(d => {
      const b = d.budget;
      return [
        d.dept, d.limit.toFixed(2), d.price.toFixed(2), d.economy.toFixed(2),
        d.economyOfficial != null ? d.economyOfficial.toFixed(2) : '',
        d.pct.toFixed(1),
        b.planFB.toFixed(2), b.factFB.toFixed(2), b.economyFB.toFixed(2),
        b.planKB.toFixed(2), b.factKB.toFixed(2), b.economyKB.toFixed(2),
        b.planMB.toFixed(2), b.factMB.toFixed(2), b.economyMB.toFixed(2),
        d.highEconomy ? 'Да' : 'Нет', d.conflicts,
      ].join(';');
    });
    const bom = '\uFEFF';
    const csv = bom + headers.join(';') + '\n' + csvRows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'economy.csv'; a.click();
    URL.revokeObjectURL(url);
  }, [deptEconomy]);

  return (
    <div className="space-y-6">
      <FilterBreadcrumb />
      {/* KPI row */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <EcoKPI icon={Coins} label="Общая экономия" value={formatMoney(totalEconomy)} sub="Σ(Лимит − Факт)" color="emerald" onClick={() => navigateTo('analytics')} />
        <EcoKPI icon={TrendingDown} label="Средний % снижения" value={`${avgPct.toFixed(1)}%`} sub="По всем подписанным КП" color="blue" onClick={() => navigateTo('data', { procurement: 'competitive' })} />
        <EcoKPI icon={AlertTriangle} label="Высокая экономия (>25%)" value={String(totalHighEconomy)} sub="Лимит−факт > 25% (НЕ НМЦК−факт)" color="red" onClick={() => navigateTo('quality', { search: 'высокая экономия' })} />
        <EcoKPI icon={Users} label="Флаг экономии не определён" value={`${totalConflicts} из ${deptEconomy.length}`} sub="Финансовый орган не установил флаг AD" color="amber" onClick={() => navigateTo('quality', { search: 'флаг эконом' })} />
      </div>

      {/* Stacked budget bar chart */}
      <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 p-5">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 size={16} className="text-zinc-500" />
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Экономия по бюджетам (ФБ / КБ / МБ)</h3>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={deptEconomy.map(d => ({
              name: d.dept,
              'ФБ': d.budget.economyFB,
              'КБ': d.budget.economyKB,
              'МБ': d.budget.economyMB,
            }))} margin={{ top: 5, right: 20, bottom: 5, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--tw-color-zinc-200, #e2e8f0)" opacity={0.5} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : String(v)} />
              <Tooltip
                formatter={(value: number) => formatMoney(value)}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="ФБ" stackId="eco" fill="#3b82f6" radius={[0, 0, 0, 0]} />
              <Bar dataKey="КБ" stackId="eco" fill="#8b5cf6" radius={[0, 0, 0, 0]} />
              <Bar dataKey="МБ" stackId="eco" fill="#14b8a6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 overflow-hidden">
        <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-700/50 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Экономия по управлениям</h3>
          <button onClick={downloadCSV} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-600 transition">
            <Download size={13} /> CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-50 dark:bg-zinc-900/50 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                <th className="px-5 py-3">Управление</th>
                <th className="px-4 py-3 text-right">Лимит, тыс. руб.</th>
                <th className="px-4 py-3 text-right">Цена контракта</th>
                <th className="px-4 py-3 text-right">Экономия (расчёт)</th>
                <th className="px-4 py-3 text-right">Экономия (СВОД)</th>
                <th className="px-4 py-3 text-right">% снижения</th>
                <th className="px-4 py-3 text-center">Высокая экономия</th>
                <th className="px-4 py-3 text-center">Флаг экономии</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
              {deptEconomy.map((d) => {
                const isExpanded = expandedDepts.has(d.dept);
                const b = d.budget;
                return (
                  <Fragment key={d.dept}>
                    <tr
                      className="hover:bg-blue-50/40 dark:hover:bg-zinc-700/30 transition cursor-pointer"
                      onClick={() => toggleExpand(d.dept)}
                    >
                      <td className="px-5 py-3 font-medium text-zinc-700 dark:text-zinc-200">
                        <span className="flex items-center gap-1.5">
                          {isExpanded ? <ChevronUp size={14} className="text-zinc-400" /> : <ChevronDown size={14} className="text-zinc-400" />}
                          {d.dept}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-zinc-600 dark:text-zinc-300 tabular-nums">{formatMoney(d.limit)}</td>
                      <td className="px-4 py-3 text-right text-zinc-600 dark:text-zinc-300 tabular-nums">{formatMoney(d.price)}</td>
                      <td className="px-4 py-3 text-right font-medium text-emerald-600 dark:text-emerald-400 tabular-nums">{formatMoney(d.economy)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-500 dark:text-zinc-400">
                        {d.economyOfficial != null ? formatMoney(d.economyOfficial) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={clsx(
                          'inline-block px-2 py-0.5 rounded-full text-xs font-medium',
                          d.pct > 25 ? 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400' :
                          d.pct < 2 ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400' :
                          d.pct >= 5 && d.pct <= 15 ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400' :
                          'bg-zinc-50 dark:bg-zinc-700/50 text-zinc-700 dark:text-zinc-300'
                        )}>
                          {d.pct.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {d.highEconomy
                          ? <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400"><AlertTriangle size={13} /> Да</span>
                          : <span className="text-zinc-300 dark:text-zinc-600">—</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {d.conflicts > 0
                          ? <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400"><Users size={13} /> {d.conflicts}</span>
                          : <span className="text-emerald-500 dark:text-emerald-400 text-xs font-medium">Солидарность</span>}
                      </td>
                    </tr>
                    {isExpanded && (
                      <>
                        <BudgetSubRow label="ФБ (федеральный)" plan={b.planFB} fact={b.factFB} economy={b.economyFB} formatMoney={formatMoney} color="blue" />
                        <BudgetSubRow label="КБ (краевой)" plan={b.planKB} fact={b.factKB} economy={b.economyKB} formatMoney={formatMoney} color="violet" />
                        <BudgetSubRow label="МБ (муниципальный)" plan={b.planMB} fact={b.factMB} economy={b.economyMB} formatMoney={formatMoney} color="teal" />
                        {d.subordinates.length > 0 && (
                          <>
                            <tr className="bg-zinc-50/80 dark:bg-zinc-900/30">
                              <td colSpan={8} className="pl-12 pr-5 py-1.5 text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                                Подведомственные ({d.subordinates.length})
                              </td>
                            </tr>
                            {d.subordinates.slice(0, 10).map(sub => (
                              <tr key={sub.name} className="bg-zinc-50/40 dark:bg-zinc-900/20 text-xs hover:bg-zinc-100/60 dark:hover:bg-zinc-800/40 transition">
                                <td className="pl-14 pr-5 py-1.5 text-zinc-600 dark:text-zinc-300 truncate max-w-[200px]" title={sub.name}>{sub.name}</td>
                                <td className="px-4 py-1.5 text-right tabular-nums text-zinc-500 dark:text-zinc-400">{formatMoney(sub.planTotal)}</td>
                                <td className="px-4 py-1.5 text-right tabular-nums text-zinc-500 dark:text-zinc-400">{formatMoney(sub.factTotal)}</td>
                                <td className="px-4 py-1.5 text-right tabular-nums font-medium text-emerald-600 dark:text-emerald-400">{formatMoney(sub.economy)}</td>
                                <td className="px-4 py-1.5 text-right text-zinc-400 dark:text-zinc-500">—</td>
                                <td className="px-4 py-1.5 text-right tabular-nums text-zinc-500 dark:text-zinc-400">{sub.pct.toFixed(1)}%</td>
                                <td colSpan={2} />
                              </tr>
                            ))}
                            {d.subordinates.length > 10 && (
                              <tr className="bg-zinc-50/40 dark:bg-zinc-900/20 text-xs">
                                <td colSpan={8} className="pl-14 pr-5 py-1.5 text-zinc-400 dark:text-zinc-500 italic">
                                  ... и ещё {d.subordinates.length - 10}
                                </td>
                              </tr>
                            )}
                          </>
                        )}
                      </>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-zinc-50 dark:bg-zinc-900/50 font-semibold text-sm">
                <td className="px-5 py-3 text-zinc-700 dark:text-zinc-200">Итого</td>
                <td className="px-4 py-3 text-right tabular-nums text-zinc-700 dark:text-zinc-200">{formatMoney(deptEconomy.reduce((s, d) => s + d.limit, 0))}</td>
                <td className="px-4 py-3 text-right tabular-nums text-zinc-700 dark:text-zinc-200">{formatMoney(deptEconomy.reduce((s, d) => s + d.price, 0))}</td>
                <td className="px-4 py-3 text-right text-emerald-700 dark:text-emerald-400 tabular-nums">{formatMoney(totalEconomy)}</td>
                <td className="px-4 py-3 text-right text-zinc-500 dark:text-zinc-400 tabular-nums">{formatMoney(deptEconomy.reduce((s, d) => s + (d.economyOfficial ?? 0), 0))}</td>
                <td className="px-4 py-3 text-right text-zinc-700 dark:text-zinc-200">{avgPct.toFixed(1)}%</td>
                <td className="px-4 py-3 text-center text-red-600 dark:text-red-400">{totalHighEconomy}</td>
                <td className="px-4 py-3 text-center text-amber-600 dark:text-amber-400">{totalConflicts}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Methodology */}
      <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50">
        <button
          onClick={() => setMethodOpen(!methodOpen)}
          className="w-full flex items-center justify-between px-5 py-4 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700/30 transition"
        >
          <span className="flex items-center gap-2"><Info size={16} className="text-blue-500" /> Методология расчёта экономии (44-ФЗ)</span>
          {methodOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {methodOpen && (
          <div className="px-5 pb-5 text-xs text-zinc-600 dark:text-zinc-300 space-y-3 border-t border-zinc-100 dark:border-zinc-700/50 pt-4">
            <p><strong>Экономия</strong> = Лимит программы − Цена контракта. Включает нераспределённый остаток лимита и снижение на торгах. Учитываются закупки с флагом AD=&laquo;да&raquo;.</p>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3">
                <div className="font-semibold text-emerald-800 dark:text-emerald-300">5—15%</div>
                <div className="text-emerald-600 dark:text-emerald-400">Нормальная экономия</div>
              </div>
              <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                <div className="font-semibold text-amber-800 dark:text-amber-300">&lt; 2%</div>
                <div className="text-amber-600 dark:text-amber-400">Предрешённость — возможен сговор</div>
              </div>
              <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-3">
                <div className="font-semibold text-red-800 dark:text-red-300">&gt; 25%</div>
                <div className="text-red-600 dark:text-red-400">Высокая экономия (лимит−факт {'>'}25%). Внимание: антидемпинг по ст.37 требует НМЦК</div>
              </div>
            </div>
            <p><strong>Конфликт флага экономии</strong>: (а) AD="экономия", но факт ≥ план — некорректный флаг; (б) экономия &gt;15%, но финансовый орган не определил флаг экономии в столбце AD.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function EcoKPI({ icon: Icon, label, value, sub, color, onClick }: {
  icon: typeof Coins; label: string; value: string; sub: string; color: string; onClick?: () => void;
}) {
  return (
    <div
      className={clsx(
        'bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 p-5 transition-all duration-200',
        onClick ? 'cursor-pointer hover:shadow-lg hover:scale-[1.02] hover:border-blue-200 dark:hover:border-blue-600/60 active:scale-[0.98]' : 'hover:shadow-md',
      )}
      onClick={onClick}
    >
      <div className="flex items-center gap-3 mb-3">
        <div className={clsx('w-9 h-9 rounded-lg flex items-center justify-center',
          color === 'emerald' && 'bg-emerald-50 dark:bg-emerald-500/10', color === 'blue' && 'bg-blue-50 dark:bg-blue-500/10',
          color === 'red' && 'bg-red-50 dark:bg-red-500/10', color === 'amber' && 'bg-amber-50 dark:bg-amber-500/10'
        )}>
          <Icon size={18} className={clsx(
            color === 'emerald' && 'text-emerald-600 dark:text-emerald-400', color === 'blue' && 'text-blue-600 dark:text-blue-400',
            color === 'red' && 'text-red-600 dark:text-red-400', color === 'amber' && 'text-amber-600 dark:text-amber-400'
          )} />
        </div>
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</span>
      </div>
      <div className="text-2xl font-bold text-zinc-800 dark:text-white">{value}</div>
      <div className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1">{sub}</div>
    </div>
  );
}

const BUDGET_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  blue: { bg: 'bg-blue-50/60 dark:bg-blue-950/20', text: 'text-blue-700 dark:text-blue-300', dot: 'bg-blue-500' },
  violet: { bg: 'bg-violet-50/60 dark:bg-violet-950/20', text: 'text-violet-700 dark:text-violet-300', dot: 'bg-violet-500' },
  teal: { bg: 'bg-teal-50/60 dark:bg-teal-950/20', text: 'text-teal-700 dark:text-teal-300', dot: 'bg-teal-500' },
};

function BudgetSubRow({ label, plan, fact, economy, formatMoney, color }: {
  label: string; plan: number; fact: number; economy: number;
  formatMoney: (v: number) => string; color: string;
}) {
  const c = BUDGET_COLORS[color] ?? BUDGET_COLORS.blue;
  const pct = plan > 0 ? (economy / plan) * 100 : 0;
  return (
    <tr className={clsx(c.bg, 'text-xs')}>
      <td className={clsx('pl-12 pr-5 py-2 font-medium', c.text)}>
        <span className="flex items-center gap-1.5">
          <span className={clsx('w-1.5 h-1.5 rounded-full', c.dot)} />
          {label}
        </span>
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-zinc-500 dark:text-zinc-400">{formatMoney(plan)}</td>
      <td className="px-4 py-2 text-right tabular-nums text-zinc-500 dark:text-zinc-400">{formatMoney(fact)}</td>
      <td className="px-4 py-2 text-right tabular-nums font-medium text-emerald-600 dark:text-emerald-400">{formatMoney(economy)}</td>
      <td className="px-4 py-2 text-right text-zinc-400 dark:text-zinc-500">—</td>
      <td className="px-4 py-2 text-right tabular-nums text-zinc-500 dark:text-zinc-400">{pct.toFixed(1)}%</td>
      <td colSpan={2} />
    </tr>
  );
}
