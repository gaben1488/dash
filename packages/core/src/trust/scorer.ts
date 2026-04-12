import type { TrustScore, TrustComponent, Issue, NormalizedMetric, DeltaResult } from '@aemr/shared';
import { THRESHOLDS, TRUST_COMPONENT_CONFIG } from '@aemr/shared';
import type { TrustComponentId, IssueGroup } from '@aemr/shared';

/**
 * Filter issues belonging to a trust component using group-based matching.
 * Falls back to legacy category matching for issues without group field.
 */
function issuesForComponent(issues: Issue[], componentId: TrustComponentId): Issue[] {
  const config = TRUST_COMPONENT_CONFIG[componentId];
  if (!config || config.issueGroups.length === 0) return [];

  const groups = new Set<string>(config.issueGroups);

  return issues.filter(i => {
    // Primary: use group field if populated (from unified class system)
    if (i.group) return groups.has(i.group);

    // Fallback: legacy category-based matching for un-enriched issues
    return matchLegacyCategory(i, componentId);
  });
}

/** Legacy category matching — backward compat for issues without group field */
function matchLegacyCategory(i: Issue, componentId: TrustComponentId): boolean {
  switch (componentId) {
    case 'data_quality':
      return i.category === 'signal:dataQuality' ||
        i.category === 'signal:factWithoutDate' ||
        i.category === 'signal:dateWithoutFact' ||
        i.category === 'signal:formulaBroken' ||
        i.origin === 'runtime_error';
    case 'formula_integrity':
      return i.category === 'formula_continuity' ||
        i.category === 'execution_percentage' ||
        i.category === 'deviation_calc' ||
        i.category === 'q1_leq_year' ||
        i.category === 'budget_sum_plan' ||
        i.category === 'budget_sum_fact' ||
        i.category === 'signal:budgetMismatch';
    case 'rule_compliance':
      return i.origin === 'spreadsheet_rule';
    case 'operational_risk':
      return i.category === 'signal:overdue' ||
        i.category === 'signal:stalledContract' ||
        i.category === 'signal:earlyClosure' ||
        i.category === 'signal:factDateBeforePlan' ||
        i.category === 'signal:factExceedsPlan' ||
        i.category === 'signal:highEconomy' ||
        // economyConflict removed: routes to rule_compliance via CHECK_REGISTRY group
        i.category === 'signal:epRisk';
    default:
      return false;
  }
}

/**
 * Вычисляет композитную оценку доверия к данным
 */
export function computeTrustScore(
  metrics: Map<string, NormalizedMetric>,
  issues: Issue[],
  deltas: DeltaResult[],
  snapshotId: string,
): TrustScore {
  const components: TrustComponent[] = [
    computeDataQuality(metrics, issues),
    computeFormulaIntegrity(issues),
    computeRuleCompliance(issues),
    computeMappingConsistency(metrics, deltas),
    computeOperationalRisk(issues),
  ];

  const totalWeight = components.reduce((sum, c) => sum + c.weight, 0);
  const weightedSum = components.reduce((sum, c) => sum + c.score * c.weight, 0);
  const overall = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;

  const grade = overall >= THRESHOLDS.TRUST.A ? 'A'
    : overall >= THRESHOLDS.TRUST.B ? 'B'
    : overall >= THRESHOLDS.TRUST.C ? 'C'
    : overall >= THRESHOLDS.TRUST.D ? 'D'
    : 'F';

  return {
    overall,
    grade,
    components,
    computedAt: new Date().toISOString(),
    basedOnSnapshot: snapshotId,
  };
}

function computeDataQuality(metrics: Map<string, NormalizedMetric>, issues: Issue[]): TrustComponent {
  const totalMetrics = metrics.size;
  if (totalMetrics === 0) {
    return { name: 'data_quality', label: 'Качество данных', score: 10, weight: 30, issues: 0, criticalIssues: 0, details: 'Нет метрик' };
  }

  let score = 100;

  // Вычитаем за пустые метрики
  const emptyCount = [...metrics.values()].filter(m => m.numericValue === null).length;
  // Reduced from 40: empty future quarters (Q3 empty in April) are expected
  const emptyPenalty = (emptyCount / totalMetrics) * 25;
  score -= emptyPenalty;

  // Вычитаем за низкую уверенность
  const lowConfCount = [...metrics.values()].filter(m => m.confidence < 0.7).length;
  const confPenalty = (lowConfCount / totalMetrics) * 20;
  score -= confPenalty;

  // Вычитаем за предупреждения
  const warningCount = [...metrics.values()].reduce((sum, m) => sum + m.warnings.length, 0);
  score -= Math.min(warningCount * 2, 20);

  const relevantIssues = issuesForComponent(issues, 'data_quality');
  const critical = relevantIssues.filter(i => i.severity === 'critical').length;

  return {
    name: 'data_quality',
    label: 'Качество данных',
    score: Math.max(10, Math.round(score)),
    weight: 30,
    issues: relevantIssues.length,
    criticalIssues: critical,
    details: `${emptyCount} пустых метрик, ${lowConfCount} с низкой уверенностью, ${warningCount} предупреждений`,
  };
}

