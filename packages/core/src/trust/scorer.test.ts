import { describe, it, expect } from 'vitest';
import { computeTrustScore } from './scorer';
import type { NormalizedMetric, Issue, DeltaResult } from '@aemr/shared';

function makeMetric(key: string, numericValue: number | null, confidence = 1.0): NormalizedMetric {
  return {
    metricKey: key,
    value: numericValue,
    numericValue,
    displayValue: String(numericValue ?? '—'),
    origin: 'official',
    period: 'annual',
    unit: 'count',
    sourceSheet: 'СВОД ТД-ПМ',
    sourceCell: 'D14',
    formula: null,
    confidence,
    readAt: new Date().toISOString(),
    warnings: [],
  };
}

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue-1',
    title: 'Test issue',
    description: 'Test',
    severity: 'warning',
    category: 'type_drift',
    status: 'open',
    origin: 'bi_heuristic',
    metricKey: 'test',
    detectedAt: new Date().toISOString(),
    detectedBy: 'test',
    ...overrides,
  };
}

describe('computeTrustScore', () => {
  it('does not assign an agreement score without comparable pairs', () => {
    const result = computeTrustScore(new Map([['m1', makeMetric('m1', 100)]]), [], [], 'snapshot');
    expect(result.components.find(c => c.name === 'mapping_consistency')?.score).toBeNull();
  });

  it('does not grade an empty evidence set', () => {
    const result = computeTrustScore(new Map(), [], [], 'snapshot');
    expect(result.overall).toBeNull();
    expect(result.grade).toBeNull();
    expect(result.components.every(c => c.score === null)).toBe(true);
  });

  it.each([null, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'does not grade a populated metric map containing only unusable values (%s)',
    value => {
      const result = computeTrustScore(new Map([['m1', makeMetric('m1', value)]]), [
        makeIssue({ category: 'formula_continuity', severity: 'critical' }),
      ], [], 'unusable');
      expect(result.overall).toBeNull();
      expect(result.grade).toBeNull();
      expect(result.components.every(c => c.score === null)).toBe(true);
      const formula = result.components.find(c => c.name === 'formula_integrity')!;
      expect(formula.criticalIssues).toBe(1);
      expect(formula.details).toContain('1 критических');
    },
  );

  it('keeps operational problems visible without lowering data quality', () => {
    const metrics = new Map([['m1', makeMetric('m1', 100)]]);
    const clean = computeTrustScore(metrics, [], [], 'snapshot');
    const delayed = computeTrustScore(metrics, [makeIssue({
      category: 'signal:overdue', severity: 'critical',
    })], [], 'snapshot');
    expect(delayed.overall).toBe(clean.overall);
    expect(delayed.components.find(c => c.name === 'operational_risk')?.issues).toBe(1);
    expect(delayed.components.find(c => c.name === 'operational_risk')?.weight).toBe(0);
  });
  it('does not infer full formula and rule coverage from clean metrics and matching values', () => {
    const metrics = new Map([
      ['m1', makeMetric('m1', 100)],
      ['m2', makeMetric('m2', 200)],
      ['m3', makeMetric('m3', 300)],
    ]);
    const deltas: DeltaResult[] = [
      { metricKey: 'm1', label: 'm1', officialValue: 100, calculatedValue: 100, delta: 0, deltaPercent: 0, withinTolerance: true, explanation: '' },
    ];
    const result = computeTrustScore(metrics, [], deltas, 'snap-1');
    expect(result.overall).toBeNull();
    expect(result.grade).toBeNull();
    expect(result.components.find(c => c.name === 'mapping_consistency')?.score).toBe(100);
    for (const name of ['formula_integrity', 'rule_compliance']) {
      expect(result.components.find(c => c.name === name)?.score).toBeNull();
    }
  });

  it.each([50, -50])('does not credit an official zero versus recalculated %s as agreement', calculatedValue => {
    const metrics = new Map([['zero', makeMetric('zero', 0)], ['equal', makeMetric('equal', 100)]]);
    const deltas: DeltaResult[] = [
      { metricKey: 'zero', label: 'zero', officialValue: 0, calculatedValue,
        delta: calculatedValue, deltaPercent: null, withinTolerance: false, explanation: '' },
      { metricKey: 'equal', label: 'equal', officialValue: 100, calculatedValue: 100,
        delta: 0, deltaPercent: 0, withinTolerance: true, explanation: '' },
    ];
    // One proven match out of two comparisons: no relative baseline does not
    // erase the known nonzero absolute discrepancy of the other comparison.
    const component = computeTrustScore(metrics, [], deltas, 'zero-reference').components
      .find(value => value.name === 'mapping_consistency')!;
    expect(component.score).toBe(50);
    expect(component.issues).toBe(1);
    expect(component.details).toBe('1 из 2 совпадают');
  });

  it('preserves absence of evidence instead of the legacy empty-set grade', () => {
    const metrics = new Map<string, NormalizedMetric>();
    const result = computeTrustScore(metrics, [], [], 'snap-1');
    expect(result.overall).toBeNull();
    expect(result.grade).toBeNull();
  });

  it('reports zero agreement when every comparable value contradicts the reference', () => {
    const deltas: DeltaResult[] = [
      { metricKey: 'm1', label: 'm1', officialValue: 100, calculatedValue: 200,
        delta: 100, deltaPercent: 100, withinTolerance: false, explanation: '' },
    ];
    const component = computeTrustScore(new Map([['m1', makeMetric('m1', 100)]]), [], deltas, 'mismatch')
      .components.find(value => value.name === 'mapping_consistency')!;
    expect(component.score).toBe(0);
    expect(component.details).toBe('0 из 1 совпадают');
  });

  it('retains data component weights while excluding operational risk', () => {
    const metrics = new Map([['m1', makeMetric('m1', 100)]]);
    const result = computeTrustScore(metrics, [], [], 'snap-1');
    const totalWeight = result.components.reduce((sum, c) => sum + c.weight, 0);
    expect(totalWeight).toBe(90);
  });

  it('keeps critical formula evidence even without a coverage score', () => {
    const metrics = new Map([['m1', makeMetric('m1', 100)]]);
    const issues = Array.from({ length: 10 }, (_, i) =>
      makeIssue({ id: `f${i}`, category: 'formula_continuity', severity: 'critical' })
    );
    const result = computeTrustScore(metrics, issues, [], 'snap-1');
    expect(result.overall).toBeNull();
    expect(result.components.find(c => c.name === 'formula_integrity')).toMatchObject({ score: null, issues: 10, criticalIssues: 10 });
  });

  it('preserves issue counts across components without fabricating an aggregate grade', () => {
    const metrics = new Map([['m1', makeMetric('m1', 100)]]);
    const issues = [
      ...Array.from({ length: 3 }, (_, i) =>
        makeIssue({ id: `dq${i}`, category: 'signal:dataQuality', severity: 'critical' })
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        makeIssue({ id: `fi${i}`, category: 'formula_continuity', severity: 'critical' })
      ),
      ...Array.from({ length: 2 }, (_, i) =>
        makeIssue({ id: `rc${i}`, origin: 'spreadsheet_rule', severity: 'critical' })
      ),
      ...Array.from({ length: 2 }, (_, i) =>
        makeIssue({ id: `or${i}`, category: 'signal:overdue', severity: 'critical' })
      ),
    ];
    const result = computeTrustScore(metrics, issues, [], 'snap-1');
    expect(result.overall).toBeNull();
    expect(result.components.reduce((sum, c) => sum + c.issues, 0)).toBe(10);
    // Every component has score >= 10
    for (const c of result.components) {
      if (c.score !== null) expect(c.score).toBeGreaterThanOrEqual(10);
    }
  });

  it('keeps provenance and component structure when the aggregate is unavailable', () => {
    const metrics = new Map([['m1', makeMetric('m1', 100)]]);
    const result = computeTrustScore(metrics, [], [], 'snap-1');

    // Just verify structure
    expect(result.grade).toBeNull();
    expect(result.computedAt).toBeTruthy();
    expect(result.basedOnSnapshot).toBe('snap-1');
    expect(result.components).toHaveLength(5);
  });
});

describe('saved control decisions', () => {
  it('does not charge a department for a saved numbering-header formula diagnostic', () => {
    const metrics = new Map([['m1', makeMetric('m1', 100)]]);
    const issue = makeIssue({ checkId: 'formula_overwritten', sheet: 'УЭР',
      cell: 'AA1', row: 1, rowSeq: '1', severity: 'critical', group: 'formula_consistency' });
    const original = JSON.parse(JSON.stringify(issue));
    const clean = computeTrustScore(metrics, [], [], 'snapshot');
    expect(computeTrustScore(metrics, [issue], [], 'snapshot').overall).toBe(clean.overall);
    expect(issue).toEqual(original);
    expect(computeTrustScore(metrics, [{ ...issue, cell: 'AA4', row: 4 }], [], 'snapshot').components.find(c => c.name === 'formula_integrity')?.criticalIssues)
      .toBe(1);
    expect(computeTrustScore(metrics, [{ ...issue, cell: 'AA4' }], [], 'snapshot').components.find(c => c.name === 'formula_integrity')?.criticalIssues)
      .toBe(1);
  });
  it('excludes confirmed false positives but keeps unresolved evidence and accepted risk', () => {
    const metrics = new Map([['m1', makeMetric('m1', 100)]]);
    const clean = computeTrustScore(metrics, [], [], 'snapshot');
    for (const status of ['open', 'acknowledged', 'in_progress', 'resolved', 'wont_fix'] as const) {
      expect(computeTrustScore(metrics, [makeIssue({ category: 'formula_continuity', severity: 'critical', status })], [], 'snapshot').components.find(c => c.name === 'formula_integrity')?.criticalIssues).toBe(1);
    }
    expect(computeTrustScore(metrics, [makeIssue({ category: 'formula_continuity', severity: 'critical', status: 'false_positive' })], [], 'snapshot').overall).toBe(clean.overall);
  });
});


describe('recorded execution coverage', () => {
  const metrics = new Map([['m1', makeMetric('m1', 100)]]);
  it('scores completed checks from their actual results, not issue absence', () => {
    const result = computeTrustScore(metrics, [], [], 's', [
      { sheet: 'УО', component: 'formula_integrity', expected: 10, checked: 10, failed: 2 },
      { sheet: 'УО', component: 'rule_compliance', expected: 4, checked: 4, failed: 1 },
    ]);
    expect(result.components.find(c => c.name === 'formula_integrity')?.score).toBe(80);
    expect(result.components.find(c => c.name === 'rule_compliance')?.score).toBe(75);
    expect(result.coverage).toHaveLength(2);
  });
  it('keeps partial and empty checks ungraded even without issues', () => {
    const result = computeTrustScore(metrics, [], [], 's', [
      { sheet: 'УО', component: 'formula_integrity', expected: 10, checked: 9, failed: 0 },
      { sheet: 'УО', component: 'rule_compliance', expected: 0, checked: 0, failed: 0 },
    ]);
    expect(result.components.find(c => c.name === 'formula_integrity')?.score).toBeNull();
    expect(result.components.find(c => c.name === 'rule_compliance')?.score).toBeNull();
  });
  it('rejects inconsistent or non-finite coverage instead of awarding credit', () => {
    for (const count of [-1, 1.5, Infinity, NaN]) {
      const result = computeTrustScore(metrics, [], [], 's', [
        { sheet: 'УО', component: 'formula_integrity', expected: 1, checked: count, failed: 0 },
      ]);
      expect(result.components.find(c => c.name === 'formula_integrity')?.score).toBeNull();
    }
  });
});
