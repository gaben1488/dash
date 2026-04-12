import React, { useState, useEffect } from 'react';
import { useStore } from '../store';
import { useFilteredData } from '../hooks/useFilteredData';
import { api } from '../api';
import { GitCompare, ChevronDown, ChevronUp, Info, AlertTriangle, CheckCircle2, Clock, FileSpreadsheet, Building2, ArrowRight, ExternalLink, Download, Users } from 'lucide-react';
import clsx from 'clsx';
import { SVOD_SPREADSHEET_ID } from '@aemr/shared';

/** СВОД ТД-ПМ cell references per department for expanded diagnostics */
const DEPT_SVOD_CELLS: Record<string, { planCount: string; factCount: string; planTotal: string; factTotal: string; economy: string; percent: string }> = {
  'УЭР':    { planCount: 'D42',  factCount: 'E42',  planTotal: 'K42',  factTotal: 'O42',  economy: 'U46',  percent: 'G42' },
  'УИО':    { planCount: 'D72',  factCount: 'E72',  planTotal: 'K72',  factTotal: 'O72',  economy: 'U77',  percent: 'G72' },
  'УАГЗО':  { planCount: 'D102', factCount: 'E102', planTotal: 'K102', factTotal: 'O102', economy: 'U107', percent: 'G102' },
  'УФБП':   { planCount: 'D132', factCount: 'E132', planTotal: 'K132', factTotal: 'O132', economy: 'U137', percent: 'G132' },
  'УД':     { planCount: 'D163', factCount: 'E163', planTotal: 'K163', factTotal: 'O163', economy: 'U168', percent: 'G163' },
  'УДТХ':   { planCount: 'D195', factCount: 'E195', planTotal: 'K195', factTotal: 'O195', economy: 'U200', percent: 'G195' },
  'УКСиМП': { planCount: 'D225', factCount: 'E225', planTotal: 'K225', factTotal: 'O225', economy: 'U230', percent: 'G225' },
  'УО':     { planCount: 'D255', factCount: 'E255', planTotal: 'K255', factTotal: 'O255', economy: 'U260', percent: 'G255' },
};

/** Diagnose the likely source of a discrepancy */
function diagnoseDelta(row: ReconDeptRow): { source: string; detail: string; severity: 'info' | 'warn' | 'error' } {
  const pAbs = Math.abs(row.planDeltaPct);
  const fAbs = Math.abs(row.factDeltaPct);
  const eAbs = row.ecoTotalOfficial !== 0 ? Math.abs(row.ecoDelta / row.ecoTotalOfficial) * 100 : 0;

  if (row.assessment.kind === 'ok' || row.assessment.kind === 'neutral') {
    return { source: 'Нет расхождений', detail: 'Данные согласованы в пределах допустимого порога (< 1%).', severity: 'info' };
  }

  // Fact much higher than official → fact detection issue
  if (fAbs > 50 && row.fullFactCalculated > row.fullFactOfficial * 1.5) {
    return {
      source: 'Детекция факта',
      detail: `Расчёт определяет значительно больше фактов (${fmtNum(row.fullFactCalculated)}) чем СВОД (${fmtNum(row.fullFactOfficial)}). Причина: алгоритм классификации строк (col Q — дата факта) может отличаться от формулы COUNTIFS в СВОД.`,
      severity: 'error',
    };
  }

  // Plan delta > 10% → likely classification/method filter issue
  if (pAbs > 10) {
    return {
      source: 'Классификация строк',
      detail: `Расчёт по строкам даёт ${fmtNum(row.fullPlanCalculated)} vs СВОД ${fmtNum(row.fullPlanOfficial)} (Δ ${fmtPct(pAbs)}). Вероятная причина: различие в фильтрации строк по методу (col L) или score-порогу классификации.`,
      severity: 'error',
    };
  }

  // Plan within 5% but fact diverges → mixed issue
  if (pAbs < 5 && fAbs > 5) {
    return {
      source: 'Факт-классификация',
      detail: `План близок (Δ ${fmtPct(pAbs)}), но факт расходится (Δ ${fmtPct(fAbs)}). Проверьте: col Q (дата факта) заполнена корректно, формула СВОД использует правильный диапазон.`,
      severity: 'warn',
    };
  }

  // Economy mismatch
  if (eAbs > 10 && Math.abs(row.ecoDelta) > 100) {
    return {
      source: 'Расчёт экономии',
      detail: `Экономия: СВОД ${fmtNum(row.ecoTotalOfficial)} vs расчёт ${fmtNum(row.ecoTotalCalculated)}. Проверьте col Z-AC (экономия) и формулу SUMIFS в СВОД.`,
      severity: 'warn',
    };
  }

  // Small discrepancy
  if (pAbs < 5 && fAbs < 5) {
    return {
      source: 'Округление / граничные строки',
      detail: `Допустимое расхождение: план Δ ${fmtPct(pAbs)}, факт Δ ${fmtPct(fAbs)}. Вероятно 1-2 граничные строки по-разному классифицируются.`,
      severity: 'info',
    };
  }

  return {
    source: 'Комплексное расхождение',
    detail: `Расходятся и план (Δ ${fmtPct(pAbs)}) и факт (Δ ${fmtPct(fAbs)}). Требуется ручная проверка формул СВОД и состава строк в листе управления.`,
    severity: 'error',
  };
}

function buildSheetUrl(spreadsheetId: string, cell?: string): string {
  let url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  if (cell) url += `#gid=0&range=${cell}`;
  return url;
}

// ── Types ──────────────────────────────────────────────────────

interface ReconDeptRow {
  department: string;
  fullPlanOfficial: number;
  fullPlanCalculated: number;
  planDelta: number;
  planDeltaPct: number;
  fullFactOfficial: number;
  fullFactCalculated: number;
  factDelta: number;
  factDeltaPct: number;
  ecoTotalOfficial: number;
  ecoTotalCalculated: number;
  ecoDelta: number;
  assessment: {
    status: string;
    kind: 'ok' | 'neutral' | 'warning' | 'high';
    reason: string;
    maxAbsDelta: number;
    source?: 'none' | 'methodology' | 'svod_error' | 'calc_error';
    sourceLabel?: string;
  };
}

