/**
 * issue-conversion.ts — конвертация legacy-issue в UnifiedIssue (вынесено из
 * unified-class-system.ts, чанк G, шаг 2).
 *
 * Зависит только от CHECK_REGISTRY (данные) + типов. Типы — через import type
 * (рантайм-цикла нет). CHECK_REGISTRY.find используется напрямую, без query-функций.
 */
import type {
  IssueGroup,
  UnifiedIssue,
  CheckOrigin,
  UnifiedSeverity,
  FilterDimensions,
} from './unified-class-system.js';
import type { IssueStatus, DepartmentId } from './types.js';
import { CHECK_REGISTRY } from './check-registry.js';

export const LEGACY_SIGNAL_TO_CHECK: Record<string, string> = {
  // Сигналы из SIGNAL_ISSUE_MAP
  overdue: 'overdue',
  stalledContract: 'stalled_contract',
  factExceedsPlan: 'fact_vs_plan',
  earlyClosure: 'early_closure',
  highEconomy: 'anti_dumping',
  epRisk: 'ep_risk',
  // budgetMismatch: УДАЛЁН — дубль Rule 1a (budget_sum_plan). Signal всегда false.
  economyConflict: 'economy_conflict',
  factWithoutDate: 'fact_without_date',
  dateWithoutFact: 'date_without_fact',
  dataQuality: 'data_quality',
  // singleParticipant УДАЛЁН из Issue-генерации — ненадёжная текстовая детекция, только badge
  factDateBeforePlan: 'fact_date_before_plan',
  futureFactDate: 'future_fact_date',
  financeDelay: 'finance_delay',
  // Дополнительные сигналы (без Issue, только badge)
  // lowCompetition УДАЛЁН из Issue-генерации — <2% экономия не является надёжным индикатором
  formulaBroken: 'formula_broken',
  // P1: Новые сигналы (аудит 2026-04-13)
  planWithoutExecution: 'plan_without_execution',
  epJustificationMissing: 'ep_justification_missing',
  budgetUnderallocation: 'budget_underallocation',
  budgetSourceMissing: 'budget_source_missing',
  // 06.08: ТД с заполненной графой программы — возможная ошибка заполнения (вводная пользователя)
  tdWithProgram: 'td_with_program',
  // 06.08: счётная строка без года плана — невидима для SUMIFS листа СВОД (сверка лимита УЭР)
  planYearMissing: 'plan_year_missing',
};

/**
 * Маппинг старых rule ID → новые check ID.
 */
export const LEGACY_RULE_TO_CHECK: Record<string, string> = {
  budget_sum_plan: 'budget_sum_plan',
  budget_sum_fact: 'budget_sum_fact',
  execution_percentage: 'execution_percentage',
  deviation_calc: 'deviation_calc',
  q1_leq_year: 'q1_leq_year',
  fact_leq_plan: 'fact_vs_plan',          // ОБЪЕДИНЁН
  method_validation: 'method_validation',
  type_validation: 'type_validation',
  status_on_data_rows: 'status_on_data_rows',
  economy_sign_check: 'economy_sign_check',
  dept_fact_sum: 'dept_fact_sum',
  dept_economy_sum: 'dept_economy_sum',
  dept_fact_leq_plan: 'fact_vs_plan',     // ОБЪЕДИНЁН
  // formula_continuity УДАЛЁН — дублирует budget_sum_plan + dept_fact_sum
};

// ────────────────────────────────────────────────────────────
// 12. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────
// 13. КОНВЕРТЕР Legacy Issue → UnifiedIssue
// ────────────────────────────────────────────────────────────

/**
 * Конвертирует legacy Issue (из validateData/detectSignalsToIssues)
 * в UnifiedIssue с полным набором координат и привязкой к реестру.
 */
