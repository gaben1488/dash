/**
 * Read-only, evidence-conscious explanation of a detected problem.
 *
 * We classify the *possible consequence*, not severity, employee fault or
 * legal guilt. Only downstream replay can confirm the actual money/report
 * impact. This is a transitional projection from the canonical CHECK_REGISTRY
 * until the verified case/evidence model is accepted.
 */
import { CHECK_REGISTRY } from '@aemr/shared';
import type { Issue } from '@aemr/shared';

export type ControlConsequenceKind =
  | 'control_not_completed'
  | 'observed_discrepancy'
  | 'possible_calculation_impact'
  | 'legal_qualification'
  | 'input_quality'
  | 'unclassified';

export interface ControlConsequence {
  kind: ControlConsequenceKind;
  explanation: string;
  /** true only when the evidence itself establishes the claimed state. */
  stateObserved: boolean;
}

type Input = Pick<Issue, 'checkId' | 'category' | 'origin' | 'severity'>;

const checks = new Map(CHECK_REGISTRY.map((entry) => [entry.id, entry]));
for (const check of CHECK_REGISTRY) {
  if (check.legacyId && !checks.has(check.legacyId)) checks.set(check.legacyId, check);
}

const YEAR_EXCLUSIONS = new Set(['plan_year_missing', 'fact_quarter_missing', 'planYearMissing', 'factQuarterMissing']);

export function controlConsequenceOf(issue: Input): ControlConsequence {
  if (issue.origin === 'runtime_error') {
    return {
      kind: 'control_not_completed',
      explanation: 'Часть проверки или чтения не выполнена. Нельзя считать отсутствие других замечаний подтверждением правильности данных.',
      stateObserved: true,
    };
  }
  if (issue.origin === 'delta_mismatch') {
    return {
      kind: 'observed_discrepancy',
      explanation: 'Официальное значение и самостоятельный расчёт расходятся. Сначала нужно установить, какая сторона и какой периметр верны.',
      stateObserved: true,
    };
  }

  const check = checks.get(issue.checkId ?? '');
  if (check?.group === 'formula_consistency' || YEAR_EXCLUSIONS.has(issue.checkId ?? '') ||
    YEAR_EXCLUSIONS.has(issue.category)) {
    return {
      kind: 'possible_calculation_impact',
      explanation: 'Это может менять расчёты, период или итоговую отчётность. Конкретное денежное влияние подтверждается повторным независимым пересчётом, не цветом сигнала.',
      stateObserved: false,
    };
  }
  if (check?.article44fz || issue.origin === 'compliance_44fz') {
    return {
      kind: 'legal_qualification',
      explanation: 'Нужно проверить правовое основание и первичные документы. Автоматический признак не устанавливает нарушение закона.',
      stateObserved: false,
    };
  }
  if (check?.group === 'field_validation' || check?.group === 'completeness' || check?.group === 'data_integrity') {
    return {
      kind: 'input_quality',
      explanation: 'Проблема со структурой или полнотой исходных данных. Влияние на показатели и готовность к миграции определяется по конкретным затронутым полям.',
      stateObserved: false,
    };
  }

  return {
    kind: 'unclassified',
    explanation: 'Влияние на расчёты ещё не оценено; требуется разбор исходных значений и применимости проверки.',
    stateObserved: false,
  };
}
