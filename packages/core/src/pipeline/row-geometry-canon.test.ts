/**
 * Стражи двух правок реестра багов 09.07.2026:
 *
 *  - пп.12–13 «несогласованные ограничения длины строки» и «расчёт сводной
 *    сетки без проверки длины строки». Google Sheets обрезает хвостовые
 *    пустые ячейки, поэтому ещё не заключённая закупка приходит строкой
 *    длиной 16–17, а не 34. Требование «не короче 25 ячеек» выбрасывало
 *    такие строки из поиска дроблений, из проверки Бенфорда и из аномалий —
 *    то есть ровно те закупки, ради которых эти проверки и написаны.
 *
 *  - п.11 «позиционное чтение колонок без проверки геометрии»: сдвиг
 *    столбца обязан подавать голос, а не подменять данные молча.
 */
import { describe, it, expect } from 'vitest';
import { DEPT_COLUMNS, DEPT_HEADER_LABELS, checkDeptHeaderGeometry, isReadableDeptRow, unifiedKey } from '@aemr/shared';
import { detectSuspiciousSplitting } from './splitting.js';
import { detectDataAnomalies } from './anomalies.js';
import { computeUnifiedGrid } from './unified-svod.js';
import { runPipeline } from './orchestrator.js';

const COL = DEPT_COLUMNS;

/**
 * Строка «план есть, факта ещё нет» ровно в том виде, в каком её отдаёт
 * Google Sheets: массив обрывается на последней заполненной ячейке (год
 * плана, индекс 15), длина 16.
 */
function planOnlyRow(id: string, subject: string, planTotal: number, method = 'ЕП'): unknown[] {
  const row: unknown[] = new Array(COL.PLAN_YEAR + 1).fill('');
  row[COL.ID] = id;
  row[COL.SUBORDINATE] = 'МКУ «ЕДДС»';
  row[COL.TYPE] = 'Текущая деятельность';
  row[COL.SUBJECT] = subject;
  row[COL.MB_PLAN] = planTotal;
  row[COL.TOTAL_PLAN] = planTotal;
  row[COL.METHOD] = method;
  row[COL.PLAN_DATE] = '15.01.2025';
  row[COL.PLAN_QUARTER] = 1;
  row[COL.PLAN_YEAR] = 2025;
  return row;
}

describe('длина строки листа — одна дверь на весь продукт (реестр 09.07.2026, пп.12-13)', () => {
  it('строка с планом без факта считается читаемой: обрыв массива — не признак мусора', () => {
    const row = planOnlyRow('1', 'Поставка бумаги', 120);
    expect(row.length).toBeLessThan(25);
    expect(isReadableDeptRow(row)).toBe(true);
  });

  it('обрубок короче столбца «ИТОГО 1» читаемым не считается', () => {
    expect(isReadableDeptRow(new Array(5).fill('x'))).toBe(false);
    expect(isReadableDeptRow(undefined)).toBe(false);
  });

  it('дробление среди незаключённых закупок находится (прежний порог 25 его прятал)', () => {
    const rows = [
      planOnlyRow('1', 'Поставка канцелярских товаров для нужд учреждения', 500),
      planOnlyRow('2', 'Поставка канцелярских товаров для нужд учреждения', 480),
      planOnlyRow('3', 'Поставка канцелярских товаров для нужд учреждения', 460),
    ];
    expect(rows.every(r => r.length < 25)).toBe(true);

    const groups = detectSuspiciousSplitting(rows);
    expect(groups.length).toBeGreaterThan(0);
    expect(groups[0].rowIndices.length).toBe(3);
  });

  it('аномалия «факт без плана» видна и на короткой строке', () => {
    const row = planOnlyRow('1', 'Ремонт кровли', 0, 'ЭА');
    row[COL.TOTAL_FACT] = 900; // массив дорастает до индекса 24 — фактическая длина 25
    const short = planOnlyRow('2', 'Ремонт фасада', 0, 'ЭА');
    short[COL.MB_PLAN] = '';

    const found = detectDataAnomalies([row]);
    expect(found.get(0)?.some(a => a.type === 'FACT_NO_PLAN')).toBe(true);
    // Короткая строка без факта аномалий не даёт, но и падать не должна.
    expect(() => detectDataAnomalies([short])).not.toThrow();
  });

  it('единая сетка не принимает обрубок за плановую процедуру (п.13)', () => {
    // Обрубок, который по признакам похож на данные (вид деятельности, предмет,
    // деньги в J), но обрывается до столбца «ИТОГО 1». До явного порога длины
    // единственной преградой здесь был гейт планового квартала — то есть
    // проверка длины в сводной сетке отсутствовала вовсе.
    const truncated: unknown[] = new Array(COL.MB_PLAN + 1).fill('');
    truncated[COL.ID] = '99';
    truncated[COL.TYPE] = 'Текущая деятельность';
    truncated[COL.SUBJECT] = 'Поставка бумаги';
    truncated[COL.MB_PLAN] = 50;

    const grid = computeUnifiedGrid(
      { ud: [planOnlyRow('1', 'Поставка бумаги', 120, 'ЭА'), truncated, ['Итого по разделу', '', '']] },
      2025,
    );

    const cell = grid.cells[unifiedKey('ud', 'all', 'kp', 'year')];
    // 120 — вклад единственной настоящей строки; 50 обрубка сюда попасть не должны.
    expect(cell?.planCount).toBe(1);
    expect(cell?.planMB).toBe(120);
  });
});

