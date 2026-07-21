// ── Локальные view-model типы страницы «Сверка» (Recon).
//    Исходные массивы приходят из API/useFilteredData как any[]; эти интерфейсы
//    аннотируют использование, чтобы ошибки формы ловились локально.
//    Зеркало DTO из @aemr/core (pipeline/reconcile.ts).
//    Извлечено move-only из pages/Recon.tsx (разрез E11-4).

export interface ReconCell {
  shdyu?: number;
  calc?: number;
  delta?: number;
  deltaPct?: number;
  /**
   * no_calc — расчётный слой за срез не построен (@aemr/core reconcile.ts §5.4-A):
   * сравнение неприменимо, это НЕ «расхождение». Раньше статус отсутствовал
   * в локальном типе и падал в дефолтный (пустой) стиль — теперь у него честный
   * нейтральный рендер (см. lib/recon/monthly.ts).
   */
  status?: 'ok' | 'warning' | 'high' | 'empty' | 'no_calc';
}

export type ReconBudget = Record<string, ReconCell>;

export interface ReconMonthlyRootCause {
  id?: string;
  label: string;
  severity: 'warning' | 'critical';
  confidence: 'low' | 'medium' | 'high';
  evidence: string;
  suggestedAction?: string;
}

export interface ReconMonthlyRow {
  deptId: string;
  deptName: string;
  month: number;
  compPlan?: ReconCell;
  compFact?: ReconCell;
  compPlanTotal?: ReconCell;
  compFactTotal?: ReconCell;
  epPlan?: ReconCell;
  epFact?: ReconCell;
  epPlanTotal?: ReconCell;
  epFactTotal?: ReconCell;
  compBudget?: ReconBudget;
  epBudget?: ReconBudget;
  warnings?: string[];
  rootCause?: ReconMonthlyRootCause;
}

export interface ReconMonthlyData {
  rows?: ReconMonthlyRow[];
  counts?: { ok?: number; warning?: number; high?: number; empty?: number };
  warning?: string;
}

export interface ReconMetricDelta {
  metricKey: string;
  label?: string;
  officialValue?: number | null;
  calculatedValue?: number | null;
  deltaPercent: number | null;
  withinTolerance: boolean;
  /** Ячейка СВОД-источника (для deep-link в Google Sheets); раньше читалась через any */
  sourceCell?: string;
}

export interface ReconSubordinate {
  name: string;
  rowCount?: number;
  competitiveCount?: number;
  epCount?: number;
  planTotal?: number;
  factTotal?: number;
  economyTotal?: number;
  executionPct?: number;
}

export interface ReconDeptNode {
  department?: { id?: string; name?: string; nameShort?: string };
  subordinates?: ReconSubordinate[];
}

export interface ReconDeptRow {
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

export interface ReconSummaryData {
  rows: ReconDeptRow[];
  counts: { ok: number; neutral: number; warning: number; high: number };
  overallStatus: string;
}

export type MetricAssessment = 'ok' | 'warning' | 'critical';

export interface MetricReconRow {
  metric: string;
  metricLabel: string;
  official: number;
  calculated: number;
  deltaAbs: number;
  deltaPct: number;
  assessment: MetricAssessment;
}
