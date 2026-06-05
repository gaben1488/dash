import { describe, it, expect } from 'vitest';
import { disciplineIndex, DISCIPLINE_WEIGHTS, type DisciplineInput } from './discipline-index.js';

const good: DisciplineInput = {
  execScore: 1, dynamicsScore: 1, epScore: 1, dataScore: 1, anomalyScore: 1, complianceScore: 1,
};

describe('discipline-index (Layer B)', () => {
  it('веса в сумме = 1.0', () => {
    const sum = Object.values(DISCIPLINE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 9);
  });
  it('всё хорошо → 100, ПОХВАЛА', () => {
    const r = disciplineIndex(good);
    expect(r.index).toBe(100);
    expect(r.mode).toBe('ПОХВАЛА');
  });
  it('всё плохо → 0, ТРЕВОГА', () => {
    const r = disciplineIndex({ execScore: 0, dynamicsScore: 0, epScore: 0, dataScore: 0, anomalyScore: 0, complianceScore: 0 });
    expect(r.index).toBe(0);
    expect(r.mode).toBe('ТРЕВОГА');
  });
  it('антикор-штраф снижает индекс (100 −40 = 60)', () => {
    expect(disciplineIndex({ ...good, anticorruptionPenalty: -40 }).index).toBe(60);
  });
  it('доминирующий фактор = худший компонент', () => {
    expect(disciplineIndex({ ...good, execScore: 0.2 }).dominantFactor).toBe('ИСПОЛНЕНИЕ');
  });
  it('контекст смягчает: низкий индекс + hasContext → КОНТЕКСТНЫЙ + dominant КОНТЕКСТ', () => {
    const r = disciplineIndex({
      execScore: 0.3, dynamicsScore: 0.3, epScore: 0.3, dataScore: 0.3, anomalyScore: 0.3, complianceScore: 0.3, hasContext: true,
    });
    expect(r.mode).toBe('КОНТЕКСТНЫЙ');
    expect(r.dominantFactor).toBe('КОНТЕКСТ');
  });
});
