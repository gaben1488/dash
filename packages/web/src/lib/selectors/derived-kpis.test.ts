import { describe, expect, it } from 'vitest';
import { buildCompetitiveRatioKpiCard, buildEconomyKpiCard, buildExecCountKpiCard } from './derived-kpis';

describe('buildExecCountKpiCard (извлечено из useFilteredData §11c\')', () => {
  const depts = [{ quarters: { q1: { planCount: 4, factCount: 2 } } }];

  it('строит главный KPI с квартальным спарком из счётчиков дептов', () => {
    const card = buildExecCountKpiCard(85, 'q1', depts);
    expect(card).toMatchObject({
      metricKey: '_derived.exec_count_pct',
      value: '85%',
      numericValue: 85,
      period: 'q1',
      status: 'normal',
      origin: 'calculated',
    });
    expect(card.sparkData).toEqual([50, 0, 0, 0]);
  });

  it('пороги статуса: ≥80 normal, ≥50 warning, ниже — critical; год → annual', () => {
    expect(buildExecCountKpiCard(60, 'year', []).status).toBe('warning');
    expect(buildExecCountKpiCard(60, 'year', []).period).toBe('annual');
    expect(buildExecCountKpiCard(10, 'q2', []).status).toBe('critical');
  });
});

describe('buildEconomyKpiCard (извлечено из useFilteredData §11d)', () => {
  it('savings rate = экономия / план; ≥5% normal', () => {
    const card = buildEconomyKpiCard({ totalPlan: 100, economyTotal: 7, periodKey: 'q1' });
    expect(card).toMatchObject({ metricKey: '_derived.savings_rate', value: '7.0%', status: 'normal', period: 'q1' });
  });

  it('0..5% warning, отрицательная — critical', () => {
    expect(buildEconomyKpiCard({ totalPlan: 100, economyTotal: 2, periodKey: 'year' }).status).toBe('warning');
    expect(buildEconomyKpiCard({ totalPlan: 100, economyTotal: -1, periodKey: 'year' }).status).toBe('critical');
  });
});

describe('buildCompetitiveRatioKpiCard (извлечено из useFilteredData §11d)', () => {
  it('доля КП от (КП+ЕП); ≥50% normal', () => {
    const card = buildCompetitiveRatioKpiCard({ totalKP: 3, totalEP: 1, periodKey: 'q1' });
    expect(card).toMatchObject({ metricKey: '_derived.competitive_ratio', value: '75.0%', status: 'normal' });
  });

  it('<50% warning', () => {
    expect(buildCompetitiveRatioKpiCard({ totalKP: 1, totalEP: 3, periodKey: 'q1' }).status).toBe('warning');
  });
});