interface ReconSummaryData {
  rows: ReconDeptRow[];
  counts: { ok: number; neutral: number; warning: number; high: number };
  overallStatus: string;
}

type MetricAssessment = 'ok' | 'warning' | 'critical';

interface MetricReconRow {
  metric: string;
  metricLabel: string;
  official: number;
  calculated: number;
  deltaAbs: number;
  deltaPct: number;
  assessment: MetricAssessment;
}

// ── Helpers ────────────────────────────────────────────────────

function deriveAssessment(withinTolerance: boolean, deltaPercent: number | null): MetricAssessment {
  if (withinTolerance) return 'ok';
  if (deltaPercent != null && Math.abs(deltaPercent) > 5) return 'critical';
  return 'warning';
}

const KIND_CONFIG = {
  ok:      { label: 'Совпадает',         bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-400', icon: CheckCircle2 },
  neutral: { label: 'Нет данных',        bg: 'bg-zinc-100 dark:bg-zinc-800',       text: 'text-zinc-500 dark:text-zinc-400',     icon: Info },
  warning: { label: 'Несопоставимо',     bg: 'bg-amber-50 dark:bg-amber-950/30',     text: 'text-amber-700 dark:text-amber-400',     icon: Clock },
  high:    { label: 'Расхождение',       bg: 'bg-red-50 dark:bg-red-950/30',         text: 'text-red-700 dark:text-red-400',         icon: AlertTriangle },
} as const;

const METRIC_ASSESS_CONFIG: Record<MetricAssessment, { label: string; bg: string; text: string; icon: typeof CheckCircle2 }> = {
  ok:       { label: 'Совпадает',    bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-400', icon: CheckCircle2 },
  warning:  { label: 'Допустимо',    bg: 'bg-amber-50 dark:bg-amber-950/30',     text: 'text-amber-700 dark:text-amber-400',     icon: Clock },
  critical: { label: 'Расхождение',  bg: 'bg-red-50 dark:bg-red-950/30',         text: 'text-red-700 dark:text-red-400',         icon: AlertTriangle },
};

/** Format number, normalizing -0 to plain "0" */
function fmtNum(n: number): string {
  // Normalize floating point noise (e.g. 1e-14) and -0 to plain zero
  if (Object.is(n, -0) || Math.abs(n) < 1e-9) return '0';
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
}

function fmtPct(n: number): string {
  if (Math.abs(n) < 1e-9) return '0%';
  return `${n.toFixed(1)}%`;
}

/** Check if a numeric value is effectively zero (floating point noise only, NOT rounding) */
function isZero(n: number): boolean {
  return Object.is(n, -0) || Math.abs(n) < 1e-9;
}

// ── Main Component ─────────────────────────────────────────────

export function ReconPage() {
  const { formatMoney, period, dashboardData, selectedDepartments, navigateTo } = useStore();
  const fd = useFilteredData();
  const [reconData, setReconData] = useState<ReconSummaryData | null>(null);
  const [reconLoading, setReconLoading] = useState(false);
  const [expandedDept, setExpandedDept] = useState<string | null>(null);
  const [expandedMetric, setExpandedMetric] = useState<string | null>(null);
  const [methodOpen, setMethodOpen] = useState(false);
  const [view, setView] = useState<'departments' | 'metrics' | 'monthly' | 'subordinates'>('departments');
  const [monthlyData, setMonthlyData] = useState<any>(null);
  const [monthlyLoading, setMonthlyLoading] = useState(false);

  // Fetch reconciliation data
  useEffect(() => {
    let cancelled = false;
    setReconLoading(true);
    api.getReconciliation()
      .then((res) => {
        if (!cancelled) {
          setReconData(res.reconciliation ?? null);
          setReconLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setReconLoading(false);
      });
    return () => { cancelled = true; };
  }, [dashboardData]);

  // Fetch monthly SHDYU reconciliation data
  useEffect(() => {
    if (view !== 'monthly') return;
    let cancelled = false;
    setMonthlyLoading(true);
    api.getReconciliationMonthly()
      .then((res) => {
        if (!cancelled) {
          setMonthlyData(res);
          setMonthlyLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setMonthlyLoading(false);
      });
    return () => { cancelled = true; };
  }, [dashboardData, view]);

  // Metric-level deltas
  const deltas = period !== 'year'
    ? fd.deltas.filter((d: any) => {
        const key = d.metricKey ?? '';
        return key.includes(`.${period}.`) || key.includes('.year.');
      })
    : fd.deltas;

  const metricRows: MetricReconRow[] = deltas
    .filter((d: any) => d.officialValue != null || d.calculatedValue != null)
    .map((d: any) => {
      const official = d.officialValue ?? 0;
      const calculated = d.calculatedValue ?? 0;
      const deltaAbs = Math.abs(official - calculated);
      const deltaPct = d.deltaPercent != null
        ? Math.abs(d.deltaPercent)
        : (official !== 0 ? Math.abs(((official - calculated) / official) * 100) : 0);
      return {
        metric: d.metricKey,
        metricLabel: d.label ?? d.metricKey,
        official,
        calculated,
        deltaAbs,
        deltaPct,
        assessment: deriveAssessment(d.withinTolerance, d.deltaPercent),
      };
    });

  // Filter out rows where both values are 0 (empty metrics)
  // Also filter by selected departments via metric key pattern grbs.{deptId}.
  const DEPT_ID_TO_RU: Record<string, string> = {
    uer: 'УЭР', uio: 'УИО', uagzo: 'УАГЗО', ufbp: 'УФБП',
    ud: 'УД', udtx: 'УДТХ', uksimp: 'УКСиМП', uo: 'УО',
  };
  const activeMetricRows = metricRows.filter(r => {
    if (r.official === 0 && r.calculated === 0) return false;
    if (selectedDepartments.size === 0) return true;
    const match = r.metric.match(/^grbs\.(\w+)\./);
    if (!match) return true;
    const ruName = DEPT_ID_TO_RU[match[1]];
    return ruName ? selectedDepartments.has(ruName) : true;
  });

  const metricOk = activeMetricRows.filter(r => r.assessment === 'ok').length;
  const metricWarn = activeMetricRows.filter(r => r.assessment === 'warning').length;
  const metricCrit = activeMetricRows.filter(r => r.assessment === 'critical').length;

  const snapshot = dashboardData?.snapshot?.metadata ?? null;

  // Filter recon rows by selected departments
  const filteredReconRows = React.useMemo(() => {
    if (!reconData?.rows) return [];
    if (selectedDepartments.size === 0) return reconData.rows;
    return reconData.rows.filter(r => selectedDepartments.has(r.department));
  }, [reconData, selectedDepartments]);

  const filteredReconCounts = React.useMemo(() => {
    const counts = { ok: 0, neutral: 0, warning: 0, high: 0 };
    for (const r of filteredReconRows) counts[r.assessment.kind]++;
    return counts;
  }, [filteredReconRows]);

  const hasDeptData = filteredReconRows.length > 0;
  const hasMetricData = activeMetricRows.length > 0;
  const hasAnyData = hasDeptData || hasMetricData;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <GitCompare className="text-blue-500" size={22} />
            <div>
              <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Сверка: СВОД vs Расчёт</h2>
              <p className="text-xs text-zinc-400 dark:text-zinc-500">
                Сравнение официальных ячеек СВОД ТД-ПМ с построчным пересчётом по листам управлений.
                Допуск: 1%. Источник: Google Sheets API.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <a
              href={api.exportReconciliationUrl()}
              download
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-600 transition"
            >
              <Download size={13} />
              CSV
            </a>
            {/* View toggle */}
            <div className="flex items-center bg-zinc-100 dark:bg-zinc-700/50 rounded-lg p-0.5">
              <button
                onClick={() => setView('departments')}
                className={clsx(
                  'px-3 py-1.5 rounded-md text-xs font-medium transition',
                  view === 'departments'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700',
                )}
              >
                <Building2 size={12} className="inline mr-1" />По управлениям
              </button>
              <button
                onClick={() => setView('metrics')}
                className={clsx(
                  'px-3 py-1.5 rounded-md text-xs font-medium transition',
                  view === 'metrics'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700',
                )}
              >
                <FileSpreadsheet size={12} className="inline mr-1" />По метрикам
              </button>
              <button
                onClick={() => setView('monthly')}
                className={clsx(
                  'px-3 py-1.5 rounded-md text-xs font-medium transition',
                  view === 'monthly'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700',
                )}
              >
                <Clock size={12} className="inline mr-1" />Помесячно (ШДЮ)
              </button>
              <button
                onClick={() => setView('subordinates')}
                className={clsx(
                  'px-3 py-1.5 rounded-md text-xs font-medium transition',
                  view === 'subordinates'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700',
                )}
              >
                <Users size={12} className="inline mr-1" />По подведам
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Empty state */}
      {!hasAnyData && !reconLoading && (
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
        <>
          {/* Summary badges */}
          <div className="flex gap-3 text-xs">
            {filteredReconCounts.ok > 0 && (
              <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 font-medium">
                <CheckCircle2 size={13} /> {filteredReconCounts.ok} совпадает
              </span>
            )}
            {filteredReconCounts.warning > 0 && (
              <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 font-medium">
                <Clock size={13} /> {filteredReconCounts.warning} несопоставимо
              </span>
            )}
            {filteredReconCounts.high > 0 && (
              <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 font-medium">
                <AlertTriangle size={13} /> {filteredReconCounts.high} расхождение
              </span>
            )}
            {filteredReconCounts.neutral > 0 && (
              <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 font-medium">
                <Info size={13} /> {filteredReconCounts.neutral} нет данных
              </span>
            )}
          </div>

          {/* Department reconciliation table */}
          <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-zinc-50 dark:bg-zinc-900/50 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                    <th className="px-5 py-3">Управление</th>
                    <th className="px-4 py-3 text-right">СВОД план</th>
                    <th className="px-4 py-3 text-right">Расчёт план</th>
                    <th className="px-4 py-3 text-right">Δ план</th>
                    <th className="px-4 py-3 text-right">СВОД факт</th>
                    <th className="px-4 py-3 text-right">Расчёт факт</th>
                    <th className="px-4 py-3 text-right">Δ факт</th>
                    <th className="px-4 py-3 text-center">Источник</th>
                    <th className="px-4 py-3 text-center">Оценка</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
                  {filteredReconRows.map((row) => {
                    const cfg = KIND_CONFIG[row.assessment.kind];
                    const Icon = cfg.icon;
                    const isExpanded = expandedDept === row.department;

                    return (
                      <React.Fragment key={row.department}>
                        <tr
                          className={clsx(
                            'transition cursor-pointer',
                            row.assessment.kind === 'high' && 'bg-red-50/30 dark:bg-red-950/20',
                            row.assessment.kind === 'warning' && 'bg-amber-50/20 dark:bg-amber-950/15',
                            isExpanded ? 'bg-blue-50/30 dark:bg-blue-950/20' : 'hover:bg-zinc-50 dark:hover:bg-zinc-700/30',
                          )}
                          onClick={() => setExpandedDept(isExpanded ? null : row.department)}
                        >
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2">
                              <Building2 size={14} className="text-zinc-400" />
                              <span className="font-semibold text-zinc-700 dark:text-zinc-200">{row.department}</span>
                              {isExpanded ? <ChevronUp size={12} className="text-zinc-400" /> : <ChevronDown size={12} className="text-zinc-400" />}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-300">{fmtNum(row.fullPlanOfficial)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-300">{fmtNum(row.fullPlanCalculated)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            <span className={clsx(
                              'font-medium',
                              isZero(row.planDelta) ? 'text-zinc-300 dark:text-zinc-600'
                                : row.assessment.kind === 'high' ? 'text-red-600 dark:text-red-400'
                                : 'text-amber-600 dark:text-amber-400',
                            )}>
                              {isZero(row.planDelta) ? '0' : fmtNum(row.planDelta)}
                              {!isZero(row.planDeltaPct) && <span className="text-[10px] ml-1">({fmtPct(row.planDeltaPct)})</span>}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-300">{fmtNum(row.fullFactOfficial)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-300">{fmtNum(row.fullFactCalculated)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            <span className={clsx(
                              'font-medium',
                              isZero(row.factDelta) ? 'text-zinc-300 dark:text-zinc-600'
                                : row.assessment.kind === 'high' ? 'text-red-600 dark:text-red-400'
                                : 'text-amber-600 dark:text-amber-400',
                            )}>
                              {isZero(row.factDelta) ? '0' : fmtNum(row.factDelta)}
                              {!isZero(row.factDeltaPct) && <span className="text-[10px] ml-1">({fmtPct(row.factDeltaPct)})</span>}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={clsx(
                              'text-[11px] font-medium',
                              row.assessment.source === 'svod_error' ? 'text-red-500 dark:text-red-400'
                                : row.assessment.source === 'calc_error' ? 'text-amber-600 dark:text-amber-400'
                                : row.assessment.source === 'methodology' ? 'text-blue-500 dark:text-blue-400'
                                : 'text-zinc-400 dark:text-zinc-500',
                            )}>
                              {row.assessment.sourceLabel ?? '—'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', cfg.bg, cfg.text)}>
                              <Icon size={12} /> {cfg.label}
                            </span>
                          </td>
                        </tr>

                        {/* Expanded detail */}
                        {isExpanded && (() => {
                          const diag = diagnoseDelta(row);
                          const cells = DEPT_SVOD_CELLS[row.department];
                          return (
                          <tr className="bg-zinc-50/80 dark:bg-zinc-900/40">
                            <td colSpan={9} className="px-5 py-4">
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
                                {/* Diagnosis */}
                                <div className="space-y-2">
                                  <div className="font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                                    <AlertTriangle size={13} className={diag.severity === 'error' ? 'text-red-500' : diag.severity === 'warn' ? 'text-amber-500' : 'text-emerald-500'} />
                                    Источник расхождения
                                  </div>
                                  <div className={clsx(
                                    'rounded-lg p-3 border',
                                    diag.severity === 'error' ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800'
                                    : diag.severity === 'warn' ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800'
                                    : 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800',
                                  )}>
                                    <div className={clsx('font-bold text-[11px]',
                                      diag.severity === 'error' ? 'text-red-700 dark:text-red-400'
                                      : diag.severity === 'warn' ? 'text-amber-700 dark:text-amber-400'
                                      : 'text-emerald-700 dark:text-emerald-400',
                                    )}>{diag.source}</div>
                                    <div className="text-[10px] mt-1 text-zinc-600 dark:text-zinc-400 leading-relaxed">{diag.detail}</div>
                                  </div>
                                </div>

                                {/* SVOD Cell References */}
                                <div className="space-y-2">
                                  <div className="font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                                    <FileSpreadsheet size={13} className="text-blue-500" /> Ячейки СВОД ТД-ПМ
                                  </div>
                                  <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3 space-y-1">
                                    {cells ? (
                                      <>
                                        {[
                                          ['План кол-во', cells.planCount, fmtNum(row.fullPlanOfficial)],
                                          ['Факт кол-во', cells.factCount, fmtNum(row.fullFactOfficial)],
                                          ['Экономия', cells.economy, fmtNum(row.ecoTotalOfficial)],
                                        ].map(([label, cell, val]) => (
                                          <div key={cell as string} className="flex items-center justify-between text-[10px]">
                                            <span className="text-blue-600 dark:text-blue-400">{label}</span>
                                            <span className="flex items-center gap-1">
                                              <code className="text-blue-800 dark:text-blue-300 font-mono">{cell}</code>
                                              <span className="text-zinc-500">= {val}</span>
                                              <button
                                                className="p-0.5 rounded hover:bg-blue-200 dark:hover:bg-blue-800 transition"
                                                onClick={(e) => { e.stopPropagation(); window.open(buildSheetUrl(SVOD_SPREADSHEET_ID, cell as string), '_blank'); }}
                                              >
                                                <ExternalLink size={9} className="text-blue-500" />
                                              </button>
                                            </span>
                                          </div>
                                        ))}
                                      </>
                                    ) : <span className="text-blue-400 text-[10px]">Нет маппинга ячеек</span>}
                                  </div>
                                </div>

                                {/* Economy comparison */}
                                <div className="space-y-2">
                                  <div className="font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                                    <Info size={13} className="text-indigo-500" /> Экономия ИТОГО
                                  </div>
                                  <div className="bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 rounded-lg p-3">
                                    <div className="flex justify-between text-[10px]">
                                      <span className="text-indigo-600 dark:text-indigo-400">СВОД:</span>
                                      <strong className="text-indigo-800 dark:text-indigo-300">{fmtNum(row.ecoTotalOfficial)}</strong>
                                    </div>
                                    <div className="flex justify-between mt-1 text-[10px]">
                                      <span className="text-indigo-600 dark:text-indigo-400">Расчёт:</span>
                                      <strong className="text-indigo-800 dark:text-indigo-300">{fmtNum(row.ecoTotalCalculated)}</strong>
                                    </div>
                                    <div className="flex justify-between mt-1 pt-1 border-t border-indigo-200 dark:border-indigo-700 text-[10px]">
                                      <span className="text-indigo-600 dark:text-indigo-400">Δ:</span>
                                      <strong className={row.ecoDelta === 0 ? 'text-indigo-300' : 'text-indigo-800 dark:text-indigo-300'}>
                                        {fmtNum(row.ecoDelta)}
                                      </strong>
                                    </div>
                                  </div>
                                </div>

                                {/* Recommendation */}
                                <div className="space-y-2">
                                  <div className="font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                                    <ArrowRight size={13} className="text-violet-500" /> Рекомендация
                                  </div>
                                  <div className="bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 rounded-lg p-3 text-[10px] text-violet-700 dark:text-violet-400 leading-relaxed">
                                    {row.assessment.kind === 'ok'
                                      ? 'Данные согласованы. Дополнительных действий не требуется.'
                                      : row.assessment.kind === 'warning'
                                      ? 'Проверьте состав строк: возможно часть строк не прошла классификацию (порог score >= 3) или период не совпадает.'
                                      : row.assessment.kind === 'high'
                                      ? `Критическое расхождение. Проверьте: (1) формулы ${cells?.planCount ?? 'СВОД'} ссылаются на правильные диапазоны, (2) колонка L (метод) заполнена корректно, (3) нет дубликатов строк.`
                                      : 'Нет данных для сравнения — проверьте что оба источника загружены.'}
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                          );
                        })()}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ═══ METRICS VIEW ═══ */}
      {view === 'metrics' && hasMetricData && (
        <>
          {/* Summary badges */}
          <div className="flex gap-3 text-xs">
            <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 font-medium">
              <CheckCircle2 size={13} /> {metricOk} совпадает
            </span>
            <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 font-medium">
              <Clock size={13} /> {metricWarn} допустимо
            </span>
            <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 font-medium">
              <AlertTriangle size={13} /> {metricCrit} расхождение
            </span>
          </div>

          {/* Metric table */}
          <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-zinc-50 dark:bg-zinc-900/50 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                    <th className="px-5 py-3">Метрика</th>
                    <th className="px-4 py-3 text-right">СВОД (офиц.)</th>
                    <th className="px-4 py-3 text-right">Расчёт</th>
                    <th className="px-4 py-3 text-right">Δ абс.</th>
                    <th className="px-4 py-3 text-right">Δ %</th>
                    <th className="px-4 py-3 text-center">Оценка</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
                  {activeMetricRows.map((row) => {
                    const cfg = METRIC_ASSESS_CONFIG[row.assessment];
                    const Icon = cfg.icon;
                    const isExpanded = expandedMetric === row.metric;
                    const delta = deltas.find((d: any) => d.metricKey === row.metric);
                    return (
                      <React.Fragment key={row.metric}>
                        <tr
                          className={clsx(
                            'transition cursor-pointer',
                            row.assessment === 'critical' && 'bg-red-50/30 dark:bg-red-950/20',
                            row.assessment === 'warning' && 'bg-amber-50/20 dark:bg-amber-950/15',
                            isExpanded ? 'bg-blue-50/30 dark:bg-blue-950/20' : 'hover:bg-zinc-50 dark:hover:bg-zinc-700/30',
                          )}
                          onClick={() => setExpandedMetric(isExpanded ? null : row.metric)}
                        >
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2">
                              <div className="font-medium text-zinc-700 dark:text-zinc-200">{row.metricLabel}</div>
                              {isExpanded ? <ChevronUp size={12} className="text-zinc-400" /> : <ChevronDown size={12} className="text-zinc-400" />}
                            </div>
                            <div className="text-[10px] text-zinc-400 dark:text-zinc-500 font-mono">{row.metric}</div>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                            <span className="inline-flex items-center gap-1">
                              {fmtNum(row.official)}
                              {delta?.sourceCell && (
                                  <button
                                    title={`Открыть ${delta.sourceCell} в Google Sheets`}
                                    className="p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      window.open(buildSheetUrl(SVOD_SPREADSHEET_ID, delta.sourceCell), '_blank');
                                    }}
                                  >
                                    <ExternalLink size={11} className="text-blue-500" />
                                  </button>
                              )}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-300">{fmtNum(row.calculated)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            <span className={clsx(
                              'font-medium',
                              isZero(row.deltaAbs) ? 'text-zinc-300 dark:text-zinc-600' : row.assessment === 'critical' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'
                            )}>
                              {isZero(row.deltaAbs) ? '0' : fmtNum(row.deltaAbs)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            <span className={clsx(
                              'font-medium',
                              isZero(row.deltaPct) ? 'text-zinc-300 dark:text-zinc-600' : row.deltaPct > 5 ? 'text-red-600 dark:text-red-400' : row.deltaPct > 1 ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-400 dark:text-zinc-500'
                            )}>
                              {fmtPct(row.deltaPct)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', cfg.bg, cfg.text)}>
                              <Icon size={12} /> {cfg.label}
                            </span>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-zinc-50/80 dark:bg-zinc-900/40">
                            <td colSpan={6} className="px-5 py-4">
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                                <div className="space-y-2">
                                  <div className="font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                                    <FileSpreadsheet size={13} className="text-blue-500" /> Ячейка СВОД
                                  </div>
                                  <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                                    <div className="text-blue-800 dark:text-blue-300 font-mono text-[11px] flex items-center gap-1.5">
                                      {delta?.sourceCell ?? row.metric}
                                      {delta?.sourceCell && (
                                        <button
                                          title="Открыть в Google Sheets"
                                          className="p-0.5 rounded hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            window.open(buildSheetUrl(SVOD_SPREADSHEET_ID, delta.sourceCell), '_blank');
                                          }}
                                        >
                                          <ExternalLink size={11} className="text-blue-500" />
                                        </button>
                                      )}
                                    </div>
                                    <div className="text-blue-600 dark:text-blue-400 mt-1">
                                      Значение: <strong>{fmtNum(row.official)}</strong>
                                    </div>
                                  </div>
                                </div>
                                <div className="space-y-2">
                                  <div className="font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                                    <Info size={13} className="text-indigo-500" /> Пересчёт
                                  </div>
                                  <div className="bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 rounded-lg p-3">
                                    <div className="text-indigo-600 dark:text-indigo-400 mt-1">
                                      Результат: <strong>{fmtNum(row.calculated)}</strong>
                                    </div>
                                    <div className="text-indigo-500 mt-0.5 text-[10px]">
                                      Агрегация по строкам листа управления
                                    </div>
                                  </div>
                                </div>
                                <div className="space-y-2">
                                  <div className="font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                                    {row.assessment === 'critical' ? <AlertTriangle size={13} className="text-red-500" /> : <CheckCircle2 size={13} className="text-emerald-500" />}
                                    Рекомендация
                                  </div>
                                  <div className={clsx(
                                    'rounded-lg p-3 border text-[11px]',
                                    row.assessment === 'critical' ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400' :
                                    row.assessment === 'warning' ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400' :
                                    'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400'
                                  )}>
                                    {row.assessment === 'ok'
                                      ? 'Значения совпадают. Дополнительных действий не требуется.'
                                      : row.assessment === 'warning'
                                      ? `Допустимое расхождение (${fmtPct(row.deltaPct)}). Проверьте при следующем обновлении данных.`
                                      : `Критическое расхождение (${fmtPct(row.deltaPct)}). Проверьте формулу СВОД.`}
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ═══ MONTHLY SHDYU VIEW ═══ */}
      {view === 'monthly' && (
        <>
          {monthlyLoading && (
            <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 p-8 text-center">
              <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
              <p className="text-xs text-zinc-500">Загрузка помесячных данных ШДЮ...</p>
            </div>
          )}
          {monthlyData?.warning && (
            <div className="bg-amber-50 dark:bg-amber-950/30 rounded-xl border border-amber-200 dark:border-amber-800 p-5 text-center">
              <AlertTriangle className="mx-auto text-amber-500 mb-2" size={28} />
              <p className="text-sm text-amber-700 dark:text-amber-400">{monthlyData.warning}</p>
            </div>
          )}
          {monthlyData?.rows?.length > 0 && (
            <>
              <div className="flex gap-3 text-xs">
                <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 font-medium">
                  <CheckCircle2 size={13} /> {monthlyData.counts?.ok ?? 0} совпадает
                </span>
                <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 font-medium">
                  <Clock size={13} /> {monthlyData.counts?.warning ?? 0} допустимо
                </span>
                <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 font-medium">
                  <AlertTriangle size={13} /> {monthlyData.counts?.high ?? 0} расхождение
                </span>
              </div>
              <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-zinc-50 dark:bg-zinc-900/50 text-left font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                        <th className="px-3 py-2.5">ГРБС</th>
                        <th className="px-3 py-2.5 text-center">Месяц</th>
                        <th className="px-3 py-2.5 text-right" colSpan={2}>КП план</th>
                        <th className="px-3 py-2.5 text-right" colSpan={2}>КП факт</th>
                        <th className="px-3 py-2.5 text-right" colSpan={2}>ЕП план</th>
                        <th className="px-3 py-2.5 text-right" colSpan={2}>ЕП факт</th>
                      </tr>
                      <tr className="bg-zinc-50/50 dark:bg-zinc-900/30 text-[10px] text-zinc-400 dark:text-zinc-500">
                        <th></th>
                        <th></th>
                        <th className="px-2 py-1 text-right">ШДЮ</th>
                        <th className="px-2 py-1 text-right">Расчёт</th>
                        <th className="px-2 py-1 text-right">ШДЮ</th>
                        <th className="px-2 py-1 text-right">Расчёт</th>
                        <th className="px-2 py-1 text-right">ШДЮ</th>
                        <th className="px-2 py-1 text-right">Расчёт</th>
                        <th className="px-2 py-1 text-right">ШДЮ</th>
                        <th className="px-2 py-1 text-right">Расчёт</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
                      {monthlyData.rows.map((r: any, i: number) => {
                        const MONTH_NAMES = ['', 'Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
                        const cellCls = (cell: any) => clsx(
                          'px-2 py-2 text-right tabular-nums',
                          cell?.status === 'ok' && 'text-emerald-600 dark:text-emerald-400',
                          cell?.status === 'warning' && 'text-amber-600 dark:text-amber-400 bg-amber-50/50 dark:bg-amber-950/20',
                          cell?.status === 'high' && 'text-red-600 dark:text-red-400 bg-red-50/50 dark:bg-red-950/20',
                          cell?.status === 'empty' && 'text-zinc-300 dark:text-zinc-600',
                        );
                        return (
                          <tr key={`${r.deptId}-${r.month}-${i}`} className="hover:bg-zinc-50 dark:hover:bg-zinc-700/30 cursor-pointer" onClick={() => navigateTo('data', { department: r.deptId, months: [r.month] })}>
                            <td className="px-3 py-2 font-medium text-zinc-700 dark:text-zinc-200">{r.deptName}</td>
                            <td className="px-3 py-2 text-center text-zinc-500">{MONTH_NAMES[r.month]}</td>
                            <td className={cellCls(r.compPlan)}>{fmtNum(r.compPlan?.shdyu ?? 0)}</td>
                            <td className={cellCls(r.compPlan)}>{fmtNum(r.compPlan?.calc ?? 0)}</td>
                            <td className={cellCls(r.compFact)}>{fmtNum(r.compFact?.shdyu ?? 0)}</td>
                            <td className={cellCls(r.compFact)}>{fmtNum(r.compFact?.calc ?? 0)}</td>
                            <td className={cellCls(r.epPlan)}>{fmtNum(r.epPlan?.shdyu ?? 0)}</td>
                            <td className={cellCls(r.epPlan)}>{fmtNum(r.epPlan?.calc ?? 0)}</td>
                            <td className={cellCls(r.epFact)}>{fmtNum(r.epFact?.shdyu ?? 0)}</td>
                            <td className={cellCls(r.epFact)}>{fmtNum(r.epFact?.calc ?? 0)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* ═══ SUBORDINATES VIEW ═══ */}
      {view === 'subordinates' && fd.depts.length > 0 && (
        <>
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
                  {fd.depts.map((dept: any) => {
                    const subs: any[] = dept.subordinates ?? [];
                    if (subs.length === 0) return null;

                    const deptPlanCount = subs.reduce((s: number, sub: any) => s + (sub.rowCount ?? 0), 0);
                    const deptFactCount = subs.reduce((s: number, sub: any) => s + (sub.competitiveCount ?? 0) + (sub.epCount ?? 0), 0);
                    const deptPlanTotal = subs.reduce((s: number, sub: any) => s + (sub.planTotal ?? 0), 0);
                    const deptFactTotal = subs.reduce((s: number, sub: any) => s + (sub.factTotal ?? 0), 0);
                    const deptEconomy = subs.reduce((s: number, sub: any) => s + (sub.economyTotal ?? 0), 0);
                    const deptExecPct = deptPlanCount > 0 ? (deptFactCount / deptPlanCount) * 100 : 0;

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
                        {subs.map((sub: any, idx: number) => {
                          const execPct = sub.executionPct ?? (sub.rowCount > 0 ? ((sub.competitiveCount + sub.epCount) / sub.rowCount) * 100 : 0);
                          return (
                            <tr
                              key={`${deptKey}-${sub.name}-${idx}`}
                              className="hover:bg-zinc-50 dark:hover:bg-zinc-700/30 transition cursor-pointer"
                              onClick={() => navigateTo('data', { department: deptKey, subordinate: sub.name })}
                            >
                              <td className="px-5 py-2.5"></td>
                              <td className="px-4 py-2.5">
                                <div className="flex items-center gap-2">
                                  <Users size={12} className="text-zinc-400" />
                                  <span className="text-zinc-700 dark:text-zinc-200 text-xs">{sub.name}</span>
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
                          <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-zinc-700 dark:text-zinc-200">{fmtNum(deptPlanCount)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-zinc-700 dark:text-zinc-200">{fmtNum(deptFactCount)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            <span className={clsx(
                              'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold',
                              deptExecPct >= 80 ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400'
                                : deptExecPct >= 50 ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400'
                                : 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400',
                            )}>
                              {fmtPct(deptExecPct)}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-zinc-700 dark:text-zinc-200">{formatMoney(deptPlanTotal)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-zinc-700 dark:text-zinc-200">{formatMoney(deptFactTotal)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-zinc-700 dark:text-zinc-200">{formatMoney(deptEconomy)}</td>
                        </tr>
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Snapshot metadata */}
      {snapshot && (
        <div className="flex flex-wrap gap-6 text-xs text-zinc-500 dark:text-zinc-400 bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 px-5 py-3">
          <span>Снапшот: <strong className="text-zinc-700 dark:text-zinc-200">{snapshot.snapshotId?.slice(0, 8) ?? '—'}</strong></span>
          <span>Ячеек: <strong className="text-zinc-700 dark:text-zinc-200">{snapshot.cellsRead ?? '—'}</strong></span>
          <span>Листов: <strong className="text-zinc-700 dark:text-zinc-200">{snapshot.sheetsRead ?? '—'}</strong></span>
          <span>Обработка: <strong className="text-zinc-700 dark:text-zinc-200">{snapshot.pipelineDurationMs ?? '—'} мс</strong></span>
        </div>
      )}

      {/* Methodology */}
      <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50">
        <button
          onClick={() => setMethodOpen(!methodOpen)}
          className="w-full flex items-center justify-between px-5 py-4 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700/30 transition"
        >
          <span className="flex items-center gap-2"><Info size={16} className="text-blue-500" /> Методология единой сверки</span>
          {methodOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {methodOpen && (
          <div className="px-5 pb-5 text-xs text-zinc-600 dark:text-zinc-300 space-y-4 border-t border-zinc-100 dark:border-zinc-700/50 pt-4">
            <p><strong>Принцип</strong>: Одна и та же методика агрегации применяется к двум источникам:</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                <div className="font-semibold text-blue-800 dark:text-blue-300">СВОД ТД-ПМ (официальный)</div>
                <div className="text-blue-600 dark:text-blue-400 mt-1">Значения из ячеек СВОД ТД-ПМ — результат формул COUNTIFS/SUMIFS внутри Google Sheets. 216 метрик по 8 управлениям + сводные.</div>
              </div>
              <div className="bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 rounded-lg p-3">
                <div className="font-semibold text-indigo-800 dark:text-indigo-300">Расчёт (row-by-row)</div>
                <div className="text-indigo-600 dark:text-indigo-400 mt-1">Независимый пересчёт по строкам из таблиц управлений. Колонки: L=метод, N=дата плана, Q=дата факта, H-K=бюджет плана, V-Y=бюджет факта, AB=экономия МБ.</div>
              </div>
            </div>

            <p className="font-semibold text-zinc-700 dark:text-zinc-200">Три уровня сверки:</p>
            <ul className="list-disc pl-4 space-y-1.5">
              <li><strong>По управлениям</strong> — агрегированное сравнение итоговых планов/фактов по каждому ГРБС. Порог: Δ &lt; 1% = совпадает, 1-5% = несопоставимо, &gt; 5% = расхождение.</li>
              <li><strong>По метрикам</strong> — сравнение каждой конкретной ячейки СВОД (D14, E14, G14...) с пересчитанным значением. Порог по умолчанию 1%.</li>
              <li><strong>Помесячно (ШДЮ)</strong> — сравнение динамики по месяцам из листа ШДЮ с row-by-row расчётом. Показывает КП/ЕП план/факт по каждому месяцу.</li>
            </ul>

            <p className="font-semibold text-zinc-700 dark:text-zinc-200 pt-1">Атрибуты метрик СВОД ТД-ПМ:</p>
            <div className="overflow-x-auto">
              <table className="w-full text-[10px] border-collapse">
                <thead>
                  <tr className="bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                    <th className="px-2 py-1.5 text-left font-medium">Колонка СВОД</th>
                    <th className="px-2 py-1.5 text-left font-medium">Атрибут</th>
                    <th className="px-2 py-1.5 text-left font-medium">Формула</th>
                    <th className="px-2 py-1.5 text-left font-medium">Колонки-источники</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
                  <tr><td className="px-2 py-1 font-mono">D</td><td className="px-2 py-1">План (кол-во)</td><td className="px-2 py-1">COUNTIFS по col L + col O</td><td className="px-2 py-1">L=метод, O=квартал плана</td></tr>
                  <tr><td className="px-2 py-1 font-mono">E</td><td className="px-2 py-1">Факт (кол-во)</td><td className="px-2 py-1">COUNTIFS по col L + col Q</td><td className="px-2 py-1">L=метод, Q=дата факта</td></tr>
                  <tr><td className="px-2 py-1 font-mono">F</td><td className="px-2 py-1">Отклонение</td><td className="px-2 py-1">=D−E</td><td className="px-2 py-1">Разница план − факт</td></tr>
                  <tr><td className="px-2 py-1 font-mono">G</td><td className="px-2 py-1">Исполнение %</td><td className="px-2 py-1">=E/D</td><td className="px-2 py-1">Доля факта от плана</td></tr>
                  <tr><td className="px-2 py-1 font-mono">H</td><td className="px-2 py-1">ФБ план</td><td className="px-2 py-1">SUMIFS по col H</td><td className="px-2 py-1">H=ФБ план (тыс. руб.)</td></tr>
                  <tr><td className="px-2 py-1 font-mono">I</td><td className="px-2 py-1">КБ план</td><td className="px-2 py-1">SUMIFS по col I</td><td className="px-2 py-1">I=КБ план (тыс. руб.)</td></tr>
                  <tr><td className="px-2 py-1 font-mono">J</td><td className="px-2 py-1">МБ план</td><td className="px-2 py-1">SUMIFS по col J</td><td className="px-2 py-1">J=МБ план (тыс. руб.)</td></tr>
                  <tr><td className="px-2 py-1 font-mono">K</td><td className="px-2 py-1">Итого план</td><td className="px-2 py-1">=H+I+J</td><td className="px-2 py-1">Сумма ФБ+КБ+МБ</td></tr>
                  <tr><td className="px-2 py-1 font-mono">L</td><td className="px-2 py-1">ФБ факт</td><td className="px-2 py-1">SUMIFS по col V</td><td className="px-2 py-1">V=ФБ факт (тыс. руб.)</td></tr>
                  <tr><td className="px-2 py-1 font-mono">M</td><td className="px-2 py-1">КБ факт</td><td className="px-2 py-1">SUMIFS по col W</td><td className="px-2 py-1">W=КБ факт (тыс. руб.)</td></tr>
                  <tr><td className="px-2 py-1 font-mono">N</td><td className="px-2 py-1">МБ факт</td><td className="px-2 py-1">SUMIFS по col X</td><td className="px-2 py-1">X=МБ факт (тыс. руб.)</td></tr>
                  <tr><td className="px-2 py-1 font-mono">O</td><td className="px-2 py-1">Итого факт</td><td className="px-2 py-1">=L+M+N</td><td className="px-2 py-1">Сумма ФБ+КБ+МБ факт</td></tr>
                  <tr><td className="px-2 py-1 font-mono">U</td><td className="px-2 py-1">Экономия итого за квартал</td><td className="px-2 py-1">SUMIFS по col AB</td><td className="px-2 py-1">AB=экономия МБ (тыс. руб.)</td></tr>
                </tbody>
              </table>
            </div>

            <p className="font-semibold text-zinc-700 dark:text-zinc-200 pt-1">Маппинг управлений в СВОД ТД-ПМ:</p>
            <div className="overflow-x-auto">
              <table className="w-full text-[10px] border-collapse">
                <thead>
                  <tr className="bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                    <th className="px-2 py-1.5 text-left font-medium">Управление</th>
                    <th className="px-2 py-1.5 text-left font-medium">Лист</th>
                    <th className="px-2 py-1.5 text-center font-medium">КП Q1</th>
                    <th className="px-2 py-1.5 text-center font-medium">КП Год</th>
                    <th className="px-2 py-1.5 text-center font-medium">ЕП Q1</th>
                    <th className="px-2 py-1.5 text-center font-medium">ЕП Год</th>
                    <th className="px-2 py-1.5 text-center font-medium">Экон. КП</th>
                    <th className="px-2 py-1.5 text-center font-medium">Экон. ЕП</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
                  {[
                    ['УЭР',    'Все',   42,  47,  53,  58, 'U46', 'U57'],
                    ['УИО',    'Все',   72,  77,  83,  88, '—',   '—'],
                    ['УАГЗО',  'УАГЗО', 102, 107, 113, 118, '—',  '—'],
                    ['УФБП',   'УФБП',  132, 137, 143, 148, '—',  'U147'],
                    ['УД',     'Все',   163, 168, 175, 180, 'U167','U179'],
                    ['УДТХ',   'УДТХ',  195, 200, 206, 211, 'U199','U210'],
                    ['УКСиМП', 'Все',   225, 230, 236, 241, 'U229','U240'],
                    ['УО',     'Все',   255, 260, 266, 271, 'U259','U270'],
                  ].map(([name, sheet, kpQ1, kpY, epQ1, epY, ecoKP, ecoEP]) => (
                    <tr key={name as string}>
                      <td className="px-2 py-1 font-medium">{name}</td>
                      <td className="px-2 py-1 font-mono text-blue-500">{sheet}</td>
                      <td className="px-2 py-1 text-center font-mono">стр.{kpQ1}</td>
                      <td className="px-2 py-1 text-center font-mono">стр.{kpY}</td>
                      <td className="px-2 py-1 text-center font-mono">стр.{epQ1}</td>
                      <td className="px-2 py-1 text-center font-mono">стр.{epY}</td>
                      <td className="px-2 py-1 text-center font-mono">{ecoKP}</td>
                      <td className="px-2 py-1 text-center font-mono">{ecoEP}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-[10px] text-zinc-400 dark:text-zinc-500 pt-1">
              Расхождение означает что формулы СВОД считают не то же что строковые данные — это сигнал проблемы данных или сломанной формулы. Сводные строки: КП Q1=стр.9, КП Год=стр.14, ЕП Q1=стр.21, ЕП Год=стр.26.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
