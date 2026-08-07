// ── Страница «Сверка: СВОД против расчёта» — композиция (разрез E11-4).
//    Здесь живут только state, фетчи и обвязка store; чистые вычисления —
//    в lib/recon/*, под-компоненты видов — в components/recon/*.
//
//    07.08.2026 — переплавка под читателя-руководителя:
//    • период-ось одна. Раньше страница читала сырое поле `period` из store
//      и сама резала ключи метрик по подстроке — это был второй, независимый
//      источник периода: выбор месяцев в шапке он не видел, и вкладка «По
//      метрикам» показывала не тот срез, что весь остальной экран. Теперь
//      период берётся из общего слоя данных (fd.periodKey), где месяцы уже
//      сведены к эффективному кварталу.
//    • ни один вид не может молча оказаться пустым: у каждого своё честное
//      объяснение, почему строк нет и что сделать.

import React, { useState, useEffect } from 'react';
import { useStore } from '../store';
import { useFilteredData } from '../hooks/useFilteredData';
import { api } from '../api';
import { AlertTriangle, GitCompare, RefreshCw } from 'lucide-react';
import { quarterLabel } from '@aemr/shared';
import { bothDeptKeyForms } from '../lib/dept-key';
import type { ReconCell, ReconMetricDelta, ReconMonthlyData, ReconMonthlyRow, ReconSummaryData } from '../lib/recon/types';
import { buildMetricRows, countMetricAssessments, filterActiveMetricRows } from '../lib/recon/metric-rows';
import { countReconKinds, filterReconRowsByDepartments } from '../lib/recon/dept-rows';
import { ReconHeader, type ReconView } from '../components/recon/ReconHeader';
import { ReconDeptTable } from '../components/recon/ReconDeptTable';
import { ReconMetricTable } from '../components/recon/ReconMetricTable';
import { ReconMonthlyTable } from '../components/recon/ReconMonthlyTable';
import { ReconSubordinatesTable } from '../components/recon/ReconSubordinatesTable';
import { ReconMethodology } from '../components/recon/ReconMethodology';
import { SkeletonTable } from '../components/Skeleton';

/** Период словами — для объяснений «за что именно строк нет». */
function periodPhrase(periodKey: string): string {
  return periodKey === 'year' ? 'за год' : `за ${quarterLabel(Number(periodKey.slice(1)))}`;
}

/**
 * Помесячная сверка под фильтром управлений.
 *
 * Помесячный ответ приходит с сервера всегда целиком, по всем управлениям:
 * фильтр шапки его не касался, и вкладка «Помесячно» молча показывала весь
 * район, пока остальной экран показывал одно управление. Имитация фильтра
 * запрещена — режем строки здесь.
 *
 * Счётчики пересобираются по тому же правилу, что и на сервере: считаются
 * ЯЧЕЙКИ, а не строки — восемь итоговых плюс все ячейки бюджетной разбивки.
 * Разбивка перебирается через значения объекта, а не по списку имён, чтобы
 * новое поле в ядре попадало в счёт само.
 */
function scopeMonthlyToDepartments(
  data: ReconMonthlyData | null,
  selectedDepartments: ReadonlySet<string>,
): ReconMonthlyData | null {
  if (!data || selectedDepartments.size === 0) return data;
  const keys = bothDeptKeyForms(selectedDepartments);
  const rows = data.rows.filter((r: ReconMonthlyRow) => keys.has(r.deptId) || keys.has(r.deptName));
  if (rows.length === data.rows.length) return data;

  const cells: ReconCell[] = [];
  for (const r of rows) {
    cells.push(r.compPlan, r.compFact, r.compPlanTotal, r.compFactTotal, r.epPlan, r.epFact, r.epPlanTotal, r.epFactTotal);
    if (r.compBudget) cells.push(...Object.values(r.compBudget));
    if (r.epBudget) cells.push(...Object.values(r.epBudget));
  }
  const countBy = (status: ReconCell['status']) => cells.filter((c) => c?.status === status).length;

  return {
    ...data,
    rows,
    counts: {
      ok: countBy('ok'),
      warning: countBy('warning'),
      high: countBy('high'),
      empty: countBy('empty'),
      noCalc: countBy('no_calc'),
    },
  };
}

