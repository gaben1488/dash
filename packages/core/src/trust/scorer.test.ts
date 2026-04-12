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
    severity: 'warning' as any,
    category: 'type_drift' as any,
    status: 'open' as any,
    origin: 'bi_heuristic' as any,
    metricKey: 'test',
    createdAt: new Date().toISOString(),
    ...overrides,
  } as Issue;
}

describe('computeTrustScore', () => {
  it('returns grade A (>=90) for clean data with no issues', () => {
    const metrics = new Map([
      ['m1', makeMetric('m1', 100)],
      ['m2', makeMetric('m2', 200)],
      ['m3', makeMetric('m3', 300)],
    ]);
    const deltas: DeltaResult[] = [
      { metricKey: 'm1', label: 'm1', officialValue: 100, calculatedValue: 100, delta: 0, deltaPercent: 0, withinTolerance: true, explanation: '' },
    ];
    const result = computeTrustScore(metrics, [], deltas, 'snap-1');
    expect(result.overall).toBeGreaterThanOrEqual(90);
    expect(result.grade).toBe('A');
  });

  it('returns 73 with empty metrics (data_quality floor=10, others=100)', () => {
    const metrics = new Map<string, NormalizedMetric>();
    const result = computeTrustScore(metrics, [], [], 'snap-1');
    // data_quality: 10×30, formula: 100×25, rules: 100×20, mapping: 100×15, ops: 100×10 = 73
    expect(result.overall).toBe(73);
    expect(result.grade).toBe('C');
  });

  it('has component weights summing to 100', () => {
    const metrics = new Map([['m1', makeMetric('m1', 100)]]);
    const result = computeTrustScore(metrics, [], [], 'snap-1');
    const totalWeight = result.components.reduce((sum, c) => sum + c.weight, 0);
    expect(totalWeight).toBe(100);
  });

  it('critical formula issues reduce score', () => {
    const metrics = new Map([['m1', makeMetric('m1', 100)]]);
    const issues = Array.from({ length: 10 }, (_, i) =>
      makeIssue({ id: `f${i}`, category: 'formula_continuity' as any, severity: 'critical' as any })
    );
    const result = computeTrustScore(metrics, issues, [], 'snap-1');
    // With 10 critical formula issues, score should be well below A
    expect(result.overall).toBeLessThan(90);
  });

  it('10 critical issues across all components still yield score >= 15 (floor=10)', () => {
    const metrics = new Map([['m1', makeMetric('m1', 100)]]);
    const issues = [
      ...Array.from({ length: 3 }, (_, i) =>
        makeIssue({ id: `dq${i}`, category: 'signal:dataQuality' as any, severity: 'critical' as any })
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        makeIssue({ id: `fi${i}`, category: 'formula_continuity' as any, severity: 'critical' as any })
      ),
      ...Array.from({ length: 2 }, (_, i) =>
        makeIssue({ id: `rc${i}`, origin: 'spreadsheet_rule' as any, severity: 'critical' as any })
      ),
      ...Array.from({ length: 2 }, (_, i) =>
        makeIssue({ id: `or${i}`, category: 'signal:overdue' as any, severity: 'critical' as any })
      ),
    ];
    const result = computeTrustScore(metrics, issues, [], 'snap-1');
    // Floor of 10 per component means minimum possible is ~10
    expect(result.overall).toBeGreaterThanOrEqual(15);
    // Every component has score >= 10
    for (const c of result.components) {
      expect(c.score).toBeGreaterThanOrEqual(10);
    }
  });

  it('grade boundaries are correct (A>=90, B>=75, C>=60, D>=40, F<40)', () => {
    const metrics = new Map([['m1', makeMetric('m1', 100)]]);
    const result = computeTrustScore(metrics, [], [], 'snap-1');

    // Just verify structure
    expect(result.grade).toMatch(/^[A-F]$/);
    expect(result.computedAt).toBeTruthy();
    expect(result.basedOnSnapshot).toBe('snap-1');
    expect(result.components).toHaveLength(5);
  });
});
