import { describe, expect, it } from 'vitest';
import type { DepartmentSummary, TrustScore } from '@aemr/shared';
import { buildTrustViewModel } from './trust-metrics';

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
  it('returns global trust when no filtered departments are provided', () => {
    const result = buildTrustViewModel(baseTrust, []);

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
});
