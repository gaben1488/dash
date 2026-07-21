// ── Страница «Сверка: СВОД vs Расчёт» — композиция (разрез E11-4).
//    Здесь живут только state, фетчи и обвязка store; чистые вычисления —
//    в lib/recon/*, под-компоненты видов — в components/recon/*.

import React, { useState, useEffect } from 'react';
import { useStore } from '../store';
import { useFilteredData } from '../hooks/useFilteredData';
import { api } from '../api';
import { AlertTriangle, GitCompare } from 'lucide-react';
import type { ReconMetricDelta, ReconMonthlyData, ReconSummaryData } from '../lib/recon/types';
import { buildMetricRows, countMetricAssessments, filterActiveMetricRows } from '../lib/recon/metric-rows';
import { countReconKinds, filterReconRowsByDepartments } from '../lib/recon/dept-rows';
import { ReconHeader, type ReconView } from '../components/recon/ReconHeader';
import { ReconDeptTable } from '../components/recon/ReconDeptTable';
import { ReconMetricTable } from '../components/recon/ReconMetricTable';
import { ReconMonthlyTable } from '../components/recon/ReconMonthlyTable';
import { ReconSubordinatesTable } from '../components/recon/ReconSubordinatesTable';
import { ReconMethodology } from '../components/recon/ReconMethodology';

