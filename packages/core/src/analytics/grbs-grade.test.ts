import { describe, it, expect } from 'vitest';
import { gradeGRBS, phaseAdjustedTarget, type GrbsGradeInput } from './grbs-grade.js';

const base: GrbsGradeInput = {
  execPct: 0.7,
  expectedExecPct: 0.7,
  anomalyCount: 0,
  epShare: 0.4,
  epShareLimit: 0.5,
  complianceViolations: 0,
};

describe('grbs-grade (Layer A)', () => {
  it('идеальный ГРБС → A (score 100)', () => {
    const r = gradeGRBS(base);
    expect(r.grade).toBe('A');
    expect(r.score).toBe(100);
    expect(r.reasons).toHaveLength(0);
  });
  it('исполнение выше ожидаемого → без штрафа за лаг, A', () => {
    expect(gradeGRBS({ ...base, execPct: 0.9, expectedExecPct: 0.7 }).grade).toBe('A');
  });
  it('сильное отставание >25% + нарушения → D (score <50)', () => {
    const r = gradeGRBS({ ...base, execPct: 0.3, expectedExecPct: 0.7, complianceViolations: 3 });
    expect(r.grade).toBe('D');
    expect(r.score).toBeLessThan(50);
    expect(r.reasons.length).toBeGreaterThan(0);
  });
  it('аномалии + превышение доли ЕП → снижение до C, с причинами', () => {
    const r = gradeGRBS({ ...base, anomalyCount: 3, epShare: 0.7, epShareLimit: 0.5 });
    expect(['B', 'C']).toContain(r.grade);
    expect(r.reasons.some(x => x.includes('аномал'))).toBe(true);
    expect(r.reasons.some(x => x.includes('ЕП'))).toBe(true);
  });
  it('лёгкое отставание <10% → остаётся A (штраф мал)', () => {
    const r = gradeGRBS({ ...base, execPct: 0.65, expectedExecPct: 0.7 });
    expect(r.grade).toBe('A');
  });
  it('phaseAdjustedTarget масштабирует ожидание по фазе квартала', () => {
    expect(phaseAdjustedTarget(0.7, 1)).toBeCloseTo(0.105, 3);
    expect(phaseAdjustedTarget(0.7, 2)).toBeCloseTo(0.385, 3);
    expect(phaseAdjustedTarget(0.7, 3)).toBeCloseTo(0.63, 3);
  });
});
