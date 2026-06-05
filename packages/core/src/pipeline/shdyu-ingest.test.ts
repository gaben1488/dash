import { describe, expect, it } from 'vitest';
import { parseSHDYUSheet } from './shdyu-ingest';

function rowsWithLength(length: number): unknown[][] {
  return Array.from({ length }, () => []);
}

describe('parseSHDYUSheet', () => {
  it('returns 9 blocks (all + 8 ГРБС) even for an empty sheet', () => {
    // Инвариант, на котором держится роут /api/reconciliation/monthly:
    // распарсенный shdyuData ВСЕГДА имеет 9 ключей, поэтому guard «нет данных»
    // (Object.keys === 0) срабатывает ТОЛЬКО когда загрузка не удалась (shdyuData=undefined),
    // а не когда лист просто пуст. Это разделяет «пусто» и «ошибка чтения» в отчёте о причине.
    const result = parseSHDYUSheet([]);
    expect(Object.keys(result)).toHaveLength(9);
    expect(result.all).toBeDefined();
  });

  it('parses the legacy production SHDYU tab with an explicit year column', () => {
    const rows = rowsWithLength(70);

    // Old production tab shape: A=ГРБС, B=month number, C=year, D=plan count.
    rows[3] = ['ВСЕ', 1, 2026, 29, 28, -1, 0.96, 1, 2, 3, 6, 4, 5, 6, 15, 9, 2.5, 7, 8, 9, 24];
    rows[19] = ['ВСЕ', 1, 2026, 782, 750, -32, 0.95, 10, 20, 30, 60, 11, 21, 31, 63, 3, 1.05, 1, 2, 3, 6];
    rows[36] = ['УЭР', 1, 2026, 2, 2, 0, 1, 100, 0, 0, 100, 90, 0, 0, 90, -10, 0.9, 10, 0, 0, 10];
    rows[52] = ['УЭР', 1, 2026, 3, 1, -2, 0.333, 50, 0, 0, 50, 25, 0, 0, 25, -25, 0.5, 5, 0, 0, 5];

    const result = parseSHDYUSheet(rows);

    expect(result.all.months[1].comp.planCount).toBe(29);
    expect(result.all.months[1].comp.planTotal).toBe(6);
    expect(result.all.months[1].comp.economyTotal).toBe(24);
    expect(result.all.months[1].ep.planCount).toBe(782);
    expect(result.uer.months[1].comp.planCount).toBe(2);
    expect(result.uer.months[1].ep.planCount).toBe(3);
  });

  it('preserves legacy formula evidence when a department block references another source sheet', () => {
    const rows = rowsWithLength(140);
    const formulas = rowsWithLength(140);

    rows[3] = ['ВСЕ', 1, 2026, 0];
    rows[102] = ['УАГЗО', 1, 2026, 0];
    rows[112] = ['УАГЗО', 11, 2026, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    rows[128] = ['УАГЗО', 11, 2026, 2, 0, -2, 0, 100, 0, 0, 175.78801, 0, 0, 0, 0, -175.78801, 0];
    formulas[128] = [
      '', '', '',
      '=IFNA(ROWS(FILTER(\'УФБП\'!L$4:L;\'УФБП\'!L$4:L<>"ЕП";MONTH(\'УФБП\'!N$4:N)=$B129;\'УФБП\'!P$4:P=$C129)))',
      '',
      '',
      '',
      '=IFNA(SUM(FILTER(\'УФБП\'!Q$4:Q;\'УФБП\'!L$4:L<>"ЕП";MONTH(\'УФБП\'!N$4:N)=$B129;\'УФБП\'!P$4:P=$C129)))',
    ];

    const parse = parseSHDYUSheet as (
      sheetData: unknown[][],
      formulaData?: unknown[][],
    ) => ReturnType<typeof parseSHDYUSheet>;

    const result = parse(rows, formulas);

    expect(result.uagzo.months[11]).toMatchObject({
      formulaIssues: [
        expect.objectContaining({
          type: 'sheet_reference_mismatch',
          expectedSheet: 'УАГЗО',
          actualSheets: ['УФБП'],
          row: 129,
          month: 11,
          block: 'ep',
        }),
        expect.objectContaining({
          type: 'method_filter_inverted',
          expectedFilter: '="ЕП"',
          detectedFilter: '<>"ЕП"',
          row: 129,
          month: 11,
          block: 'ep',
        }),
      ],
    });
  });

  it('flags an inverted method filter when a КП cell filters L="ЕП" (УО R279 case)', () => {
    const rows = rowsWithLength(300);
    const formulas = rowsWithLength(300);

    rows[3] = ['ВСЕ', 1, 2026, 0]; // triggers legacy-format detection (year in col C)
    // УО legacy compStartRow=268 → month 12 = row 279 (rowIdx 278), КП-блок.
    rows[278] = ['УО', 12, 2026, 1, 0, -1, 0, 0, 0, 997.5, 997.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    formulas[278] = [
      '', '', '',
      '=SUM(FILTER(\'УО\'!H$4:H;\'УО\'!L$4:L="ЕП";MONTH(\'УО\'!N$4:N)=12;\'УО\'!P$4:P=2026))',
    ];

    const parse = parseSHDYUSheet as (
      sheetData: unknown[][],
      formulaData?: unknown[][],
    ) => ReturnType<typeof parseSHDYUSheet>;

    const result = parse(rows, formulas);

    // Своя ссылка ('УО') → нет sheet_reference_mismatch; только инвертированный фильтр.
    expect(result.uo.months[12].formulaIssues).toEqual([
      expect.objectContaining({
        type: 'method_filter_inverted',
        block: 'comp',
        detectedFilter: '="ЕП"',
        expectedFilter: '<>"ЕП"',
        row: 279,
        month: 12,
      }),
    ]);
  });
});