export function convertLegacyIssue(
  issue: {
    id: string;
    severity: string;
    origin: string;
    category: string;
    title: string;
    description: string;
    sheet?: string;
    cell?: string;
    row?: number;
    departmentId?: string;
    recommendation?: string;
    activityType?: string;
    signal?: string;
    status: string;
    detectedAt: string;
    detectedBy: string;
  },
  year: number = 2026,
): UnifiedIssue {
  // Resolve check ID from signal or rule
  let checkId: string;
  if (issue.signal && LEGACY_SIGNAL_TO_CHECK[issue.signal as keyof typeof LEGACY_SIGNAL_TO_CHECK]) {
    checkId = LEGACY_SIGNAL_TO_CHECK[issue.signal as keyof typeof LEGACY_SIGNAL_TO_CHECK];
  } else if (LEGACY_RULE_TO_CHECK[issue.category]) {
    checkId = LEGACY_RULE_TO_CHECK[issue.category];
  } else {
    checkId = issue.category || 'unknown';
  }

  const check = CHECK_REGISTRY.find(c => c.id === checkId);

  // Map legacy severity to unified
  const severityMap: Record<string, UnifiedSeverity> = {
    error: 'error', critical: 'critical', significant: 'significant',
    warning: 'warning', info: 'info',
  };

  const severity = check?.severity ?? severityMap[issue.severity] ?? 'info';
  const group = check?.group ?? resolveGroupFromCategory(issue.category);

  // Extract month/quarter from description or cell reference
  const monthMatch = issue.description?.match(/месяц\s*(\d+)|m(\d+)|строка/i);
  const month = monthMatch ? parseInt(monthMatch[1] || monthMatch[2]) || null : null;

  return {
    id: issue.id,
    checkId,
    group,
    severity,
    origin: (check?.origin ?? issue.origin ?? 'bi_heuristic') as CheckOrigin,
    title: issue.title,
    description: issue.description,
    recommendation: check?.recommendation ?? issue.recommendation ?? '',
    kbHint: check?.kbHint ?? '',
    dimensions: {
      departmentId: (issue.departmentId as DepartmentId) ?? null,
      subordinate: null,
      month,
      quarter: null,
      year,
      method: null,
      activityType: (issue.activityType as FilterDimensions['activityType']) ?? null,
      sheet: issue.sheet ?? '',
      row: issue.row ?? null,
      cell: issue.cell ?? null,
    },
    actual: undefined,
    expected: undefined,
    metadata: {},
    status: issue.status as IssueStatus,
    detectedAt: issue.detectedAt,
    detectedBy: issue.detectedBy,
  };
}

/** Resolve group from legacy category string */
function resolveGroupFromCategory(category: string): IssueGroup {
  if (!category) return 'completeness';
  const cat = category.toLowerCase();
  if (cat.includes('budget') || cat.includes('sum')) return 'data_integrity';
  if (cat.includes('formula') || cat.includes('execution') || cat.includes('deviation')) return 'formula_consistency';
  if (cat.includes('method') || cat.includes('type') || cat.includes('validation')) return 'field_validation';
  if (cat.includes('overdue') || cat.includes('stalled') || cat.includes('early') || cat.includes('date')) return 'temporal';
  if (cat.includes('fact') || cat.includes('anti') || cat.includes('ep_risk') || cat.includes('dump')) return 'financial';
  if (cat.includes('economy') || cat.includes('status_on') || cat.includes('flag')) return 'economy_control';
  if (cat.includes('signal:overdue') || cat.includes('signal:stalled')) return 'temporal';
  if (cat.includes('signal:economy') || cat.includes('signal:anti')) return 'financial';
  if (cat.includes('signal:fact') || cat.includes('signal:date')) return 'completeness';
  return 'completeness';
}

/**
 * Batch convert all legacy issues to unified.
 */
export function convertAllIssues(
  issues: Array<{
    id: string; severity: string; origin: string; category: string;
    title: string; description: string; sheet?: string; cell?: string;
    row?: number; departmentId?: string; recommendation?: string;
    activityType?: string; signal?: string; status: string;
    detectedAt: string; detectedBy: string;
  }>,
  year?: number,
): UnifiedIssue[] {
  return issues.map(i => convertLegacyIssue(i, year));
}

// ────────────────────────────────────────────────────────────
// 14. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ────────────────────────────────────────────────────────────