/** Пустое состояние: причина + что сделать. Прочерков без объяснения не бывает. */
function EmptyView({ title, reason, hint }: { title: string; reason: string; hint?: string }) {
  return (
    <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-700/50 p-10 text-center">
      <GitCompare className="mx-auto text-zinc-300 dark:text-zinc-600 mb-3" size={32} />
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">{title}</p>
      <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-lg mx-auto">{reason}</p>
      {hint && <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-2 max-w-lg mx-auto">{hint}</p>}
    </div>
  );
}

export function ReconPage() {
  const { formatMoney, year, dashboardData, selectedDepartments, navigateTo, refresh, loading } = useStore();
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
          setReconError(err instanceof Error ? err.message : String(err));
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
          setMonthlyError(err instanceof Error ? err.message : String(err));
          setMonthlyLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [dashboardData, view, year]);

  // Метрики за выбранный период. Период — единственный, общий: fd.periodKey
  // уже сводит выбор месяцев к эффективному кварталу, поэтому вкладка «По
  // метрикам» показывает тот же срез, что и весь остальной экран.
  const periodKey = fd.periodKey;
  const allDeltas: ReconMetricDelta[] = fd.deltas;
  const deltas: ReconMetricDelta[] = periodKey !== 'year'
    ? allDeltas.filter((d: ReconMetricDelta) => {
        const key = d.metricKey ?? '';
        return key.includes(`.${periodKey}.`) || key.includes('.year.');
      })
    : allDeltas;

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

  const scopedMonthly = React.useMemo(
    () => scopeMonthlyToDepartments(monthlyData, selectedDepartments),
    [monthlyData, selectedDepartments],
  );

  const hasDeptData = filteredReconRows.length > 0;
  const hasMetricData = activeMetricRows.length > 0;
  const nothingLoaded = !hasDeptData && !hasMetricData;
  const hasDeptFilter = selectedDepartments.size > 0;

  // Загрузка, ошибка и «сверять нечего» относятся к годовому запросу — он
  // питает только два вида. На помесячном и на подведомственных свои
  // источники и свои состояния; чужое сообщение там было бы враньём.
  const yearLevelView = view === 'departments' || view === 'metrics';

  // Ровно одна причина, почему во вкладке «По метрикам» пусто.
  const metricEmptyReason = allDeltas.length === 0
    ? 'Снимок не содержит сверок отдельных показателей: расчёт по строкам за этот год не строился.'
    : deltas.length === 0
      ? `Сверки в снимке есть, но ни одна не относится к выбранному периоду (${periodPhrase(periodKey)}). Переключите период в шапке.`
      : 'Сверки за период есть, но ни одна не относится к выбранным управлениям. Снимите фильтр по управлениям в шапке.';

  return (
    <div className="space-y-6">
      {/* Header */}
      <ReconHeader view={view} onViewChange={setView} csvUrl={api.exportReconciliationUrl(year)} />

      {/* Ошибка запроса — это не «нет данных», и говорится об этом прямо */}
      {yearLevelView && reconError && !reconLoading && (
        <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-red-200 dark:border-red-800/50 p-10 text-center">
          <AlertTriangle className="mx-auto text-red-400 dark:text-red-500 mb-3" size={36} />
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">Сверка не загрузилась: сервер не ответил</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4 max-w-lg mx-auto">
            Это сбой запроса, а не отсутствие данных в книгах. Проверьте связь и повторите; если
            повторяется — сервер приложения недоступен, обратитесь к администратору.
          </p>
          <button
            onClick={() => { void refresh(); }}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : undefined} />
            {loading ? 'Повторяем…' : 'Повторить'}
          </button>
          {/* Технический текст — мелко и в скобках, заголовок им не занимаем */}
          <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-3 font-mono break-words max-w-lg mx-auto">({reconError})</p>
        </div>
      )}

      {/* Загрузка */}
      {yearLevelView && reconLoading && (
        <div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">Сверяем официальные числа СВОД с расчётом по строкам…</p>
          <SkeletonTable rows={6} />
        </div>
      )}

      {/* Совсем нечего сверять: ни управлений, ни показателей */}
      {yearLevelView && nothingLoaded && !reconLoading && !reconError && (
        <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-amber-200 dark:border-amber-700/50 p-10 text-center">
          <GitCompare className="mx-auto text-amber-400 dark:text-amber-500 mb-3" size={36} />
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">Сверять пока не с чем</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4 max-w-lg mx-auto">
            Сверка сравнивает официальные числа листа СВОД ТД-ПМ с независимым пересчётом по строкам
            листов управлений. Прочитан не весь набор книг: одного из двух источников нет.
            Обновите данные — читаются оба.
          </p>
          <button
            onClick={() => { void refresh(); }}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : undefined} />
            {loading ? 'Читаем книги…' : 'Прочитать книги'}
          </button>
        </div>
      )}

      {/* ═══ ПО УПРАВЛЕНИЯМ ═══ */}
      {view === 'departments' && !reconLoading && !reconError && !nothingLoaded && (
        hasDeptData && reconData ? (
          <ReconDeptTable
            rows={filteredReconRows}
            counts={filteredReconCounts}
            expandedDept={expandedDept}
            onToggleDept={setExpandedDept}
          />
        ) : (
          <EmptyView
            title="По управлениям сверки нет"
            reason={hasDeptFilter
              ? 'Ни одно из выбранных управлений не попало в сверку этого снимка. Снимите фильтр по управлениям в шапке.'
              : 'Годовая сверка по управлениям в снимке не построена: официальные строки листа СВОД ТД-ПМ не прочитаны.'}
            hint="Показатели по отдельности могут быть доступны — откройте вид «По показателям»."
          />
        )
      )}

      {/* ═══ ПО ПОКАЗАТЕЛЯМ ═══ */}
      {view === 'metrics' && !reconLoading && !reconError && !nothingLoaded && (
        hasMetricData ? (
          <ReconMetricTable
            rows={activeMetricRows}
            deltas={deltas}
            counts={metricCounts}
            expandedMetric={expandedMetric}
            onToggleMetric={setExpandedMetric}
          />
        ) : (
          <EmptyView title="По показателям сверок нет" reason={metricEmptyReason} />
        )
      )}

      {/* ═══ ПОМЕСЯЧНО (лист «СВОД с месяцами») ═══ */}
      {view === 'monthly' && (
        <ReconMonthlyTable
          data={scopedMonthly}
          loading={monthlyLoading}
          error={monthlyError}
          expandedKey={expandedMonthly}
          onToggleRow={setExpandedMonthly}
          formatMoney={formatMoney}
          onOpenMonth={(deptId, month) => navigateTo('data', { department: deptId, months: [month] })}
          emptyReason={hasDeptFilter && (monthlyData?.rows?.length ?? 0) > 0
            ? 'Помесячная сверка в снимке есть, но выбранных управлений в ней нет. Снимите фильтр по управлениям в шапке.'
            : 'Лист «СВОД с месяцами» прочитан, но сопоставимых месяцев в нём не нашлось: помесячный слой за выбранный год не заполнен либо ведётся в другой книге. Проверьте год в шапке; годовая картина доступна в виде «По управлениям».'}
        />
      )}

      {/* ═══ ПО ПОДВЕДОМСТВЕННЫМ ═══ */}
      {view === 'subordinates' && (
        fd.depts.length > 0 ? (
          <ReconSubordinatesTable
            depts={fd.depts}
            formatMoney={formatMoney}
            onOpenSubordinate={(deptKey, name) => navigateTo('data', { department: deptKey, subordinate: name })}
          />
        ) : (
          <EmptyView
            title="Подведомственных в срезе нет"
            reason={hasDeptFilter
              ? 'Выбранные управления не дали ни одной подведомственной организации. Снимите фильтр по управлениям в шапке.'
              : 'Данные по управлениям ещё не прочитаны — обновите данные в шапке.'}
          />
        )
      )}

      {/* Паспорт снимка: откуда взяты числа на этой странице */}
      {snapshot && (
        <div className="flex flex-wrap gap-6 text-xs text-zinc-500 dark:text-zinc-400 bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 px-5 py-3">
          <span>Числа на странице — из снимка книг за {year === 'all' ? 'все годы' : year}</span>
          {typeof snapshot.cellsRead === 'number' && (
            <span>Прочитано ячеек: <strong className="text-zinc-700 dark:text-zinc-200 tabular-nums">{snapshot.cellsRead.toLocaleString('ru-RU')}</strong></span>
          )}
          {/* sheetsRead — список имён листов; раньше он выводился как есть,
              и React склеивал имена в одно слово. Читателю нужен счёт. */}
          {Array.isArray(snapshot.sheetsRead) && (
            <span title={snapshot.sheetsRead.join(', ')}>
              Листов: <strong className="text-zinc-700 dark:text-zinc-200 tabular-nums">{snapshot.sheetsRead.length}</strong>
            </span>
          )}
          {typeof snapshot.pipelineDurationMs === 'number' && (
            <span>Разбор занял: <strong className="text-zinc-700 dark:text-zinc-200 tabular-nums">{(snapshot.pipelineDurationMs / 1000).toFixed(1)} с</strong></span>
          )}
        </div>
      )}

      {/* Methodology */}
      <ReconMethodology open={methodOpen} onToggle={() => setMethodOpen(!methodOpen)} />
    </div>
  );
}
