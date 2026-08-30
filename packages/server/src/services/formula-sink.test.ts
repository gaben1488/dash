/**
 * Страж приёмника формул: разбор целостности идёт и тогда, когда снимок не
 * пересобирается. Замер на проде 30.08: формулы прочитаны (98 402 ячейки),
 * а вердикта не было — розетка пустовала, и экран молчал ровно так же, как
 * при «дефектов нет». Различие «не разбирали» ↔ «чисто» держится тестом.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  acceptFormulaDelivery,
  connectFormulaSink,
  disconnectFormulaSink,
  formulaVerdicts,
  resetFormulaVerdicts,
} from './formula-sink.js';
import { formulaDeliveryState } from './source-refresh.js';

/** Три строки книги: две здоровые, у третьей затёрта формула итога плана. */
function sheet(healthy = false): { values: string[][]; formulas: string[][]; startRow: number } {
  const values: string[][] = [];
  const formulas: string[][] = [];
  for (let i = 0; i < 3; i++) {
    const sheetRow = 4 + i;
    const v = new Array(30).fill('');
    v[0] = String(101 + i); // A — номер закупки
    v[10] = '100';          // K — итог плана
    values.push(v);
    const f = new Array(30).fill('');
    f[10] = !healthy && i === 2 ? '229.4' : `=SUM(H${sheetRow}:J${sheetRow})`;
    formulas.push(f);
  }
  return { values, formulas, startRow: 4 };
}

describe('приёмник формул', () => {
  beforeEach(() => { disconnectFormulaSink(); resetFormulaVerdicts(); });
  afterEach(() => { disconnectFormulaSink(); resetFormulaVerdicts(); });

  it('до подключения розетка пуста — разбор не обещан', () => {
    expect(formulaDeliveryState().sinkConnected).toBe(false);
    expect(formulaVerdicts()).toHaveLength(0);
  });

  it('после подключения розетка занята', () => {
    connectFormulaSink();
    expect(formulaDeliveryState().sinkConnected).toBe(true);
  });

  it('книги без вердикта нет в перечне — это не «дефектов нет»', () => {
    connectFormulaSink();
    expect(formulaVerdicts().find((v) => v.book === 'УО')).toBeUndefined();
  });

  it('вердикт считает судимые строки и находит затёртую формулу', () => {
    const { values, formulas, startRow } = sheet();
    acceptFormulaDelivery({ book: 'УИО', values, formulas, startRow, formulasRead: true });
    const v = formulaVerdicts().find((x) => x.book === 'УИО');
    expect(v).toBeDefined();
    expect(v?.rowsJudged).toBe(3);
    expect(v?.defects.some((d) => d.kind === 'formula_overwritten' && d.column === 'K')).toBe(true);
    expect(v?.defects[0]?.cell).toBe('K6');
  });

  it('здоровая книга даёт вердикт с нулём дефектов — чистота отличима от молчания', () => {
    const { values, formulas, startRow } = sheet(true);
    acceptFormulaDelivery({ book: 'УЭР', values, formulas, startRow, formulasRead: true });
    const v = formulaVerdicts().find((x) => x.book === 'УЭР');
    expect(v?.defects).toHaveLength(0);
    expect(v?.rowsJudged).toBe(3);
  });

  it('вердикт книги обновляется следующей доставкой, а не копится', () => {
    const bad = sheet();
    acceptFormulaDelivery({ book: 'УИО', values: bad.values, formulas: bad.formulas, startRow: 4, formulasRead: true });
    const good = sheet(true);
    acceptFormulaDelivery({ book: 'УИО', values: good.values, formulas: good.formulas, startRow: 4, formulasRead: true });
    const v = formulaVerdicts().filter((x) => x.book === 'УИО');
    expect(v).toHaveLength(1);
    expect(v[0].defects).toHaveLength(0);
  });
});

describe('шапка книги не судится', () => {
  it('строка номеров колонок не даёт дефектов (замер прода 30.08)', () => {
    // Лист приходит с первой строки: 1-3 — шапка, третья несёт номера
    // колонок 1..28. Раньше они читались как «затёртые формулы».
    const values: string[][] = [];
    const formulas: string[][] = [];
    for (let i = 0; i < 5; i++) {
      const sheetRow = 1 + i;
      const v = new Array(30).fill('');
      const f = new Array(30).fill('');
      if (sheetRow <= 3) {
        // Шапка: в графе A номер колонки, в формульных графах — числа.
        v[0] = String(sheetRow);
        v[26] = '27'; v[27] = '28';
        f[26] = '27'; f[27] = '28';
      } else {
        v[0] = String(100 + i);
        v[10] = '100';
        f[10] = `=SUM(H${sheetRow}:J${sheetRow})`;
      }
      values.push(v); formulas.push(f);
    }
    acceptFormulaDelivery({ book: 'УАГЗО', values, formulas, startRow: 1, formulasRead: true });
    const v = formulaVerdicts().find((x) => x.book === 'УАГЗО');
    expect(v?.defects).toHaveLength(0);
    expect(v?.rowsJudged).toBe(2);
  });
});
