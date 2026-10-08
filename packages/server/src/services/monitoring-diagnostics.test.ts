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
  it('enforces blank J and assigns an exact address if a signal is written into the separator', () => {
    const master = source();
    const queue: unknown[][] = [[], [], ['', '', 'Подвести итоги', 'ЭА001-26']];
    const book: MonitoringBookSnapshot = {
      sheets: { 'Рабочий реестр процедур': master, 'Процедуры в работе': queue },
      readAt: '2026-10-08T12:00:00Z', failed: {}, version: 1, changed: [],
    };
    const parsed = parseMonitoringProcedures(book.sheets, '2026-10-09');
    const before = queueDriftSignals(book, parsed.procedures);
    expect(before.flatMap(s => s.addresses ?? []).some(a => a.address === 'Процедуры в работе!J3')).toBe(false);
    queue[2][9] = 'Ошибка: устаревший сигнал в J';
    const after = queueDriftSignals(book, parsed.procedures);
    expect(after.flatMap(s => s.addresses ?? [])).toContainEqual({
      address: 'Процедуры в работе!J3',
      note: 'Столбец J должен быть пустым разделителем. Сигналы активных процедур выводятся вместе с действием в C.',
    });
  });
  it('checks the closed procedure code in P, not the severity label in O', () => {
    const master = source();
    master[2][22] = 'Состоялась';
    master[2][23] = 'Проверить сведения';
    master[2][24] = 'Проверить: основание — S';
    const row = Array<unknown>(24).fill('');
    row[14] = 'Проверить'; row[15] = 'ЭА001-26';
    const book: MonitoringBookSnapshot = {
      sheets: { 'Рабочий реестр процедур': master, 'Процедуры в работе': [[], [], row] },
      readAt: '2026-10-08T12:00:00Z', failed: {}, version: 1, changed: [],
    };
    const parsed = parseMonitoringProcedures(book.sheets, '2026-10-09');
    expect(queueDriftSignals(book, parsed.procedures)).toEqual([]);
    row[15] = 'ЭА002-26';
    const changed = queueDriftSignals(book, parsed.procedures);
    expect(changed[0]?.addresses).toEqual([
      { address: 'Процедуры в работе!P3', note: 'Лишняя строка витрины: ЭА002-26' },
      { address: 'Рабочий реестр процедур!A3', note: 'В витрине P отсутствует ЭА001-26' },
    ]);
  });
  it('a plausible stage value does not count as an intact formula; empty source rows are ignored', () => {
    const master = [...source(), []];
    const formulas = structuredClone(master);
    for (const column of [16, 18, 21, 23, 24]) formulas[2][column] = '=IF(A3="";"";1)';
    expect(missingFormulaAddresses(master, formulas)).toEqual(['Рабочий реестр процедур!W3']);
  });
});