// ── п.11: якоря шапки ────────────────────────────────────────────────

/** Эталонная шапка книги ГРБС: подписи канона, разложенные по своим столбцам. */
function canonHeader(): unknown[] {
  const header: unknown[] = new Array(COL.COMMENT_UFBP + 1).fill('');
  for (const [key, idx] of Object.entries(COL) as Array<[keyof typeof COL, number]>) {
    header[idx] = DEPT_HEADER_LABELS[key];
  }
  return header;
}

describe('якоря шапки книги ГРБС (реестр 09.07.2026, п.11)', () => {
  it('эталонная шапка расхождений не даёт', () => {
    expect(checkDeptHeaderGeometry([[], [], canonHeader()])).toEqual([]);
  });

  it('вставленный столбец назван поимённо: где ожидалось и где оказалось', () => {
    const shifted = canonHeader();
    shifted.splice(COL.TOTAL_PLAN, 0, 'Новая графа');

    const mismatches = checkDeptHeaderGeometry([[], [], shifted]);
    expect(mismatches.length).toBeGreaterThan(0);
    const method = mismatches.find(m => m.expected.includes('способ определения поставщика'));
    expect(method).toBeDefined();
    expect(method!.column).toBe('L');
    expect(method!.foundAt).toBe('M');
  });

  it('чужая шапка молчит: опорных подписей в ней нет вовсе, это не сдвиг', () => {
    expect(checkDeptHeaderGeometry([[], [], ['Дата', 'Сумма', 'Примечание']])).toEqual([]);
  });
});

describe('runPipeline — съехавшие столбцы становятся замечанием, а не тишиной', () => {
  it('сдвиг раскладки книги ГРБС отдаётся критическим замечанием с адресом', () => {
    const shifted = canonHeader();
    shifted.splice(COL.TOTAL_PLAN, 0, 'Новая графа');
    const dataRow = planOnlyRow('1', 'Поставка бумаги', 120, 'ЭА');

    const snapshot = runPipeline({
      batchGetData: [],
      sheetRows: { 'УД': [[], [], shifted, dataRow] },
      reportMap: [],
      rules: [],
      spreadsheetId: 'test',
      targetYear: 2025,
    });

    const issue = snapshot.issues.find(i => i.category === 'header_geometry');
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('critical');
    expect(issue!.sheet).toBe('УД');
    expect(issue!.departmentId).toBe('ud');
    expect(issue!.description).toContain('столбце L');
  });

  it('книга с эталонной шапкой замечания о геометрии не получает', () => {
    const snapshot = runPipeline({
      batchGetData: [],
      sheetRows: { 'УД': [[], [], canonHeader(), planOnlyRow('1', 'Поставка бумаги', 120, 'ЭА')] },
      reportMap: [],
      rules: [],
      spreadsheetId: 'test',
      targetYear: 2025,
    });

    expect(snapshot.issues.filter(i => i.category === 'header_geometry')).toHaveLength(0);
  });
});
