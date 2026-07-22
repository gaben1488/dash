// ── Типы страницы «Сверка» (Recon): алиасы DTO из @aemr/core / @aemr/shared
//    вместо локальных дублей (rethink E11-4). Исходные массивы приходят из
//    API/useFilteredData нетипизированными; алиасы аннотируют использование,
//    чтобы ошибки формы ловились локально, а дрейф от ядра — компилятором.

import type {
  MonthlyReconCell,
  MonthlyReconRow,
  MonthlyReconSummary,
  ReconRow,
  ReconSummary,
  SubordinateMetrics,
} from '@aemr/core';
import type { DeltaResult } from '@aemr/shared';

/**
 * Ячейка помесячной сверки (лист «СВОД с месяцами») — DTO ядра
 * (@aemr/core reconcile.ts), включая статус no_calc («расчётный слой за срез
 * не построен», §5.4-A): сравнение неприменимо, это НЕ «расхождение» —
 * у него честный нейтральный рендер (см. lib/recon/monthly.ts).
 */
export type ReconCell = MonthlyReconCell;

/**
 * Бюджетная разбивка (ФБ/КБ/МБ × план/факт/экономия) блока КП или ЕП.
 * Имя BudgetReconCells не экспортировано из @aemr/core — берём через
 * indexed access, чтобы не заводить структурный дубль.
 */
export type ReconBudget = NonNullable<MonthlyReconRow['compBudget']>;

/**
 * Root-cause помесячного расхождения. Имя SHDYUReconRootCause не
 * экспортировано из @aemr/core — indexed access вместо дубля.
 */
export type ReconMonthlyRootCause = NonNullable<MonthlyReconRow['rootCause']>;

/** Строка помесячной сверки — DTO ядра (reconcileMonthly). */
export type ReconMonthlyRow = MonthlyReconRow;

/**
 * Ответ GET /api/reconciliation/monthly: сводка ядра + предупреждение сервера
 * (лист не загружен / официального помесячного слоя за год не существует) —
 * поле дописывает routes/reconciliation.ts поверх MonthlyReconSummary.
 */
export type ReconMonthlyData = MonthlyReconSummary & { warning?: string };

/** Строка сверки «По управлениям» — DTO ядра (reconcile). */
export type ReconDeptRow = ReconRow;

/** Ответ GET /api/reconciliation (поле reconciliation) — DTO ядра. */
export type ReconSummaryData = ReconSummary;

/**
 * Метрика-дельта из dashboard-пейлоада: DeltaResult (@aemr/shared) + ячейка
 * СВОД-источника, которую дописывает сервер (routes/dashboard.ts) для
 * deep-link в Google Sheets.
 */
export type ReconMetricDelta = DeltaResult & { sourceCell?: string };

/**
 * Подвед в dashboard-пейлоаде: подмножество SubordinateMetrics ядра.
 * Поля, кроме имени, опциональны — данные проходят через нетипизированный
 * JSON-слой (fd/dashboardData); Pick привязывает имена и типы полей к ядру.
 */
export type ReconSubordinate = Pick<SubordinateMetrics, 'name'> &
  Partial<
    Pick<
      SubordinateMetrics,
      'rowCount' | 'competitiveCount' | 'epCount' | 'planTotal' | 'factTotal' | 'economyTotal' | 'executionPct'
    >
  >;

/**
 * Узел «управление + его подведы» из dashboardData.departments — обвязка
 * дашборда, в ядре именованного аналога нет, остаётся локальным.
 */
export interface ReconDeptNode {
  department?: { id?: string; name?: string; nameShort?: string };
  subordinates?: ReconSubordinate[];
}

/** Оценка метрики-дельты (view-model вкладки «По метрикам»). */
export type MetricAssessment = 'ok' | 'warning' | 'critical';

/** Строка таблицы «По метрикам» (view-model, строится в metric-rows.ts). */
export interface MetricReconRow {
  metric: string;
  metricLabel: string;
  official: number;
  calculated: number;
  deltaAbs: number;
  deltaPct: number;
  assessment: MetricAssessment;
}