export function ReconPage() {
  const { formatMoney, period, year, dashboardData, selectedDepartments, navigateTo } = useStore();
  const fd = useFilteredData();
  const [reconData, setReconData] = useState<ReconSummaryData | null>(null);
  const [reconLoading, setReconLoading] = useState(false);
  const [reconError, setReconError] = useState<string | null>(null);
  const [expandedDept, setExpandedDept] = useState<string | null>(null);
  const [expandedMetric, setExpandedMetric] = useState<string | null>(null);
  const [methodOpen, setMethodOpen] = useState(false);
  const [view, setView] = useState<ReconView>('departments');
  const [monthlyData, setMonthlyData] = useState<ReconMonthlyData | null>(null);
  const [monthlyLoading, setMonthlyLoading] = useState(false);
  const [monthlyError, setMonthlyError] = useState<string | null>(null);
  const [expandedMonthly, setExpandedMonthly] = useState<string | null>(null);

  // Fetch reconciliation data
  // DEPRECATED (целевая модель): страничный фетч мимо общего data-слоя (fd/store).
  // По target-architecture-2026-07-15 §3 (E2/E8) сверка получает данные через
  // общий сверочный DTO, а не собственные запросы страницы. Не переносить в lib.
  useEffect(() => {
    let cancelled = false;
    setReconLoading(true);
    setReconError(null);
    api.getReconciliation(year)
      .then((res) => {
        if (!cancelled) {
          setReconData(res.reconciliation ?? null);
          setReconError(null);
          setReconLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setReconError(err instanceof Error ? err.message : 'Не удалось загрузить данные сверки');
          setReconLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [dashboardData, year]);

  // Fetch monthly SHDYU reconciliation data
  // DEPRECATED (целевая модель): второй страничный фетч — та же судьба, что выше.
  useEffect(() => {
    if (view !== 'monthly') return;
    let cancelled = false;
    setMonthlyLoading(true);
    setMonthlyError(null);
    api.getReconciliationMonthly(undefined, year)
      .then((res) => {
        if (!cancelled) {
          setMonthlyData(res);
          setMonthlyError(null);
          setMonthlyLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setMonthlyError(err instanceof Error ? err.message : 'Не удалось загрузить помесячную сверку (СВОД с месяцами)');
          setMonthlyLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [dashboardData, view, year]);

  // Metric-level deltas
  // DEPRECATED (целевая модель): локальная период-ось — фильтрация ключей метрик
  // по подстроке `.{period}.` дублирует период-логику страницы. По
  // filter-system-target-2026-07-16 §3 период приходит из FilterContext одной
  // осью (PeriodSel), фильтр — селектором. Не переносить в lib.
  const deltas: ReconMetricDelta[] = period !== 'year'
    ? fd.deltas.filter((d: ReconMetricDelta) => {
        const key = d.metricKey ?? '';
        return key.includes(`.${period}.`) || key.includes('.year.');
      })
    : fd.deltas;

  const metricRows = buildMetricRows(deltas);
  const activeMetricRows = filterActiveMetricRows(metricRows, selectedDepartments);
  const metricCounts = countMetricAssessments(activeMetricRows);

  const snapshot = dashboardData?.snapshot?.metadata ?? null;

  // Filter recon rows by selected departments
  const filteredReconRows = React.useMemo(
    () => filterReconRowsByDepartments(reconData?.rows, selectedDepartments),
    [reconData, selectedDepartments],
  );

  const filteredReconCounts = React.useMemo(
    () => countReconKinds(filteredReconRows),
    [filteredReconRows],
  );

  const hasDeptData = filteredReconRows.length > 0;
  const hasMetricData = activeMetricRows.length > 0;
  const hasAnyData = hasDeptData || hasMetricData;

  return (
    <div className="space-y-6">
      {/* Header */}
      <ReconHeader view={view} onViewChange={setView} csvUrl={api.exportReconciliationUrl(year)} />

      {/* Error state — сбой запроса, а не отсутствие данных */}
      {reconError && !reconLoading && (
        <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-red-200 dark:border-red-800/50 p-12 text-center">
          <AlertTriangle className="mx-auto text-red-400 dark:text-red-500 mb-3" size={40} />
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">Не удалось загрузить сверку</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">{reconError}</p>
          <p className="text-[11px] text-zinc-400">
            Это сбой запроса к API, а не отсутствие данных. Проверьте, что сервер доступен, и обновите страницу.
          </p>
        </div>
      )}

      {/* Empty state */}
      {!hasAnyData && !reconLoading && !reconError && (
        <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-amber-200 dark:border-amber-700/50 p-12 text-center">
          <GitCompare className="mx-auto text-amber-400 dark:text-amber-500 mb-3" size={40} />
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">Сверка не выполнена</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">
            Для сверки нужны данные из СВОД и из листов управлений. Нажмите «Загрузить все» в шапке, чтобы загрузить оба источника.
          </p>
          <p className="text-[11px] text-zinc-400">
            Пайплайн сравнивает официальные ячейки СВОД ТД-ПМ (формулы COUNTIFS/SUMIFS) с независимым пересчётом по строкам каждого управления.
          </p>
        </div>
      )}

      {/* Loading */}
      {reconLoading && (
        <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 p-8 text-center">
          <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-xs text-zinc-500">Загрузка данных сверки...</p>
        </div>
      )}

      {/* ═══ DEPARTMENT VIEW ═══ */}
      {view === 'departments' && hasDeptData && reconData && (
        <ReconDeptTable
          rows={filteredReconRows}
          counts={filteredReconCounts}
          expandedDept={expandedDept}
          onToggleDept={setExpandedDept}
        />
      )}

      {/* ═══ METRICS VIEW ═══ */}
      {view === 'metrics' && hasMetricData && (
        <ReconMetricTable
          rows={activeMetricRows}
          deltas={deltas}
          counts={metricCounts}
          expandedMetric={expandedMetric}
          onToggleMetric={setExpandedMetric}
        />
      )}

      {/* ═══ MONTHLY SHDYU VIEW ═══ */}
      {view === 'monthly' && (
        <ReconMonthlyTable
          data={monthlyData}
          loading={monthlyLoading}
          error={monthlyError}
          expandedKey={expandedMonthly}
          onToggleRow={setExpandedMonthly}
          formatMoney={formatMoney}
          onOpenMonth={(deptId, month) => navigateTo('data', { department: deptId, months: [month] })}
        />
      )}

      {/* ═══ SUBORDINATES VIEW ═══ */}
      {view === 'subordinates' && fd.depts.length > 0 && (
        <ReconSubordinatesTable
          depts={fd.depts}
          formatMoney={formatMoney}
          onOpenSubordinate={(deptKey, name) => navigateTo('data', { department: deptKey, subordinate: name })}
        />
      )}

      {/* Snapshot metadata */}
      {snapshot && (
        <div className="flex flex-wrap gap-6 text-xs text-zinc-500 dark:text-zinc-400 bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 px-5 py-3">
          <span>Снапшот: <strong className="text-zinc-700 dark:text-zinc-200">{dashboardData?.snapshot?.id?.slice(0, 8) ?? '—'}</strong></span>
          <span>Ячеек: <strong className="text-zinc-700 dark:text-zinc-200">{snapshot.cellsRead ?? '—'}</strong></span>
          <span>Листов: <strong className="text-zinc-700 dark:text-zinc-200">{snapshot.sheetsRead ?? '—'}</strong></span>
          <span>Обработка: <strong className="text-zinc-700 dark:text-zinc-200">{snapshot.pipelineDurationMs ?? '—'} мс</strong></span>
        </div>
      )}

      {/* Methodology */}
      <ReconMethodology open={methodOpen} onToggle={() => setMethodOpen(!methodOpen)} />
    </div>
  );
}
