import { describe, expect, it } from 'vitest';
import { MONITORING_MASTER_HEADERS, parseMonitoringProcedures } from '@aemr/core';
import { missingFormulaAddresses, queueDriftSignals } from './monitoring-diagnostics.js';
import type { MonitoringBookSnapshot } from './monitoring.js';

function source() {
  const r: unknown[] = Array(25).fill('');
  r[0] = 'ЭА001-26'; r[4] = 'УО'; r[5] = 'Учреждение'; r[6] = 'Поставка'; r[7] = 100;
  r[22] = 'Объявлена'; r[23] = 'Подвести итоги';
  return [[], [...MONITORING_MASTER_HEADERS], r];
}

describe('independent native monitoring diagnostics', () => {
  it('names both the missing master row and the extra native row without normalizing source codes', () => {
    const master = source();
    const queue: unknown[][] = [[], [], ['', '', '', 'ЭА002-26']];
    const book: MonitoringBookSnapshot = { sheets: { 'Рабочий реестр процедур': master, 'Процедуры в работе': queue }, readAt: '2026-10-08T12:00:00Z', failed: {}, version: 1, changed: [] };
    const registry = parseMonitoringProcedures(book.sheets, '2026-10-09');
    expect(queueDriftSignals(book, registry.procedures)[0].addresses).toEqual([
      { address: 'Процедуры в работе!D3', note: 'Лишняя строка витрины: ЭА002-26' },
      { address: 'Рабочий реестр процедур!A3', note: 'В витрине D отсутствует ЭА001-26' },
    ]);
  });
  it('a plausible stage value does not count as an intact formula; empty source rows are ignored', () => {
    const master = [...source(), []];
    const formulas = structuredClone(master);
    for (const column of [16, 18, 21, 23, 24]) formulas[2][column] = '=IF(A3="";"";1)';
    expect(missingFormulaAddresses(master, formulas)).toEqual(['Рабочий реестр процедур!W3']);
  });
});
