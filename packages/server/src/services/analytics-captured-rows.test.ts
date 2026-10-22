import { describe, expect, it } from 'vitest';
import type { DataSnapshot } from '@aemr/shared';
import { capturedAnalyticsRows } from './analytics-captured-rows.js';

describe('C08.02 mixed analytics source boundary', () => {
  it('uses exact sealed procurement row arrays without copying or rereading mutable Google cache', () => {
    const row: unknown[] = Array.from({ length: 34 }, () => '');
    row[0] = '173/18'; row[6] = 'Frozen supplier need'; row[10] = 25;
    const rows = [row];
    const snapshot: Pick<DataSnapshot, 'rowsByDept'> = { rowsByDept: { УЭР: rows } };
    expect(capturedAnalyticsRows(snapshot, 'УЭР')).toBe(rows);
    expect(capturedAnalyticsRows(snapshot, 'УЭР')[0][0]).toBe('173/18');
    expect(capturedAnalyticsRows(snapshot, 'УЭР')[0][10]).toBe(25);
    expect(snapshot.rowsByDept?.УЭР).toBe(rows);
  });

  it('resolves approved historical department labels but refuses ambiguous duplicate captures', () => {
    const oldNameRows: unknown[][] = [['signed-row']];
    const snapshot: Pick<DataSnapshot, 'rowsByDept'> = { rowsByDept: { УФ: oldNameRows } };
    expect(capturedAnalyticsRows(snapshot, 'УФБП')).toBe(oldNameRows);
    expect(capturedAnalyticsRows(snapshot, 'УФ')).toBe(oldNameRows);
    expect(() => capturedAnalyticsRows({
      rowsByDept: { УФ: oldNameRows, УФБП: oldNameRows },
    }, 'УФБП')).toThrow('ANALYTICS_CAPTURE_AMBIGUOUS_DEPARTMENT');
    expect(() => capturedAnalyticsRows(snapshot, 'Неизвестное управление'))
      .toThrow('ANALYTICS_UNKNOWN_DEPARTMENT');
  });

  it('distinguishes a captured known-empty department from a missing or corrupt source', () => {
    const snapshot: Pick<DataSnapshot, 'rowsByDept'> = { rowsByDept: { УЭР: [] } };
    expect(capturedAnalyticsRows(snapshot, 'УЭР')).toEqual([]);
    expect(() => capturedAnalyticsRows(snapshot, 'УО')).toThrow('ANALYTICS_CAPTURE_NOT_AVAILABLE');
    expect(() => capturedAnalyticsRows({}, 'УЭР')).toThrow('ANALYTICS_CAPTURE_NOT_AVAILABLE');
    expect(() => capturedAnalyticsRows({ rowsByDept: { УЭР: null } } as unknown as DataSnapshot, 'УЭР'))
      .toThrow('ANALYTICS_CAPTURE_NOT_AVAILABLE');
  });
});
