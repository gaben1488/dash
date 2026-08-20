/**
 * Характеризационные тесты живого пути ingest (зона В, 20.08.2026).
 *
 * Заведены при удалении мёртвого grid-пути (ingestWorkbook и утилиты
 * getCell*): у оставшихся двух функций — единственных дверей конвейера в
 * сырые ответы Google Sheets — покрытия не было вовсе, хотя на разборе
 * диапазона держится вся адресация ячеек (провенанс «лист!ячейка»).
 * Поведение фиксируется КАК ЕСТЬ.
 */
import { describe, expect, it } from 'vitest';
import type { ReportMapEntry } from '@aemr/shared';
import { ingestBatchGetResponse, ingestSheetRows } from './ingest.js';

/** Минимальная запись карты метрик — для lookup ingest её содержимое не важно. */
const entry = (sheet: string, cell: string): ReportMapEntry =>
  ({ sourceSheet: sheet, sourceCell: cell } as unknown as ReportMapEntry);

describe('ingestBatchGetResponse — адресация ячеек из values.batchGet', () => {
  it('раскладывает значения по адресам с учётом старта диапазона (кавычки в имени листа)', () => {
    const res = ingestBatchGetResponse(
      [{ range: "'СВОД ТД-ПМ'!B14:C15", values: [[1, 'x'], [2, null]] }],
      [entry('СВОД ТД-ПМ', 'B14')],
    );
    expect(res.sheets).toEqual(['СВОД ТД-ПМ']);
    expect(res.cells.get('СВОД ТД-ПМ!B14')?.rawValue).toBe(1);
    expect(res.cells.get('СВОД ТД-ПМ!C14')?.rawValue).toBe('x');
    expect(res.cells.get('СВОД ТД-ПМ!B15')?.rawValue).toBe(2);
    // null-ячейка тоже адресуется — с valueType 'null' (честная пустота)
    expect(res.cells.get('СВОД ТД-ПМ!C15')?.valueType).toBe('null');
    expect(res.errors).toEqual([]);
  });

  it('колонки за Z получают двухбуквенный адрес (Y, Z, AA, AB)', () => {
    // Диапазон с колонки Y (25-я, 0-based 24): четыре значения → Y, Z, AA, AB
    const res = ingestBatchGetResponse(
      [{ range: 'УО!Y3:AB3', values: [['y', 'z', 'aa', 'ab']] }],
      [],
    );
    expect(res.cells.get('УО!Y3')?.rawValue).toBe('y');
    expect(res.cells.get('УО!Z3')?.rawValue).toBe('z');
    expect(res.cells.get('УО!AA3')?.rawValue).toBe('aa');
    expect(res.cells.get('УО!AB3')?.rawValue).toBe('ab');
  });

  it('формулы подхватываются из параллельного FORMULA-чтения только со знаком «=»', () => {
    const res = ingestBatchGetResponse(
      [{
        range: 'УК!D2:E2',
        values: [[10, 20]],
        formulas: [['=SUM(A1:A9)', 'не формула']],
      }],
      [],
    );
    expect(res.cells.get('УК!D2')?.formula).toBe('=SUM(A1:A9)');
    expect(res.cells.get('УК!E2')?.formula).toBeNull();
  });

  it('нечитаемый range пропускается молча, не ломая соседей', () => {
    const res = ingestBatchGetResponse(
      [
        { range: 'мусор без восклицательного', values: [[1]] },
        { range: 'УФ!A1:A1', values: [[7]] },
      ],
      [],
    );
    expect(res.sheets).toEqual(['УФ']);
    expect(res.cells.get('УФ!A1')?.rawValue).toBe(7);
  });
});

describe('ingestSheetRows — строки листа для классификатора', () => {
  it('раскладывает значения по буквам колонок, rowIndex 1-based', () => {
    const rows = ingestSheetRows([
      ['a0', 'b0'],
      ['a1', 'b1', 'c1'],
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ rowIndex: 1, cells: { A: 'a0', B: 'b0' } });
    expect(rows[1].rowIndex).toBe(2);
    expect(rows[1].cells['C']).toBe('c1');
  });

  it('27-я колонка и дальше — двухбуквенные ключи (AA…)', () => {
    const wide = Array.from({ length: 28 }, (_, i) => i);
    const [row] = ingestSheetRows([wide]);
    expect(row.cells['Z']).toBe(25);
    expect(row.cells['AA']).toBe(26);
    expect(row.cells['AB']).toBe(27);
  });
});
