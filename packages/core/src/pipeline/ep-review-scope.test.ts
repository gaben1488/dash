import { describe, expect, it } from 'vitest';
import { DEPT_COLUMNS, type NormalizedMetric } from '@aemr/shared';
import { runPipeline } from './orchestrator';
import { computeTrustScore } from '../trust/scorer';

function snapshot(subject: string, reason: string, factDate = 'Х', fact: unknown = 800, plan: unknown = 1200) {
  const row: unknown[] = Array(34).fill('');
  row[DEPT_COLUMNS.PLAN_YEAR] = 2026; row[DEPT_COLUMNS.ID] = '3'; row[DEPT_COLUMNS.SUBJECT] = subject;
  row[DEPT_COLUMNS.METHOD] = 'ЕП'; row[DEPT_COLUMNS.EP_REASON] = reason;
  row[DEPT_COLUMNS.TOTAL_PLAN] = plan; row[DEPT_COLUMNS.TOTAL_FACT] = fact;
  row[DEPT_COLUMNS.FACT_DATE] = factDate;
  return runPipeline({ spreadsheetId: 'test', batchGetData: [],
    sheetRows: { 'УКСиМП': [[], [], [], row] }, reportMap: [], rules: [], targetYear: 2026 });
}

describe('EP case scope and explanation through the pipeline', () => {
  it('keeps a recognized reason actionable without asserting a critical violation', () => {
    const result = snapshot('Разовая закупка', 'Проведение аукциона нецелесообразно', '10.10.2026');
    const issue = result.issues.find(i => i.signal === 'epRisk');
    expect(issue).toMatchObject({ severity: 'warning', status: 'open' });
    expect(issue?.recommendation).toContain('не подтверждают');
  });
  it('keeps the same annual scope for historical comma and thousands-separated amounts', () => {
    const result = snapshot('Окорока (куриные)', '', 'Х', '800,00', '1 200,00');
    expect(result.issues.find(i => i.signal === 'epRisk')).toMatchObject({ severity: 'info' });
  });
  it('dictionary uncertainty is not an employee operational penalty, while real risks remain', () => {
    const metrics = new Map<string, NormalizedMetric>([['test', { metricKey: 'test', value: 100, numericValue: 100, displayValue: '100',
      origin: 'official', period: 'annual', unit: 'count', sourceSheet: 'СВОД', sourceCell: 'A1', formula: null,
      confidence: 1, readAt: '2026-10-12T00:00:00Z', warnings: [] }]]);
    const baseline = computeTrustScore(metrics, [], [], 'test');
    const component = (reason: string) => {
      const ep = snapshot('Разовая закупка', reason, '10.10.2026').issues.find(i => i.signal === 'epRisk')!;
      const trust = computeTrustScore(metrics, [ep], [], 'test');
      return { ep, trust, score: trust.components.find(c => c.name === 'operational_risk')!.score };
    };
    const unknown = component('Особое основание для проверки');
    expect(unknown.ep).toMatchObject({ origin: 'mapping_error', status: 'open' });
    expect(unknown.score).toBe(100);
    expect(unknown.trust.overall).toBe(baseline.overall);
    expect(unknown.trust.components.map(c => [c.name, c.score])).toEqual(baseline.components.map(c => [c.name, c.score]));
    expect(unknown.trust.components.reduce((n, c) => n + c.issues, 0)).toBeGreaterThan(0);
    // A position total alone cannot penalize the employee as a single-contract breach.
    for (const reason of ['', 'Проведение аукциона нецелесообразно']) {
      expect(component(reason).trust.overall).toBe(baseline.overall);
      expect(component(reason).trust.components.map(c => [c.name, c.score]))
        .toEqual(baseline.components.map(c => [c.name, c.score]));
    }
    expect(component('не является монополистом').score).toBe(100);
  });
  it('uses curated series evidence but refuses to transfer it to a reused number', () => {
    const series = snapshot('Окорока (куриные)', '');
    const reused = snapshot('Другая закупка', '');
    expect(series.issues.find(i => i.signal === 'epRisk')).toMatchObject({ severity: 'info', status: 'open' });
    expect(reused.issues.find(i => i.signal === 'epRisk')).toMatchObject({ severity: 'warning', status: 'open' });
  });
});
