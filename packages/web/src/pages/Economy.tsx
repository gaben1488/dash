// ────────────────────────────────────────────────────────────────
// Economy Page — Premium Redesign v2 (E11-5: композиция)
//
// Вопросы отчёта: «Где экономия?» → hero + чарт бюджетов;
// «Какой ГРБС больше?» → рейтинг со спарклайнами; «Расхождения?» →
// индикаторы конфликтов; «Что делать?» → инлайн-рекомендации.
//
// Чистые вычисления — lib/economy/*; блоки UI — components/economy/*.
// ────────────────────────────────────────────────────────────────

import { useState, useMemo, useCallback } from 'react';
import type { DepartmentSummary } from '@aemr/shared';
import clsx from 'clsx';
import { Activity, Building2, Download, Inbox, Layers } from 'lucide-react';
import { useStore } from '../store';
import { useFilteredData } from '../hooks/useFilteredData';
import { ECONOMY_EMPTY_STATE_COPY, buildEconomyInsight, economyBannerStatus } from '../lib/economy-copy';
import { budgetSelection } from '../lib/economy/budget';
import {
  buildBarChartData, buildDeptEconomy, computeEconomyTotals,
  flattenSubordinates, sortDeptEconomy,
} from '../lib/economy/dept-economy';
import {
  buildDeptSparks, buildPerDeptQuarterly, buildQuarterlyTrend,
  economySpark, mergeTrendWithDepts, pctSpark, quarterDeltas,
} from '../lib/economy/quarterly';
import { buildEconomyCsv, economyCsvFilename } from '../lib/economy/csv';
import type { SortDir, SortField } from '../lib/economy/types';
import { Card } from '../components/economy/primitives';
import { EconomyHero } from '../components/economy/EconomyHero';
import type { HeroMetric } from '../components/economy/EconomyHero';
import { EconomyCharts } from '../components/economy/EconomyCharts';
import { EconomyDeptTable } from '../components/economy/EconomyDeptTable';
import { EconomySubTable } from '../components/economy/EconomySubTable';

