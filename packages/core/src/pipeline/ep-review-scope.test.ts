import { describe, expect, it } from 'vitest';
import { DEPT_COLUMNS } from '@aemr/shared';
import { runPipeline } from './orchestrator';

function snapshot(subject: string, reason: string, factDate = 'Х', fact: unknown = 800, plan: unknown = 1200) {
  const row: unknown[] = Array(34).fill('');
  row[DEPT_COLUMNS.ID] = '3'; row[DEPT_COLUMNS.SUBJECT] = subject;
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
    expect(issue?.recommendation).toContain('не подтверждённое нарушение');
  });
  it('keeps the same annual scope for historical comma and thousands-separated amounts', () => {
    const result = snapshot('Окорока (куриные)', '', 'Х', '800,00', '1 200,00');
    expect(result.issues.find(i => i.signal === 'epRisk')).toMatchObject({ severity: 'info' });
  });
  it('uses curated series evidence but refuses to transfer it to a reused number', () => {
    const series = snapshot('Окорока (куриные)', '');
    const reused = snapshot('Другая закупка', '');
    expect(series.issues.find(i => i.signal === 'epRisk')).toMatchObject({ severity: 'info', status: 'open' });
    expect(reused.issues.find(i => i.signal === 'epRisk')).toMatchObject({ severity: 'critical', status: 'open' });
  });
});
