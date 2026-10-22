import { describe, expect, it } from 'vitest';
import type { DatasetAnalysis } from '@aemr/core';
import { DEPT_COLUMNS, findDept, type DataSnapshot } from '@aemr/shared';
import { anomalyFactsOfCapturedRows } from './anomaly-snapshot-facts.js';
import { datasetFindingsOf } from '../routes/anomalies.js';

function sourceRow(id: string, subject: string): unknown[] {
  const row: unknown[] = Array(34).fill('');
  row[DEPT_COLUMNS.ID] = id;
  row[DEPT_COLUMNS.SUBJECT] = subject;
  return row;
}

describe('C08.02: recorded anomaly addresses are bound to recorded inputs', () => {
  it('maps header-stripped captured rows back to the original physical sheet coordinates', () => {
    const recorded = sourceRow('17/1', 'Сохранённый предмет');
    const snapshot: Pick<DataSnapshot, 'rowsByDept'> = { rowsByDept: { УО: [recorded] } };
    const byRow = anomalyFactsOfCapturedRows(snapshot, 'УО');
    expect([...byRow.keys()]).toEqual([4]);
    const dept = findDept('УО')!;
    const analysis = { anomalies: { dataAnomalies: [
      { type: 'EXACT_MATCH', severity: 'СРЕДНЯЯ', details: 'проверить факт', rowIndex: 3 },
    ] } } as unknown as Partial<DatasetAnalysis>;
    const found = datasetFindingsOf(analysis, dept, byRow).findings;
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ sheetRow: 4, rowSeq: '17/1', subject: 'Сохранённый предмет' });

    // The separate live cache changed number and subject at the same address.
    const independentLive = sourceRow('99', 'Чужая новая закупка');
    expect(independentLive[DEPT_COLUMNS.ID]).toBe('99');
    expect(datasetFindingsOf(analysis, dept, byRow).findings[0])
      .toMatchObject({ rowSeq: '17/1', subject: 'Сохранённый предмет' });
  });

  it('accepts the verified UF rename and declines two competing aliases for one captured book', () => {
    const historical: unknown[][] = [sourceRow('4', 'Проверенный архивный предмет')];
    expect(anomalyFactsOfCapturedRows({ rowsByDept: { УФ: historical } }, 'УФБП').get(4))
      .toBe(historical[0]);
    expect(anomalyFactsOfCapturedRows({
      rowsByDept: { УФ: historical, УФБП: historical },
    }, 'УФБП').size).toBe(0);
  });

  it('does not manufacture source facts when a legacy snapshot lacks captured rows', () => {
    expect(anomalyFactsOfCapturedRows({}, 'УО').size).toBe(0);
    const dept = findDept('УО')!;
    const analysis = { anomalies: { dataAnomalies: [
      { type: 'FACT_NO_PLAN', severity: 'ВЫСОКАЯ', details: 'check', rowIndex: 3 },
    ] } } as unknown as Partial<DatasetAnalysis>;
    const findings = datasetFindingsOf(analysis, dept, anomalyFactsOfCapturedRows({}, 'УО')).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ sheetRow: 4, rowSeq: '', subject: '' });
  });
});