export function EconomyPage() {
  const { formatMoney, toggleDepartment, toggleSubordinate, navigateTo, period, activeMonths,
    selectedBudgets, selectedMethods, deptOnlyMode } = useStore();
  const fd = useFilteredData();
  const summaries = fd.depts as DepartmentSummary[];

  const [expandedDepts, setExpandedDepts] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<SortField>('economy');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [showBudgetBreakdown, setShowBudgetBreakdown] = useState(false);
  const [tableView, setTableView] = useState<'departments' | 'subordinates'>('departments');
  const [heroMetric, setHeroMetric] = useState<HeroMetric>('economy');

  const toggleExpand = useCallback((dept: string) => {
    setExpandedDepts(prev => {
      const next = new Set(prev);
      if (next.has(dept)) next.delete(dept);
      else next.add(dept);
      return next;
    });
  }, []);

  const handleSort = useCallback((field: SortField) => {
    setSortDir(prev => sortField === field ? (prev === 'desc' ? 'asc' : 'desc') : 'desc');
    setSortField(field);
  }, [sortField]);

  const budgets = useMemo(() => budgetSelection(selectedBudgets), [selectedBudgets]);

  // ── Method filter — только для суффикса баннера ──
  const isMethodFiltered = selectedMethods.size > 0;
  const mKP = !isMethodFiltered || selectedMethods.has('competitive');
  const mEP = !isMethodFiltered || selectedMethods.has('single');

  // DEPRECATED (Б14): собственный вывод periodKey из activeMonths/period
  // дублирует канонический вывод периода в hooks/useFilteredData.
  // Не переносить в lib — умрёт вместе с закрытием Б14.
  const periodKey = useMemo(() => {
    if (activeMonths.size > 0) {
      const qMap: Record<string, number[]> = { q1: [1, 2, 3], q2: [4, 5, 6], q3: [7, 8, 9], q4: [10, 11, 12] };
      const covered = Object.entries(qMap).filter(([, ms]) => ms.some(m => activeMonths.has(m))).map(([q]) => q);
      return covered.length === 1 ? covered[0] : 'year';
    }
    return period !== 'year' ? period : 'year';
  }, [activeMonths, period]);

  // ── Данные: строки ГРБС → сортировка → агрегаты → ряды чартов ──
  const deptEconomy = useMemo(
    () => buildDeptEconomy({ summaries, periodKey, budgets, deptOnlyMode }),
    [summaries, periodKey, budgets, deptOnlyMode],
  );
  const sortedDeptEconomy = useMemo(
    () => sortDeptEconomy(deptEconomy, sortField, sortDir),
    [deptEconomy, sortField, sortDir],
  );
  const allSubordinates = useMemo(() => flattenSubordinates(deptEconomy), [deptEconomy]);
  const totals = useMemo(() => computeEconomyTotals(deptEconomy), [deptEconomy]);
  const barChartData = useMemo(() => buildBarChartData(sortedDeptEconomy), [sortedDeptEconomy]);

  const quarterlyTrend = useMemo(() => buildQuarterlyTrend(summaries, budgets), [summaries, budgets]);
  const perDeptQuarterly = useMemo(() => buildPerDeptQuarterly(summaries, budgets), [summaries, budgets]);
  const trendData = useMemo(() => mergeTrendWithDepts(quarterlyTrend, perDeptQuarterly), [quarterlyTrend, perDeptQuarterly]);
  const deptSparks = useMemo(() => buildDeptSparks(summaries, budgets), [summaries, budgets]);
  const ecoSpark = useMemo(() => economySpark(quarterlyTrend), [quarterlyTrend]);
  const reductionSpark = useMemo(() => pctSpark(quarterlyTrend), [quarterlyTrend]);
  const deltas = useMemo(() => quarterDeltas(ecoSpark, reductionSpark), [ecoSpark, reductionSpark]);

  const downloadCSV = useCallback(() => {
    const blob = new Blob([buildEconomyCsv(deptEconomy)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = economyCsvFilename(); a.click();
    URL.revokeObjectURL(url);
  }, [deptEconomy]);

  const navigateToSub = useCallback((deptId: string, subName?: string) => {
    if (subName) toggleSubordinate(subName);
    toggleDepartment(deptId);
    navigateTo('data');
  }, [toggleDepartment, toggleSubordinate, navigateTo]);

  // ── Empty state (после всех хуков) ──
  if (deptEconomy.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center mx-auto">
            <Inbox className="text-emerald-500/60" size={24} />
          </div>
          <p className="text-sm font-medium text-zinc-400">{ECONOMY_EMPTY_STATE_COPY.title}</p>
          <p className="text-[11px] text-zinc-600 max-w-xs leading-relaxed">
            {ECONOMY_EMPTY_STATE_COPY.body}
          </p>
        </div>
      </div>
    );
  }

  // ── Assertion-баннер: сумма + активные фильтры + статус нормы ──
  const budgetTag = budgets.filtered
    ? ` [${[budgets.fb && 'ФБ', budgets.kb && 'КБ', budgets.mb && 'МБ'].filter(Boolean).join('+')}]`
    : '';
  const methodTag = isMethodFiltered
    ? ` (${[mKP && 'КП', mEP && 'ЕП'].filter(Boolean).join('+')})`
    : '';
  const deptOnlyTag = deptOnlyMode.size > 0
    ? ` • только упр.: ${[...deptOnlyMode].join(', ')}`
    : '';
  // «В норме» — только при нуле отклонений >25% И нуле конфликтов флага.
  const bannerStatus = economyBannerStatus({ conflicts: totals.conflicts, over25: totals.highCount });

  return (
    <div className="space-y-2.5">
      <div className={clsx(
        'px-3 py-2 rounded-lg border text-xs font-medium',
        bannerStatus.ok
          ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-700/40 text-emerald-700 dark:text-emerald-300'
          : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700/40 text-amber-700 dark:text-amber-300',
      )}>
        {formatMoney(totals.economy)} экономии{budgetTag}{methodTag}{deptOnlyTag} • {bannerStatus.label}
      </div>

      <EconomyHero
        rows={deptEconomy}
        sortedRows={sortedDeptEconomy}
        totals={totals}
        economySpark={ecoSpark}
        pctSpark={reductionSpark}
        deltas={deltas}
        heroMetric={heroMetric}
        onHeroMetric={setHeroMetric}
        formatMoney={formatMoney}
        onToggleDepartment={toggleDepartment}
      />

      {/* ═══ AUTO-INSIGHT: умная сводка одним предложением ═══ */}
      <div className="flex items-center gap-2 px-1 animate-[fadeIn_500ms_ease-out_200ms_both]">
        <Activity size={10} className="text-emerald-500/60 shrink-0" />
        <p className="text-[10px] text-zinc-500 leading-relaxed">
          {buildEconomyInsight({
            // Только отфильтрованный набор — лидер/расхождения не могут назвать чужой ГРБС.
            depts: sortedDeptEconomy.map(d => ({ dept: d.dept, economy: d.economy })),
            totalEconomy: totals.economy,
            totalPlan: totals.plan,
            mbEconomy: totals.mbEco,
            highEconomyCount: totals.highCount,
            conflicts: totals.conflicts,
            formatMoney,
          })}
        </p>
      </div>

      <EconomyCharts
        barChartData={barChartData}
        trendData={trendData}
        perDeptQuarterly={perDeptQuarterly}
        showBudgetBreakdown={showBudgetBreakdown}
        onToggleBudgetBreakdown={() => setShowBudgetBreakdown(v => !v)}
        formatMoney={formatMoney}
        onBarClick={toggleDepartment}
      />

      {/* ═══ Таблица экономии — герой страницы ═══ */}
      <Card accent="blue">
        <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.04]">
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-zinc-200 tracking-tight">Экономия по управлениям</span>

            <div className="flex items-center bg-white/[0.04] rounded-lg p-0.5 border border-white/[0.04]">
              {([
                { key: 'departments' as const, icon: Building2, label: 'ГРБС' },
                { key: 'subordinates' as const, icon: Layers, label: `Подведы (${totals.subCount})` },
              ]).map(v => (
                <button
                  key={v.key}
                  onClick={() => setTableView(v.key)}
                  className={clsx(
                    'flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold rounded-md transition-all uppercase tracking-wider',
                    tableView === v.key
                      ? 'bg-white/[0.08] text-zinc-200 shadow-sm'
                      : 'text-zinc-600 hover:text-zinc-400',
                  )}
                >
                  <v.icon size={9} />{v.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[9px] text-zinc-600 tabular-nums">
              {tableView === 'departments' ? `${deptEconomy.length} упр.` : `${allSubordinates.length} орг.`}
            </span>
            <button
              onClick={downloadCSV}
              className="flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-zinc-500 hover:text-zinc-300 rounded-lg hover:bg-white/[0.04] transition-all border border-white/[0.04]"
            >
              <Download size={9} /> CSV
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          {tableView === 'departments' ? (
            <EconomyDeptTable
              rows={sortedDeptEconomy}
              totals={totals}
              expandedDepts={expandedDepts}
              onToggleExpand={toggleExpand}
              sortField={sortField}
              sortDir={sortDir}
              onSort={handleSort}
              deptSparks={deptSparks}
              formatMoney={formatMoney}
              onToggleDepartment={toggleDepartment}
              onNavigateToSub={navigateToSub}
            />
          ) : (
            <EconomySubTable
              subs={allSubordinates}
              formatMoney={formatMoney}
              onNavigateToSub={navigateToSub}
            />
          )}
        </div>
      </Card>
    </div>
  );
}
