import { describe, expect, it } from 'vitest';
import { MONITORING_MASTER_HEADERS, parseMonitoringProcedures } from '@aemr/core';
import { formulaTemplateDriftAddresses, missingFormulaAddresses, queueDriftSignals } from './monitoring-diagnostics.js';
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
  it('keeps the active signal in J and reports an accidental value in separator N', () => {
    const master = source();
    const row: unknown[] = Array(24).fill('');
    row[2] = 'Подвести итоги'; row[3] = 'ЭА001-26';
    row[9] = 'Проверить: уточнить документ'; // J is a legitimate signal, not a divider.
    const queue: unknown[][] = [[], [], row];
    const book: MonitoringBookSnapshot = {
      sheets: { 'Рабочий реестр процедур': master, 'Процедуры в работе': queue },
      readAt: '2026-10-08T12:00:00Z', failed: {}, version: 1, changed: [],
    };
    const parsed = parseMonitoringProcedures(book.sheets, '2026-10-09');
    expect(queueDriftSignals(book, parsed.procedures)).toEqual([]);
    row[13] = 'Неожиданные данные'; // N is reserved for the visible gap.
    expect(queueDriftSignals(book, parsed.procedures)[0]?.addresses).toContainEqual({
      address: 'Процедуры в работе!N3',
      note: 'Столбец N должен оставаться пустым визуальным разделителем. Сигналы активных процедур отображаются в J, действия — в C.',
    });
  });
  it('checks the closed procedure code in P, not the severity label in O', () => {
    const master = source();
    master[2][19] = 'Состоялась';
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
  it('uses the P code header beside the N separator instead of severity in O', () => {
    const master = source(); master[2][19] = 'Состоялась'; master[2][22] = 'Состоялась';
    const queue: unknown[][] = [[], Array(24).fill(''), Array(24).fill('')];
    queue[1][3] = 'Код'; queue[1][14] = 'Уровень'; queue[1][15] = 'Код';
    queue[2][14] = 'Проверить'; queue[2][15] = 'ЭА001-26';
    const book: MonitoringBookSnapshot = { sheets: { 'Рабочий реестр процедур': master, 'Процедуры в работе': queue }, readAt: '2026-10-08T12:00:00Z', failed: {}, version: 1, changed: [] };
    expect(queueDriftSignals(book, parseMonitoringProcedures(book.sheets, '2026-10-09').procedures)).toEqual([]);
    queue[2][15] = 'ЭА002-26';
    expect(queueDriftSignals(book, parseMonitoringProcedures(book.sheets, '2026-10-09').procedures)[0].addresses[0].address).toBe('Процедуры в работе!P3');
  });
  it('a plausible stage value does not count as an intact formula; empty source rows are ignored', () => {
    const master = [...source(), []];
    const formulas = structuredClone(master);
    for (const column of [0, 16, 18, 21, 23, 24]) formulas[2][column] = '=IF(A3="";"";1)';
    expect(missingFormulaAddresses(master, formulas)).toEqual(['Рабочий реестр процедур!W3']);
  });
  it('accepts valid human-entered INNs and flags a malformed nine-digit value', () => {
    const master = source();
    const formulas = structuredClone(master);
    for (const col of [0, 16, 21, 22, 23, 24]) formulas[2][col] = '=IF(G3="";"";1)';
    for (const inn of [4105041770, 410200615520]) {
      master[2][18] = inn;
      formulas[2][18] = inn;
      expect(missingFormulaAddresses(master, formulas)).toEqual([]);
    }
    master[2][18] = 300033529;
    formulas[2][18] = 300033529;
    expect(missingFormulaAddresses(master, formulas)).toEqual(['Рабочий реестр процедур!S3']);
  });

  it('flags formulas that reference the previous row even though a formula exists', () => {
    const master = source();
    const second = [...master[2]]; second[0] = 'ЭА002-26'; second[6] = 'ЭА002-26 Поставка';
    master.push(second);
    const grid = structuredClone(master);
    for (const col of [0, 16, 21, 22, 23, 24]) {
      grid[2][col] = '=IF(A3="";"";G3)';
      grid[3][col] = '=IF(A4="";"";G4)';
    }
    grid[2][18] = '4105041770'; grid[3][18] = '4105041770'; // user-entered INN must not masquerade as a template defect
    expect(formulaTemplateDriftAddresses(master, grid)).toEqual([]);
    grid[3][0] = '=IF(A3="";"";G3)';
    expect(formulaTemplateDriftAddresses(master, grid)).toEqual(['Рабочий реестр процедур!A4']);
    grid[3][0] = 'ЭА002-26';
    expect(formulaTemplateDriftAddresses(master, grid)).toEqual([]); // missing formula reported by the other detector
    expect(missingFormulaAddresses(master, grid)).toContain('Рабочий реестр процедур!A4');
  });

});