function computeFormulaIntegrity(issues: Issue[]): TrustComponent {
  const formulaIssues = issuesForComponent(issues, 'formula_integrity');
  const config = TRUST_COMPONENT_CONFIG['formula_integrity'];

  let score = 100;
  // Per-severity penalty from config — linear, not logarithmic
  // This ensures 100 critical issues ARE worse than 10 critical issues
  for (const issue of formulaIssues) {
    const sev = issue.severity as keyof typeof config.penalties;
    const penalty = config.penalties[sev] ?? config.penalties['warning'] ?? 3;
    score -= penalty;
  }

  const critical = formulaIssues.filter(i => i.severity === 'critical').length;
  const significant = formulaIssues.filter(i => i.severity === 'significant').length;

  return {
    name: 'formula_integrity',
    label: 'Целостность формул',
    score: Math.max(10, Math.round(score)),
    weight: 25,
    issues: formulaIssues.length,
    criticalIssues: critical,
    details: `${formulaIssues.length} замечаний (${critical} критических, ${significant} значимых)`,
  };
}

function computeRuleCompliance(issues: Issue[]): TrustComponent {
  const ruleIssues = issuesForComponent(issues, 'rule_compliance');
  const config = TRUST_COMPONENT_CONFIG['rule_compliance'];

  let score = 100;

  // Per-severity weighting from config — each issue penalizes proportionally
  for (const issue of ruleIssues) {
    const sev = issue.severity as keyof typeof config.penalties;
    const penalty = config.penalties[sev] ?? config.penalties['warning'] ?? 3;
    score -= penalty;
  }

  // Group by rule ID for reporting
  const byRule = new Map<string, number>();
  for (const issue of ruleIssues) {
    const ruleId = issue.detectedBy ?? issue.category ?? 'unknown';
    byRule.set(ruleId, (byRule.get(ruleId) ?? 0) + 1);
  }

  const totalCritical = ruleIssues.filter(i => i.severity === 'critical').length;
  const criticalRules = new Set(ruleIssues.filter(i => i.severity === 'critical').map(i => i.detectedBy ?? i.category)).size;

  return {
    name: 'rule_compliance',
    label: 'Соответствие правилам',
    score: Math.max(10, Math.round(score)),
    weight: 20,
    issues: ruleIssues.length,
    criticalIssues: totalCritical,
    details: `${byRule.size} правил с нарушениями, ${ruleIssues.length} замечаний (${criticalRules} критических правил)`,
  };
}

function computeMappingConsistency(
  _metrics: Map<string, NormalizedMetric>,
  deltas: DeltaResult[],
): TrustComponent {
  // Only score deltas where BOTH official and calculated values exist
  // Missing calculated values are expected (not all metrics are row-recalculable)
  const comparable = deltas.filter(d => d.officialValue !== null && d.calculatedValue !== null);
  const totalComparable = comparable.length;

  if (totalComparable === 0) {
    return { name: 'mapping_consistency', label: 'Согласованность привязок', score: 100, weight: 15, issues: 0, criticalIssues: 0, details: 'Нет данных для сравнения' };
  }

  // Graduated scoring: full credit ≤1%, partial credit 1-5%, no credit >5%
  let totalCredit = 0;
  for (const d of comparable) {
    const absPct = d.deltaPercent !== null ? Math.abs(d.deltaPercent) : 0;
    if (d.withinTolerance || absPct <= 1) {
      totalCredit += 1.0;
    } else if (absPct <= 5) {
      totalCredit += 0.5;
    }
    // >5%: no credit
  }
  const score = Math.round((totalCredit / totalComparable) * 100);

  const outOfTolerance = comparable.filter(d => !d.withinTolerance).length;
  const missingCalc = deltas.filter(d => d.officialValue !== null && d.calculatedValue === null).length;
  const withinTolerance = totalComparable - outOfTolerance;

  return {
    name: 'mapping_consistency',
    label: 'Согласованность привязок',
    score: Math.max(10, score),
    weight: 15,
    issues: outOfTolerance,
    criticalIssues: comparable.filter(d => !d.withinTolerance && d.deltaPercent !== null && Math.abs(d.deltaPercent) > 10).length,
    details: `${withinTolerance} из ${totalComparable} совпадают${missingCalc > 0 ? `, ${missingCalc} без пересчёта` : ''}`,
  };
}

function computeOperationalRisk(issues: Issue[]): TrustComponent {
  const opIssues = issuesForComponent(issues, 'operational_risk');
  const config = TRUST_COMPONENT_CONFIG['operational_risk'];
  const critical = opIssues.filter(i => i.severity === 'critical').length;

  let score = 100;
  // Per-severity penalty from config — linear, proportional to actual issue count
  for (const issue of opIssues) {
    const sev = issue.severity as keyof typeof config.penalties;
    const penalty = config.penalties[sev] ?? config.penalties['warning'] ?? 2;
    score -= penalty;
  }

  return {
    name: 'operational_risk',
    label: 'Операционные риски',
    score: Math.max(10, Math.round(score)),
    weight: 10,
    issues: opIssues.length,
    criticalIssues: critical,
    details: `${opIssues.length} операционных замечаний`,
  };
}
