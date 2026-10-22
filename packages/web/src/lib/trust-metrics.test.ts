import { describe, expect, it } from 'vitest';
import type { DepartmentSummary, TrustScore } from '@aemr/shared';
import { buildTrustViewModel, withCurrentFormulaAssessment, currentFormulaScope, type LiveFormulaAssessment } from './trust-metrics';

const baseTrust: TrustScore = {
  overall: 70,
  grade: 'C',
  computedAt: '2026-06-04T00:00:00.000Z',
  basedOnSnapshot: 'snapshot-1',
  components: [
    { name: 'data_quality', label: 'Качество данных', score: 70, weight: 30, issues: 1, criticalIssues: 0, details: 'global' },
    { name: 'formula_integrity', label: 'Целостность формул', score: 70, weight: 25, issues: 2, criticalIssues: 1, details: 'global' },
  ],
};

function dept(name: string, trustScore: number, dataScore: number, formulaScore: number): DepartmentSummary {
  return {
    department: { id: name, name, nameShort: name, sheetName: name, svodRange: { startRow: 1, endRow: 1 }, controlCells: {} },
    planTotal: 0,
    factTotal: 0,
    executionPercent: 0,
    economyTotal: 0,
    issueCount: 0,
    criticalIssueCount: 0,
    trustScore,
    trustComponents: [
      { name: 'data_quality', label: 'Качество данных', score: dataScore, weight: 30, issues: 1, criticalIssues: 0, details: name },
      { name: 'formula_integrity', label: 'Целостность формул', score: formulaScore, weight: 25, issues: 2, criticalIssues: 1, details: name },
    ],
    status: 'normal',
  };
}

describe('buildTrustViewModel', () => {
  it('does not turn an unassessed formula component into a perfect filtered score', () => {
    const local = dept('d1', 100, 100, 100);
    local.trustComponents![1].score = null;
    const result = buildTrustViewModel({ ...baseTrust, overall: null }, [local]);
    expect(result.overallScore).toBeNull();
    expect(result.components[1].issues).toBe(2);
    expect(result.components[1].details).toContain('не подтверждена');
  });
  it('returns global trust when no filtered departments are provided', () => {
    const result = buildTrustViewModel(baseTrust);

    expect(result.overallScore).toBe(70);
    expect(result.components).toEqual(baseTrust.components);
  });

  it('uses component weights for filtered overall instead of averaging department trustScore', () => {
    const filtered = [
      dept('d1', 90, 100, 0),
      dept('d2', 10, 100, 0),
    ];

    const result = buildTrustViewModel(baseTrust, filtered);

    // A raw average of department trustScore would be 50. Backend scorer semantics are
    // component-weighted: ((100 * 30) + (0 * 25)) / 55 = 54.545 -> 55.
    expect(result.overallScore).toBe(55);
  });

  it('sums filtered component issue counts while averaging component scores', () => {
    const result = buildTrustViewModel(baseTrust, [
      dept('d1', 90, 80, 40),
      dept('d2', 70, 60, 20),
    ]);

    expect(result.components[0]).toMatchObject({ name: 'data_quality', score: 70, issues: 2, criticalIssues: 0 });
    expect(result.components[1]).toMatchObject({ name: 'formula_integrity', score: 30, issues: 4, criticalIssues: 2 });
  });
  it('does not substitute district trust for an empty local selection', () => {
    const result = buildTrustViewModel(baseTrust, []);
    expect(result.overallScore).toBeNull();
    expect(result.components).toEqual([]);
  });

  it('marks a missing local component unavailable rather than using district data', () => {
    const local = dept('d1', 90, 100, 90);
    local.trustComponents = local.trustComponents!.slice(0, 1);
    const result = buildTrustViewModel(baseTrust, [local]);
    expect(result.overallScore).toBeNull();
    expect(result.components.map(c => c.name)).toEqual(['data_quality']);
    expect(result.unavailableComponents).toEqual(['Целостность формул']);
  });

  it('does not average a component from only part of the selected departments', () => {
    const missing = dept('d2', 90, 100, 90);
    missing.trustComponents = [];
    const result = buildTrustViewModel(baseTrust, [dept('d1', 90, 100, 90), missing]);
    expect(result.overallScore).toBeNull();
    expect(result.components).toEqual([]);
  });

});


it('uses actual check denominators across differently sized departments', () => {
  const small = dept('small', 0, 100, 0);
  const large = dept('large', 100, 100, 100);
  small.trustComponents![1].checks = { expected: 1, checked: 1, failed: 1 };
  large.trustComponents![1].checks = { expected: 9, checked: 9, failed: 0 };
  const result = buildTrustViewModel(baseTrust, [small, large]);
  expect(result.components[1].score).toBe(90);
  expect(result.components[1].checks).toEqual({ expected: 10, checked: 10, failed: 1 });
});

describe('latest formula assessment in visible trust', () => {
  const evidence: LiveFormulaAssessment = {
    expectedBooks: 2, checkedBooks: 2, checkedAt: '2026-10-23T02:00:00.000Z',
    score: 90, checks: { expected: 10, checked: 10, failed: 1 },
    books: [
      { book: 'd1', checkedAt: '2026-10-23T01:00:00.000Z', score: 100,
        checks: { expected: 1, checked: 1, failed: 0 }, defects: 0 },
      { book: 'd2', checkedAt: '2026-10-23T02:00:00.000Z', score: 89,
        checks: { expected: 9, checked: 9, failed: 1 }, defects: 1 },
    ],
  };
  it('recalculates the overall from the live formula verdict without mutating snapshot components', () => {
    const before = buildTrustViewModel(baseTrust);
    const after = withCurrentFormulaAssessment(before, evidence);
    expect(after.components[1].score).toBe(90);
    expect(after.components[1].checks).toMatchObject({ expected: 10, checked: 10, failed: 1 });
    expect(after.overallScore).toBe(79); // (70*30 + 90*25) / 55
    expect(baseTrust.components[1].score).toBe(70);
  });

  it('uses only selected books, weighted by actual checked cells rather than average department grade', () => {
    expect(currentFormulaScope(evidence, ['d1'])).toMatchObject({
      score: 100, expectedBooks: 1, checkedBooks: 1,
    });
    expect(currentFormulaScope(evidence, ['d1', 'd2'])).toMatchObject({
      score: 90, expectedBooks: 2, checkedBooks: 2,
    });
    const local = buildTrustViewModel(baseTrust, [dept('d1', 80, 70, 100)]);
    expect(withCurrentFormulaAssessment(local, evidence, ['d1']).components[1].score).toBe(100);
  });

  it('does not present an unconfirmed book as a perfect grade', () => {
    const latest = { ...evidence, checkedBooks: 1, score: null, books: [
      evidence.books[0], { ...evidence.books[1], score: null, checks: null, defects: null },
    ] };
    const after = withCurrentFormulaAssessment(buildTrustViewModel(baseTrust), latest);
    expect(after.overallScore).toBeNull();
    expect(after.components[1].score).toBeNull();
    expect(after.components[1].details).toContain('1 из 2');
  });

  it('does not invent missing local components even with complete formula evidence', () => {
    const only = dept('d1', 90, 100, 90);
    only.trustComponents = only.trustComponents!.slice(0, 1);
    const view = withCurrentFormulaAssessment(buildTrustViewModel(baseTrust, [only]), evidence, ['d1']);
    expect(view.overallScore).toBeNull();
    expect(view.unavailableComponents).toEqual(['Целостность формул']);
  });
});
